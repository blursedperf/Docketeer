import UIKit
import WebKit

/**
 * Export to PDF on iOS (docs/mobile/PLAN.md, Phase 2), as desktop does it (app:printToPdf in main.ts): the page
 * the renderer made is shown in a web view of its own that runs no scripts, under the same offline rules, with
 * pictures and fonts from quire://app/ only, and printed onto pages with WebKit's own print output.
 */
final class Printer: NSObject, WKNavigationDelegate {
	/** Paper sizes, in points, portrait. */
	static let sizes: [String: CGSize] = [
		"A4": CGSize(width: 595.28, height: 841.89),
		"Letter": CGSize(width: 612, height: 792),
		"Legal": CGSize(width: 612, height: 1008),
		"A3": CGSize(width: 841.89, height: 1190.55),
		"A5": CGSize(width: 419.53, height: 595.28),
	]
	/** Margins as desktop's (inches): 0.75 top and bottom, 0.8 at the sides. */
	static let margins = UIEdgeInsets(top: 54, left: 57.6, bottom: 54, right: 57.6)
	/** Where the page is said to be, so its quire://app/ pictures and fonts load. Only this may be shown. */
	static let base = URL(string: "quire://app/print/")!

	private let webView: WKWebView
	private let paper: CGSize
	private var done: ((Result<Data, Error>) -> Void)?
	/** Keeps a printer alive until it has answered. */
	private static var busy = Set<Printer>()

	/** `rules`: the offline rule list; `scheme`: the quire://app/ handler (its own, for this page). */
	init(rules: WKContentRuleList, scheme: WKURLSchemeHandler, pageSize: String?, landscape: Bool) {
		let config = WKWebViewConfiguration()
		Lockdown.apply(to: config)
		config.defaultWebpagePreferences.allowsContentJavaScript = false
		config.websiteDataStore = .nonPersistent()
		config.setURLSchemeHandler(scheme, forURLScheme: "quire")
		config.userContentController.add(rules)
		let size = Self.sizes[pageSize ?? ""] ?? Self.sizes["A4"]!
		paper = landscape ? CGSize(width: size.height, height: size.width) : size
		webView = WKWebView(frame: CGRect(origin: .zero, size: CGSize(width: paper.width - Self.margins.left - Self.margins.right, height: paper.height)), configuration: config)
		super.init()
		webView.navigationDelegate = self
	}

	func print(_ html: String, _ done: @escaping (Result<Data, Error>) -> Void) {
		self.done = done
		Self.busy.insert(self)
		webView.loadHTMLString(html, baseURL: Self.base)
	}

	private func finish(_ result: Result<Data, Error>) {
		guard let done else { return }
		self.done = nil
		webView.stopLoading()
		Self.busy.remove(self)
		done(result)
	}

	// The page itself, and nothing else: no links followed, no other address.
	func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
		let first = action.navigationType == .other && action.request.url == Self.base
		decisionHandler(first ? .allow : .cancel)
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		finish(.success(Self.pages(from: webView.viewPrintFormatter(), paper: paper)))
	}

	func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(BridgeError("The page being printed stopped"))) }

	/** The formatter's content on pages of `paper`, numbered at the foot. */
	static func pages(from formatter: UIPrintFormatter, paper: CGSize) -> Data {
		let renderer = NumberedPages()
		renderer.addPrintFormatter(formatter, startingAtPageAt: 0)
		let sheet = CGRect(origin: .zero, size: paper)
		renderer.setValue(sheet, forKey: "paperRect")
		// The page number sits in the bottom margin, as on desktop: the printable area reaches into it by the footer.
		var inner = margins
		inner.bottom -= renderer.footerHeight
		renderer.setValue(sheet.inset(by: inner), forKey: "printableRect")
		let data = NSMutableData()
		UIGraphicsBeginPDFContextToData(data, sheet, nil)
		let count = renderer.numberOfPages
		renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
		for i in 0..<count {
			UIGraphicsBeginPDFPage()
			renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
		}
		UIGraphicsEndPDFContext()
		return data as Data
	}
}

/** Pages with their number at the foot, small and grey, as desktop's footer. */
private final class NumberedPages: UIPrintPageRenderer {
	override init() {
		super.init()
		footerHeight = 30
	}

	override func drawFooterForPage(at pageIndex: Int, in footerRect: CGRect) {
		let text = "\(pageIndex + 1)" as NSString
		let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor(white: 0.4, alpha: 1)]
		let size = text.size(withAttributes: attrs)
		text.draw(at: CGPoint(x: footerRect.midX - size.width / 2, y: footerRect.midY - size.height / 2), withAttributes: attrs)
	}
}
