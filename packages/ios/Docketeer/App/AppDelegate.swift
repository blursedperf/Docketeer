import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
	func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
		let config = UISceneConfiguration(name: "Default", sessionRole: session.role)
		config.delegateClass = SceneDelegate.self
		return config
	}
}

/** One scene with one window, holding the page. */
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
	var window: UIWindow?
	private var page: PageViewController?

	func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
		guard let scene = scene as? UIWindowScene else { return }
		let page = PageViewController()
		let window = UIWindow(windowScene: scene)
		window.rootViewController = page
		window.makeKeyAndVisible()
		self.window = window
		self.page = page
	}

	func sceneWillEnterForeground(_ scene: UIScene) {
		page?.enteredForeground()
	}

	func sceneDidEnterBackground(_ scene: UIScene) {
		page?.enteredBackground()
	}
}

/** The system clipboard for the bridge. */
final class Pasteboard: TextClipboard {
	var text: String? {
		get { UIPasteboard.general.string }
		set { UIPasteboard.general.string = newValue }
	}
}
