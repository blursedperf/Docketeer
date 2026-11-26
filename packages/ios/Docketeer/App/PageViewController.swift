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
	/** Put over the page as the app leaves while locked notes are open (the app switcher's picture). */
	private var cover: UIView?
	/** Watches the open homebase for changes made outside Docketeer. */
	private var watcher: HomebaseWatcher?

	static let startURL = URL(string: "quire://app/index.html")!

	#if DEBUG
	/** A smoke run (XCTest), or nil for the app itself. */
	private let smoke: SmokeRun?

	init(smoke: SmokeRun? = nil) {
		self.smoke = smoke
		super.init(nibName: nil, bundle: nil)
	}
	#else
	init() {
		super.init(nibName: nil, bundle: nil)
	}
	#endif

	required init?(coder: NSCoder) { fatalError("Made in code") }

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
		var defaults = UserDefaults.standard
		var documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
		#if DEBUG
		// A smoke run keeps to its own settings and folder: never the person's homebases or settings.
		if let smoke { defaults = smoke.defaults; documents = smoke.folder }
		#endif
		let homebases = Homebases(
			defaults: defaults,
			documents: documents,
			exampleSource: root.appendingPathComponent("example-homebase", isDirectory: true),
			deviceStorage: pad ? "On My iPad" : "On My iPhone"
		)
		homebases.onOpen = { [weak self] fs in self?.watch(fs) }
		#if DEBUG
		if let smoke { _ = try? homebases.add(folder: smoke.homebase) } else { homebases.reopenLast() }
		#else
		homebases.reopenLast()
		#endif
		#if DEBUG
		// Simulator runs: `-openExample` opens the example homebase without tapping (Debug builds only).
		if smoke == nil, ProcessInfo.processInfo.arguments.contains("-openExample") { _ = try? homebases.openExample() }
		#endif
		var formFactor = pad ? "tablet" : "phone"
		#if DEBUG
		if let smoke { formFactor = smoke.formFactor }
		#endif
		let channels = Channels(
			root: root,
			defaults: defaults,
			clipboard: Pasteboard(),
			formFactor: formFactor,
			appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0",
			homebases: homebases
		)
		channels.onQuitReady = { [weak self] token in self?.finishSaving(token) }
		channels.chooseFolder = { [weak self] done in self?.chooseFolder(done) ?? done(nil) }
		channels.reload = { [weak self] in self?.webView?.reload() }
		// Only the Files app, at a folder on this device: never a web address.
		channels.showInFiles = { url in if url.scheme == "shareddocuments" { UIApplication.shared.open(url) } }
		let files = AppFiles(root: root, vault: { homebases.fs })
		// Export to PDF: a page of its own with no scripts, under the same offline rules (Printer.swift).
		channels.printPDF = { html, size, landscape, done in
			Printer(rules: rules, scheme: QuireSchemeHandler(files: files), pageSize: size, landscape: landscape).print(html, done)
		}
		channels.shareFile = { [weak self] url, closed in self?.share(url, closed) ?? closed() }
		let bridge = Bridge(channels: channels)
		self.bridge = bridge

		let config = WKWebViewConfiguration()
		Lockdown.apply(to: config)
		config.allowsInlineMediaPlayback = true
		config.setURLSchemeHandler(QuireSchemeHandler(files: files), forURLScheme: "quire")
		config.userContentController.add(rules)
		config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
		#if DEBUG
		if let smoke {
			channels.smoke = smoke
			channels.systemLock = { [weak self] in self?.webView?.emitQuireEvent("app:system-lock") }
			// The page's own pixels at twice its size in points, for comparing (the screen's scale may differ).
			channels.capture = { [weak self] done in
				guard let webView = self?.webView else { done(nil); return }
				let config = WKSnapshotConfiguration()
				config.afterScreenUpdates = true
				webView.takeSnapshot(with: config) { image, _ in
					guard let image else { done(nil); return }
					let format = UIGraphicsImageRendererFormat()
					format.scale = 2
					let png = UIGraphicsImageRenderer(size: image.size, format: format).pngData { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
					done(png)
				}
			}
			smoke.refusedNavigations = { [lockdown] in lockdown.refused.count }
			ConsoleRelay.install(in: config.userContentController, levels: ["error", "warn", "log", "info"]) { smoke.console($0, $1) }
		} else {
			ConsoleRelay.install(in: config.userContentController)
		}
		#endif

		let webView = WKWebView(frame: .zero, configuration: config)
		webView.navigationDelegate = lockdown
		webView.uiDelegate = lockdown
		webView.allowsLinkPreview = false
		// The page keeps clear of the home indicator itself (viewport-fit=cover, env(safe-area-inset-*)): no inset
		// added here, which the page cannot see (its bottom would sit behind the home indicator).
		webView.scrollView.contentInsetAdjustmentBehavior = .never
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
		cover?.removeFromSuperview()
		cover = nil
		watcher?.rescanSoon()
	}

	/** A plain screen with the app's name over everything, before iOS takes its picture of the window. */
	private func showCover() {
		guard cover == nil else { return }
		let c = UIView(frame: view.bounds)
		c.autoresizingMask = [.flexibleWidth, .flexibleHeight]
		c.backgroundColor = .systemBackground
		let label = UILabel()
		label.text = "Docketeer"
		label.font = .preferredFont(forTextStyle: .title2)
		label.textColor = .secondaryLabel
		label.translatesAutoresizingMaskIntoConstraints = false
		c.addSubview(label)
		NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: c.centerXAnchor), label.centerYAnchor.constraint(equalTo: c.centerYAnchor)])
		view.addSubview(c)
		cover = c
	}

	/** The system folder picker. Only the folder picked becomes reachable (through its security-scoped URL). */
	/** The share sheet for a file (a copy: Channels.shareLater); `closed` once it is dismissed, shared or not. */
	private func share(_ url: URL, _ closed: @escaping () -> Void) {
		let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
		sheet.completionWithItemsHandler = { _, _, _, _ in closed() }
		// On an iPad it is a popover: from the foot of the screen, where the notice offering it is.
		if let pop = sheet.popoverPresentationController {
			pop.sourceView = view
			pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 60, width: 1, height: 1)
			pop.permittedArrowDirections = [.down]
		}
		(presentedViewController ?? self).present(sheet, animated: true)
	}

	private func chooseFolder(_ done: @escaping (URL?) -> Void) {
		picked?(nil)
		picked = done
		let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
		picker.delegate = self
		picker.allowsMultipleSelection = false
		present(picker, animated: true)
	}

	/**
	 * Leaving the screen (inactive: Control Centre, the app switcher): let the page save, in a background task that
	 * ends when it has. Nothing closes: the app usually comes back.
	 */
	func resignedActive() {
		askToSave("app:background")
	}

	/** In the background, where iOS may end the app without warning: lock the homebase if locking is on, and save. */
	func enteredBackground() {
		if bridge?.channels.coverInBackground == true { showCover() }
		webView?.emitQuireEvent("app:system-lock")
		askToSave("app:background")
	}

	/** iOS is ending the app (rarely announced): save and close, as desktop does before its window closes. */
	func willTerminate() {
		askToSave("app:before-quit")
	}

	/** Send `event` with a token; the page answers app:quit-ready with it once it has saved. */
	private func askToSave(_ event: String) {
		guard let webView else { return }
		let token = UUID().uuidString
		saving[token] = UIApplication.shared.beginBackgroundTask(withName: "Saving notes") { [weak self] in self?.finishSaving(token) }
		webView.emitQuireEvent(event, token)
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
