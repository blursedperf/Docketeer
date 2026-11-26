import Foundation

/** An error the page sees as the rejection of its call. */
struct BridgeError: Error, Equatable {
	let message: String
	init(_ message: String) { self.message = message }
}

/** The clipboard, as the bridge needs it (UIPasteboard in the app, a stand-in in tests). */
protocol TextClipboard: AnyObject {
	var text: String? { get set }
}

/**
 * Answers the page's calls by channel name. The names are the desktop IPC channels (packages/app/src/main/preload.ts);
 * the Phase 0 list is in packages/ios/README.md. Every channel checks its arguments, and an unknown one is an error.
 * Answers are plain JSON values (dictionaries, arrays, strings, numbers, NSNull), which WebKit hands to the page.
 */
final class Channels {
	/** The built page: Resources/app/ in the bundle. */
	let root: URL
	let defaults: UserDefaults
	let clipboard: TextClipboard
	let formFactor: String
	let appVersion: String
	let homebases: Homebases
	/** Called with the token of app:quit-ready: the page has saved. */
	var onQuitReady: ((String) -> Void)?
	/** Shows the folder picker; answers with the folder, or nil if it was cancelled (main thread). */
	var chooseFolder: ((@escaping (URL?) -> Void) -> Void)?
	/** Reloads the page, after another homebase opened (main thread). */
	var reload: (() -> Void)?
	/** Opens the Files app at a folder (main thread). */
	var showInFiles: ((URL) -> Void)?
	/** Prints a page (HTML) to PDF: page size, landscape; answers with the PDF (main thread, Printer.swift). */
	var printPDF: ((String, String?, Bool, @escaping (Result<Data, Error>) -> Void) -> Void)?
	/** Cover the window as the app goes to the background (app:coverInBackground: locked notes are open). */
	var coverInBackground = false
	/** Opens the share sheet for a file; calls back when it closes (main thread). */
	var shareFile: ((URL, @escaping () -> Void) -> Void)?
	#if DEBUG
	/** A smoke run: host:info says so, and smoke:* channels answer. */
	var smoke: SmokeRun?
	/** Sends app:system-lock to the page (smoke:system-lock, as if the device locked). */
	var systemLock: (() -> Void)?
	#endif

	/** Channels answered later, on the main thread (they show something first). */
	static let later: Set<String> = ["app:chooseVault", "app:printToPdf", "app:shareFile"]
	/** Channels that change which homebase is open, or touch UIKit: answered on the main thread. */
	static let mainThread: Set<String> = ["clipboard:readText", "clipboard:writeText", "app:quit-ready", "app:recent", "app:openVault", "app:forgetVault", "app:openExample", "app:showItemInFolder", "app:coverInBackground"]
	/** The most a new homebase's panels file may hold. */
	static let maxPanelsJSON = 1_000_000
	/** The most a page printed to PDF may hold, as desktop. */
	static let maxPrintHTML = 50_000_000

	static let configKey = "config"
	static let dictionaryLanguages: Set<String> = ["en-AU", "en-GB", "en-US"]
	static let pdfKinds: Set<String> = ["standard_fonts", "cmaps"]

	init(root: URL, defaults: UserDefaults, clipboard: TextClipboard, formFactor: String, appVersion: String, homebases: Homebases) {
		self.root = root
		self.homebases = homebases
		self.defaults = defaults
		self.clipboard = clipboard
		self.formFactor = formFactor
		self.appVersion = appVersion
	}

	func answer(_ channel: String, _ args: [Any]) throws -> Any {
		switch channel {
		case "host:info":
			let vault: Any = homebases.current.map { ["path": $0.location, "name": $0.name] } ?? NSNull()
			var info: [String: Any] = ["platform": "ios", "appVersion": appVersion, "formFactor": formFactor, "vault": vault]
			#if DEBUG
			if smoke != nil { info["isSmoke"] = true }
			#endif
			return info
		#if DEBUG
		case "smoke:report" where smoke != nil:
			let report: Any = args.first ?? NSNull()
			DispatchQueue.main.async { [smoke] in smoke?.pageReported(report) }
			return NSNull()
		case "smoke:system-lock" where smoke != nil:
			DispatchQueue.main.async { [systemLock] in systemLock?() }
			return NSNull()
		#endif
		case "app:recent":
			return homebases.recent()
		case "app:openVault":
			let location = try arg(args, 0, String.self)
			guard homebases.open(location: location) else { return false }
			afterOpening()
			return true
		case "app:forgetVault":
			homebases.forget(location: try arg(args, 0, String.self))
			return NSNull()
		case "app:showItemInFolder":
			// The Files app, at the folder (a note's own folder for a note). Nothing happens where Files cannot go.
			guard let fs = homebases.fs else { return NSNull() }
			let url = try fs.resolve(args.first)
			let folder = HomebaseFS.isFolder(url.path) ? url : url.deletingLastPathComponent()
			if let files = Self.filesURL(for: folder) { showInFiles?(files) }
			return NSNull()
		case "app:coverInBackground":
			coverInBackground = try arg(args, 0, Bool.self)
			return NSNull()
		case "app:openExample":
			let location = try homebases.openExample()
			afterOpening()
			return location
		case let c where c.hasPrefix("fs:"):
			return try fsAnswer(c, args)
		case "app:getConfig":
			return config()
		case "app:setConfig":
			let patch = try arg(args, 0, [String: Any].self)
			var c = config()
			c.merge(patch) { _, new in new }
			guard JSONSerialization.isValidJSONObject(c) else { throw BridgeError("Settings must be JSON") }
			defaults.set(try JSONSerialization.data(withJSONObject: c), forKey: Self.configKey)
			return NSNull()
		case "spell:dictionary":
			let lang = try arg(args, 0, String.self)
			guard Self.dictionaryLanguages.contains(lang) else { return NSNull() }
			let dir = root.appendingPathComponent("dictionaries").appendingPathComponent(lang)
			guard let aff = try? String(contentsOf: dir.appendingPathComponent("index.aff"), encoding: .utf8),
				let dic = try? String(contentsOf: dir.appendingPathComponent("index.dic"), encoding: .utf8) else { return NSNull() }
			return ["aff": aff, "dic": dic]
		case "app:notices":
			return (try? String(contentsOf: root.appendingPathComponent("THIRD_PARTY_NOTICES.txt"), encoding: .utf8)) ?? ""
		case "plugins:list":
			return pluginList()
		case "pdf:asset":
			let kind = try arg(args, 0, String.self), name = try arg(args, 1, String.self)
			guard Self.pdfKinds.contains(kind), name.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil else { throw BridgeError("Not a PDF asset") }
			guard let data = try? Data(contentsOf: root.appendingPathComponent("pdfjs").appendingPathComponent(kind).appendingPathComponent(name)) else { throw BridgeError("No such PDF asset") }
			return data.base64EncodedString()
		case "clipboard:readText":
			return clipboard.text ?? ""
		case "clipboard:writeText":
			clipboard.text = try arg(args, 0, String.self)
			return NSNull()
		case "app:quit-ready":
			onQuitReady?(try arg(args, 0, String.self))
			return NSNull()
		default:
			throw BridgeError("Unknown channel: \(channel)")
		}
	}

	/**
	 * Answer a channel that shows something first (Channels.later), on the main thread. app:chooseVault: the folder
	 * picker; the folder becomes the open homebase, a new Generic one gets the panels the page sent (written only
	 * if it has none), and the page reloads. Answers false if the picker was cancelled.
	 */
	func answerLater(_ channel: String, _ args: [Any], _ reply: @escaping (Result<Any, Error>) -> Void) {
		switch channel {
		case "app:printToPdf": printLater(args, reply)
		case "app:shareFile": shareLater(args, reply)
		case "app:chooseVault": chooseLater(args, reply)
		default: reply(.failure(BridgeError("Unknown channel: \(channel)")))
		}
	}

	/** app:printToPdf(html, { pageSize, landscape }): the PDF, as base64 (as pdf:asset). */
	private func printLater(_ args: [Any], _ reply: @escaping (Result<Any, Error>) -> Void) {
		guard let html = args.first as? String, !html.isEmpty, html.utf8.count <= Self.maxPrintHTML else { reply(.failure(BridgeError("Nothing to print"))); return }
		let options = args.count > 1 ? args[1] as? [String: Any] : nil
		let size = options?["pageSize"] as? String
		guard let printPDF else { reply(.failure(BridgeError("Printing is not available"))); return }
		printPDF(html, size.flatMap { Printer.sizes[$0] != nil ? $0 : nil }, options?["landscape"] as? Bool ?? false) { result in
			reply(result.map { $0.base64EncodedString() })
		}
	}

	/**
	 * app:shareFile(path): the share sheet, with a copy of the homebase file (read under coordination), so the app
	 * it goes to needs no access to the homebase. The copy is removed when the sheet closes.
	 */
	private func shareLater(_ args: [Any], _ reply: @escaping (Result<Any, Error>) -> Void) {
		guard let fs = homebases.fs else { reply(.failure(BridgeError("No homebase is open"))); return }
		guard let shareFile else { reply(.failure(BridgeError("Sharing is not available"))); return }
		do {
			let url = try fs.resolve(args.first)
			guard let path = args.first as? String, !path.split(separator: "/").contains(where: { $0.hasPrefix(".") }) else { throw BridgeError("That file cannot be shared") }
			guard !HomebaseFS.isFolder(url.path) else { throw BridgeError("A folder cannot be shared") }
			let data = try fs.readBinary(path)
			let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Share-\(UUID().uuidString)", isDirectory: true)
			try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
			let copy = folder.appendingPathComponent(url.lastPathComponent)
			try data.write(to: copy, options: .atomic)
			shareFile(copy) {
				try? FileManager.default.removeItem(at: folder)
				reply(.success(NSNull()))
			}
		} catch {
			reply(.failure(error))
		}
	}

	private func chooseLater(_ args: [Any], _ reply: @escaping (Result<Any, Error>) -> Void) {
		let create = args.first as? Bool ?? false
		let panels = args.count > 2 ? args[2] as? String : nil
		if let panels, panels.utf8.count > Self.maxPanelsJSON || (try? JSONSerialization.jsonObject(with: Data(panels.utf8))) == nil {
			reply(.failure(BridgeError("The panels for the new homebase are not valid")))
			return
		}
		guard let chooseFolder else { reply(.failure(BridgeError("The folder picker is not available"))); return }
		chooseFolder { [weak self] url in
			guard let self, let url else { reply(.success(false)); return }
			do {
				try self.homebases.add(folder: url)
				if create, let panels, let fs = self.homebases.fs, !(try fs.exists(".quire/panels.json")) {
					try fs.write(".quire/panels.json", Data(panels.utf8))
				}
				reply(.success(true))
				self.afterOpening()
			} catch {
				reply(.failure(error))
			}
		}
	}

	/** The Files app's address for a folder on this device: shareddocuments:// and its path. */
	static func filesURL(for folder: URL) -> URL? {
		var c = URLComponents()
		c.scheme = "shareddocuments"
		c.host = "" // shareddocuments:///path, as Files expects
		c.path = folder.standardizedFileURL.path
		return c.url
	}

	/** Another homebase is open: reload the page so it starts again with it (as desktop reloads the window). */
	private func afterOpening() {
		guard let reload else { return }
		DispatchQueue.main.async(execute: reload)
	}

	/** The fs:* channels, on the open homebase (the desktop's IPC; bytes as base64). */
	private func fsAnswer(_ channel: String, _ args: [Any]) throws -> Any {
		guard let fs = homebases.fs else { throw BridgeError("No homebase is open") }
		let path: Any? = args.first
		let second: Any? = args.count > 1 ? args[1] : nil
		func text(_ v: Any?) throws -> Data {
			guard let s = v as? String else { throw BridgeError("Argument 2 has the wrong type") }
			return Data(s.utf8)
		}
		switch channel {
		case "fs:tree":
			return try fs.tree(path).map { e -> [String: Any] in var j = e.stat.json; j["path"] = e.path; return j }
		case "fs:stat":
			return try fs.stat(path)?.json ?? NSNull()
		case "fs:exists":
			return try fs.exists(path)
		case "fs:read":
			return try fs.read(path)
		case "fs:readBinary":
			return try fs.readBinary(path).base64EncodedString()
		case "fs:write":
			return try fs.write(path, try text(second)).json
		case "fs:writeBinary":
			guard let b64 = second as? String, let data = Data(base64Encoded: b64) else { throw BridgeError("Argument 2 has the wrong type") }
			return try fs.write(path, data).json
		case "fs:append":
			return try fs.append(path, try text(second)).json
		case "fs:mkdir":
			try fs.mkdir(path)
			return NSNull()
		case "fs:list":
			let l = try fs.list(path)
			return ["files": l.files, "folders": l.folders]
		case "fs:remove":
			try fs.remove(path)
			return NSNull()
		case "fs:rmdir":
			try fs.rmdir(path, recursive: second as? Bool ?? false)
			return NSNull()
		case "fs:rename":
			try fs.rename(path, second)
			return NSNull()
		case "fs:copy":
			try fs.copy(path, second)
			return NSNull()
		case "fs:trash":
			return try fs.trash(path)
		case "fs:conflicts":
			return try fs.conflicts().map(\.json)
		case "fs:readConflict":
			return try fs.readConflict(path)
		case "fs:resolveConflict":
			guard let keep = second as? String else { throw BridgeError("Argument 2 has the wrong type") }
			try fs.resolveConflict(path, keep: keep, copyPath: args.count > 2 ? args[2] : nil)
			return NSNull()
		default:
			throw BridgeError("Unknown channel: \(channel)")
		}
	}

	private func arg<T>(_ args: [Any], _ i: Int, _: T.Type) throws -> T {
		guard i < args.count, let v = args[i] as? T else { throw BridgeError("Argument \(i + 1) has the wrong type") }
		return v
	}

	private func config() -> [String: Any] {
		guard let data = defaults.data(forKey: Self.configKey),
			let c = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
		return c
	}

	/** The built-in plugins: each folder in plugins/ with a manifest that has an id and a main.js. */
	private func pluginList() -> [[String: Any]] {
		let dir = root.appendingPathComponent("plugins", isDirectory: true)
		let names = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).sorted()
		var out: [[String: Any]] = []
		var seen = Set<String>()
		for name in names {
			let d = dir.appendingPathComponent(name)
			guard let data = try? Data(contentsOf: d.appendingPathComponent("manifest.json")),
				let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
				let id = manifest["id"] as? String, !seen.contains(id),
				FileManager.default.fileExists(atPath: d.appendingPathComponent("main.js").path) else { continue }
			seen.insert(id)
			out.append(["manifest": manifest, "source": "builtin", "hasStyles": FileManager.default.fileExists(atPath: d.appendingPathComponent("styles.css").path)])
		}
		return out
	}
}
