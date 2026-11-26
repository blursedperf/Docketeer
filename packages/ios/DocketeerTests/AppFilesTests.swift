import XCTest
@testable import Docketeer

/** quire://app/: routes, path checks and headers (docs/mobile/decisions.md §3). */
final class AppFilesTests: XCTestCase {
	private var root: URL!
	private var outside: URL!

	override func setUpWithError() throws {
		let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		root = tmp.appendingPathComponent("app")
		outside = tmp.appendingPathComponent("outside")
		try write("renderer/csp.txt", "default-src 'none'\n")
		try write("renderer/index.html", "<!DOCTYPE html>")
		try write("renderer/renderer.js", "1")
		try write("renderer/fonts/a.woff2", "f")
		try write("plugins/task-docket/main.js", "p")
		try write("plugins/task-docket/notes.txt", "n")
		try write("example-homebase/pics/cat.png", "png")
		try write("example-homebase/Welcome.md", "# Hi")
		try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
		try "secret".write(to: outside.appendingPathComponent("secret.png"), atomically: true, encoding: .utf8)
		try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("renderer/escape"), withDestinationURL: outside)
		try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("example-homebase/escape"), withDestinationURL: outside)
	}

	override func tearDownWithError() throws {
		try? FileManager.default.removeItem(at: root.deletingLastPathComponent())
	}

	private func write(_ rel: String, _ text: String) throws {
		let url = root.appendingPathComponent(rel)
		try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
		try text.write(to: url, atomically: true, encoding: .utf8)
	}

	private func answer(_ url: String) -> AppFiles.Answer {
		AppFiles(root: root).answer(for: URL(string: url)!)
	}

	func testIndexCarriesTheCSP() {
		for url in ["quire://app/", "quire://app/index.html", "quire://app"] {
			let a = answer(url)
			XCTAssertEqual(a.status, 200, url)
			XCTAssertEqual(a.headers["Content-Security-Policy"], "default-src 'none'", url)
			XCTAssertEqual(a.headers["Content-Type"], "text/html; charset=utf-8")
			XCTAssertEqual(a.file?.lastPathComponent, "index.html")
		}
	}

	func testIndexIsNotServedWithoutACSP() throws {
		try "  \n".write(to: root.appendingPathComponent("renderer/csp.txt"), atomically: true, encoding: .utf8)
		XCTAssertNil(answer("quire://app/index.html").file)
		XCTAssertNotEqual(answer("quire://app/index.html").status, 200)
	}

	func testRendererFilesHaveTypesAndNoSniff() {
		let a = answer("quire://app/renderer.js")
		XCTAssertEqual(a.status, 200)
		XCTAssertEqual(a.headers["Content-Type"], "text/javascript; charset=utf-8")
		XCTAssertEqual(a.headers["X-Content-Type-Options"], "nosniff")
		XCTAssertEqual(a.headers["Cache-Control"], "no-store")
		XCTAssertEqual(answer("quire://app/fonts/a.woff2").headers["Content-Type"], "font/woff2")
		XCTAssertEqual(answer("quire://app/missing.js").status, 404)
		XCTAssertEqual(answer("quire://app/fonts").status, 404, "a folder is not a file")
	}

	func testOnlyTheAppHost() {
		XCTAssertEqual(answer("quire://other/index.html").status, 404)
		XCTAssertEqual(answer("https://app/index.html").status, 404)
	}

	func testUnsafePathsAreRefused() {
		for url in [
			"quire://app/../outside/secret.png", "quire://app/%2e%2e/outside/secret.png", "quire://app/fonts/%2E%2E/%2E%2E/x",
			"quire://app/a%00.js", "quire://app/a%5Cb.js", "quire://app/a%2Fb.js", "quire://app//renderer.js",
			"quire://app/./renderer.js", "quire://app/vault/../csp.txt", "quire://app/vault/pics/%2e%2e/%2e%2e/renderer/renderer.js",
		] {
			XCTAssertEqual(answer(url).status, 403, url)
			XCTAssertNil(answer(url).file, url)
		}
	}

	func testSymlinksOutOfTheRootAreRefused() {
		XCTAssertEqual(answer("quire://app/escape/secret.png").status, 403)
		XCTAssertEqual(answer("quire://app/vault/escape/secret.png").status, 403)
	}

	func testPluginsOnlyServeTheirThreeFiles() {
		XCTAssertEqual(answer("quire://app/plugins/task-docket/main.js").status, 200)
		XCTAssertEqual(answer("quire://app/plugins/task-docket/styles.css").status, 404)
		XCTAssertEqual(answer("quire://app/plugins/task-docket/notes.txt").status, 403)
		XCTAssertEqual(answer("quire://app/plugins/-bad/main.js").status, 403)
		XCTAssertEqual(answer("quire://app/plugins/task-docket").status, 404)
	}

	func testVaultServesOnlyMediaTypes() {
		let a = answer("quire://app/vault/pics/cat.png")
		XCTAssertEqual(a.status, 200)
		XCTAssertEqual(a.headers["Content-Type"], "image/png")
		XCTAssertEqual(a.file?.lastPathComponent, "cat.png")
		XCTAssertEqual(answer("quire://app/vault/Welcome.md").status, 403)
		XCTAssertEqual(answer("quire://app/vault/").status, 403)
		XCTAssertEqual(answer("quire://app/vault/pics/dog.png").status, 404)
	}

	func testPartsAreDecodedOnce() {
		XCTAssertEqual(AppFiles.parts(of: URL(string: "quire://app/vault/My%20Notes/a%2520b.png")!), ["vault", "My Notes", "a%20b.png"])
		XCTAssertEqual(AppFiles.parts(of: URL(string: "quire://app/")!), [])
	}
}

/** The bridge's channels: argument checks and the bundled files. */
final class ChannelsTests: XCTestCase {
	private final class Clip: TextClipboard { var text: String? }
	private var root: URL!
	private var defaults: UserDefaults!
	private var suite: String!

	override func setUpWithError() throws {
		root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		for (rel, text) in [
			("pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap", "cmap"),
			("dictionaries/en-AU/index.aff", "aff"), ("dictionaries/en-AU/index.dic", "dic"),
			("plugins/task-docket/manifest.json", #"{"id":"task-docket","name":"Tasks"}"#), ("plugins/task-docket/main.js", ""),
			("plugins/broken/manifest.json", "{"), ("plugins/broken/main.js", ""),
			("example-homebase/Welcome.md", "# Hi"), ("example-homebase/.quire/units.json", "{}"),
		] {
			let url = root.appendingPathComponent(rel)
			try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
			try text.write(to: url, atomically: true, encoding: .utf8)
		}
		suite = "docketeer-tests-\(UUID().uuidString)"
		defaults = UserDefaults(suiteName: suite)
	}

	override func tearDownWithError() throws {
		defaults.removePersistentDomain(forName: suite)
		try? FileManager.default.removeItem(at: root)
	}

	private func channels() -> Channels {
		Channels(root: root, defaults: defaults, clipboard: Clip(), formFactor: "tablet", appVersion: "1.2.3")
	}

	func testUnknownChannelsAndWrongArgumentsAreErrors() {
		let c = channels()
		XCTAssertThrowsError(try c.answer("fs:read", ["Welcome.md"]))
		XCTAssertThrowsError(try c.answer("app:setConfig", ["not an object"]))
		XCTAssertThrowsError(try c.answer("pdf:asset", ["cmaps"]))
		XCTAssertThrowsError(try c.answer("clipboard:writeText", [3]))
	}

	func testPdfAssetsAreCheckedLikeDesktop() throws {
		let c = channels()
		XCTAssertEqual(try c.answer("pdf:asset", ["cmaps", "Adobe-Japan1-UCS2.bcmap"]) as? String, Data("cmap".utf8).base64EncodedString())
		XCTAssertThrowsError(try c.answer("pdf:asset", ["cmaps", "../dictionaries/en-AU/index.aff"]))
		XCTAssertThrowsError(try c.answer("pdf:asset", ["fonts", "x"]))
		XCTAssertThrowsError(try c.answer("pdf:asset", ["cmaps", ".hidden"]))
	}

	func testDictionariesOnlyForTheThreeLanguages() throws {
		let c = channels()
		XCTAssertEqual(try c.answer("spell:dictionary", ["en-AU"]) as? [String: String], ["aff": "aff", "dic": "dic"])
		XCTAssertTrue(try c.answer("spell:dictionary", ["../en-AU"]) is NSNull)
		XCTAssertTrue(try c.answer("spell:dictionary", ["en-GB"]) is NSNull, "listed but not bundled here")
	}

	func testSettingsMergeAndPersist() throws {
		_ = try channels().answer("app:setConfig", [["a": 1, "b": ["c": true]]])
		_ = try channels().answer("app:setConfig", [["a": 2]])
		let c = try channels().answer("app:getConfig", []) as? [String: Any]
		XCTAssertEqual(c?["a"] as? Int, 2)
		XCTAssertEqual((c?["b"] as? [String: Bool])?["c"], true)
	}

	func testPluginsAndExampleFiles() throws {
		let plugins = try channels().answer("plugins:list", []) as? [[String: Any]]
		XCTAssertEqual(plugins?.count, 1)
		XCTAssertEqual((plugins?.first?["manifest"] as? [String: Any])?["id"] as? String, "task-docket")
		XCTAssertEqual(plugins?.first?["hasStyles"] as? Bool, false)
		let files = try channels().answer("example:files", []) as? [[String: String]]
		XCTAssertEqual(files?.map { $0["path"]! }, [".quire/units.json", "Welcome.md"])
	}

	func testHostInfo() throws {
		let info = try channels().answer("host:info", []) as? [String: Any]
		XCTAssertEqual(info?["platform"] as? String, "ios")
		XCTAssertEqual(info?["formFactor"] as? String, "tablet")
		XCTAssertEqual(info?["appVersion"] as? String, "1.2.3")
	}
}
