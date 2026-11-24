import UIKit
import WebKit

final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, UIAdaptivePresentationControllerDelegate {
    private(set) var webView: WKWebView!
    private let suppliedConfiguration: WKWebViewConfiguration?
    private let isPopup: Bool
    private var bridge: AppBridge!
    private lazy var downloads = DownloadHandler(owner: self)
    private var chrome = ThemeColor.initial
    private var errorOverlay: ErrorOverlay?
    private var failedURL: URL?
    private var recoveredContentProcess = false
    private var cancelDialog: (() -> Void)?
    private var pendingShares: [URL] = []
    private var pendingErrors: [Error] = []
    private weak var popup: WebViewController?

    init(configuration: WKWebViewConfiguration? = nil, popup: Bool = false) {
        suppliedConfiguration = configuration
        isPopup = popup
        super.init(nibName: nil, bundle: nil)
        if popup { edgesForExtendedLayout = [.bottom] }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var preferredStatusBarStyle: UIStatusBarStyle { chrome.lightStatusBar ? .lightContent : .darkContent }

    override func loadView() {
        // Which language iOS treats this app as: it picks the system UI language (attachment sheet,
        // alerts' system strings) and the starting keyboard from it, not from the page's language.
        Diagnostics.record("languages system=\(Locale.preferredLanguages.prefix(3)) app=\(Bundle.main.preferredLocalizations)")
        view = UIView()
        observeKeyboard()
        view.backgroundColor = chrome.uiColor
        let configuration = suppliedConfiguration ?? WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "LocalAIAgentApp/\(Config.version)"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        // No App-Bound Domains: HTML previews and arbitrary subframes must keep working.
        let controller = WKUserContentController()
        bridge = AppBridge(owner: self)
        controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "mindfsApp")
        controller.addUserScript(WKUserScript(source: AppBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = chrome.uiColor
        webView.underPageBackgroundColor = chrome.uiColor
        applySafeArea(extendsUnderSafeArea: true)
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        // No native keyboard insets. The web owns visualViewport/Safari keyboard handling.
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            // Landscape notch/island sides are inset; top and bottom stay edge-to-edge so the
            // page can paint under the Dynamic Island and home indicator itself.
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor)
        ])
        if isPopup {
            navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closePopup))
            title = Config.relayBaseURL.host
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        updatePopupChrome()
    }

    private func updatePopupChrome() {
        guard isPopup, let bar = navigationController?.navigationBar else { return }
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = chrome.uiColor
        let foreground: UIColor = chrome.lightStatusBar ? .white : .black
        appearance.titleTextAttributes = [.foregroundColor: foreground]
        bar.standardAppearance = appearance
        bar.scrollEdgeAppearance = appearance
        bar.compactAppearance = appearance
        bar.tintColor = foreground
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !isPopup { view.window?.backgroundColor = chrome.uiColor }
        applyInterfaceStyle()
        drainShares()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || navigationController?.isBeingDismissed == true || view.window == nil {
            cancelDialogs()
        }
    }

    func navigate(to url: URL) {
        loadViewIfNeeded()
        recoveredContentProcess = false
        cancelDialogs()
        let load = { [weak self] in
            guard let self else { return }
            self.removeError()
            self.setInsetBehavior(extendsUnderSafeArea: SafeAreaPolicy.extendsUnderSafeArea(url: url))
            self.webView.load(URLRequest(url: url))
            Diagnostics.record("main load \(url.absoluteString)")
        }
        if presentedViewController != nil { dismiss(animated: false, completion: load) }
        else { load() }
    }

    /// Switches how the scroll view treats the safe area. WebKit reports the viewport minus these
    /// insets, so the mode must already be right when a new document starts: a page that reads
    /// `innerHeight` at load while the previous page's mode is still applied sees a viewport that is
    /// shorter by the status bar and home indicator, and builds its layout with a blank band.
    private func setInsetBehavior(extendsUnderSafeArea: Bool) {
        let behavior = SafeAreaPolicy.behavior(extendsUnderSafeArea: extendsUnderSafeArea)
        guard webView.scrollView.contentInsetAdjustmentBehavior != behavior else { return }
        webView.scrollView.contentInsetAdjustmentBehavior = behavior
        webView.setNeedsLayout()
        webView.layoutIfNeeded()
        Diagnostics.record("safe area extends=\(extendsUnderSafeArea)")
    }

    private func applySafeArea(extendsUnderSafeArea: Bool) {
        setInsetBehavior(extendsUnderSafeArea: extendsUnderSafeArea)
        pushSafeAreaToPage()
    }

    /// The web pads its fixed bars with `--mindfs-safe-area-top/bottom` (the contract the Android
    /// shell already honours) and ignores `env()` whenever those variables exist, so an edge-to-edge
    /// shell has to publish the real insets itself or content sits under the Dynamic Island.
    private var publishedInsets: (top: CGFloat, bottom: CGFloat)?
    private func pushSafeAreaToPage() {
        guard isViewLoaded, let webView else { return }
        let extends = webView.scrollView.contentInsetAdjustmentBehavior == .never
        let insets = webView.safeAreaInsets
        // With the keyboard up the home indicator is covered. Safari reports a bottom inset of 0
        // then, and the page pads its composer with it; keeping the indicator's height there would
        // leave a blank band between the composer and the keyboard.
        let values = (top: extends ? insets.top : 0, bottom: extends && !keyboardCoversBottom ? insets.bottom : 0)
        if let last = publishedInsets, last.top == values.top, last.bottom == values.bottom { return }
        publishedInsets = values
        webView.evaluateJavaScript(SafeAreaPolicy.publishScript(top: values.top, bottom: values.bottom))
        Diagnostics.record("safe area published top=\(values.top) bottom=\(values.bottom)")
    }

    private var keyboardCoversBottom = false

    private func observeKeyboard() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardFrameWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide), name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func keyboardFrameWillChange(_ notification: Notification) {
        guard !isPopup, isViewLoaded, view.window != nil,
              let end = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        setKeyboardCoversBottom(view.convert(end, from: nil).intersection(view.bounds).height > 0)
    }

    @objc private func keyboardWillHide() {
        guard !isPopup else { return }
        setKeyboardCoversBottom(false)
    }

    private func setKeyboardCoversBottom(_ covers: Bool) {
        guard keyboardCoversBottom != covers else { return }
        keyboardCoversBottom = covers
        pushSafeAreaToPage()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        pushSafeAreaToPage()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        pushSafeAreaToPage()
    }

    /// Match the keyboard and system sheets to the page's appearance.
    private func applyInterfaceStyle() {
        guard !isPopup else { return }
        let style: UIUserInterfaceStyle = chrome.lightStatusBar ? .dark : .light
        overrideUserInterfaceStyle = style
        view.window?.overrideUserInterfaceStyle = style
    }

    func setChrome(_ color: ThemeColor) {
        chrome = color
        applyInterfaceStyle()
        view.backgroundColor = color.uiColor
        webView.backgroundColor = color.uiColor
        webView.underPageBackgroundColor = color.uiColor
        if !isPopup { view.window?.backgroundColor = color.uiColor }
        setNeedsStatusBarAppearanceUpdate()
        navigationController?.setNeedsStatusBarAppearanceUpdate()
        updatePopupChrome()
        Diagnostics.record("chrome lightStatusBar=\(color.lightStatusBar)")
    }

    private func removeError() { errorOverlay?.removeFromSuperview(); errorOverlay = nil }

    private func loadFailed(_ error: Error, url: URL?) {
        let nsError = error as NSError
        // WebKit 102 is the expected interruption when navigation becomes a download
        // (or is handed to the system), not an offline/TLS/DNS failure.
        guard !(nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled),
              !(nsError.domain == "WebKitErrorDomain" && nsError.code == 102) else { return }
        let target = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? url ?? Config.startURL
        failedURL = target
        removeError()
        let overlay = ErrorOverlay(error: nsError, url: target)
        overlay.retry = { [weak self] in
            guard let self else { return }
            self.recoveredContentProcess = false
            self.removeError()
            self.webView.load(URLRequest(url: self.failedURL ?? Config.startURL))
        }
        view.addSubview(overlay)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor), overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor), overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        errorOverlay = overlay
        Diagnostics.record("load failed \(nsError.domain) \(nsError.code) \(target.absoluteString)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error, url: webView.url)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error, url: webView.url)
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        removeError()
        publishedInsets = nil
        applySafeArea(extendsUnderSafeArea: SafeAreaPolicy.extendsUnderSafeArea(url: webView.url))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Diagnostics.record("\(isPopup ? "popup" : "page") finished \(webView.url?.absoluteString ?? "nil")")
        // The page's own viewport declaration is authoritative once it has loaded.
        webView.evaluateJavaScript(SafeAreaPolicy.declaresCoverScript) { [weak self] result, _ in
            guard let self else { return }
            self.publishedInsets = nil
            self.applySafeArea(extendsUnderSafeArea: (result as? Bool) ?? SafeAreaPolicy.extendsUnderSafeArea(url: webView.url))
        }
        #if DEBUG
        DebugProbes.run(in: webView)
        #endif
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        if !recoveredContentProcess {
            recoveredContentProcess = true
            webView.reload()
        } else {
            loadFailed(NSError(domain: "WebKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "网页进程再次退出，请重试。"]), url: webView.url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        Diagnostics.record("action \(navigationAction.request.url?.absoluteString ?? "nil") main=\(String(describing: navigationAction.targetFrame?.isMainFrame)) download=\(navigationAction.shouldPerformDownload)")
        guard navigationAction.targetFrame?.isMainFrame != false, let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        Diagnostics.record("navigation \(url.absoluteString) download=\(navigationAction.shouldPerformDownload) popup=\(isPopup)")
        if !isPopup, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            setInsetBehavior(extendsUnderSafeArea: SafeAreaPolicy.extendsUnderSafeArea(url: url))
        }
        let decision = NavigationPolicy.sameOrigin(url) ? .allow : NavigationPolicy.decide(url: url, mainFrame: true,
            linkActivated: navigationAction.navigationType == .linkActivated, popup: isPopup, relay: Config.navigationOrigin)
        switch decision {
        case .external:
            decisionHandler(.cancel)
            ExternalLinks.open(url)
            if isPopup { closePopup() }
        case .cancel: decisionHandler(.cancel)
        case .allow: decisionHandler(navigationAction.shouldPerformDownload ? .download : .allow)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard navigationResponse.isForMainFrame else { decisionHandler(.allow); return }
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let attachment = disposition.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() == "attachment"
        decisionHandler(attachment || !navigationResponse.canShowMIMEType ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.receive(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.receive(download) }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        Diagnostics.record("popup request \(navigationAction.request.url?.absoluteString ?? "nil")")
        let requestedURL = navigationAction.request.url
        let url = (requestedURL?.absoluteString.isEmpty == false ? requestedURL : nil) ?? URL(string: "about:blank")!
        let decision = NavigationPolicy.sameOrigin(url) ? .allow : NavigationPolicy.decide(url: url, mainFrame: true,
            linkActivated: true, popup: true, relay: Config.navigationOrigin)
        guard decision == .allow else {
            if decision == .external { ExternalLinks.open(url) }
            return nil
        }
        guard presentedViewController == nil, view.window != nil else { return nil }
        let child = WebViewController(configuration: configuration, popup: true)
        child.loadViewIfNeeded()
        popup = child
        let nav = PopupNavigationController(rootViewController: child)
        nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
        nav.presentationController?.delegate = self
        Diagnostics.record("popup created \(url.absoluteString)")
        return child.webView
    }
    func webViewDidClose(_ webView: WKWebView) { if isPopup { closePopup() } }
    @objc private func closePopup() {
        cancelDialogs()
        Diagnostics.record("popup dismissed")
        navigationController?.dismiss(animated: true)
    }

    func share(_ url: URL) {
        pendingShares.append(url)
        drainShares()
    }
    private func drainShares() {
        guard isViewLoaded, view.window != nil, presentedViewController == nil else { return }
        if !pendingErrors.isEmpty {
            let error = pendingErrors.removeFirst()
            let alert = UIAlertController(title: "下载失败", message: error.localizedDescription, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "好", style: .default) { [weak self] _ in
                self?.dismiss(animated: true) { self?.drainShares() }
            })
            present(alert, animated: true)
            return
        }
        guard !pendingShares.isEmpty else { return }
        let url = pendingShares.removeFirst()
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in
            self?.dismiss(animated: true) { self?.drainShares() }
        }
        present(sheet, animated: true)
        sheet.presentationController?.delegate = self
        Diagnostics.record("share presented \(url.lastPathComponent)")
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { drainShares() }

    func showError(_ error: Error) {
        pendingErrors.append(error)
        drainShares()
    }

    private func cancelDialogs() {
        cancelDialog?()
        cancelDialog = nil
        popup?.cancelDialogs()
    }

    /// Both UIKit actions and dismissal/deallocation can resolve a dialog; only the first wins.
    private func dialog<T>(message: String, frame: WKFrameInfo, defaultValue: T,
                           completion: @escaping (T) -> Void,
                           actions: (UIAlertController, @escaping (T) -> Void) -> Void) {
        guard view.window != nil, presentedViewController == nil else { completion(defaultValue); return }
        let once = DialogReply(completion)
        cancelDialog = { once.resolve(defaultValue) }
        let originHost = frame.securityOrigin.host.isEmpty ? nil : frame.securityOrigin.host
        let host = frame.request.url?.host ?? originHost ?? webView.url?.host ?? Config.relayBaseURL.host
        let alert = UIAlertController(title: host, message: message, preferredStyle: .alert)
        actions(alert) { [weak self] value in
            once.resolve(value)
            self?.cancelDialog = nil
            self?.dismiss(animated: true) { self?.drainShares() }
        }
        present(alert, animated: true)
        Diagnostics.record("dialog presented \(message)")
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        dialog(message: message, frame: frame, defaultValue: (), completion: { completionHandler() }) { alert, done in
            alert.addAction(UIAlertAction(title: "好", style: .default) { _ in done(()) })
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        dialog(message: message, frame: frame, defaultValue: false, completion: completionHandler) { alert, done in
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in done(false) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in done(true) })
        }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        dialog(message: prompt, frame: frame, defaultValue: nil, completion: completionHandler) { alert, done in
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in done(nil) })
            alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak alert] _ in done(alert?.textFields?.first?.text) })
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        cancelDialog?()
    }
}

private final class DialogReply<T> {
    private var completion: ((T) -> Void)?
    init(_ completion: @escaping (T) -> Void) { self.completion = completion }
    func resolve(_ value: T) {
        let callback = completion
        completion = nil
        callback?(value)
    }
}

private final class PopupNavigationController: UINavigationController {
    override var childForStatusBarStyle: UIViewController? { topViewController }
}
