import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DownloadFiles.cleanPreviousLaunch()
        return true
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let controller = WebViewController()
        let window = UIWindow(windowScene: windowScene)
        // UIKit asks the scene's root controller for the status bar appearance.
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        controller.navigate(to: deepLinkTarget(in: connectionOptions.urlContexts) ?? Config.startURL)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let target = deepLinkTarget(in: URLContexts) else { return }
        (window?.rootViewController as? WebViewController)?.navigate(to: target)
    }

    private func deepLinkTarget(in contexts: Set<UIOpenURLContext>) -> URL? {
        guard let input = contexts.first?.url else { return nil }
        guard let target = DeepLink.parse(input) else {
            Diagnostics.record("deep link rejected")
            return nil
        }
        Diagnostics.record("deep link accepted \(target.absoluteString)")
        return target
    }
}
