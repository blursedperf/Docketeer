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

	/** Also given every message relayed (a smoke run: errors, and leaks of note text into any log). */
	private let sink: ((String, String) -> Void)?

	init(sink: ((String, String) -> Void)? = nil) {
		self.sink = sink
	}

	/** Relay `levels` of the page's console (errors and warnings; a smoke run also log and info). */
	static func install(in controller: WKUserContentController, levels: [String] = ["error", "warn"], sink: ((String, String) -> Void)? = nil) {
		let list = levels.map { "'\($0)'" }.joined(separator: ", ")
		let script = """
		(() => {
			const post = (level, args) => {
				try {
					const text = args.map((a) => a instanceof Error ? `${a.name}: ${a.message}\\n${a.stack ?? ''}` : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
					window.webkit.messageHandlers.\(name).postMessage({ level, text });
				} catch {}
			};
			for (const level of [\(list)]) {
				const orig = console[level].bind(console);
				console[level] = (...args) => { post(level, args); orig(...args); };
			}
			addEventListener('error', (e) => post('uncaught', [e.error || e.message]));
			addEventListener('unhandledrejection', (e) => post('unhandled', [e.reason]));
		})();
		"""
		controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
		controller.add(ConsoleRelay(sink: sink), contentWorld: .page, name: name)
	}

	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
		guard let body = message.body as? [String: Any] else { return }
		let level = body["level"] as? String ?? "?", text = body["text"] as? String ?? ""
		sink?(level, text)
		if level != "log" && level != "info" { NSLog("[page] %@: %@", level, text) }
	}
}
#endif
