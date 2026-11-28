#if DEBUG
import Foundation

/**
 * A smoke run (Debug builds, started by XCTest): the page's own checks (packages/app/src/renderer/smoke.ts) in
 * WebKit, on a throwaway copy of the desktop smoke test's homebase, with throwaway settings, so the run never
 * touches the person's own homebases, recent list or settings. Native adds what only it can see: the page's
 * console errors and the navigations it refused.
 */
final class SmokeRun {
	/** The homebase: "Caselore demo", as on desktop (main.ts → smokeVault). */
	let homebase: URL
	/** Where the run's files live; removed by cleanUp. */
	let folder: URL
	/** Settings and the recent list for the run only. */
	let defaults: UserDefaults
	private let suite: String
	/** The form factor the page is told (the layout follows the window, which XCTest sizes). */
	let formFactor: String
	/** A screenshot run: the page takes the iPhone's screenshots (runShots) and they are written here. */
	var shotsFolder: URL?

	/** Console errors and uncaught errors from the page. */
	private(set) var consoleErrors: [String] = []
	/** What the page reported, with native's additions; set once. */
	private(set) var report: [String: Any]?
	/** Called once, on the main thread, with the report. */
	var onReport: (([String: Any]) -> Void)?
	/** How many navigations the lockdown refused, read when the page reports. */
	var refusedNavigations: () -> Int = { 0 }

	/** A private phrase in a test note: the run fails if it ever reaches a log (as on desktop). */
	static let privateMarker = "QUIRE-PRIVATE-7731"

	init(formFactor: String = "tablet") throws {
		self.formFactor = formFactor
		folder = FileManager.default.temporaryDirectory.appendingPathComponent("quire-smoke-\(UUID().uuidString)", isDirectory: true)
		homebase = folder.appendingPathComponent("Caselore demo", isDirectory: true)
		suite = "caselore-smoke-\(UUID().uuidString)"
		guard let d = UserDefaults(suiteName: suite) else { throw HomebaseError("No settings for the smoke run") }
		defaults = d
		let fm = FileManager.default
		try fm.createDirectory(at: homebase.appendingPathComponent("Folder"), withIntermediateDirectories: true)
		try "# Welcome\n\nA note with a [[Second note]] link.[^1]\n\n[^1]: A footnote.\n".write(to: homebase.appendingPathComponent("Welcome.md"), atomically: true, encoding: .utf8)
		try "---\ntags: [test]\n---\n\n# Second\n\nBack to [[Welcome]].\n".write(to: homebase.appendingPathComponent("Second note.md"), atomically: true, encoding: .utf8)
		try "Inside a folder. \(Self.privateMarker)\n".write(to: homebase.appendingPathComponent("Folder/Inside.md"), atomically: true, encoding: .utf8)
	}

	/** A console message from the page (ConsoleRelay). */
	func console(_ level: String, _ text: String) {
		if level == "error" || level == "uncaught" || level == "unhandled" { consoleErrors.append(text) }
		if text.contains(Self.privateMarker) || text.contains("Folder/Inside") { leaks += 1 }
	}
	private(set) var leaks = 0

	/** The page's report: native adds the console errors, refused navigations and log leaks. */
	func pageReported(_ page: Any) {
		guard report == nil else { return }
		var r = page as? [String: Any] ?? ["ok": false, "error": "The report was not an object"]
		r["consoleErrors"] = consoleErrors
		r["refusedNavigations"] = refusedNavigations()
		r["logLeaks"] = leaks
		report = r
		onReport?(r)
	}

	func cleanUp() {
		defaults.removePersistentDomain(forName: suite)
		try? FileManager.default.removeItem(at: folder)
	}
}
#endif
