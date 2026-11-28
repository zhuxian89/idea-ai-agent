import AppKit
import WebKit
import XCTest

final class WebKitTests: XCTestCase {
    @MainActor
    func testPageThemeControlsWindowAppearance() async throws {
        try await withFixture { _, controller in
            let window = try XCTUnwrap(controller.window)
            for (color, appearance) in [("#101827", NSAppearance.Name.darkAqua), ("#fafafa", .aqua)] {
                let result = try await controller.webView.callAsyncJavaScript(
                    "return await MindFSMacApp.call('setChrome', {color})", arguments: ["color": color], in: nil, contentWorld: .page
                )
                XCTAssertEqual(result as? Bool, true)
                XCTAssertEqual(window.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), appearance)
            }
        }
    }

    @MainActor
    func testWebKitJavaScriptDialogsUseNativeSheets() async throws {
        try await withFixture { _, controller in
            controller.showWindow(nil)
            let window = try XCTUnwrap(controller.window)
            let web = controller.webView
            for (body, response, expected) in [
                ("alert('Test alert'); return 'dismissed';", NSApplication.ModalResponse.alertFirstButtonReturn, "dismissed"),
                ("return String(confirm('Test confirm'));", .alertSecondButtonReturn, "false"),
                ("return prompt('Test prompt', 'initial');", .alertFirstButtonReturn, "initial"),
            ] {
                let result = Task { try await web.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page) }
                defer { result.cancel() }
                try await self.until { window.attachedSheet != nil }
                window.endSheet(try XCTUnwrap(window.attachedSheet), returnCode: response)
                let value = try await result.value as? String
                XCTAssertEqual(value, expected)
            }
        }
    }

    @MainActor
    func testAttachmentOpensSavePanelAndCanBeCancelled() async throws {
        try await withFixture { fixture, controller in
            controller.showWindow(nil)
            let window = try XCTUnwrap(controller.window)
            controller.setChrome(.initial)
            controller.load(fixture.origin.appendingPathComponent("attachment"))
            try await self.until { window.attachedSheet != nil }
            let sheet = try XCTUnwrap(window.attachedSheet)
            XCTAssertEqual(sheet.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]), .darkAqua)
            window.endSheet(sheet, returnCode: .cancel)
            try await self.until { window.attachedSheet == nil }
            XCTAssertFalse(controller.webView.isHidden)
        }
    }

    @MainActor
    func testAttachmentRestoresHiddenWindowForSavePanel() async throws {
        try await withFixture { fixture, controller in
            controller.showWindow(nil)
            let window = try XCTUnwrap(controller.window)
            window.orderOut(nil)
            XCTAssertFalse(window.isVisible)
            controller.load(fixture.origin.appendingPathComponent("attachment"))
            try await self.until { window.attachedSheet != nil }
            XCTAssertTrue(window.isVisible)
            window.endSheet(try XCTUnwrap(window.attachedSheet), returnCode: .cancel)
            try await self.until { window.attachedSheet == nil }
        }
    }

    @MainActor
    func testAttachmentAfterSessionRenewalReturnsToTheOriginalPage() async throws {
        try await withFixture { fixture, controller in
            controller.showWindow(nil)
            let window = try XCTUnwrap(controller.window)
            let page = fixture.origin.appendingPathComponent("viewer").absoluteString + "?root=a&session=b#draft"
            controller.load(URL(string: page)!)
            try await self.until("session page") { controller.webView.url?.absoluteString == page && !controller.webView.isLoading }
            try await fixture.rotate(token: "renewed", mode: "in-place")
            controller.load(fixture.origin.appendingPathComponent("attachment"))
            try await self.until("save panel after the session was renewed") { window.attachedSheet != nil }
            window.endSheet(try XCTUnwrap(window.attachedSheet), returnCode: .cancel)
            try await self.until("original session page after the download") {
                controller.webView.url?.absoluteString == page && controller.local?.step == .ready && !controller.webView.isHidden
            }
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["unauthorized"], 1)
            XCTAssertEqual(stats["sign_in"], 2)
        }
    }

    @MainActor
    func testDownloadLinkWithStaleSessionRenewsAndDeliversTheFile() async throws {
        try await withFixture { fixture, controller in
            controller.showWindow(nil)
            let window = try XCTUnwrap(controller.window)
            let page = fixture.origin.appendingPathComponent("viewer").absoluteString + "?root=a&session=b#draft"
            controller.load(URL(string: page)!)
            try await self.until("session page") { controller.webView.url?.absoluteString == page && !controller.webView.isLoading }
            try await fixture.rotate(token: "renewed", mode: "in-place")
            _ = try await controller.webView.evaluateJavaScript("document.getElementById('save').click(); true")
            try await self.until("save panel after the session was renewed") { window.attachedSheet != nil }
            // The panel opens over the finished download, so its source file is the fetched attachment, not the 401 body.
            let held = try XCTUnwrap(self.pendingDownloads().first, "downloaded file")
            XCTAssertEqual(try String(contentsOf: held, encoding: .utf8), "mac download fixture\n")
            XCTAssertEqual(held.lastPathComponent, "fixture.txt")
            window.endSheet(try XCTUnwrap(window.attachedSheet), returnCode: .cancel)
            try await self.until("original session page after the download") {
                controller.webView.url?.absoluteString == page && controller.local?.step == .ready && !controller.webView.isHidden
            }
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["unauthorized"], 1)
            XCTAssertEqual(stats["sign_in"], 2)
        }
    }

    private func pendingDownloads() -> [URL] {
        let folder = DownloadFiles.root.appendingPathComponent(String(getpid()), isDirectory: true)
        let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey])
        return (files?.allObjects as? [URL] ?? []).filter { (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
    }

    @MainActor
    func testRetryAfterConnectionFailureReturnsToFailedPage() async throws {
        try await withFixture { fixture, controller in
            let page = fixture.origin.appendingPathComponent("project").absoluteString + "?root=a&session=b#draft"
            try await fixture.setFailing(true)
            controller.load(URL(string: page)!)
            try await self.until("connection error page") { controller.webView.isHidden }
            try await fixture.setFailing(false)
            controller.reloadPage()
            try await self.until("failed page restored") {
                controller.webView.url?.absoluteString == page && controller.local?.step == .ready && !controller.webView.isHidden
            }
        }
    }

    @MainActor
    func testRetryWhileBackendRestartsKeepsFailedPageForReconnect() async throws {
        try await withFixture { fixture, controller in
            let page = fixture.origin.appendingPathComponent("project").absoluteString + "?root=a&session=b#draft"
            try await fixture.setFailing(true)
            controller.load(URL(string: page)!)
            try await self.until("connection error page") { controller.webView.isHidden }
            // The backend removes host.json on exit; the user retries before the new one is published.
            try FileManager.default.removeItem(at: fixture.directory.appendingPathComponent("host.json"))
            try await fixture.setFailing(false)
            controller.reloadPage()
            XCTAssertTrue(controller.webView.isHidden)
            try await fixture.rotate(token: "restarted", mode: "replace")
            try await self.until("failed page restored once the backend is back") {
                controller.webView.url?.absoluteString == page && controller.local?.step == .ready && !controller.webView.isHidden
            }
        }
    }

    @MainActor
    func testPageReadsSystemAppearanceWhateverTheWindowChrome() async throws {
        try await withFixture { _, controller in
            controller.showWindow(nil)
            let systemIsDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            for color in ["#101827", "#fafafa"] {
                controller.setChrome(try XCTUnwrap(ThemeColor(hex: color)))
                try await self.until("page prefers-color-scheme follows the system with chrome \(color)") {
                    try await controller.webView.evaluateJavaScript("matchMedia('(prefers-color-scheme: dark)').matches") as? Bool == systemIsDark
                }
            }
        }
    }

    @MainActor
    func testLocalSignInAndActualWebKitBridge() async throws {
        try await withFixture { fixture, controller in
            try await self.until { try await controller.webView.evaluateJavaScript("document.body.dataset.token") as? String == "first" }
            XCTAssertEqual(controller.local?.step, .ready)
            let info = try await controller.webView.callAsyncJavaScript("return await MindFSMacApp.call('getAppInfo')", arguments: [:], in: nil, contentWorld: .page)
            XCTAssertNotNil((info as? [String: String])?["version"])
            let state = try await controller.webView.evaluateJavaScript("[MindFSMacApp.platform, Object.isFrozen(MindFSMacApp), document.cookie, window.childBridge]") as? [Any]
            XCTAssertEqual(state?[0] as? String, "macos")
            XCTAssertEqual(state?[1] as? Bool, true)
            XCTAssertEqual(state?[2] as? String, "")
            XCTAssertEqual(state?[3] as? String, "denied")
            let expected = try XCTUnwrap(NSColor(srgbRed: 53 / 255.0, green: 122 / 255.0, blue: 188 / 255.0, alpha: 1).usingColorSpace(.sRGB))
            try await self.until { controller.window?.backgroundColor.usingColorSpace(.sRGB) == expected }
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["sign_in"], 1)
            XCTAssertEqual(stats["root_page"], 1)
        }
    }

    @MainActor
    func testPopupUsesSameOriginBridgeAndRecoversItsOwnPage() async throws {
        try await withFixture { fixture, controller in
            let appDelegate = MacAppDelegate()
            appDelegate.present(controller)
            let path = "/popup?session=child#draft"
            let opened = try await controller.webView.callAsyncJavaScript(
                "return Boolean(window.open(path))", arguments: ["path": path], in: nil, contentWorld: .page
            )
            XCTAssertEqual(opened as? Bool, true)
            let popup = try XCTUnwrap(NSApp.windows.compactMap { $0.windowController as? MacWindowController }.first { $0.isPopup })
            defer { popup.close() }
            let page = URL(string: path, relativeTo: fixture.origin)!.absoluteURL
            try await self.until { popup.webView.url == page && !popup.webView.isLoading }
            let info = try await popup.webView.callAsyncJavaScript("return await MindFSMacApp.call('getAppInfo')", arguments: [:], in: nil, contentWorld: .page)
            XCTAssertNotNil((info as? [String: String])?["version"])
            try await self.until { try await popup.webView.evaluateJavaScript("window.childBridge") as? String == "denied" }

            try await fixture.rotate(token: "popup-renewed", mode: "in-place")
            _ = try await popup.webView.evaluateJavaScript("location.reload(); true")
            try await self.until { popup.local?.descriptor.token == "popup-renewed" && popup.local?.step == .ready }
            XCTAssertEqual(popup.webView.url, page)
            let token = try await popup.webView.evaluateJavaScript("document.body.dataset.token") as? String
            XCTAssertEqual(token, "popup-renewed")
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["sign_in"], 2)
            XCTAssertEqual(stats["unauthorized"], 1)
        }
    }

    @MainActor
    func testMainFrame401RecoversChangedTokenAndExactPage() async throws {
        try await withFixture { fixture, controller in
            let page = fixture.origin.appendingPathComponent("project").absoluteString + "?root=a&session=b#draft"
            controller.load(URL(string: page)!)
            try await self.until { controller.webView.url?.absoluteString == page && !controller.webView.isLoading }
            try await fixture.rotate(token: "second", mode: "in-place")
            _ = try await controller.webView.evaluateJavaScript("location.reload(); true")
            try await self.until { controller.local?.descriptor.token == "second" && controller.local?.step == .ready }
            let token = try await controller.webView.evaluateJavaScript("document.body.dataset.token") as? String
            XCTAssertEqual(token, "second")
            XCTAssertEqual(controller.webView.url?.absoluteString, page)
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["sign_in"], 2)
            XCTAssertEqual(stats["unauthorized"], 1)
        }
    }

    @MainActor
    func testDescriptorReplacementReconnectsPageWithoutManualRefresh() async throws {
        try await withFixture { fixture, controller in
            let page = fixture.origin.appendingPathComponent("open").absoluteString + "?session=retained#position"
            controller.load(URL(string: page)!)
            try await self.until { controller.webView.url?.absoluteString == page && !controller.webView.isLoading }
            try await fixture.rotate(token: "after-restart", mode: "replace")
            try await self.until { controller.local?.descriptor.token == "after-restart" && controller.local?.step == .ready }
            let token = try await controller.webView.evaluateJavaScript("document.body.dataset.token") as? String
            XCTAssertEqual(token, "after-restart")
            XCTAssertEqual(controller.webView.url?.absoluteString, page)
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["sign_in"], 2)
            XCTAssertEqual(stats["unauthorized"], 0)
        }
    }

    @MainActor
    func testInvalidTokenCannotCreateRetryLoop() async throws {
        try await withFixture { fixture, controller in
            try await fixture.rotate(token: "unpublished", mode: "none")
            _ = try await controller.webView.evaluateJavaScript("location.reload(); true")
            try await self.until { controller.webView.isHidden }
            try await self.until { try await fixture.stats()["unauthorized"] == 2 }
            try await Task.sleep(nanoseconds: 300_000_000)
            let stats = try await fixture.stats()
            XCTAssertEqual(stats["sign_in"], 2)
            XCTAssertEqual(stats["unauthorized"], 2)
        }
    }

    @MainActor
    func testToolbarModeSwitcherAndStatusReflectLocalAndRelay() async throws {
        try await withFixture { _, controller in
            XCTAssertFalse(controller.isPopup)
            XCTAssertNotNil(controller.window?.toolbar)
            XCTAssertEqual(controller.modeSegmentControl?.selectedSegment, 0)
            XCTAssertEqual(controller.connectionState, .connected)
            XCTAssertEqual(controller.connectionStatusText, "本机 · 已连接")

            controller.selectModeSegment(1)
            XCTAssertEqual(controller.mode, .relay)
            XCTAssertEqual(controller.modeSegmentControl?.selectedSegment, 1)
            XCTAssertEqual(controller.requestedURL, MacWindowController.relayNodes)
            XCTAssertTrue(controller.connectionStatusText.hasPrefix("远程 · "))

            controller.selectModeSegment(0)
            try await self.until("reconnected back to local") {
                controller.mode == .local && controller.local?.step == .ready && controller.connectionState == .connected
            }
            XCTAssertEqual(controller.modeSegmentControl?.selectedSegment, 0)
            XCTAssertEqual(controller.connectionStatusText, "本机 · 已连接")
        }
    }

    @MainActor
    func testMissingBackendAutoInstallsAndConnectsAutomatically() async throws {
        _ = NSApplication.shared
        let fixture = try WebFixture()
        defer { fixture.stop() }
        try await fixture.waitUntilPublished()
        let publishedHostData = try Data(contentsOf: fixture.directory.appendingPathComponent("host.json"))

        let fm = FileManager.default
        let isolatedRoot = fm.temporaryDirectory.appendingPathComponent("auto-install-\(UUID().uuidString)", isDirectory: true)
        defer { try? fm.removeItem(at: isolatedRoot) }
        let missingRemoteDir = isolatedRoot.appendingPathComponent("LocalAIAgent/remote", isDirectory: true)

        final class Counter: @unchecked Sendable {
            let lock = NSLock()
            var runs = 0
            var executablePath = ""
            func record(path: String) {
                lock.lock()
                runs += 1
                executablePath = path
                lock.unlock()
            }
        }
        let counter = Counter()

        let manager = StandaloneBackendManager(
            descriptorDirectory: missingRemoteDir,
            fallbackExecutable: nil,
            fetchScript: { Data("#!/bin/sh\necho simulated\n".utf8) },
            runProcess: { executable, _, _, onOutput in
                counter.record(path: executable.path)
                onOutput("Downloading standalone backend...\n")
                try await Task.sleep(nanoseconds: 150_000_000)
                try fm.createDirectory(at: missingRemoteDir, withIntermediateDirectories: true)
                try publishedHostData.write(to: missingRemoteDir.appendingPathComponent("host.json"), options: .atomic)
                onOutput("Local AI Agent installed and started.\n")
                return 0
            }
        )

        let controller = MacWindowController(
            mode: .local,
            directory: missingRemoteDir,
            dataStore: .nonPersistent(),
            backendManager: manager,
            autoInstallOnMissing: true
        )
        defer { controller.close() }

        controller.open(.local)
        XCTAssertEqual(controller.connectionState, .installing)
        XCTAssertEqual(controller.connectionStatusText, "本机 · 安装中")
        XCTAssertTrue(controller.isShowingMessage)

        try await until("auto-install completed and signed in") {
            controller.local?.step == .ready && controller.connectionState == .connected && !controller.isShowingMessage
        }
        XCTAssertEqual(counter.runs, 1)
        XCTAssertEqual(counter.executablePath, "/bin/sh")
        XCTAssertEqual(controller.connectionStatusText, "本机 · 已连接")
        XCTAssertTrue(controller.logOutputText.contains("Downloading standalone backend..."))
        let token = try await controller.webView.evaluateJavaScript("document.body.dataset.token") as? String
        XCTAssertEqual(token, "first")
    }

    @MainActor
    func testAutoInstallFailureDoesNotLoopAndAllowsRelaySwitch() async throws {
        _ = NSApplication.shared
        let fm = FileManager.default
        let isolatedRoot = fm.temporaryDirectory.appendingPathComponent("auto-install-fail-\(UUID().uuidString)", isDirectory: true)
        let remoteDir = isolatedRoot.appendingPathComponent("remote", isDirectory: true)
        try fm.createDirectory(at: remoteDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: isolatedRoot) }

        final class Counter: @unchecked Sendable {
            let lock = NSLock()
            var runs = 0
            func increment() {
                lock.lock()
                runs += 1
                lock.unlock()
            }
        }
        let counter = Counter()

        let manager = StandaloneBackendManager(
            descriptorDirectory: remoteDir,
            fallbackExecutable: nil,
            fetchScript: { Data("#!/bin/sh\nexit 1\n".utf8) },
            runProcess: { _, _, _, onOutput in
                counter.increment()
                onOutput("simulated network failure\n")
                return 1
            }
        )

        let controller = MacWindowController(
            mode: .local,
            directory: remoteDir,
            dataStore: .nonPersistent(),
            backendManager: manager,
            autoInstallOnMissing: true
        )
        defer { controller.close() }

        controller.open(.local)
        try await until("failed auto-install falls back to retry card") {
            controller.connectionState == .notInstalled && controller.primaryActionTitle == "重试安装本机后台"
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(counter.runs, 1, "failed auto-install must never retry in a loop")
        XCTAssertTrue(controller.isShowingMessage)
        XCTAssertTrue(controller.logOutputText.contains("simulated network failure"))

        controller.selectModeSegment(1)
        XCTAssertEqual(controller.mode, .relay)
        XCTAssertEqual(controller.modeSegmentControl?.selectedSegment, 1)
        XCTAssertEqual(controller.requestedURL, MacWindowController.relayNodes)
    }

    @MainActor
    func testInstalledStoppedBackendOffersStartAndConnects() async throws {
        _ = NSApplication.shared
        let fixture = try WebFixture()
        defer { fixture.stop() }
        try await fixture.waitUntilPublished()
        let publishedHostData = try Data(contentsOf: fixture.directory.appendingPathComponent("host.json"))

        let fm = FileManager.default
        let isolatedRoot = fm.temporaryDirectory.appendingPathComponent("installed-start-\(UUID().uuidString)", isDirectory: true)
        let remoteDir = isolatedRoot.appendingPathComponent("remote", isDirectory: true)
        try fm.createDirectory(at: remoteDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: isolatedRoot) }

        let stubBinary = isolatedRoot.appendingPathComponent("local-ai-agent")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: stubBinary)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: stubBinary.path)
        try JSONEncoder().encode(["executable": stubBinary.path]).write(to: remoteDir.appendingPathComponent("installation.json"))

        final class Capture: @unchecked Sendable {
            let lock = NSLock()
            var runs = 0
            var executable: URL?
            var arguments: [String] = []
            func record(executable: URL, arguments: [String]) {
                lock.lock()
                runs += 1
                self.executable = executable
                self.arguments = arguments
                lock.unlock()
            }
        }
        let capture = Capture()

        let manager = StandaloneBackendManager(
            descriptorDirectory: remoteDir,
            fallbackExecutable: nil,
            fetchScript: { XCTFail("must not download installer when already installed"); return Data() },
            runProcess: { executable, arguments, _, onOutput in
                capture.record(executable: executable, arguments: arguments)
                onOutput("Starting local-ai-agent...\n")
                try publishedHostData.write(to: remoteDir.appendingPathComponent("host.json"), options: .atomic)
                return 0
            }
        )

        let controller = MacWindowController(
            mode: .local,
            directory: remoteDir,
            dataStore: .nonPersistent(),
            backendManager: manager,
            autoInstallOnMissing: true
        )
        defer { controller.close() }

        controller.open(.local)
        XCTAssertEqual(capture.runs, 0, "installed backend should prompt to start rather than auto-reinstall")
        XCTAssertEqual(controller.connectionState, .disconnected)
        XCTAssertEqual(controller.primaryActionTitle, "启动本机后台")
        XCTAssertTrue(controller.isShowingMessage)

        controller.performPrimaryAction()
        try await until("installed backend started and connected") {
            controller.local?.step == .ready && controller.connectionState == .connected && !controller.isShowingMessage
        }
        XCTAssertEqual(capture.runs, 1)
        XCTAssertEqual(capture.executable, stubBinary)
        XCTAssertEqual(capture.arguments, ["-no-browser"])
        XCTAssertEqual(controller.connectionStatusText, "本机 · 已连接")
    }

    @MainActor
    private func withFixture(_ run: (WebFixture, MacWindowController) async throws -> Void) async throws {
        _ = NSApplication.shared
        let fixture = try WebFixture()
        defer { fixture.stop() }
        try await fixture.waitUntilPublished()
        let controller = MacWindowController(mode: .local, directory: fixture.directory, dataStore: .nonPersistent())
        defer { controller.close() }
        controller.open(.local)
        try await until("initial local sign-in") { controller.local?.step == .ready }
        try await run(fixture, controller)
    }

    @MainActor
    private func until(_ what: String = "WebKit condition", file: StaticString = #filePath, line: UInt = #line,
                       _ condition: () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if (try? await condition()) == true { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw FixtureError.timeout("\(what) did not become true (\(file):\(line))")
    }
}

private enum FixtureError: LocalizedError {
    case timeout(String)
    case serverExited(Int32)
    case descriptorMissing(String)

    var errorDescription: String? {
        switch self {
        case .timeout(let message): return message
        case .serverExited(let status): return "Test backend exited with status \(status) before publishing host.json."
        case .descriptorMissing(let path): return "Test backend did not publish \(path) within 10 seconds."
        }
    }
}

private final class WebFixture {
    let directory: URL
    private let process = Process()
    var origin: URL!

    init() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        directory = root.appendingPathComponent("remote", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let support = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("TestSupport/server.py")
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["python3", support.path, directory.path]
        var environment = ProcessInfo.processInfo.environment
        environment["IDE_AGENT_REMOTE_HOST_DIR"] = directory.path
        environment["IDE_AGENT_DATA_DIR"] = root.appendingPathComponent("data").path
        environment["MINDFS_AGENTS_CONFIG"] = root.appendingPathComponent("agents.json").path
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.standardError
        try process.run()
    }

    /// Waits for the descriptor, stopping early with the real cause if the backend process dies.
    func waitUntilPublished() async throws {
        let descriptor = directory.appendingPathComponent("host.json")
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if FileManager.default.fileExists(atPath: descriptor.path) {
                origin = try LocalHostDescriptor.read(directory: directory).origin.url
                return
            }
            if !process.isRunning { throw FixtureError.serverExited(process.terminationStatus) }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw FixtureError.descriptorMissing(descriptor.path)
    }

    func setFailing(_ failing: Bool) async throws {
        var target = URLComponents(url: origin.appendingPathComponent("__test/fail"), resolvingAgainstBaseURL: false)!
        target.queryItems = [URLQueryItem(name: "on", value: failing ? "1" : "0")]
        _ = try await URLSession.shared.data(from: target.url!)
    }

    func rotate(token: String, mode: String) async throws {
        var target = URLComponents(url: origin.appendingPathComponent("__test/rotate"), resolvingAgainstBaseURL: false)!
        target.queryItems = [URLQueryItem(name: "token", value: token), URLQueryItem(name: "mode", value: mode)]
        _ = try await URLSession.shared.data(from: target.url!)
    }

    func stats() async throws -> [String: Int] {
        let (data, _) = try await URLSession.shared.data(from: origin.appendingPathComponent("__test/stats"))
        return try JSONDecoder().decode([String: Int].self, from: data)
    }

    func stop() {
        if process.isRunning { process.terminate(); process.waitUntilExit() }
        try? FileManager.default.removeItem(at: directory.deletingLastPathComponent())
    }
}
