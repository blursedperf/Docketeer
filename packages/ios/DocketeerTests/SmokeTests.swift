import UIKit
import XCTest
@testable import Docketeer

/**
 * The page's smoke checks (packages/app/src/renderer/smoke.ts) in WebKit, on the iOS host: a throwaway homebase
 * and settings (SmokeRun), an iPad-sized window. Every check must pass, the page must log no errors and no note
 * text, and the lockdown must refuse no navigation. Needs the built page (npm run build -w @quire/ios).
 */
final class SmokeTests: XCTestCase {
	func testTheSmokeChecksPassInWebKit() throws {
		let run = try SmokeRun(formFactor: "tablet")
		defer { run.cleanUp() }
		let page = PageViewController(smoke: run)
		let frame = CGRect(x: 0, y: 0, width: 1194, height: 834)
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
		let report = try XCTUnwrap(run.report)

		let checks = report["checks"] as? [[String: Any]] ?? []
		let failed = checks.filter { $0["ok"] as? Bool != true }
		let summary = failed.map { "\($0["name"] as? String ?? "?"): \(($0["detail"] as? String ?? "").prefix(300))" }.joined(separator: "\n")
		let skipped = checks.compactMap { c in (c["skipped"] as? String).map { "\(c["name"] as? String ?? "?") (\($0))" } }
		print("SMOKE: \(checks.count - failed.count) of \(checks.count) checks passed; \(skipped.count) skipped on this host:\n  " + skipped.joined(separator: "\n  "))
		if let error = report["error"] { XCTFail("The page could not run its checks: \(error)") }
		XCTAssertGreaterThan(checks.count, 50, "the checks ran")
		XCTAssertTrue(failed.isEmpty, "\(failed.count) checks failed:\n\(summary)")
		XCTAssertEqual(report["consoleErrors"] as? [String] ?? ["?"], [], "console errors")
		XCTAssertEqual(report["refusedNavigations"] as? Int, 0, "navigations refused")
		XCTAssertEqual(report["logLeaks"] as? Int, 0, "note text in a log")
	}
}
