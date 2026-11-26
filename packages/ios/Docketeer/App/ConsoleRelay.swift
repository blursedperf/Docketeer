#if DEBUG
import Foundation
import WebKit

/**
 * Debug builds only: copies the page's console errors and warnings, and uncaught errors, to the system log
 * (`xcrun simctl spawn booted log stream --predicate 'eventMessage CONTAINS "[page]"'`), so a run in the
 * simulator can be checked without Web Inspector.
 */
final class ConsoleRelay: NSObject, WKScriptMessageHandler {
	static let name = "quireConsole"

	static func install(in controller: WKUserContentController) {
		let script = """
		(() => {
			const post = (level, args) => {
				try {
					const text = args.map((a) => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
					window.webkit.messageHandlers.\(name).postMessage({ level, text });
				} catch {}
			};
			for (const level of ['error', 'warn']) {
				const orig = console[level].bind(console);
				console[level] = (...args) => { post(level, args); orig(...args); };
			}
			addEventListener('error', (e) => post('uncaught', [e.error || e.message]));
			addEventListener('unhandledrejection', (e) => post('unhandled', [e.reason]));
		})();
		"""
		controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
		controller.add(ConsoleRelay(), contentWorld: .page, name: name)
	}

	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
		guard let body = message.body as? [String: Any] else { return }
		NSLog("[page] %@: %@", body["level"] as? String ?? "?", body["text"] as? String ?? "")
	}
}
#endif
