import UIKit
import XCTest
@testable import Docketeer

/**
 * The page's smoke checks (packages/app/src/renderer/smoke.ts) in WebKit, on the iOS host: a throwaway homebase
 * and settings (SmokeRun), in an iPad-sized window and in an iPhone-sized one (the compact layout, which leaves
 * out what needs a wide window: those checks say they are skipped). Every check must pass, the page must log no errors and no note
 * text, and the lockdown must refuse no navigation. Needs the built page (npm run build -w @quire/ios).
 */
final class SmokeTests: XCTestCase {
	func testTheSmokeChecksPassInWebKit() throws {
		try runSmoke(formFactor: "tablet", size: CGSize(width: 1194, height: 834))
	}

	/** An iPhone 15 Pro Max's window, in points. */
	func testTheSmokeChecksPassOnAPhoneSizedWindow() throws {
		try runSmoke(formFactor: "phone", size: CGSize(width: 430, height: 932))
	}

	/**
	 * The iPhone's screenshots (runShots in smoke.ts), written to the folder DOCKETEER_SHOTS names; skipped without
	 * it. `npm run shots:ios -w @quire/ios` runs this alone and compares them with test/visual/ios/.
	 */
	func testPhoneScreenshots() throws {
		guard let out = ProcessInfo.processInfo.environment["DOCKETEER_SHOTS"], !out.isEmpty else { throw XCTSkip("Screenshots run only with DOCKETEER_SHOTS (npm run shots:ios)") }
		let folder = URL(fileURLWithPath: out, isDirectory: true)
		try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		for old in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] where old.pathExtension == "png" { try? FileManager.default.removeItem(at: old) }
		let report = try runPage(formFactor: "phone", size: CGSize(width: 430, height: 932), shots: folder)
		XCTAssertEqual(report["consoleErrors"] as? [String] ?? ["?"], [], "console errors")
		let taken = ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).filter { $0.hasSuffix(".png") }
		XCTAssertGreaterThanOrEqual(taken.count, 7, "screenshots taken: \(taken.sorted())")
	}

	private func runSmoke(formFactor: String, size: CGSize) throws {
		let report = try runPage(formFactor: formFactor, size: size)
		try check(report, formFactor: formFactor)
	}

	/** Loads the page in a window of `size` for a smoke run (or a screenshot run) and waits for its report. */
	private func runPage(formFactor: String, size: CGSize, shots: URL? = nil) throws -> [String: Any] {
		let run = try SmokeRun(formFactor: formFactor)
		run.shotsFolder = shots
		defer { run.cleanUp() }
		let page = PageViewController(smoke: run)
		let frame = CGRect(origin: .zero, size: size)
		let window: UIWindow
		if let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
			window = UIWindow(windowScene: scene)
			window.frame = frame
		} else {
			window = UIWindow(frame: frame)
		}
		window.rootViewController = page
		window.isHidden = false
		defer { window.isHidden = true }

		let reported = expectation(description: "the page's smoke report")
		run.onReport = { _ in reported.fulfill() }
		wait(for: [reported], timeout: 300)
		return try XCTUnwrap(run.report)
	}

	private func check(_ report: [String: Any], formFactor: String) throws {
		let checks = report["checks"] as? [[String: Any]] ?? []
		let failed = checks.filter { $0["ok"] as? Bool != true }
		let summary = failed.map { "\($0["name"] as? String ?? "?"): \(($0["detail"] as? String ?? "").prefix(300))" }.joined(separator: "\n")
		let skipped = checks.compactMap { c in (c["skipped"] as? String).map { "\(c["name"] as? String ?? "?") (\($0))" } }
		print("SMOKE (\(formFactor)): \(checks.count - failed.count) of \(checks.count) checks passed; \(skipped.count) skipped on this host:\n  " + skipped.joined(separator: "\n  "))
		if let error = report["error"] { XCTFail("The page could not run its checks: \(error)") }
		XCTAssertGreaterThan(checks.count, 50, "the checks ran")
		XCTAssertTrue(failed.isEmpty, "\(failed.count) checks failed:\n\(summary)")
		XCTAssertEqual(report["consoleErrors"] as? [String] ?? ["?"], [], "console errors")
		XCTAssertEqual(report["refusedNavigations"] as? Int, 0, "navigations refused")
		XCTAssertEqual(report["logLeaks"] as? Int, 0, "note text in a log")
	}
}
