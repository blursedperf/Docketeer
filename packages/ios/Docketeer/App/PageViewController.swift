import UIKit
import UniformTypeIdentifiers
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
	/** Answers the folder picker that is showing. */
	private var picked: ((URL?) -> Void)?
	/** Watches the open homebase for changes made outside Docketeer. */
	private var watcher: HomebaseWatcher?

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
		let pad = traitCollection.userInterfaceIdiom == .pad
		let homebases = Homebases(
			defaults: .standard,
			documents: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
			exampleSource: root.appendingPathComponent("example-homebase", isDirectory: true),
			deviceStorage: pad ? "On My iPad" : "On My iPhone"
		)
		homebases.onOpen = { [weak self] fs in self?.watch(fs) }
		homebases.reopenLast()
		#if DEBUG
		// Simulator runs: `-openExample` opens the example homebase without tapping (Debug builds only).
		if ProcessInfo.processInfo.arguments.contains("-openExample") { _ = try? homebases.openExample() }
		#endif
		let channels = Channels(
			root: root,
			defaults: .standard,
			clipboard: Pasteboard(),
			formFactor: pad ? "tablet" : "phone",
			appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
			homebases: homebases
		)
		channels.onQuitReady = { [weak self] token in self?.finishSaving(token) }
		channels.chooseFolder = { [weak self] done in self?.chooseFolder(done) ?? done(nil) }
		channels.reload = { [weak self] in self?.webView?.reload() }
		let bridge = Bridge(channels: channels)
		self.bridge = bridge

		let config = WKWebViewConfiguration()
		Lockdown.apply(to: config)
		config.allowsInlineMediaPlayback = true
		config.setURLSchemeHandler(QuireSchemeHandler(files: AppFiles(root: root, vault: { homebases.fs })), forURLScheme: "quire")
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

	/** Watch the homebase that just opened (and stop watching the last one). */
	private func watch(_ fs: HomebaseFS) {
		watcher?.stop()
		let w = HomebaseWatcher(fs: fs) { [weak self] events in self?.webView?.emitQuireEvent("fs:events", events) }
		w.start()
		watcher = w
	}

	/** Back in the foreground: look for changes made while the app was away. */
	func enteredForeground() {
		watcher?.rescanSoon()
	}

	/** The system folder picker. Only the folder picked becomes reachable (through its security-scoped URL). */
	private func chooseFolder(_ done: @escaping (URL?) -> Void) {
		picked?(nil)
		picked = done
		let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
		picker.delegate = self
		picker.allowsMultipleSelection = false
		present(picker, animated: true)
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

extension PageViewController: UIDocumentPickerDelegate {
	func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
		let done = picked
		picked = nil
		done?(urls.first)
	}

	func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
		let done = picked
		picked = nil
		done?(nil)
	}
}
