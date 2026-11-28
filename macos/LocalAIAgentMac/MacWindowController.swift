import AppKit
import WebKit

enum ConnectionState: Equatable {
    case connecting
    case connected
    case installing
    case starting
    case notInstalled
    case disconnected
}

private enum MainToolbarItem {
    static let toolbarID = NSToolbar.Identifier("LocalAIAgentMainToolbar")
    static let modeSwitcher = NSToolbarItem.Identifier("modeSwitcher")
    static let statusBadge = NSToolbarItem.Identifier("statusBadge")
    static let reload = NSToolbarItem.Identifier("reload")
}

private final class StatusPillView: NSView {
    private let dotView = NSView()
    let label = NSTextField(labelWithString: "")
    private var dotColor: NSColor = .systemOrange

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = 11
        layer?.borderWidth = 0.5

        dotView.wantsLayer = true
        dotView.layer?.cornerRadius = 4
        dotView.translatesAutoresizingMaskIntoConstraints = false

        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .labelColor
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false

        addSubview(dotView)
        addSubview(label)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 24),
            dotView.widthAnchor.constraint(equalToConstant: 8),
            dotView.heightAnchor.constraint(equalToConstant: 8),
            dotView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 9),
            dotView.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: dotView.trailingAnchor, constant: 6),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        applyAppearanceColors()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func update(text: String, color: NSColor) {
        label.stringValue = text
        dotColor = color
        applyAppearanceColors()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        applyAppearanceColors()
    }

    private func applyAppearanceColors() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            dotView.layer?.backgroundColor = dotColor.cgColor
            layer?.backgroundColor = dotColor.withAlphaComponent(0.12).cgColor
            layer?.borderColor = dotColor.withAlphaComponent(0.28).cgColor
        }
    }
}

@MainActor
final class MacWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate {
    static let relayNodes = AppleShell.relayBaseURL.appendingPathComponent("nodes")

    private enum PrimaryAction {
        case none
        case installBackend
        case startInstalled(URL)
        case retry
    }

    let descriptorDirectory: URL
    let backendManager: StandaloneBackendManager
    private let autoInstallOnMissing: Bool
    private var hasAttemptedAutoInstall = false
    private var hasConnectedLocally = false

    // Toolbar controls (main windows only)
    private(set) var modeSegmentControl: NSSegmentedControl?
    private var statusPillView: StatusPillView?
    private var reloadToolbarButton: NSButton?

    // Native onboarding / status / recovery UI
    private let messageContainer = NSView()
    private let messageStack = NSStackView()
    private let messageBadgeLabel = NSTextField(labelWithString: "")
    private let messageTitle = NSTextField(labelWithString: "")
    private let messageDetail = NSTextField(wrappingLabelWithString: "")
    private let progressRow = NSStackView()
    private let progressSpinner = NSProgressIndicator()
    private let progressCaption = NSTextField(labelWithString: "")
    private let logScrollView = NSScrollView()
    private let logTextView = NSTextView()
    private let primaryButton = NSButton(title: "", target: nil, action: nil)
    private let retryButton = NSButton(title: "重试连接", target: nil, action: nil)
    private let switchModeButton = NSButton(title: "切换至远程 Relay", target: nil, action: nil)
    private let cancelButton = NSButton(title: "取消", target: nil, action: nil)
    private let secondaryActionsRow = NSStackView()
    private let reinstallButton = NSButton(title: "重新安装后台", target: nil, action: nil)
    private let copyCommandButton = NSButton(title: "复制终端安装命令", target: nil, action: nil)
    private var primaryAction: PrimaryAction = .none
    private var copyFeedbackTask: Task<Void, Never>?

    private var descriptorWatch: HostWatch?
    private var backendTask: Task<Void, Never>?
    private var isRunningBackendProcess = false
    private var titleObservation: NSKeyValueObservation?
    private var systemAppearanceObservation: NSKeyValueObservation?
    private var expectedNavigation: WKNavigation?
    var requestedURL: URL?
    /// The page to bring back once the backend publishes its connection details again.
    private var reconnectTarget: URL?
    /// The page on screen when a session renewal started; sign-in replaces it, and a download does not bring it back.
    private var pageBeforeRenewal: URL?
    var navigationStatus: Int?
    var local: LocalConnection?
    private(set) var mode: ConnectionMode
    private(set) var connectionState: ConnectionState = .connecting
    var origin: BridgeOrigin { BridgeOrigin(mode: mode, local: local?.descriptor.origin) }
    let webView: WKWebView
    let isPopup: Bool
    lazy var downloads = MacDownloads(owner: self)
    weak var appDelegate: MacAppDelegate?

    var isShowingMessage: Bool { !messageContainer.isHidden }
    var primaryActionTitle: String? { primaryButton.isHidden ? nil : primaryButton.title }
    var logOutputText: String { logTextView.string }
    var connectionStatusText: String { statusPillView?.label.stringValue ?? statusSummary().text }

    init(
        mode: ConnectionMode,
        directory: URL,
        dataStore: WKWebsiteDataStore? = nil,
        popupConfiguration: WKWebViewConfiguration? = nil,
        localDescriptor: LocalHostDescriptor? = nil,
        backendManager: StandaloneBackendManager? = nil,
        autoInstallOnMissing: Bool = false
    ) {
        self.mode = mode
        self.descriptorDirectory = directory
        self.backendManager = backendManager ?? StandaloneBackendManager(descriptorDirectory: directory)
        self.autoInstallOnMissing = autoInstallOnMissing
        isPopup = popupConfiguration != nil
        if let localDescriptor {
            local = LocalConnection(descriptor: localDescriptor)
            local?.pageFinished()
            connectionState = .connected
            hasConnectedLocally = true
        }
        let configuration = popupConfiguration ?? WKWebViewConfiguration()
        if popupConfiguration == nil {
            configuration.websiteDataStore = dataStore ?? .default()
            configuration.userContentController.addScriptMessageHandler(MacBridge(), contentWorld: .page, name: MacBridge.name)
            configuration.userContentController.addUserScript(WKUserScript(source: MacBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 520, height: 420)
        window.titlebarAppearsTransparent = true
        if !isPopup {
            installToolbar(on: window)
        }
        window.center()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        let content = NSView()
        window.contentView = content
        webView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        ])
        configureMessage(in: content)
        updateModeAndStatusUI()
        if isPopup { watchDescriptor() }
        titleObservation = webView.observe(\.title, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.updateTitle() }
        }
        // The window's appearance follows the page theme, so the page reads the system setting from the application.
        systemAppearanceObservation = NSApplication.shared.observe(\.effectiveAppearance, options: [.initial, .new]) { [weak self] app, _ in
            MainActor.assumeIsolated { self?.webView.appearance = app.effectiveAppearance }
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    func open(_ mode: ConnectionMode, target: URL? = nil) {
        cancelBackendTask()
        webView.stopLoading()
        descriptorWatch = nil
        local = nil
        self.mode = mode
        connectionState = .connecting
        updateModeAndStatusUI()
        switch mode {
        case .relay:
            showPage()
            load(target ?? Self.relayNodes)
        case .local:
            do {
                startSignIn(LocalConnection(descriptor: try readDescriptor(), target: target))
            } catch {
                reconnectTarget = target
                presentMissingLocalBackend(allowAutoInstall: target == nil)
            }
            watchDescriptor()
        }
    }

    func load(_ url: URL) {
        requestedURL = url
        navigationStatus = nil
        expectedNavigation = webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12))
    }

    func navigationStarted(_ navigation: WKNavigation?) {
        expectedNavigation = navigation
        navigationStatus = nil
        if connectionState != .installing && connectionState != .starting {
            connectionState = .connecting
            updateModeAndStatusUI()
        }
    }

    func navigationDiscarded() { expectedNavigation = nil }

    /// A response that turns into a download never reaches `didFinish`, so it must end a pending session restore itself.
    func navigationBecameDownload() {
        expectedNavigation = nil
        guard case .restoring = local?.step else { return }
        if let page = pageBeforeRenewal {
            pageBeforeRenewal = nil
            local?.step = .restoring(page)
            load(page)
            return
        }
        local?.pageFinished()
        connectionState = .connected
        showPage()
        updateModeAndStatusUI()
    }

    func navigationFinished(_ navigation: WKNavigation?) {
        guard navigation === expectedNavigation, let url = webView.url else { return }
        if case .signingIn = local?.step {
            // The backend's 303 removes the token before a page can be displayed.
            guard let status = navigationStatus, (200..<300).contains(status),
                  URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "ide_token" }) != true else {
                connectionState = .disconnected
                showLocalConnectionFailure("本机独立后台未能建立会话。请确认后台已启动后重试，或切换至远程 Relay。")
                return
            }
            if let target = local?.signInFinished(at: url) { load(target); return }
        } else {
            local?.pageFinished()
        }
        pageBeforeRenewal = nil
        if mode == .local {
            hasConnectedLocally = true
        }
        connectionState = .connected
        showPage()
        updateModeAndStatusUI()
    }

    /// The URL a local backend refused with `401` because the session cookie is stale, if `response` is such a refusal.
    func rejectedURL(_ response: URLResponse?) -> URL? {
        guard mode == .local, let http = response as? HTTPURLResponse, http.statusCode == 401, let url = http.url,
              local?.descriptor.origin.contains(url) == true else { return nil }
        return url
    }

    func recoverLocalSession(failedURL: URL) {
        guard mode == .local, let local else { return }
        pageBeforeRenewal = local.step == .ready ? committedLocalPage : nil
        do {
            if let next = try local.recover(failedURL: failedURL, readDescriptor: readDescriptor) {
                startSignIn(next)
                return
            }
        } catch {
            connectionState = .disconnected
            showLocalConnectionFailure("本机独立后台正在重启或连接信息已失效。请稍候重试，或切换至远程 Relay。")
            return
        }
        connectionState = .disconnected
        showLocalConnectionFailure("本机独立后台拒绝了会话。请确认后台已启动后重试。")
    }

    func navigationFailed(_ navigation: WKNavigation?, error: Error) {
        guard navigation === expectedNavigation, (error as NSError).code != NSURLErrorCancelled else { return }
        connectionState = .disconnected
        if mode == .local {
            showLocalConnectionFailure("无法连接本机独立后台。请启动后台后重试，也可以切换至远程 Relay。")
        } else {
            showRelayError("无法连接远程 Relay（\(AppleShell.relayBaseURL.host ?? "Relay")）。请检查网络连接后重试，或切换回本机模式。")
        }
    }

    func setChrome(_ theme: ThemeColor) {
        let color = NSColor(srgbRed: theme.red, green: theme.green, blue: theme.blue, alpha: 1)
        window?.backgroundColor = color
        window?.appearance = NSAppearance(named: theme.lightStatusBar ? .darkAqua : .aqua)
        webView.underPageBackgroundColor = color
    }

    @objc func reloadPage() {
        guard !messageContainer.isHidden else { webView.reloadFromOrigin(); return }
        if isRunningBackendProcess { return }
        // Reconnect to the page that failed, not the default entry.
        open(mode, target: local?.step.target ?? requestedURL ?? reconnectTarget)
    }

    func performPrimaryAction() {
        primaryActionTapped()
    }

    func performCancelAction() {
        cancelBackendOperation()
    }

    func selectModeSegment(_ index: Int) {
        guard let control = modeSegmentControl, (0..<control.segmentCount).contains(index) else { return }
        control.selectedSegment = index
        modeSegmentChanged(control)
    }

    @objc private func modeSegmentChanged(_ sender: NSSegmentedControl) {
        let target: ConnectionMode = sender.selectedSegment == 1 ? .relay : .local
        guard target != mode else { return }
        appDelegate?.select(target, in: self) ?? open(target)
    }

    @objc private func useRelay() { appDelegate?.select(.relay, in: self) ?? open(.relay) }
    @objc private func useLocal() { appDelegate?.select(.local, in: self) ?? open(.local) }

    @objc private func switchModeTapped() {
        if mode == .local {
            useRelay()
        } else {
            useLocal()
        }
    }

    @objc private func primaryActionTapped() {
        switch primaryAction {
        case .none:
            break
        case .installBackend:
            startOneClickInstall(automatic: false)
        case .startInstalled(let executable):
            startInstalledBackend(executable)
        case .retry:
            reloadPage()
        }
    }

    @objc private func reinstallTapped() {
        startOneClickInstall(automatic: false)
    }

    @objc private func cancelBackendOperation() {
        backendManager.cancel()
        backendTask?.cancel()
    }

    @objc private func copyInstallCommand() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(StandaloneBackendManager.terminalInstallCommand, forType: .string)
        copyCommandButton.title = "已复制安装命令"
        copyFeedbackTask?.cancel()
        copyFeedbackTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            self?.copyCommandButton.title = "复制终端安装命令"
        }
    }

    func windowWillClose(_ notification: Notification) {
        cancelBackendTask()
        copyFeedbackTask?.cancel()
        copyFeedbackTask = nil
        descriptorWatch = nil
        downloads.windowClosed()
        appDelegate?.remove(self)
    }

    // MARK: - NSToolbarDelegate

    private func installToolbar(on window: NSWindow) {
        let segment = NSSegmentedControl()
        segment.segmentCount = 2
        segment.trackingMode = .selectOne
        segment.segmentStyle = .automatic
        segment.setLabel("本机", forSegment: 0)
        segment.setLabel("远程 Relay", forSegment: 1)
        if let localIcon = NSImage(systemSymbolName: "desktopcomputer", accessibilityDescription: "本机模式") {
            segment.setImage(localIcon, forSegment: 0)
            segment.setImageScaling(.scaleProportionallyDown, forSegment: 0)
        }
        if let relayIcon = NSImage(systemSymbolName: "globe", accessibilityDescription: "远程 Relay 模式") {
            segment.setImage(relayIcon, forSegment: 1)
            segment.setImageScaling(.scaleProportionallyDown, forSegment: 1)
        }
        segment.setWidth(82, forSegment: 0)
        segment.setWidth(110, forSegment: 1)
        segment.target = self
        segment.action = #selector(modeSegmentChanged(_:))
        segment.toolTip = "切换本机后台或远程 Relay（⌘⇧1 / ⌘⇧2）"
        modeSegmentControl = segment

        let pill = StatusPillView()
        statusPillView = pill

        let reloadButton = NSButton(title: "", target: self, action: #selector(reloadPage))
        reloadButton.bezelStyle = .texturedRounded
        reloadButton.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: "刷新")
        reloadButton.toolTip = "刷新页面（⌘R）"
        reloadToolbarButton = reloadButton

        let toolbar = NSToolbar(identifier: MainToolbarItem.toolbarID)
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        toolbar.autosavesConfiguration = false
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.titleVisibility = .hidden
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [
            MainToolbarItem.modeSwitcher,
            .flexibleSpace,
            MainToolbarItem.statusBadge,
            .flexibleSpace,
            MainToolbarItem.reload,
        ]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: itemIdentifier)
        switch itemIdentifier {
        case MainToolbarItem.modeSwitcher:
            item.label = "连接模式"
            item.view = modeSegmentControl
            return item
        case MainToolbarItem.statusBadge:
            item.label = "连接状态"
            item.view = statusPillView
            return item
        case MainToolbarItem.reload:
            item.label = "刷新"
            item.view = reloadToolbarButton
            return item
        default:
            return nil
        }
    }

    // MARK: - Local backend detection, auto-install & startup

    private func presentMissingLocalBackend(allowAutoInstall: Bool) {
        switch backendManager.detect() {
        case .notInstalled:
            if allowAutoInstall && autoInstallOnMissing && !hasAttemptedAutoInstall && !hasConnectedLocally {
                hasAttemptedAutoInstall = true
                startOneClickInstall(automatic: true)
            } else {
                connectionState = .notInstalled
                showOnboardingNotInstalled(
                    title: "尚未安装本机独立后台",
                    detail: "本机模式需要安装独立后台服务（local-ai-agent）。点击下方按钮自动下载、校验并启动，或直接切换至远程 Relay 使用其他设备。",
                    keepLog: false
                )
            }
        case .installed(let executable):
            connectionState = .disconnected
            showInstalledStopped(
                executable: executable,
                title: "本机独立后台未运行",
                detail: "已检测到本机独立后台（\(executable.path)），但当前未在运行。点击下方按钮立即启动，或切换至远程 Relay。",
                keepLog: false
            )
        }
    }

    private func startOneClickInstall(automatic: Bool) {
        cancelBackendTask()
        hasAttemptedAutoInstall = true
        connectionState = .installing
        isRunningBackendProcess = true
        clearLog()
        showBusyCard(
            badge: "本机模式 · 自动安装",
            title: automatic ? "正在为你安装本机独立后台" : "正在安装本机独立后台",
            detail: "正在从官方仓库下载、校验并启动独立后台（local-ai-agent），完成后将自动进入界面。你也可以随时切换至远程 Relay。",
            caption: "正在准备安装…",
            cancelTitle: "取消安装"
        )
        watchDescriptor()

        backendTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.backendManager.installAndStart { [weak self] chunk in
                    Task { @MainActor in
                        self?.appendLog(chunk)
                    }
                }
                guard !Task.isCancelled, self.mode == .local else { return }
                self.isRunningBackendProcess = false
                self.progressCaption.stringValue = "安装已完成，正在等待本机后台就绪…"
                await self.waitForDescriptorAndConnect(timeoutSeconds: 15)
            } catch is CancellationError {
                self.handleBackendTaskCancelled()
            } catch StandaloneBackendError.cancelled {
                self.handleBackendTaskCancelled()
            } catch {
                self.handleBackendTaskFailure(error, wasInstalling: true)
            }
        }
    }

    private func startInstalledBackend(_ executable: URL) {
        cancelBackendTask()
        connectionState = .starting
        isRunningBackendProcess = true
        clearLog()
        showBusyCard(
            badge: "本机模式 · 启动中",
            title: "正在启动本机独立后台",
            detail: "正在启动 \(executable.path)，就绪后将自动进入界面。",
            caption: "正在启动后台服务…",
            cancelTitle: "取消启动"
        )
        watchDescriptor()

        backendTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.backendManager.startInstalled(executable) { [weak self] chunk in
                    Task { @MainActor in
                        self?.appendLog(chunk)
                    }
                }
                guard !Task.isCancelled, self.mode == .local else { return }
                self.isRunningBackendProcess = false
                self.progressCaption.stringValue = "后台已启动，正在建立连接…"
                await self.waitForDescriptorAndConnect(timeoutSeconds: 15)
            } catch is CancellationError {
                self.handleBackendTaskCancelled()
            } catch StandaloneBackendError.cancelled {
                self.handleBackendTaskCancelled()
            } catch {
                self.handleBackendTaskFailure(error, wasInstalling: false)
            }
        }
    }

    private func waitForDescriptorAndConnect(timeoutSeconds: TimeInterval) async {
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        while Date() < deadline {
            if Task.isCancelled || mode != .local { return }
            if local != nil { return }
            if let fresh = try? readDescriptor() {
                startSignIn(LocalConnection(descriptor: fresh, target: reconnectTarget))
                return
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        guard !Task.isCancelled, mode == .local, local == nil else { return }
        backendTask = nil
        connectionState = .disconnected
        switch backendManager.detect() {
        case .installed(let executable):
            showInstalledStopped(
                executable: executable,
                title: "后台尚未就绪",
                detail: "命令已执行，但在 \(Int(timeoutSeconds)) 秒内未检测到本机后台连接信息。请查看下方日志，或重试连接。",
                keepLog: true
            )
        case .notInstalled:
            showOnboardingNotInstalled(
                title: "未检测到本机独立后台就绪",
                detail: "安装流程已结束，但仍未检测到本机后台。请查看下方日志后重试，或切换至远程 Relay。",
                keepLog: true
            )
        }
    }

    private func handleBackendTaskCancelled() {
        isRunningBackendProcess = false
        backendTask = nil
        guard mode == .local else { return }
        switch backendManager.detect() {
        case .notInstalled:
            connectionState = .notInstalled
            showOnboardingNotInstalled(
                title: "已取消安装本机独立后台",
                detail: "你可以随时点击下方按钮重新安装，或切换至远程 Relay 连接其他设备。",
                keepLog: !logTextView.string.isEmpty
            )
        case .installed(let executable):
            connectionState = .disconnected
            showInstalledStopped(
                executable: executable,
                title: "已取消启动本机独立后台",
                detail: "你可以重新启动本机后台，或切换至远程 Relay。",
                keepLog: !logTextView.string.isEmpty
            )
        }
    }

    private func handleBackendTaskFailure(_ error: Error, wasInstalling: Bool) {
        isRunningBackendProcess = false
        backendTask = nil
        guard mode == .local else { return }
        appendLog("\n[错误] \(error.localizedDescription)\n")
        switch backendManager.detect() {
        case .installed(let executable) where !wasInstalling:
            connectionState = .disconnected
            showInstalledStopped(
                executable: executable,
                title: "启动本机独立后台失败",
                detail: error.localizedDescription,
                keepLog: true
            )
        default:
            connectionState = .notInstalled
            showOnboardingNotInstalled(
                title: wasInstalling ? "安装本机独立后台失败" : "启动本机独立后台失败",
                detail: "\(error.localizedDescription) 你可以重试安装、复制命令到终端执行，或先切换至远程 Relay。",
                keepLog: true,
                primaryTitle: "重试安装本机后台"
            )
        }
    }

    private func cancelBackendTask() {
        isRunningBackendProcess = false
        backendManager.cancel()
        backendTask?.cancel()
        backendTask = nil
    }

    // MARK: - Navigation & descriptor helpers

    private func readDescriptor() throws -> LocalHostDescriptor { try .read(directory: descriptorDirectory) }

    private var localPage: URL? { webView.url.flatMap { local?.descriptor.origin.contains($0) == true ? $0 : nil } }

    /// The page last committed to the web view. `webView.url` already names a navigation that is still pending.
    private var committedLocalPage: URL? {
        webView.backForwardList.currentItem.map(\.url).flatMap { local?.descriptor.origin.contains($0) == true ? $0 : nil }
    }

    private func startSignIn(_ connection: LocalConnection) {
        reconnectTarget = nil
        local = connection
        connectionState = .connecting
        webView.isHidden = true
        messageContainer.isHidden = true
        updateModeAndStatusUI()
        load(connection.descriptor.signInURL)
    }

    private func watchDescriptor() {
        guard mode == .local, descriptorWatch == nil else { return }
        descriptorWatch = HostWatch(directory: descriptorDirectory) { [weak self] in self?.descriptorChanged() }
    }

    private func descriptorChanged() {
        guard mode == .local, !isRunningBackendProcess, let fresh = try? readDescriptor(), fresh != local?.descriptor else { return }
        let target = local?.step.target ?? localPage ?? reconnectTarget
        startSignIn(LocalConnection(descriptor: fresh, target: target))
    }

    // MARK: - Message / onboarding presentation

    private func showLocalConnectionFailure(_ detail: String) {
        switch backendManager.detect() {
        case .installed(let executable):
            showInstalledStopped(
                executable: executable,
                title: "无法连接本机独立后台",
                detail: detail,
                keepLog: false
            )
        case .notInstalled:
            applyCard(
                badge: "本机模式 · 未连接",
                title: "无法连接本机独立后台",
                detail: detail,
                primaryTitle: "重试连接",
                primaryAction: .retry,
                showRetry: false,
                switchTitle: "切换至远程 Relay",
                showCancel: false,
                showReinstall: true,
                showCopyCommand: true,
                showBusy: false,
                showLog: false
            )
        }
    }

    private func showOnboardingNotInstalled(title: String, detail: String, keepLog: Bool, primaryTitle: String = "一键安装并启动本机后台") {
        applyCard(
            badge: "本机模式 · 未安装",
            title: title,
            detail: detail,
            primaryTitle: primaryTitle,
            primaryAction: .installBackend,
            showRetry: false,
            switchTitle: "切换至远程 Relay",
            showCancel: false,
            showReinstall: false,
            showCopyCommand: true,
            showBusy: false,
            showLog: keepLog
        )
    }

    private func showInstalledStopped(executable: URL, title: String, detail: String, keepLog: Bool) {
        applyCard(
            badge: "本机模式 · 未运行",
            title: title,
            detail: detail,
            primaryTitle: "启动本机后台",
            primaryAction: .startInstalled(executable),
            showRetry: true,
            switchTitle: "切换至远程 Relay",
            showCancel: false,
            showReinstall: true,
            showCopyCommand: false,
            showBusy: false,
            showLog: keepLog
        )
    }

    private func showRelayError(_ detail: String) {
        applyCard(
            badge: "远程 Relay · 未连接",
            title: "无法连接远程 Relay",
            detail: detail,
            primaryTitle: "重新连接 Relay",
            primaryAction: .retry,
            showRetry: false,
            switchTitle: "切换至本机模式",
            showCancel: false,
            showReinstall: false,
            showCopyCommand: false,
            showBusy: false,
            showLog: false
        )
    }

    private func showBusyCard(badge: String, title: String, detail: String, caption: String, cancelTitle: String) {
        progressCaption.stringValue = caption
        cancelButton.title = cancelTitle
        applyCard(
            badge: badge,
            title: title,
            detail: detail,
            primaryTitle: nil,
            primaryAction: .none,
            showRetry: false,
            switchTitle: "切换至远程 Relay",
            showCancel: true,
            showReinstall: false,
            showCopyCommand: false,
            showBusy: true,
            showLog: true
        )
    }

    private func applyCard(
        badge: String,
        title: String,
        detail: String,
        primaryTitle: String?,
        primaryAction: PrimaryAction,
        showRetry: Bool,
        switchTitle: String,
        showCancel: Bool,
        showReinstall: Bool,
        showCopyCommand: Bool,
        showBusy: Bool,
        showLog: Bool
    ) {
        self.primaryAction = primaryAction
        messageBadgeLabel.stringValue = badge
        messageTitle.stringValue = title
        messageDetail.stringValue = detail

        if let primaryTitle {
            primaryButton.title = primaryTitle
            primaryButton.isHidden = false
            primaryButton.isEnabled = true
        } else {
            primaryButton.isHidden = true
        }
        retryButton.isHidden = !showRetry
        switchModeButton.title = switchTitle
        switchModeButton.isHidden = false
        switchModeButton.isEnabled = true
        cancelButton.isHidden = !showCancel
        cancelButton.isEnabled = showCancel

        reinstallButton.isHidden = !showReinstall
        copyCommandButton.isHidden = !showCopyCommand
        secondaryActionsRow.isHidden = !showReinstall && !showCopyCommand

        progressRow.isHidden = !showBusy
        if showBusy {
            progressSpinner.startAnimation(nil)
        } else {
            progressSpinner.stopAnimation(nil)
        }
        logScrollView.isHidden = !showLog

        webView.isHidden = true
        messageContainer.isHidden = false
        updateModeAndStatusUI()
    }

    private func showPage() {
        let wasHidden = webView.isHidden
        progressSpinner.stopAnimation(nil)
        messageContainer.isHidden = true
        webView.isHidden = false
        if wasHidden { window?.makeFirstResponder(webView) }
    }

    private func clearLog() {
        logTextView.string = ""
    }

    private func appendLog(_ text: String) {
        guard !text.isEmpty else { return }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular),
            .foregroundColor: NSColor.labelColor,
        ]
        logTextView.textStorage?.append(NSAttributedString(string: text, attributes: attrs))
        logTextView.scrollToEndOfDocument(nil)
        if let lastLine = text.split(whereSeparator: \.isNewline).last.map(String.init), !lastLine.isEmpty {
            progressCaption.stringValue = lastLine
        }
    }

    private func configureMessage(in content: NSView) {
        messageBadgeLabel.font = .systemFont(ofSize: 12, weight: .medium)
        messageBadgeLabel.textColor = .secondaryLabelColor
        messageBadgeLabel.alignment = .center

        messageTitle.font = .systemFont(ofSize: 22, weight: .semibold)
        messageTitle.alignment = .center

        messageDetail.alignment = .center
        messageDetail.textColor = .secondaryLabelColor
        messageDetail.preferredMaxLayoutWidth = 480

        progressSpinner.style = .spinning
        progressSpinner.controlSize = .small
        progressCaption.font = .systemFont(ofSize: 12)
        progressCaption.textColor = .secondaryLabelColor
        progressCaption.lineBreakMode = .byTruncatingMiddle
        progressCaption.maximumNumberOfLines = 1
        progressRow.orientation = .horizontal
        progressRow.alignment = .centerY
        progressRow.spacing = 8
        progressRow.addArrangedSubview(progressSpinner)
        progressRow.addArrangedSubview(progressCaption)
        progressRow.isHidden = true

        logTextView.isEditable = false
        logTextView.isSelectable = true
        logTextView.drawsBackground = true
        logTextView.backgroundColor = .textBackgroundColor
        logTextView.textContainerInset = NSSize(width: 8, height: 8)
        logTextView.isHorizontallyResizable = false
        logTextView.autoresizingMask = [.width]
        logTextView.textContainer?.widthTracksTextView = true

        logScrollView.documentView = logTextView
        logScrollView.hasVerticalScroller = true
        logScrollView.autohidesScrollers = true
        logScrollView.borderType = .bezelBorder
        logScrollView.translatesAutoresizingMaskIntoConstraints = false
        logScrollView.isHidden = true
        NSLayoutConstraint.activate([
            logScrollView.widthAnchor.constraint(equalToConstant: 520),
            logScrollView.heightAnchor.constraint(equalToConstant: 165),
        ])

        primaryButton.bezelStyle = .rounded
        primaryButton.keyEquivalent = "\r"
        primaryButton.target = self
        primaryButton.action = #selector(primaryActionTapped)

        retryButton.bezelStyle = .rounded
        retryButton.target = self
        retryButton.action = #selector(reloadPage)

        switchModeButton.bezelStyle = .rounded
        switchModeButton.target = self
        switchModeButton.action = #selector(switchModeTapped)

        cancelButton.bezelStyle = .rounded
        cancelButton.target = self
        cancelButton.action = #selector(cancelBackendOperation)

        let mainButtonsRow = NSStackView(views: [primaryButton, retryButton, cancelButton, switchModeButton])
        mainButtonsRow.orientation = .horizontal
        mainButtonsRow.spacing = 10

        reinstallButton.bezelStyle = .inline
        reinstallButton.isBordered = false
        reinstallButton.contentTintColor = .secondaryLabelColor
        reinstallButton.font = .systemFont(ofSize: 12)
        reinstallButton.target = self
        reinstallButton.action = #selector(reinstallTapped)

        copyCommandButton.bezelStyle = .inline
        copyCommandButton.isBordered = false
        copyCommandButton.contentTintColor = .secondaryLabelColor
        copyCommandButton.font = .systemFont(ofSize: 12)
        copyCommandButton.target = self
        copyCommandButton.action = #selector(copyInstallCommand)

        secondaryActionsRow.orientation = .horizontal
        secondaryActionsRow.spacing = 16
        secondaryActionsRow.addArrangedSubview(reinstallButton)
        secondaryActionsRow.addArrangedSubview(copyCommandButton)
        secondaryActionsRow.isHidden = true

        [
            messageBadgeLabel,
            messageTitle,
            messageDetail,
            progressRow,
            logScrollView,
            mainButtonsRow,
            secondaryActionsRow,
        ].forEach { messageStack.addArrangedSubview($0) }

        messageStack.orientation = .vertical
        messageStack.alignment = .centerX
        messageStack.spacing = 12
        messageStack.translatesAutoresizingMaskIntoConstraints = false

        messageContainer.translatesAutoresizingMaskIntoConstraints = false
        messageContainer.isHidden = true
        messageContainer.addSubview(messageStack)
        content.addSubview(messageContainer)

        NSLayoutConstraint.activate([
            messageContainer.topAnchor.constraint(equalTo: content.topAnchor),
            messageContainer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            messageContainer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            messageContainer.trailingAnchor.constraint(equalTo: content.trailingAnchor),

            messageStack.centerXAnchor.constraint(equalTo: messageContainer.centerXAnchor),
            messageStack.centerYAnchor.constraint(equalTo: messageContainer.centerYAnchor),
            messageStack.leadingAnchor.constraint(greaterThanOrEqualTo: messageContainer.leadingAnchor, constant: 28),
            messageStack.trailingAnchor.constraint(lessThanOrEqualTo: messageContainer.trailingAnchor, constant: -28),
        ])
    }

    // MARK: - Toolbar & title sync

    private func statusSummary() -> (text: String, color: NSColor) {
        switch (mode, connectionState) {
        case (.local, .connected):
            return ("本机 · 已连接", .systemGreen)
        case (.local, .connecting):
            return ("本机 · 连接中", .systemOrange)
        case (.local, .installing):
            return ("本机 · 安装中", .systemOrange)
        case (.local, .starting):
            return ("本机 · 启动中", .systemOrange)
        case (.local, .notInstalled):
            return ("本机 · 未安装", .systemYellow)
        case (.local, .disconnected):
            return ("本机 · 未连接", .systemRed)
        case (.relay, .connected):
            return ("远程 · Relay", .systemBlue)
        case (.relay, .connecting):
            return ("远程 · 连接中", .systemOrange)
        case (.relay, _):
            return ("远程 · 未连接", .systemRed)
        }
    }

    private func updateModeAndStatusUI() {
        modeSegmentControl?.selectedSegment = mode == .local ? 0 : 1
        let summary = statusSummary()
        statusPillView?.update(text: summary.text, color: summary.color)
        reloadToolbarButton?.isEnabled = !isRunningBackendProcess
        updateTitle()
    }

    private func updateTitle() {
        let title = webView.title ?? ""
        let label = mode == .local ? "本机" : "远程 Relay"
        window?.title = "\(title.isEmpty ? "Local AI Agent" : title) · \(label)"
    }
}
