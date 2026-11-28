import Foundation

/**
 * Finds changes to the open homebase made outside Caselore (another device through iCloud, the Files app) and
 * reports them as fs:events, the shape the desktop watcher sends: `[{ path, stat }]`, `stat` null when it went.
 *
 * Every signal leads to the same rescan, which compares each file's type, size and modification time with the
 * last scan (hidden names and symlinks skipped, as tree() does; folders only when they appear or go):
 * - coordinated changes to the folder (NSFilePresenter; iCloud and Files coordinate theirs);
 * - iCloud's metadata query, for files from other devices;
 * - returning to the foreground (rescanSoon from the scene);
 * - a slow timer while the app is open, in case a change came without a signal.
 */
final class HomebaseWatcher: NSObject, NSFilePresenter {
	struct Seen: Equatable {
		var type: String
		var size: Int
		var mtime: Int
		/** Not downloaded yet: when it arrives, that is a change even if its time is the same. */
		var pending: Bool
	}

	let fs: HomebaseFS
	/** Called with the events of a rescan, on the main thread. */
	private let emit: ([[String: Any]]) -> Void
	private let queue = DispatchQueue(label: "quire.watcher")
	private var seen: [String: Seen] = [:]
	private var pending: DispatchWorkItem?
	private var query: NSMetadataQuery?
	private var timer: Timer?

	static let settle: TimeInterval = 0.3
	static let backstop: TimeInterval = 20

	var presentedItemURL: URL? { fs.root }
	let presentedItemOperationQueue: OperationQueue = {
		let q = OperationQueue()
		q.maxConcurrentOperationCount = 1
		return q
	}()

	init(fs: HomebaseFS, emit: @escaping ([[String: Any]]) -> Void) {
		self.fs = fs
		self.emit = emit
		super.init()
	}

	/** Take the first scan, then listen (main thread). */
	func start() {
		queue.sync { seen = scan() }
		NSFileCoordinator.addFilePresenter(self)
		let q = NSMetadataQuery()
		q.searchScopes = [NSMetadataQueryAccessibleUbiquitousExternalDocumentsScope]
		q.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemPathKey, fs.root.path)
		NotificationCenter.default.addObserver(self, selector: #selector(queryChanged), name: .NSMetadataQueryDidUpdate, object: q)
		q.start()
		query = q
		timer = Timer.scheduledTimer(withTimeInterval: Self.backstop, repeats: true) { [weak self] _ in self?.rescanSoon() }
	}

	/** Stop listening (main thread). */
	func stop() {
		NSFileCoordinator.removeFilePresenter(self)
		query?.stop()
		if let query { NotificationCenter.default.removeObserver(self, name: .NSMetadataQueryDidUpdate, object: query) }
		query = nil
		timer?.invalidate()
		timer = nil
		queue.sync { pending?.cancel() }
	}

	/** Rescan shortly; several signals close together make one rescan. */
	func rescanSoon() {
		queue.async { [weak self] in
			guard let self else { return }
			self.pending?.cancel()
			let work = DispatchWorkItem { [weak self] in self?.rescan() }
			self.pending = work
			self.queue.asyncAfter(deadline: .now() + Self.settle, execute: work)
		}
	}

	/** Compare with the last scan and report what changed (on the watcher's queue). */
	func rescan() {
		let now = scan()
		let events = Self.diff(seen, now, stat: { [fs] path in fs.statOf(fs.root.appendingPathComponent(path)) })
		seen = now
		guard !events.isEmpty else { return }
		DispatchQueue.main.async { [emit] in emit(events) }
	}

	/** Events for what changed between two scans: added and changed ones with their stat, gone ones with null. */
	static func diff(_ before: [String: Seen], _ after: [String: Seen], stat: (String) -> HostStat?) -> [[String: Any]] {
		var events: [[String: Any]] = []
		for path in after.keys.sorted(by: { ($0.split(separator: "/").count, $0) < ($1.split(separator: "/").count, $1) }) where before[path] != after[path] {
			events.append(["path": path, "stat": stat(path)?.json ?? NSNull()])
		}
		for path in before.keys.sorted() where after[path] == nil {
			events.append(["path": path, "stat": NSNull()])
		}
		return events
	}

	private func scan() -> [String: Seen] {
		var out: [String: Seen] = [:]
		for e in (try? fs.tree("")) ?? [] {
			// A folder's time changes with what is in it; it is reported only when it appears or goes.
			let folder = e.stat.type == "folder"
			out[e.path] = Seen(type: e.stat.type, size: folder ? 0 : e.stat.size, mtime: folder ? 0 : e.stat.mtime, pending: e.stat.pending)
		}
		return out
	}

	@objc private func queryChanged(_ note: Notification) { rescanSoon() }

	// MARK: NSFilePresenter

	func presentedItemDidChange() { rescanSoon() }
	func presentedSubitemDidChange(at url: URL) { rescanSoon() }
	func presentedSubitemDidAppear(at url: URL) { rescanSoon() }
	func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) { rescanSoon() }
	func accommodatePresentedSubitemDeletion(at url: URL, completionHandler: @escaping (Error?) -> Void) {
		completionHandler(nil)
		rescanSoon()
	}
}
