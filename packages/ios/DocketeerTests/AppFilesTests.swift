import WebKit
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
		let homebase = try? HomebaseFS(root: root.appendingPathComponent("example-homebase"))
		return AppFiles(root: root, vault: { homebase }).answer(for: URL(string: url)!)
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
		XCTAssertEqual(AppFiles(root: root).answer(for: URL(string: "quire://app/vault/pics/cat.png")!).status, 404, "no homebase open")
		try? "plist".write(to: root.appendingPathComponent("example-homebase/pics/.lecture.mp4.icloud"), atomically: true, encoding: .utf8)
		XCTAssertEqual(answer("quire://app/vault/pics/lecture.mp4").status, 404, "not downloaded yet")
	}

	// MARK: Byte ranges (the cases of packages/app/test/vault-files.test.ts)

	func testNoHeaderOrOneItDoesNotHandleMeansTheWholeFile() {
		for h: String? in [nil, "", "items=0-5", "bytes=0-1,5-9", "bytes=-", "bytes=9-3"] {
			XCTAssertEqual(AppFiles.parseRange(h, size: 1000), .whole, String(describing: h))
		}
	}

	func testStartEndOpenEndedAndSuffixRanges() {
		XCTAssertEqual(AppFiles.parseRange("bytes=0-99", size: 1000), .range(start: 0, end: 99))
		XCTAssertEqual(AppFiles.parseRange("bytes=500-", size: 1000), .range(start: 500, end: 999))
		XCTAssertEqual(AppFiles.parseRange("bytes=-100", size: 1000), .range(start: 900, end: 999))
		XCTAssertEqual(AppFiles.parseRange("Bytes = 10 - 20", size: 1000), .range(start: 10, end: 20))
	}

	func testRangesRunningPastTheEndAreClamped() {
		XCTAssertEqual(AppFiles.parseRange("bytes=990-5000", size: 1000), .range(start: 990, end: 999))
		XCTAssertEqual(AppFiles.parseRange("bytes=-5000", size: 1000), .range(start: 0, end: 999))
		XCTAssertEqual(AppFiles.parseRange("bytes=0-99999999999999999999999", size: 1000), .range(start: 0, end: 999))
	}

	func testARangeWhollyOutsideTheFileIsUnsatisfiable() {
		XCTAssertEqual(AppFiles.parseRange("bytes=1000-", size: 1000), .unsatisfiable)
		XCTAssertEqual(AppFiles.parseRange("bytes=-0", size: 1000), .unsatisfiable)
		XCTAssertEqual(AppFiles.parseRange("bytes=0-", size: 0), .unsatisfiable)
		XCTAssertEqual(AppFiles.parseRange("bytes=99999999999999999999999-", size: 1000), .unsatisfiable)
	}

	private func media() throws {
		try Data((0..<256).map { UInt8($0) }).write(to: root.appendingPathComponent("example-homebase/pics/Week 3.mp4"))
	}

	private func homebaseAnswer(_ url: String, method: String = "GET", range: String? = nil) -> AppFiles.Answer {
		let homebase = try? HomebaseFS(root: root.appendingPathComponent("example-homebase"))
		return AppFiles(root: root, vault: { homebase }).answer(for: URL(string: url)!, method: method, range: range)
	}

	func testHomebaseMediaIsServedWholeOrByRange() throws {
		try media()
		let whole = homebaseAnswer("quire://app/vault/pics/Week%203.mp4")
		XCTAssertEqual(whole.status, 200)
		XCTAssertEqual(whole.headers["Content-Type"], "video/mp4")
		XCTAssertEqual(whole.headers["Accept-Ranges"], "bytes")
		XCTAssertEqual(whole.headers["Content-Length"], "256")
		XCTAssertEqual(whole.bytes, 0..<256)
		XCTAssertTrue(whole.fromHomebase)
		XCTAssertTrue(whole.headers["Content-Security-Policy"]?.contains("sandbox") == true, "never a page that can run anything")

		let part = homebaseAnswer("quire://app/vault/pics/Week%203.mp4", range: "bytes=16-31")
		XCTAssertEqual(part.status, 206)
		XCTAssertEqual(part.headers["Content-Range"], "bytes 16-31/256")
		XCTAssertEqual(part.headers["Content-Length"], "16")
		XCTAssertEqual(part.bytes, 16..<32)

		let past = homebaseAnswer("quire://app/vault/pics/Week%203.mp4", range: "bytes=256-")
		XCTAssertEqual(past.status, 416)
		XCTAssertEqual(past.headers["Content-Range"], "bytes */256")
		XCTAssertNil(past.file)

		let head = homebaseAnswer("quire://app/vault/pics/Week%203.mp4", method: "HEAD")
		XCTAssertEqual(head.status, 200)
		XCTAssertEqual(head.headers["Content-Length"], "256")
		XCTAssertEqual(head.bytes?.isEmpty, true, "headers only")
	}

	func testTheHandlerStreamsTheRangeInPieces() throws {
		try media()
		let homebase = try HomebaseFS(root: root.appendingPathComponent("example-homebase"))
		let handler = QuireSchemeHandler(files: AppFiles(root: root, vault: { homebase }))
		let saved = QuireSchemeHandler.chunk
		QuireSchemeHandler.chunk = 10
		defer { QuireSchemeHandler.chunk = saved }

		var request = URLRequest(url: URL(string: "quire://app/vault/pics/Week%203.mp4")!)
		request.setValue("bytes=16-79", forHTTPHeaderField: "Range")
		let task = FakeTask(request)
		handler.webView(WKWebView(), start: task)
		XCTAssertTrue(task.wait())
		XCTAssertEqual(task.response?.statusCode, 206)
		XCTAssertEqual(task.pieces, 7, "64 bytes in pieces of 10")
		XCTAssertEqual(task.body, Data((16..<80).map { UInt8($0) }))
		XCTAssertTrue(task.finished)

		// A stopped task is not answered any more.
		let stopped = FakeTask(URLRequest(url: URL(string: "quire://app/vault/pics/Week%203.mp4")!))
		let view = WKWebView()
		handler.webView(view, start: stopped)
		handler.webView(view, stop: stopped)
		RunLoop.main.run(until: Date().addingTimeInterval(0.3))
		XCTAssertFalse(stopped.finished)
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
			("example-homebase/Welcome.md", "# Hi"), ("example-homebase/.quire/example.json", "{}"),
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

	private func homebases() -> Homebases {
		Homebases(defaults: defaults, documents: root.appendingPathComponent("Documents"), exampleSource: root.appendingPathComponent("example-homebase"), deviceStorage: "On My iPad")
	}

	private func channels(_ homebases: Homebases? = nil) -> Channels {
		Channels(root: root, defaults: defaults, clipboard: Clip(), formFactor: "tablet", appVersion: "1.2.3", homebases: homebases ?? self.homebases())
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
		XCTAssertThrowsError(try channels().answer("example:files", []), "Phase 0's in-memory example is gone")
	}

	func testHostInfo() throws {
		let info = try channels().answer("host:info", []) as? [String: Any]
		XCTAssertEqual(info?["platform"] as? String, "ios")
		XCTAssertEqual(info?["formFactor"] as? String, "tablet")
		XCTAssertEqual(info?["appVersion"] as? String, "1.2.3")
		XCTAssertTrue(info?["vault"] is NSNull, "no homebase yet: the page shows its welcome")
	}

	func testTheExampleOpensFromDocumentsAndTheFsChannelsUseIt() throws {
		let hb = homebases()
		let c = channels(hb)
		var reloaded = 0
		c.reload = { reloaded += 1 }
		XCTAssertThrowsError(try c.answer("fs:read", ["Welcome.md"]), "no homebase open")
		XCTAssertEqual(try c.answer("app:openExample", []) as? String, "On My iPad/Docketeer/Docketeer example")
		let exp = expectation(description: "reload")
		DispatchQueue.main.async { exp.fulfill() }
		wait(for: [exp], timeout: 1)
		XCTAssertEqual(reloaded, 1)
		let info = try c.answer("host:info", []) as? [String: Any]
		XCTAssertEqual((info?["vault"] as? [String: String])?["name"], "Docketeer example")

		XCTAssertEqual(try c.answer("fs:read", ["Welcome.md"]) as? String, "# Hi")
		let st = try c.answer("fs:write", ["Notes/New.md", "new"]) as? [String: Any]
		XCTAssertEqual(st?["size"] as? Int, 3)
		XCTAssertEqual((try c.answer("fs:writeBinary", ["b.bin", "AQID"]) as? [String: Any])?["size"] as? Int, 3)
		XCTAssertEqual(try c.answer("fs:readBinary", ["b.bin"]) as? String, "AQID")
		XCTAssertEqual((try c.answer("fs:tree", [""]) as? [[String: Any]])?.compactMap { $0["path"] as? String }, ["Notes", "Notes/New.md", "Welcome.md", "b.bin"])
		XCTAssertEqual((try c.answer("fs:list", [""]) as? [String: [String]])?["folders"], [".quire", "Notes"])
		XCTAssertTrue(try c.answer("fs:stat", ["Missing.md"]) is NSNull)
		XCTAssertEqual(try c.answer("fs:exists", ["Notes/New.md"]) as? Bool, true)
		_ = try c.answer("fs:rename", ["Notes/New.md", "Notes/Renamed.md"])
		_ = try c.answer("fs:rmdir", ["Notes", true])
		XCTAssertEqual(try c.answer("fs:exists", ["Notes"]) as? Bool, false)
		XCTAssertThrowsError(try c.answer("fs:read", ["../../escape.md"]))
		XCTAssertThrowsError(try c.answer("fs:write", ["a.md", 3]))
		XCTAssertThrowsError(try c.answer("fs:writeBinary", ["a.bin", "not base64!"]))
		XCTAssertThrowsError(try c.answer("fs:nothing", [""]))

		// The copy in Documents is kept: opening the example again reuses it.
		_ = try c.answer("app:openExample", [])
		XCTAssertEqual(try c.answer("fs:exists", ["b.bin"]) as? Bool, true)
	}

	func testChoosingAFolderOpensItAndANewGenericOneGetsItsPanels() throws {
		let folder = root.appendingPathComponent("Picked/Law")
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		let c = channels()
		c.chooseFolder = { done in done(folder) }
		let panels = #"[{"id":"files"}]"#
		var result: Result<Any, Error>?
		c.answerLater("app:chooseVault", [true, "generic", panels]) { result = $0 }
		XCTAssertEqual(try result?.get() as? Bool, true)
		XCTAssertEqual(try String(contentsOf: folder.appendingPathComponent(".quire/panels.json"), encoding: .utf8), panels)
		let recent = try c.answer("app:recent", []) as? [[String: Any]]
		XCTAssertEqual(recent?.first?["name"] as? String, "Law")
		XCTAssertEqual(recent?.first?["current"] as? Bool, true)

		// An existing panels file is left as it is; a cancelled picker answers false; bad panels are refused.
		c.answerLater("app:chooseVault", [true, "generic", #"[{"id":"other"}]"#]) { result = $0 }
		XCTAssertEqual(try String(contentsOf: folder.appendingPathComponent(".quire/panels.json"), encoding: .utf8), panels)
		c.chooseFolder = { done in done(nil) }
		c.answerLater("app:chooseVault", [false, "legal", NSNull()]) { result = $0 }
		XCTAssertEqual(try result?.get() as? Bool, false)
		c.answerLater("app:chooseVault", [true, "generic", "{not json"]) { result = $0 }
		XCTAssertThrowsError(try result?.get())
	}
}

/** The homebases this device knows: bookmarks, the recent list, the example, where each is in words. */
final class HomebasesTests: XCTestCase {
	private var root: URL!
	private var defaults: UserDefaults!
	private var suite: String!

	override func setUpWithError() throws {
		root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		for dir in ["example/.quire", "Law", "Medicine", "Documents"] {
			try FileManager.default.createDirectory(at: root.appendingPathComponent(dir), withIntermediateDirectories: true)
		}
		try "{}".write(to: root.appendingPathComponent("example/.quire/example.json"), atomically: true, encoding: .utf8)
		suite = "docketeer-homebases-\(UUID().uuidString)"
		defaults = UserDefaults(suiteName: suite)
	}

	override func tearDownWithError() throws {
		defaults.removePersistentDomain(forName: suite)
		try? FileManager.default.removeItem(at: root)
	}

	private func make() -> Homebases {
		Homebases(defaults: defaults, documents: root.appendingPathComponent("Documents"), exampleSource: root.appendingPathComponent("example"), deviceStorage: "On My iPhone")
	}

	func testABookmarkRoundTrip() throws {
		let hb = make()
		let law = try hb.add(folder: root.appendingPathComponent("Law"))
		try hb.add(folder: root.appendingPathComponent("Medicine"))
		XCTAssertEqual(hb.current?.name, "Medicine")
		XCTAssertEqual(hb.recent().map { $0["name"] as? String }, ["Medicine", "Law"])

		// A new launch: the last one opens again, from its bookmark.
		let again = make()
		again.reopenLast()
		XCTAssertEqual(again.current?.name, "Medicine")
		XCTAssertTrue(again.open(location: law))
		XCTAssertEqual(again.current?.name, "Law")
		XCTAssertNotNil(try again.fs?.write("Torts.md", Data("x".utf8)))
		XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Law/Torts.md").path))
		XCTAssertFalse(again.open(location: "Nowhere/Else"))
	}

	func testAFolderThatWentIsMissingAndCanBeForgotten() throws {
		let hb = make()
		let law = try hb.add(folder: root.appendingPathComponent("Law"))
		try hb.add(folder: root.appendingPathComponent("Medicine"))
		try FileManager.default.removeItem(at: root.appendingPathComponent("Law"))
		let gone = hb.recent().first { $0["path"] as? String == law }
		XCTAssertEqual(gone?["missing"] as? Bool, true)
		XCTAssertFalse(hb.open(location: law))
		hb.forget(location: law)
		XCTAssertEqual(hb.recent().count, 1)
		XCTAssertEqual(hb.current?.name, "Medicine", "the open one stays open")
	}

	func testTheExampleIsCopiedOnceAndAnUnrelatedFolderIsLeftAlone() throws {
		let hb = make()
		try FileManager.default.createDirectory(at: root.appendingPathComponent("Documents/Docketeer example"), withIntermediateDirectories: true)
		let location = try hb.openExample()
		XCTAssertEqual(location, "On My iPhone/Docketeer/Docketeer example 2", "a folder of that name that is not the example is not used")
		try hb.fs?.write("Mine.md", Data("mine".utf8))
		XCTAssertEqual(try make().openExample(), location)
		XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("Documents/Docketeer example 2/Mine.md").path))
	}

	func testTheListKeepsTwelve() throws {
		let hb = make()
		for n in 1...14 {
			let dir = root.appendingPathComponent("Subject \(n)")
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
			try hb.add(folder: dir)
		}
		XCTAssertEqual(hb.recent().count, 12)
		XCTAssertEqual(hb.recent().first?["name"] as? String, "Subject 14")
	}

	func testWhereAFolderIsInWords() {
		let docs = URL(fileURLWithPath: "/var/mobile/Containers/Data/Application/ABC/Documents")
		let say = { (p: String) in Homebases.location(of: URL(fileURLWithPath: p), documents: docs, deviceStorage: "On My iPad") }
		XCTAssertEqual(say("/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Law/Torts"), "iCloud Drive/Law/Torts")
		XCTAssertEqual(say("/var/mobile/Containers/Data/Application/ABC/Documents/Docketeer example"), "On My iPad/Docketeer/Docketeer example")
		XCTAssertEqual(say("/private/var/mobile/Containers/Shared/AppGroup/X/File Provider Storage/Notes"), "On My iPad/Notes")
		XCTAssertEqual(say("/Volumes/USB/Uni/Law/Notes"), "Uni/Law/Notes")
	}
}

/** A stand-in for WebKit's task: records what the handler sends. */
final class FakeTask: NSObject, WKURLSchemeTask {
	let request: URLRequest
	var response: HTTPURLResponse?
	var body = Data()
	var pieces = 0
	var finished = false
	var error: Error?

	init(_ request: URLRequest) { self.request = request }

	func didReceive(_ response: URLResponse) { self.response = response as? HTTPURLResponse }
	func didReceive(_ data: Data) { body.append(data); pieces += 1 }
	func didFinish() { finished = true }
	func didFailWithError(_ error: Error) { self.error = error }

	/** Wait (running the main queue, where answers arrive) until it finished or failed. */
	func wait(_ seconds: TimeInterval = 3) -> Bool {
		let until = Date().addingTimeInterval(seconds)
		while !finished && error == nil && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
		return finished
	}
}
