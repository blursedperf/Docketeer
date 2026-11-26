import Foundation
import WebKit

/** Serves quire://app/ from the app bundle (see AppFiles for what is answered). Files are read off the main thread. */
final class QuireSchemeHandler: NSObject, WKURLSchemeHandler {
	private let files: AppFiles
	private let queue = DispatchQueue(label: "quire.scheme", qos: .userInitiated, attributes: .concurrent)
	/** Tasks WebKit has not stopped yet (main thread only). Answering a stopped task crashes. */
	private var live = Set<ObjectIdentifier>()

	init(files: AppFiles) {
		self.files = files
	}

	func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
		let id = ObjectIdentifier(task)
		live.insert(id)
		guard let url = task.request.url else {
			live.remove(id)
			task.didFailWithError(URLError(.badURL))
			return
		}
		let answer = files.answer(for: url)
		queue.async { [weak self] in
			var status = answer.status
			var headers = answer.headers
			var body = Data((status == 403 ? "Forbidden" : status == 404 ? "Not found" : "Error").utf8)
			if let file = answer.file {
				if let data = try? Data(contentsOf: file, options: .mappedIfSafe) {
					body = data
				} else {
					status = 404
					headers = AppFiles.Answer.error(404).headers
					body = Data("Not found".utf8)
				}
			}
			headers["Content-Length"] = String(body.count)
			DispatchQueue.main.async {
				guard let self, self.live.remove(id) != nil else { return }
				guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
					task.didFailWithError(URLError(.cannotParseResponse))
					return
				}
				task.didReceive(response)
				task.didReceive(body)
				task.didFinish()
			}
		}
	}

	func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
		live.remove(ObjectIdentifier(task))
	}
}
