import UIKit
import WebKit

/**
 * The one WKWebView, showing quire://app/index.html: the scheme handler serves the page, the bridge answers it, and
 * the lockdown keeps it offline. The page is not loaded until the offline rules are in place.
 */
final class PageViewController: UIViewController {
	private var webView: WKWebView?
	private let lockdown = LockdownDelegate()
	private var bridge: Bridge?
	/** The background task waiting for the page to save, by the token sent with app:before-quit. */
	private var saving: [String: UIBackgroundTaskIdentifier] = [:]

	static let startURL = URL(string: "quire://app/index.html")!

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = .systemBackground
		guard let root = Bundle.main.url(forResource: "app", withExtension: nil) else {
			showFailure("The app's files are missing from the bundle (run npm run build -w @quire/ios).")
			return
		}
		Lockdown.ruleList { [weak self] result in
			DispatchQueue.main.async {
				switch result {
				case .success(let rules): self?.load(root: root, rules: rules)
				case .failure(let error): self?.showFailure("Docketeer could not turn on its offline rules, so it did not start.\n\n\(error.localizedDescription)")
				}
			}
		}
	}

	private func load(root: URL, rules: WKContentRuleList) {
		let channels = Channels(
			root: root,
			defaults: .standard,
			clipboard: Pasteboard(),
			formFactor: traitCollection.userInterfaceIdiom == .pad ? "tablet" : "phone",
			appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
		)
		channels.onQuitReady = { [weak self] token in self?.finishSaving(token) }
		let bridge = Bridge(channels: channels)
		self.bridge = bridge

		let config = WKWebViewConfiguration()
		Lockdown.apply(to: config)
		config.allowsInlineMediaPlayback = true
		config.setURLSchemeHandler(QuireSchemeHandler(files: AppFiles(root: root)), forURLScheme: "quire")
		config.userContentController.add(rules)
		config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
		#if DEBUG
		ConsoleRelay.install(in: config.userContentController)
		#endif

		let webView = WKWebView(frame: .zero, configuration: config)
		webView.navigationDelegate = lockdown
		webView.uiDelegate = lockdown
		webView.allowsLinkPreview = false
		#if DEBUG
		webView.isInspectable = true
		#endif
		webView.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(webView)
		let safe = view.safeAreaLayoutGuide
		NSLayoutConstraint.activate([
			webView.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
			webView.trailingAnchor.constraint(equalTo: safe.trailingAnchor),
			webView.topAnchor.constraint(equalTo: safe.topAnchor),
			webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
		])
		self.webView = webView
		webView.load(URLRequest(url: Self.startURL))
	}

	/** Lock the homebase if locking is on, and let the page save, in a background task that ends when it has. */
	func enteredBackground() {
		guard let webView else { return }
		webView.emitQuireEvent("app:system-lock")
		let token = UUID().uuidString
		saving[token] = UIApplication.shared.beginBackgroundTask(withName: "Saving notes") { [weak self] in self?.finishSaving(token) }
		webView.emitQuireEvent("app:before-quit", token)
	}

	private func finishSaving(_ token: String) {
		guard let task = saving.removeValue(forKey: token) else { return }
		UIApplication.shared.endBackgroundTask(task)
	}

	private func showFailure(_ text: String) {
		let label = UILabel()
		label.text = text
		label.numberOfLines = 0
		label.textAlignment = .center
		label.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(label)
		NSLayoutConstraint.activate([
			label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
			label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
			label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
		])
	}
}
