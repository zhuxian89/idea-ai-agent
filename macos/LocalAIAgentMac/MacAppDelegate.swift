import AppKit
import WebKit

@MainActor
final class MacAppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private static let modeKey = "connectionMode"
    let descriptorDirectory: URL
    private let usesDefaultDescriptorDirectory: Bool
    private var windows: [MacWindowController] = []

    override init() {
        if let override = ProcessInfo.processInfo.environment["IDE_AGENT_REMOTE_HOST_DIR"], !override.isEmpty {
            descriptorDirectory = URL(fileURLWithPath: override, isDirectory: true)
            usesDefaultDescriptorDirectory = false
        } else {
            descriptorDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("LocalAIAgent/remote", isDirectory: true)
            usesDefaultDescriptorDirectory = true
        }
        super.init()
    }

    private var current: MacWindowController? { NSApp.keyWindow?.windowController as? MacWindowController }
    private var preferred: ConnectionMode {
        UserDefaults.standard.string(forKey: Self.modeKey).flatMap(ConnectionMode.init(rawValue:)) ?? .local
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        DownloadFiles.cleanPreviousLaunch()
        installMenus()
        if windows.isEmpty { newWindow() }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { newWindow() }
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for target in urls.compactMap({ DeepLink.parse($0) }) {
            let window = current ?? windows.last ?? makeWindow(mode: .relay)
            // An incoming link opens its Relay session without changing the default for future windows.
            window.open(.relay, target: target)
            window.showWindow(nil)
            window.window?.makeKeyAndOrderFront(nil)
        }
    }

    func present(_ controller: MacWindowController) {
        controller.appDelegate = self
        windows.append(controller)
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    func remove(_ controller: MacWindowController) { windows.removeAll { $0 === controller } }

    func select(_ mode: ConnectionMode, in controller: MacWindowController) {
        UserDefaults.standard.set(mode.rawValue, forKey: Self.modeKey)
        controller.open(mode)
    }

    private func makeWindow(mode: ConnectionMode) -> MacWindowController {
        let fallback = usesDefaultDescriptorDirectory ? StandaloneBackendManager.defaultExecutableURL : nil
        let backendManager = StandaloneBackendManager(descriptorDirectory: descriptorDirectory, fallbackExecutable: fallback)
        let controller = MacWindowController(
            mode: mode,
            directory: descriptorDirectory,
            backendManager: backendManager,
            autoInstallOnMissing: true
        )
        present(controller)
        return controller
    }

    @objc private func newWindow() {
        let mode = current?.mode ?? preferred
        makeWindow(mode: mode).open(mode)
    }

    @objc private func useLocal() { pick(.local) }
    @objc private func useRelay() { pick(.relay) }
    private func pick(_ mode: ConnectionMode) { select(mode, in: current ?? makeWindow(mode: mode)) }
    @objc private func reload() { current?.reloadPage() }

    @objc private func find() {
        guard let controller = current, let window = controller.window else { return }
        let input = NSTextField(string: "")
        input.frame.size.width = 260
        let alert = NSAlert()
        alert.messageText = "在页面中查找"
        alert.addButton(withTitle: "查找")
        alert.addButton(withTitle: "取消")
        alert.accessoryView = input
        alert.window.initialFirstResponder = input
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn, !input.stringValue.isEmpty else { return }
            controller.webView.find(input.stringValue, configuration: WKFindConfiguration()) { _ in }
        }
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(useLocal) { menuItem.state = current?.mode == .local ? .on : .off }
        if menuItem.action == #selector(useRelay) { menuItem.state = current?.mode == .relay ? .on : .off }
        if menuItem.action == #selector(find) || menuItem.action == #selector(reload) { return current != nil }
        return true
    }

    private func installMenus() {
        let bar = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let root = NSMenuItem()
            let menu = NSMenu(title: title)
            root.submenu = menu
            bar.addItem(root)
            return menu
        }
        func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "",
                  target: AnyObject? = nil, modifiers: NSEvent.ModifierFlags = [.command]) {
            let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
            item.target = target
            item.keyEquivalentModifierMask = modifiers
        }

        let app = submenu("Local AI Agent")
        item(app, "关于 Local AI Agent", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        app.addItem(.separator())
        item(app, "隐藏 Local AI Agent", #selector(NSApplication.hide(_:)), "h")
        item(app, "隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", modifiers: [.command, .option])
        item(app, "显示全部", #selector(NSApplication.unhideAllApplications(_:)))
        app.addItem(.separator())
        item(app, "退出 Local AI Agent", #selector(NSApplication.terminate(_:)), "q")

        let file = submenu("文件")
        item(file, "新建窗口", #selector(newWindow), "n", target: self)
        item(file, "关闭窗口", #selector(NSWindow.performClose(_:)), "w")

        let edit = submenu("编辑")
        item(edit, "撤销", Selector(("undo:")), "z")
        item(edit, "重做", Selector(("redo:")), "z", modifiers: [.command, .shift])
        edit.addItem(.separator())
        item(edit, "剪切", #selector(NSText.cut(_:)), "x")
        item(edit, "复制", #selector(NSText.copy(_:)), "c")
        item(edit, "粘贴", #selector(NSText.paste(_:)), "v")
        item(edit, "全选", #selector(NSText.selectAll(_:)), "a")
        edit.addItem(.separator())
        item(edit, "查找…", #selector(find), "f", target: self)

        let view = submenu("显示")
        item(view, "刷新", #selector(reload), "r", target: self)
        item(view, "进入全屏", #selector(NSWindow.toggleFullScreen(_:)), "f", modifiers: [.command, .control])
        view.addItem(.separator())
        item(view, "本机后台", #selector(useLocal), "1", target: self, modifiers: [.command, .shift])
        item(view, "Relay 节点", #selector(useRelay), "2", target: self, modifiers: [.command, .shift])

        let window = submenu("窗口")
        item(window, "最小化", #selector(NSWindow.performMiniaturize(_:)), "m")
        item(window, "缩放", #selector(NSWindow.performZoom(_:)))
        item(window, "前置全部窗口", #selector(NSApplication.arrangeInFront(_:)))
        NSApp.mainMenu = bar
        NSApp.windowsMenu = window
    }
}
