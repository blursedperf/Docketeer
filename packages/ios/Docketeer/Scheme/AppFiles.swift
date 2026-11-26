import Foundation

/**
 * What quire://app/ answers for a URL: which bundled file, with which headers, or an error status. Kept apart
 * from WebKit so it can be tested. Mirrors registerProtocol() in packages/app/src/main/main.ts; the design is in
 * docs/mobile/decisions.md §3.
 */
struct AppFiles {
	/** An answer: a file to send with these headers, or a status with no file. */
	struct Answer: Equatable {
		var status: Int
		var file: URL?
		var headers: [String: String]

		static func error(_ status: Int) -> Answer {
			Answer(status: status, file: nil, headers: ["Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"])
		}
	}

	/** Content types for the app's own files (the same table as desktop). */
	static let mime: [String: String] = [
		"html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
		"css": "text/css; charset=utf-8", "json": "application/json", "svg": "image/svg+xml", "png": "image/png",
		"jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
		"avif": "image/avif", "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf",
	]

	/** File types served from the homebase, by extension (VAULT_TYPES in packages/app/src/main/vault-files.ts). */
	static let vaultTypes: [String: String] = [
		// Pictures
		"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
		"bmp": "image/bmp", "avif": "image/avif", "svg": "image/svg+xml",
		// Documents
		"pdf": "application/pdf",
		// Video
		"mp4": "video/mp4", "m4v": "video/mp4", "webm": "video/webm", "ogv": "video/ogg", "mov": "video/quicktime",
		// Audio
		"mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "ogg": "audio/ogg", "oga": "audio/ogg",
		"opus": "audio/ogg", "wav": "audio/wav", "flac": "audio/flac",
		// Captions, for <track>
		"vtt": "text/vtt; charset=utf-8",
	]

	static let pluginFiles: Set<String> = ["main.js", "styles.css", "manifest.json"]

	/** The built page: Resources/app/ in the bundle. */
	let root: URL
	/** The Content-Security-Policy for index.html; without one, index.html is not served. */
	let csp: String?
	/** The open homebase, served under vault/ (nil when none is open). */
	let vault: () -> HomebaseFS?

	init(root: URL, vault: @escaping () -> HomebaseFS? = { nil }) {
		self.root = root
		self.vault = vault
		let text = try? String(contentsOf: root.appendingPathComponent("renderer/csp.txt"), encoding: .utf8)
		let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		self.csp = trimmed.isEmpty ? nil : trimmed
	}

	func answer(for url: URL) -> Answer {
		guard url.scheme?.lowercased() == "quire", url.host?.lowercased() == "app" else { return .error(404) }
		guard let parts = Self.parts(of: url) else { return .error(403) }

		if parts.isEmpty || parts == ["index.html"] {
			guard let csp else { return .error(500) }
			return serve(root.appendingPathComponent("renderer"), ["index.html"], type: Self.mime["html"]!, extra: ["Content-Security-Policy": csp])
		}
		if parts[0] == "plugins" {
			guard parts.count == 3 else { return .error(404) }
			let id = parts[1], file = parts[2]
			guard Self.pluginFiles.contains(file), id.range(of: "^[a-z0-9][a-z0-9_.-]*$", options: [.regularExpression, .caseInsensitive]) != nil else { return .error(403) }
			return serve(root.appendingPathComponent("plugins"), [id, file])
		}
		if parts[0] == "vault" {
			let rest = Array(parts.dropFirst())
			guard let last = rest.last, let type = Self.vaultTypes[(last as NSString).pathExtension.lowercased()] else { return .error(403) }
			guard let fs = vault() else { return .error(404) }
			// The homebase's own checks: nothing outside it, by name or through a symlink.
			guard let file = try? fs.resolve(rest.joined(separator: "/")) else { return .error(403) }
			return serve(file: file, type: type)
		}
		return serve(root.appendingPathComponent("renderer"), parts)
	}

	/**
	 * The decoded parts of the URL's path, or nil if one is unsafe: empty, `.`, `..`, or holding NUL, `\` or `/`
	 * (an encoded slash). `quire://app/` has no parts.
	 */
	static func parts(of url: URL) -> [String]? {
		var path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? ""
		if path.hasPrefix("/") { path.removeFirst() }
		if path.isEmpty { return [] }
		var out: [String] = []
		for raw in path.split(separator: "/", omittingEmptySubsequences: false) {
			guard let part = String(raw).removingPercentEncoding else { return nil }
			if part.isEmpty || part == "." || part == ".." || part.contains("\0") || part.contains("\\") || part.contains("/") { return nil }
			out.append(part)
		}
		return out
	}

	/** True when `file`, with symlinks resolved, lies inside `dir`. */
	static func contains(_ dir: URL, _ file: URL) -> Bool {
		let base = dir.resolvingSymlinksInPath().standardizedFileURL.path
		let target = file.resolvingSymlinksInPath().standardizedFileURL.path
		return target.hasPrefix(base.hasSuffix("/") ? base : base + "/")
	}

	private func serve(_ dir: URL, _ parts: [String], type: String? = nil, extra: [String: String] = [:]) -> Answer {
		let file = parts.reduce(dir) { $0.appendingPathComponent($1) }
		guard Self.contains(dir, file) else { return .error(403) }
		return serve(file: file, type: type, extra: extra)
	}

	private func serve(file: URL, type: String? = nil, extra: [String: String] = [:]) -> Answer {
		var isDir: ObjCBool = false
		guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir), !isDir.boolValue else { return .error(404) }
		var headers = [
			"Content-Type": type ?? Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
		]
		headers.merge(extra) { _, new in new }
		return Answer(status: 200, file: file, headers: headers)
	}
}
