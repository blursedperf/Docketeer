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
	/** Called with the token of app:quit-ready: the page has saved. */
	var onQuitReady: ((String) -> Void)?

	static let configKey = "config"
	static let dictionaryLanguages: Set<String> = ["en-AU", "en-GB", "en-US"]
	static let pdfKinds: Set<String> = ["standard_fonts", "cmaps"]

	init(root: URL, defaults: UserDefaults, clipboard: TextClipboard, formFactor: String, appVersion: String) {
		self.root = root
		self.defaults = defaults
		self.clipboard = clipboard
		self.formFactor = formFactor
		self.appVersion = appVersion
	}

	func answer(_ channel: String, _ args: [Any]) throws -> Any {
		switch channel {
		case "host:info":
			let name = "Docketeer example"
			return ["platform": "ios", "appVersion": appVersion, "formFactor": formFactor, "vault": ["path": name, "name": name]]
		case "example:files":
			return try exampleFiles()
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

	private func arg<T>(_ args: [Any], _ i: Int, _: T.Type) throws -> T {
		guard i < args.count, let v = args[i] as? T else { throw BridgeError("Argument \(i + 1) has the wrong type") }
		return v
	}

	private func config() -> [String: Any] {
		guard let data = defaults.data(forKey: Self.configKey),
			let c = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
		return c
	}

	/** Every file of the bundled example homebase, hidden ones included, with paths relative to it. */
	private func exampleFiles() throws -> [[String: String]] {
		let base = root.appendingPathComponent("example-homebase", isDirectory: true).resolvingSymlinksInPath()
		guard let walk = FileManager.default.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey]) else { throw BridgeError("The example homebase is missing") }
		var out: [[String: String]] = []
		let prefix = base.path.hasSuffix("/") ? base.path : base.path + "/"
		for case let url as URL in walk {
			guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
			let full = url.resolvingSymlinksInPath().path
			guard full.hasPrefix(prefix), let data = try? Data(contentsOf: url) else { continue }
			out.append(["path": String(full.dropFirst(prefix.count)), "base64": data.base64EncodedString()])
		}
		return out.sorted { $0["path"]! < $1["path"]! }
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
