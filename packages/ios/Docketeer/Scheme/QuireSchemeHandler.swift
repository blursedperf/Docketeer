import Foundation
import WebKit

/**
 * Serves quire://app/ (see AppFiles for what is answered). Files are read off the main thread. Homebase files are
 * sent in pieces, inside a coordinated read, so a lecture recording is never held in memory whole; byte ranges
 * let media seek.
 */
final class QuireSchemeHandler: NSObject, WKURLSchemeHandler {
	/** How much of a homebase file is read at a time. */
	static var chunk = 512 * 1024

	private let files: AppFiles
	private let queue = DispatchQueue(label: "quire.scheme", qos: .userInitiated, attributes: .concurrent)
	/** Tasks WebKit has not stopped yet. Answering a stopped task crashes. */
	private var live = Set<ObjectIdentifier>()
	private let lock = NSLock()

	init(files: AppFiles) {
		self.files = files
	}

	private func isLive(_ id: ObjectIdentifier) -> Bool {
		lock.lock(); defer { lock.unlock() }
		return live.contains(id)
	}

	/** Run on the main thread if the task is still live; `last` ends it. */
	private func send(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, last: Bool = false, _ body: @escaping () -> Void) {
		DispatchQueue.main.async { [weak self] in
			guard let self else { return }
			self.lock.lock()
			let ok = last ? self.live.remove(id) != nil : self.live.contains(id)
			self.lock.unlock()
			if ok { body() }
		}
	}

	func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
		let id = ObjectIdentifier(task)
		lock.lock(); live.insert(id); lock.unlock()
		guard let url = task.request.url else {
			send(task, id, last: true) { task.didFailWithError(URLError(.badURL)) }
			return
		}
		let answer = files.answer(for: url, method: task.request.httpMethod ?? "GET", range: task.request.value(forHTTPHeaderField: "Range"))
		queue.async { [weak self] in
			guard let self else { return }
			if answer.fromHomebase, let file = answer.file, let bytes = answer.bytes {
				self.stream(task, id, url, answer, file, bytes)
			} else {
				self.whole(task, id, url, answer)
			}
		}
	}

	func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
		lock.lock(); live.remove(ObjectIdentifier(task)); lock.unlock()
	}

	private func response(_ url: URL, _ status: Int, _ headers: [String: String]) -> HTTPURLResponse? {
		HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)
	}

	/** The app's own files, and errors: small, sent at once. */
	private func whole(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, _ answer: AppFiles.Answer) {
		var status = answer.status
		var headers = answer.headers
		var body = Data((status == 403 ? "Forbidden" : status == 404 ? "Not found" : status == 416 ? "" : "Error").utf8)
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
		let res = response(url, status, headers)
		send(task, id, last: true) {
			guard let res else { task.didFailWithError(URLError(.cannotParseResponse)); return }
			task.didReceive(res)
			task.didReceive(body)
			task.didFinish()
		}
	}

	/** A homebase file: the headers, then the bytes asked for, a piece at a time, until done or stopped. */
	private func stream(_ task: WKURLSchemeTask, _ id: ObjectIdentifier, _ url: URL, _ answer: AppFiles.Answer, _ file: URL, _ bytes: Range<Int>) {
		var failed: Error?
		var coordError: NSError?
		var sentHeaders = false
		NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: file, options: [], error: &coordError) { u in
			do {
				let handle = try FileHandle(forReadingFrom: u)
				defer { try? handle.close() }
				try handle.seek(toOffset: UInt64(bytes.lowerBound))
				guard let res = response(url, answer.status, answer.headers) else { throw URLError(.cannotParseResponse) }
				send(task, id) { task.didReceive(res) }
				sentHeaders = true
				var left = bytes.count
				while left > 0 && isLive(id) {
					guard let data = try handle.read(upToCount: min(Self.chunk, left)), !data.isEmpty else { break }
					left -= data.count
					send(task, id) { task.didReceive(data) }
				}
			} catch {
				failed = error
			}
		}
		if let error = failed ?? coordError {
			// Before the headers, a plain 404; after them, the load fails (it cannot be answered twice).
			if sentHeaders {
				send(task, id, last: true) { task.didFailWithError(error) }
			} else {
				whole(task, id, url, .error(404))
			}
			return
		}
		send(task, id, last: true) { task.didFinish() }
	}
}
