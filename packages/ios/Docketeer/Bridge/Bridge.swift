import Foundation
import WebKit

/**
 * window.quire's native side: `webkit.messageHandlers.quire.postMessage({ channel, args })` from the page, answered
 * by Channels. Only the main frame of quire://app is answered. Work runs off the main thread, except the clipboard,
 * which UIKit wants on it.
 */
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
	static let name = "quire"
	let channels: Channels
	private let queue = DispatchQueue(label: "quire.bridge", qos: .userInitiated, attributes: .concurrent)

	init(channels: Channels) {
		self.channels = channels
	}

	func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
		let origin = message.frameInfo.securityOrigin
		guard message.frameInfo.isMainFrame, origin.protocol == "quire", origin.host == "app" else {
			replyHandler(nil, "Refused")
			return
		}
		guard let body = message.body as? [String: Any], let channel = body["channel"] as? String else {
			replyHandler(nil, "A message needs a channel")
			return
		}
		let args = body["args"] as? [Any] ?? []
		let send = { (result: Result<Any, Error>) in
			let reply: (Any?, String?)
			switch result {
			case .success(let value): reply = (value, nil)
			case .failure(let e as BridgeError): reply = (nil, e.message)
			case .failure(let e as HomebaseError): reply = (nil, e.code.map { "\($0): \(e.message)" } ?? e.message)
			case .failure(let e): reply = (nil, e.localizedDescription)
			}
			DispatchQueue.main.async { replyHandler(reply.0, reply.1) }
		}
		if Channels.later.contains(channel) {
			channels.answerLater(channel, args, send)
			return
		}
		let run = { [channels] in send(Result { try channels.answer(channel, args) }) }
		if Channels.mainThread.contains(channel) { run() } else { queue.async(execute: run) }
	}
}

extension WKWebView {
	/** Tell the page of an event: window.__quireNative.emit(name, payload), which only calls registered handlers. */
	func emitQuireEvent(_ name: String, _ payload: Any = NSNull()) {
		guard let n = try? JSONSerialization.data(withJSONObject: name, options: .fragmentsAllowed),
			let p = try? JSONSerialization.data(withJSONObject: payload, options: .fragmentsAllowed) else { return }
		let js = "window.__quireNative && window.__quireNative.emit(\(String(decoding: n, as: UTF8.self)), \(String(decoding: p, as: UTF8.self)))"
		evaluateJavaScript(js, completionHandler: nil)
	}
}
