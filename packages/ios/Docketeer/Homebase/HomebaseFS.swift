import Darwin
import Foundation

/** A file or folder as the page sees it (HostStat in packages/api/src/host.ts). */
struct HostStat: Equatable {
	var type: String
	var size: Int
	/** Milliseconds since 1970, rounded, as desktop. */
	var mtime: Int
	var ctime: Int
	/** Not downloaded to this device yet (iCloud). */
	var pending = false

	var json: [String: Any] {
		var j: [String: Any] = ["type": type, "size": size, "mtime": mtime, "ctime": ctime]
		if pending { j["pending"] = true }
		return j
	}
}

/** An error the page sees; `code` is set for the ones it acts on (`conflict`, from the conflict guard). */
struct HomebaseError: Error, Equatable {
	let message: String
	var code: String?
	init(_ message: String, code: String? = nil) { self.message = message; self.code = code }
}

/**
 * The homebase on disk: every HostFs call, with the desktop host's behaviour (the fs:* handlers in
 * packages/app/src/main/main.ts) and the checks in docs/mobile/decisions.md §5. Paths are relative to the root,
 * with forward slashes; a path that leaves the root, by name or through a symlink, is refused. Reads and writes go
 * through NSFileCoordinator, and writes are atomic.
 */
final class HomebaseFS {
	let root: URL
	/** The root with symlinks resolved, for the containment check. */
	let realRoot: String
	private let fm = FileManager.default
	/** For the conflict guard: the modification time Docketeer last read or wrote, by homebase path. */
	private var known: [String: Int] = [:]
	private let knownLock = NSLock()
	/** How long reading a file waits for iCloud to download it. */
	var downloadWait: TimeInterval = 60

	init(root: URL) throws {
		let root = root.standardizedFileURL
		guard let real = Self.realpath(root.path), Self.isFolder(real) else { throw HomebaseError("The homebase folder is missing") }
		self.root = root
		self.realRoot = real
	}

	// MARK: Paths

	/** The file URL for a homebase path, or an error if it is not a string, holds NUL, or leaves the root. */
	func resolve(_ rel: Any?) throws -> URL {
		guard let rel = rel as? String, !rel.contains("\0") else { throw HomebaseError("Invalid path") }
		var parts: [String] = []
		for part in rel.drop(while: { $0 == "/" || $0 == "\\" }).split(separator: "/", omittingEmptySubsequences: true) {
			if part == "." { continue }
			if part == ".." {
				guard !parts.isEmpty else { throw HomebaseError("Path outside the homebase: \(rel)") }
				parts.removeLast()
				continue
			}
			parts.append(String(part))
		}
		let url = parts.reduce(root) { $0.appendingPathComponent($1) }
		// The nearest part that exists, symlinks followed, must really be inside the root. A symlink that leads
		// nowhere cannot be resolved, so it is refused too.
		var probe = url
		while !Self.exists(probe.path) && probe.path != root.path { probe.deleteLastPathComponent() }
		guard let real = Self.realpath(probe.path), Self.inside(realRoot, real) else { throw HomebaseError("Path outside the homebase: \(rel)") }
		return url
	}

	/** The homebase path of a URL under the root. */
	func relative(_ url: URL) -> String {
		String(url.standardizedFileURL.path.dropFirst(root.path.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
	}

	static func inside(_ base: String, _ path: String) -> Bool {
		path == base || path.hasPrefix(base.hasSuffix("/") ? base : base + "/")
	}

	static func realpath(_ path: String) -> String? {
		guard let r = Darwin.realpath(path, nil) else { return nil }
		defer { free(r) }
		return String(cString: r)
	}

	/** True if something is at the path, a symlink included (not followed). */
	static func exists(_ path: String) -> Bool {
		var st = Darwin.stat()
		return lstat(path, &st) == 0
	}

	static func isFolder(_ path: String) -> Bool {
		var dir: ObjCBool = false
		return FileManager.default.fileExists(atPath: path, isDirectory: &dir) && dir.boolValue
	}

	static func isSymlink(_ path: String) -> Bool {
		var st = Darwin.stat()
		return lstat(path, &st) == 0 && (st.st_mode & S_IFMT) == S_IFLNK
	}

	private func refuseRoot(_ url: URL) throws {
		if url.path == root.path { throw HomebaseError("Cannot remove the homebase") }
	}

	// MARK: iCloud downloads

	/** The stand-in iCloud leaves for a file not downloaded: ".Name.md.icloud" beside where it will be. */
	static func standIn(for url: URL) -> URL {
		url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
	}

	/** The file a stand-in is for ("Name.md" for ".Name.md.icloud"), or nil if the name is not a stand-in. */
	static func standInTarget(_ name: String) -> String? {
		guard name.hasPrefix("."), name.hasSuffix(".icloud"), name.count > ".".count + ".icloud".count else { return nil }
		return String(name.dropFirst().dropLast(".icloud".count))
	}

	/** True when the file is in iCloud but not on this device: a stand-in, or a file without its contents yet. */
	func isPending(_ url: URL) -> Bool {
		if !Self.exists(url.path) { return Self.exists(Self.standIn(for: url).path) }
		guard let v = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]),
			v.isUbiquitousItem == true, let status = v.ubiquitousItemDownloadingStatus else { return false }
		return status != .current && status != .downloaded
	}

	/** Ask iCloud to bring the file to this device (nothing happens for a file that is not in iCloud). */
	func startDownload(_ url: URL) {
		try? fm.startDownloadingUbiquitousItem(at: url)
	}

	/** Wait for a file iCloud is still downloading (starting the download), up to `downloadWait`. */
	private func ensureDownloaded(_ url: URL) throws {
		guard isPending(url) else { return }
		startDownload(url)
		let until = Date().addingTimeInterval(downloadWait)
		while isPending(url) {
			if Date() > until { throw HomebaseError("“\(url.lastPathComponent)” is still downloading from iCloud. Try again in a moment.") }
			Thread.sleep(forTimeInterval: 0.25)
		}
	}

	// MARK: The conflict guard

	/**
	 * Files the guard covers: everything but the settings in .quire/, which stay last-write-wins as on desktop
	 * (decisions.md §5).
	 */
	static func guarded(_ rel: String) -> Bool {
		!(rel == ".quire" || rel.hasPrefix(".quire/"))
	}

	private func remember(_ rel: String, _ mtime: Int?) {
		knownLock.lock(); defer { knownLock.unlock() }
		known[rel] = mtime
	}

	/** Forget a path and everything under it (removed), or move what is remembered (renamed). */
	private func forget(_ rel: String, movingTo dest: String? = nil) {
		knownLock.lock(); defer { knownLock.unlock() }
		for (path, mtime) in known where path == rel || path.hasPrefix(rel + "/") {
			known[path] = nil
			if let dest { known[dest + path.dropFirst(rel.count)] = mtime }
		}
	}

	/** Refuse to replace a file that changed on disk since Docketeer last read or wrote it. */
	private func check(_ rel: String, _ url: URL) throws {
		guard Self.guarded(rel) else { return }
		knownLock.lock()
		let last = known[rel]
		knownLock.unlock()
		guard let last, let now = statOf(url), now.mtime != last else { return }
		throw HomebaseError("“\(rel)” changed on disk since Docketeer read it", code: "conflict")
	}

	// MARK: Coordination

	private func reading<T>(_ url: URL, _ body: (URL) throws -> T) throws -> T {
		var coordError: NSError?
		var result: Result<T, Error> = .failure(HomebaseError("Could not read \(relative(url))"))
		NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { u in
			result = Result { try body(u) }
		}
		if let coordError { throw coordError }
		return try result.get()
	}

	private func writing<T>(_ url: URL, _ options: NSFileCoordinator.WritingOptions = .forReplacing, _ body: (URL) throws -> T) throws -> T {
		var coordError: NSError?
		var result: Result<T, Error> = .failure(HomebaseError("Could not write \(relative(url))"))
		NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordError) { u in
			result = Result { try body(u) }
		}
		if let coordError { throw coordError }
		return try result.get()
	}

	// MARK: HostFs

	func stat(_ rel: Any?) throws -> HostStat? {
		statOf(try resolve(rel))
	}

	func statOf(_ url: URL) -> HostStat? {
		let ms = { (d: Any?) in Int(((d as? Date)?.timeIntervalSince1970 ?? 0) * 1000 + 0.5) }
		guard let a = try? fm.attributesOfItem(atPath: url.resolvingSymlinksInPath().path) else {
			// Only iCloud's stand-in is here: the file, not downloaded yet.
			let standIn = Self.standIn(for: url)
			guard Self.exists(standIn.path), let s = try? fm.attributesOfItem(atPath: standIn.path) else { return nil }
			return HostStat(type: "file", size: 0, mtime: ms(s[.modificationDate]), ctime: ms(s[.creationDate] ?? s[.modificationDate]), pending: true)
		}
		let folder = (a[.type] as? FileAttributeType) == .typeDirectory
		return HostStat(type: folder ? "folder" : "file", size: (a[.size] as? NSNumber)?.intValue ?? 0, mtime: ms(a[.modificationDate]), ctime: ms(a[.creationDate] ?? a[.modificationDate]), pending: !folder && isPending(url))
	}

	func exists(_ rel: Any?) throws -> Bool {
		let url = try resolve(rel)
		return fm.fileExists(atPath: url.path) || Self.exists(Self.standIn(for: url).path)
	}

	/**
	 * Every file and folder under `rel` (the whole homebase for ""), skipping names that start with "." and symlinks.
	 * Files iCloud has not downloaded are listed `pending`; notes among them start downloading (other files, such as
	 * recordings, only when opened).
	 */
	func tree(_ rel: Any?) throws -> [(path: String, stat: HostStat)] {
		let start = try resolve(rel)
		var out: [(path: String, stat: HostStat)] = []
		func walk(_ dir: URL) {
			guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return }
			let present = Set(names)
			var listed = names.filter { !$0.hasPrefix(".") }
			// Stand-ins: list the file they are for, unless it is here already.
			for name in names { if let target = Self.standInTarget(name), !present.contains(target), !target.hasPrefix(".") { listed.append(target) } }
			for name in listed.sorted() {
				let url = dir.appendingPathComponent(name)
				if Self.isSymlink(url.path) { continue }
				guard let st = statOf(url) else { continue }
				if st.pending, url.pathExtension.lowercased() == "md" { startDownload(url) }
				out.append((relative(url), st))
				if st.type == "folder" { walk(url) }
			}
		}
		walk(start)
		return out
	}

	func read(_ rel: Any?) throws -> String {
		let data = try readBinary(rel)
		guard let text = String(data: data, encoding: .utf8) else { throw HomebaseError("Not UTF-8 text: \(rel as? String ?? "")") }
		return text
	}

	func readBinary(_ rel: Any?) throws -> Data {
		let url = try resolve(rel)
		let path = relative(url)
		try ensureDownloaded(url)
		return try reading(url) { u in
			let before = statOf(u)
			let data = try Data(contentsOf: u)
			remember(path, before?.mtime)
			return data
		}
	}

	/** Atomic write: a hidden temporary file beside the old one replaces it. Creates missing parent folders. */
	@discardableResult
	func write(_ rel: Any?, _ data: Data) throws -> HostStat {
		let url = try resolve(rel)
		if Self.isFolder(url.path) { throw HomebaseError("A folder is there: \(relative(url))") }
		let path = relative(url)
		return try writing(url) { u in
			try check(path, u)
			try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
			let tmp = u.deletingLastPathComponent().appendingPathComponent(".\(u.lastPathComponent).\(UUID().uuidString).quire-tmp")
			do {
				try data.write(to: tmp)
				guard Darwin.rename(tmp.path, u.path) == 0 else { throw HomebaseError("Could not save \(relative(u)): \(String(cString: strerror(errno)))") }
			} catch {
				try? fm.removeItem(at: tmp)
				throw error
			}
			guard let st = statOf(u) else { throw HomebaseError("Could not save \(relative(u))") }
			remember(path, st.mtime)
			return st
		}
	}

	@discardableResult
	func append(_ rel: Any?, _ data: Data) throws -> HostStat {
		let url = try resolve(rel)
		return try writing(url, .forMerging) { u in
			try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
			if !fm.fileExists(atPath: u.path) { fm.createFile(atPath: u.path, contents: nil) }
			let handle = try FileHandle(forWritingTo: u)
			defer { try? handle.close() }
			try handle.seekToEnd()
			try handle.write(contentsOf: data)
			guard let st = statOf(u) else { throw HomebaseError("Could not save \(relative(u))") }
			remember(relative(u), st.mtime)
			return st
		}
	}

	func mkdir(_ rel: Any?) throws {
		let url = try resolve(rel)
		try writing(url) { try fm.createDirectory(at: $0, withIntermediateDirectories: true) }
	}

	/** Direct children of a folder, hidden names included. */
	func list(_ rel: Any?) throws -> (files: [String], folders: [String]) {
		let url = try resolve(rel)
		var files: [String] = [], folders: [String] = []
		for name in try fm.contentsOfDirectory(atPath: url.path).sorted() {
			let child = url.appendingPathComponent(name)
			if !Self.isSymlink(child.path) && Self.isFolder(child.path) { folders.append(relative(child)) } else { files.append(relative(child)) }
		}
		return (files, folders)
	}

	/** Remove a file (not a folder: that is rmdir). */
	func remove(_ rel: Any?) throws {
		let url = try resolve(rel)
		if !Self.isSymlink(url.path) && Self.isFolder(url.path) { throw HomebaseError("A folder, not a file: \(relative(url))") }
		try writing(url, .forDeleting) { try fm.removeItem(at: $0) }
		forget(relative(url))
	}

	/** Remove a folder: with everything in it if `recursive`, otherwise only when it is empty. */
	func rmdir(_ rel: Any?, recursive: Bool) throws {
		let url = try resolve(rel)
		try refuseRoot(url)
		guard Self.isFolder(url.path) else { throw HomebaseError("Not a folder: \(relative(url))") }
		if !recursive, !(try fm.contentsOfDirectory(atPath: url.path)).isEmpty { throw HomebaseError("The folder is not empty: \(relative(url))") }
		try writing(url, .forDeleting) { try fm.removeItem(at: $0) }
		forget(relative(url))
	}

	/** Move or rename; replaces what is at `to`, as desktop does. Creates missing parent folders. */
	func rename(_ from: Any?, _ to: Any?) throws {
		let a = try resolve(from), b = try resolve(to)
		try refuseRoot(a)
		guard Self.exists(a.path) else { throw HomebaseError("Not found: \(relative(a))") }
		var coordError: NSError?
		var result: Result<Void, Error> = .success(())
		let coordinator = NSFileCoordinator(filePresenter: nil)
		coordinator.coordinate(writingItemAt: a, options: .forMoving, writingItemAt: b, options: .forReplacing, error: &coordError) { ua, ub in
			result = Result {
				try fm.createDirectory(at: ub.deletingLastPathComponent(), withIntermediateDirectories: true)
				guard Darwin.rename(ua.path, ub.path) == 0 else { throw HomebaseError("Could not move \(relative(ua)): \(String(cString: strerror(errno)))") }
				coordinator.item(at: ua, didMoveTo: ub)
			}
		}
		if let coordError { throw coordError }
		try result.get()
		forget(relative(a), movingTo: relative(b))
	}

	/** Copy a file; replaces what is at `to`, atomically. */
	func copy(_ from: Any?, _ to: Any?) throws {
		let data = try readBinary(from)
		try write(to, data)
	}

	/** Move to the trash; where the folder has none, to <homebase>/.trash/. False if neither worked. */
	func trash(_ rel: Any?) throws -> Bool {
		let url = try resolve(rel)
		try refuseRoot(url)
		guard Self.exists(url.path) else { return false }
		if (try? writing(url, .forDeleting, { try fm.trashItem(at: $0, resultingItemURL: nil) })) != nil {
			forget(relative(url))
			return true
		}
		let bin = root.appendingPathComponent(".trash", isDirectory: true)
		let base = url.deletingPathExtension().lastPathComponent, ext = url.pathExtension
		var dest = bin.appendingPathComponent(url.lastPathComponent)
		var n = 2
		while Self.exists(dest.path) {
			dest = bin.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
			n += 1
		}
		do {
			try fm.createDirectory(at: bin, withIntermediateDirectories: true)
			try rename(relative(url), relative(dest))
			return true
		} catch {
			return false
		}
	}
}
