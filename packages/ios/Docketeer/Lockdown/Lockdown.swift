import Foundation
import WebKit

/**
 * Keeps the page offline (PLAN §2.7, docs/mobile/decisions.md §3): a content rule list that blocks every load but
 * quire://app/, data: and blob:, navigation only within quire://app/, no new windows, and no permissions.
 */
enum Lockdown {
	static let ruleListID = "quire-offline-v1"

	/** Block everything, then let through the app's own scheme, data: and blob:. */
	static let rules = """
	[
		{ "trigger": { "url-filter": ".*" }, "action": { "type": "block" } },
		{ "trigger": { "url-filter": "^quire://app/" }, "action": { "type": "ignore-previous-rules" } },
		{ "trigger": { "url-filter": "^data:" }, "action": { "type": "ignore-previous-rules" } },
		{ "trigger": { "url-filter": "^blob:" }, "action": { "type": "ignore-previous-rules" } }
	]
	"""

	/** Compile (or reuse) the rule list. The page must not load without it. */
	static func ruleList(_ done: @escaping (Result<WKContentRuleList, Error>) -> Void) {
		WKContentRuleListStore.default().compileContentRuleList(forIdentifier: ruleListID, encodedContentRuleList: rules) { list, error in
			if let list { done(.success(list)) } else { done(.failure(error ?? BridgeError("The offline rules did not compile"))) }
		}
	}

	/** Only quire://app/ may be shown. */
	static func allows(_ url: URL?) -> Bool {
		url?.scheme?.lowercased() == "quire" && url?.host?.lowercased() == "app"
	}

	/** Settings that would otherwise reach the network or hand links to other apps. */
	static func apply(to config: WKWebViewConfiguration) {
		config.preferences.isFraudulentWebsiteWarningEnabled = false
		config.dataDetectorTypes = []
		config.upgradeKnownHostsToHTTPS = false
	}
}

/** The navigation and UI delegate: refuses leaving quire://app/, new windows and permission requests. */
final class LockdownDelegate: NSObject, WKNavigationDelegate, WKUIDelegate {
	/** Navigations refused, for the smoke checks (PLAN Phase 1: blocked requests = 0). */
	private(set) var refused: [String] = []

	func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
		if Lockdown.allows(action.request.url) {
			decisionHandler(.allow)
		} else {
			let scheme = action.request.url?.scheme ?? "?"
			refused.append(scheme)
			NSLog("Docketeer refused a navigation (%@:)", scheme)
			decisionHandler(.cancel)
		}
	}

	func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
		nil
	}

	func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
		decisionHandler(.deny)
	}

	func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
		decisionHandler(.deny)
	}

	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		webView.reload()
	}
}
