import Foundation

/**
 * The homebases this device knows (decisions.md §5): folders picked with the system picker, each kept as a
 * security-scoped bookmark in UserDefaults (on this device only), and the example homebase in the app's own
 * Documents folder. One is open at a time; its folder access lasts until another opens.
 *
 * The page knows each one by where it is, in words ("iCloud Drive/Law"): that is `path` in the recent list, and
 * the key for its bookmark. The page never sees a real path.
 */
final class Homebases {
	struct Entry: Codable, Equatable {
		var location: String
		var name: String
		/** Milliseconds since 1970, when it was last opened. */
		var time: Double
		var bookmark: Data?
		/** The example homebase: found in Documents by `folder`, not by bookmark (the app's folder moves on reinstall). */
		var example: Bool = false
		var folder: String?
	}

	static let exampleName = "Caselore example"
	static let exampleMarker = ".quire/example.json"
	static let maxRecent = 12

	private let defaults: UserDefaults
	private let key: String
	/** The app's Documents folder (where the example goes; Files shows it under "On My iPad › Caselore"). */
	let documents: URL
	/** The example homebase in the app bundle. */
	let exampleSource: URL
	/** "On My iPad" or "On My iPhone", as Files says it. */
	let deviceStorage: String

	/** Called on the main thread when a homebase opens (with its files), to start watching it. */
	var onOpen: ((HomebaseFS) -> Void)?

	private let lock = NSLock()
	private var openEntry: Entry?
	private var openFolder: URL?
	private var openFS: HomebaseFS?
	private var scoped = false

	init(defaults: UserDefaults, key: String = "homebases", documents: URL, exampleSource: URL, deviceStorage: String) {
		self.defaults = defaults
		self.key = key
		self.documents = documents
		self.exampleSource = exampleSource
		self.deviceStorage = deviceStorage
	}

	// MARK: The open homebase

	/** The open homebase's files, or nil. Safe from any thread. */
	var fs: HomebaseFS? {
		lock.lock(); defer { lock.unlock() }
		return openFS
	}

	/** The open homebase for host:info: where it is (in words) and its name. */
	var current: (location: String, name: String)? {
		lock.lock(); defer { lock.unlock() }
		return openEntry.map { ($0.location, $0.name) }
	}

	/** At launch: open the homebase that was open last, if it is still there. */
	func reopenLast() {
		if let last = defaults.string(forKey: key + ".current") { _ = open(location: last) }
	}

	/** Open a known homebase. False if it is not known or its folder cannot be reached. */
	@discardableResult
	func open(location: String) -> Bool {
		guard var entry = entries().first(where: { $0.location == location }),
			let (url, isScoped, renewed) = reach(entry) else { return false }
		guard let fs = try? HomebaseFS(root: url) else {
			if isScoped { url.stopAccessingSecurityScopedResource() }
			return false
		}
		if let renewed { entry.bookmark = renewed }
		entry.time = Date().timeIntervalSince1970 * 1000
		setOpen(entry, url, fs, isScoped)
		save([entry] + entries().filter { $0.location != location })
		defaults.set(location, forKey: key + ".current")
		return true
	}

	/** Add a folder from the picker (or bring it to the top of the list), and open it. */
	@discardableResult
	func add(folder url: URL) throws -> String {
		let scopedNow = url.startAccessingSecurityScopedResource()
		defer { if scopedNow { url.stopAccessingSecurityScopedResource() } }
		let bookmark = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
		let location = Self.location(of: url, documents: documents, deviceStorage: deviceStorage)
		let entry = Entry(location: location, name: url.lastPathComponent, time: Date().timeIntervalSince1970 * 1000, bookmark: bookmark)
		save([entry] + entries().filter { $0.location != location })
		guard open(location: location) else { throw HomebaseError("Caselore could not open “\(url.lastPathComponent)”.") }
		return location
	}

	/** Copy the example homebase into Documents the first time, then open it. Returns where it is, in words. */
	@discardableResult
	func openExample() throws -> String {
		let fm = FileManager.default
		guard fm.fileExists(atPath: exampleSource.appendingPathComponent(Self.exampleMarker).path) else { throw HomebaseError("The example homebase is missing from this installation") }
		var folder: String?
		for n in 1...99 {
			let name = n == 1 ? Self.exampleName : "\(Self.exampleName) \(n)"
			let dest = documents.appendingPathComponent(name, isDirectory: true)
			if fm.fileExists(atPath: dest.path) {
				if fm.fileExists(atPath: dest.appendingPathComponent(Self.exampleMarker).path) { folder = name; break }
				continue
			}
			try fm.createDirectory(at: documents, withIntermediateDirectories: true)
			try fm.copyItem(at: exampleSource, to: dest)
			folder = name
			break
		}
		guard let folder else { throw HomebaseError("Too many folders called “\(Self.exampleName)”") }
		let location = "\(deviceStorage)/Caselore/\(folder)"
		let entry = Entry(location: location, name: folder, time: Date().timeIntervalSince1970 * 1000, bookmark: nil, example: true, folder: folder)
		save([entry] + entries().filter { $0.location != location })
		guard open(location: location) else { throw HomebaseError("Caselore could not open the example homebase") }
		return location
	}

	/** Take a homebase off the list (its folder is not touched). The open one stays open. */
	func forget(location: String) {
		save(entries().filter { $0.location != location })
		if defaults.string(forKey: key + ".current") == location { defaults.removeObject(forKey: key + ".current") }
	}

	/** The recent list for the page, newest first: `missing` when its folder cannot be reached, `current` for the open one. */
	func recent() -> [[String: Any]] {
		let open = current?.location
		return entries().map { e in
			var item: [String: Any] = ["path": e.location, "name": e.name, "time": e.time]
			if e.location == open {
				item["current"] = true
			} else if let (url, isScoped, _) = reach(e) {
				if isScoped { url.stopAccessingSecurityScopedResource() }
			} else {
				item["missing"] = true
			}
			return item
		}
	}

	// MARK: Inside

	/** The folder of an entry, with access started if it is security-scoped, and a renewed bookmark if it was stale. */
	private func reach(_ e: Entry) -> (URL, Bool, Data?)? {
		if e.example {
			guard let folder = e.folder else { return nil }
			let url = documents.appendingPathComponent(folder, isDirectory: true)
			return HomebaseFS.isFolder(url.path) ? (url, false, nil) : nil
		}
		guard let bookmark = e.bookmark else { return nil }
		var stale = false
		guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { return nil }
		let isScoped = url.startAccessingSecurityScopedResource()
		guard HomebaseFS.isFolder(url.path) else {
			if isScoped { url.stopAccessingSecurityScopedResource() }
			return nil
		}
		let renewed = stale ? try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) : nil
		return (url, isScoped, renewed)
	}

	private func setOpen(_ entry: Entry, _ url: URL, _ fs: HomebaseFS, _ isScoped: Bool) {
		lock.lock()
		let (oldURL, oldScoped) = (openFolder, scoped)
		openEntry = entry
		openFolder = url
		openFS = fs
		scoped = isScoped
		lock.unlock()
		// Access is counted: the new one was started already, so the old one ends even when it is the same folder.
		if let oldURL, oldScoped { oldURL.stopAccessingSecurityScopedResource() }
		onOpen?(fs)
	}

	func entries() -> [Entry] {
		guard let data = defaults.data(forKey: key), let list = try? JSONDecoder().decode([Entry].self, from: data) else { return [] }
		return list
	}

	private func save(_ list: [Entry]) {
		defaults.set(try? JSONEncoder().encode(Array(list.prefix(Self.maxRecent))), forKey: key)
	}

	/**
	 * Where a folder is, in the words Files uses: "iCloud Drive/Law/Torts", "On My iPad/Caselore/…", or, for
	 * another provider, its last three folders.
	 */
	static func location(of url: URL, documents: URL, deviceStorage: String) -> String {
		let parts = url.standardizedFileURL.pathComponents
		if let i = parts.firstIndex(of: "com~apple~CloudDocs") {
			return (["iCloud Drive"] + parts[(i + 1)...]).joined(separator: "/")
		}
		let docs = documents.standardizedFileURL.pathComponents
		if parts.count > docs.count, Array(parts.prefix(docs.count)) == docs {
			return ([deviceStorage, "Caselore"] + parts[docs.count...]).joined(separator: "/")
		}
		if let i = parts.firstIndex(of: "File Provider Storage") {
			return ([deviceStorage] + parts[(i + 1)...]).joined(separator: "/")
		}
		return parts.suffix(3).joined(separator: "/")
	}
}
