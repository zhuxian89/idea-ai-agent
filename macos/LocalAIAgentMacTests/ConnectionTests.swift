import XCTest

final class ConnectionTests: XCTestCase {
    func testDescriptorAndLoopbackAddresses() throws {
        for address in ["http://127.0.0.1:7001", "http://127.20.30.40:7001/", "http://[::1]:7001", "http://[0:0:0:0:0:0:0:1]:7001", "http://[::ffff:127.0.0.1]:7001"] {
            let descriptor = try decode(address: address)
            XCTAssertEqual(descriptor.origin.port, 7001, address)
            XCTAssertTrue(descriptor.origin.contains(descriptor.origin.url), address)
        }
        for address in ["https://127.0.0.1:7001", "http://localhost:7001", "http://192.168.0.1:7001", "http://[::2]:7001",
                        "http://127.0.0.1", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:7001/p",
                        "http://127.0.0.1:7001/?p=1", "http://127.0.0.1:7001/#p", "http://u@127.0.0.1:7001", "http://127.1:7001"] {
            XCTAssertThrowsError(try decode(address: address), address)
        }
        XCTAssertThrowsError(try decode(protocolVersion: 2))
        XCTAssertThrowsError(try decode(mode: nil), "plugin control port is not a web backend")
        XCTAssertThrowsError(try decode(mode: "relay"))
        XCTAssertThrowsError(try decode(token: ""))
        XCTAssertThrowsError(try decode(remote: "http://example.org:7001"))
    }

    func testSignInEscapesToken() throws {
        let descriptor = try decode(token: "one+two &three")
        XCTAssertEqual(descriptor.signInURL.absoluteString, "http://127.0.0.1:7001/?ide_token=one%2Btwo%20%26three")
    }

    func testRecoveryRereadsDescriptorAndKeepsPathQueryAndFragment() throws {
        let first = try decode()
        let second = try decode(address: "http://127.0.0.1:7002", token: "rotated")
        let page = try XCTUnwrap(URL(string: "http://127.0.0.1:7001/project%20name/?root=A&session=B#draft"))
        var connection = LocalConnection(descriptor: first, target: page)
        connection.pageFinished()
        var reads = 0
        func read() -> LocalHostDescriptor { reads += 1; return second }
        var recovered = try XCTUnwrap(connection.recover(failedURL: page, readDescriptor: read))
        XCTAssertEqual(recovered.descriptor, second)
        XCTAssertEqual(recovered.signInFinished(at: second.origin.url)?.absoluteString,
                       "http://127.0.0.1:7002/project%20name/?root=A&session=B#draft")
        XCTAssertNil(try recovered.recover(failedURL: page, readDescriptor: read))
        XCTAssertEqual(reads, 1)
        recovered.pageFinished()
        XCTAssertNotNil(try recovered.recover(failedURL: page, readDescriptor: read))
        XCTAssertEqual(reads, 2)
    }

    func testBridgeTrustsOnlyCurrentModeMainFrameAndExactOrigin() throws {
        let loopback = try decode().origin
        let local = BridgeOrigin(mode: .local, local: loopback)
        let relay = BridgeOrigin(mode: .relay, local: loopback)
        let relayHost = "relay.20260310.best"
        XCTAssertTrue(local.allows(mainFrame: true, scheme: "http", host: "127.0.0.1", port: 7001))
        XCTAssertFalse(local.allows(mainFrame: false, scheme: "http", host: "127.0.0.1", port: 7001))
        XCTAssertFalse(local.allows(mainFrame: true, scheme: "http", host: "127.0.0.2", port: 7001))
        XCTAssertFalse(local.allows(mainFrame: true, scheme: "http", host: "127.0.0.1", port: 7002))
        XCTAssertFalse(local.allows(mainFrame: true, scheme: "https", host: "127.0.0.1", port: 7001))
        XCTAssertFalse(local.allows(mainFrame: true, scheme: "https", host: relayHost, port: 443))
        XCTAssertTrue(relay.allows(mainFrame: true, scheme: "https", host: relayHost, port: 0))
        XCTAssertTrue(relay.allows(mainFrame: true, scheme: "https", host: relayHost, port: 443))
        XCTAssertFalse(relay.allows(mainFrame: false, scheme: "https", host: relayHost, port: 443))
        XCTAssertFalse(relay.allows(mainFrame: true, scheme: "https", host: relayHost + ".example.org", port: 443))
        XCTAssertFalse(relay.allows(mainFrame: true, scheme: "https", host: relayHost, port: 444))
        XCTAssertFalse(relay.allows(mainFrame: true, scheme: "http", host: relayHost, port: 443))
        XCTAssertFalse(relay.allows(mainFrame: true, scheme: "http", host: "127.0.0.1", port: 7001))
    }

    func testSharedDesktopPolicies() throws {
        let local = try decode().origin.url
        XCTAssertEqual(NavigationPolicy.decide(url: local.appendingPathComponent("page"), mainFrame: true, linkActivated: true, relay: local), .allow)
        XCTAssertEqual(NavigationPolicy.decide(url: AppleShell.relayBaseURL, mainFrame: true, linkActivated: true, relay: local), .external)
        XCTAssertNil(NavigationPolicy.bridgeExternalURL(URL(fileURLWithPath: "/tmp/file").absoluteString))
        XCTAssertEqual(DownloadFiles.sanitize("../folder\\test:name.txt"), "test_name.txt")
        XCTAssertEqual(try DownloadFiles.decodeBase64("bWFj"), Data("mac".utf8))
        XCTAssertThrowsError(try DownloadFiles.decodeBase64("?"))
        XCTAssertEqual(DeepLink.parse(URL(string: "localaiagent://open?path=%2Fn%2Ftest%2F%3Fsession%3Dabc")!)?.absoluteString,
                       "https://relay.20260310.best/n/test/?session=abc")
        XCTAssertNil(DeepLink.parse(URL(string: "localaiagent://open?url=https://other.example/")!))
        XCTAssertEqual(try XCTUnwrap(ThemeColor(hex: "#fff")).luminance, 1, accuracy: 0.0001)
        XCTAssertNil(ThemeColor(hex: "#1234"))
    }

    func testPreviousLaunchCleanupKeepsFoldersOfRunningProcesses() throws {
        let files = FileManager.default
        let fixture = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let downloads = fixture.appendingPathComponent(DownloadFiles.root.lastPathComponent, isDirectory: true)
        let sibling = fixture.appendingPathComponent("keep.txt")
        try files.createDirectory(at: downloads, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: fixture) }
        let contents = Data("fixture".utf8)
        try contents.write(to: sibling)

        // Another client instance that is still running, one that exited, and this launch's own process id.
        let running = Process()
        running.executableURL = URL(fileURLWithPath: "/bin/sleep")
        running.arguments = ["30"]
        try running.run()
        defer { running.terminate(); running.waitUntilExit() }
        let exited = Process()
        exited.executableURL = URL(fileURLWithPath: "/usr/bin/true")
        try exited.run()
        exited.waitUntilExit()
        let folders = [running.processIdentifier, exited.processIdentifier, getpid()].map { downloads.appendingPathComponent(String($0)) }
            + [downloads.appendingPathComponent(UUID().uuidString)]
        for folder in folders {
            let pending = folder.appendingPathComponent("unfinished", isDirectory: true)
            try files.createDirectory(at: pending, withIntermediateDirectories: true)
            try contents.write(to: pending.appendingPathComponent("attachment.txt"))
        }

        DownloadFiles.cleanPreviousLaunch(in: downloads)

        XCTAssertEqual(folders.map { files.fileExists(atPath: $0.path) }, [true, false, false, false])
        XCTAssertEqual(try Data(contentsOf: sibling), contents)
    }

    func testDownloadRootIsSeparateFromEarlierBuilds() {
        XCTAssertEqual(DownloadFiles.root.deletingLastPathComponent(), FileManager.default.temporaryDirectory)
        XCTAssertNotEqual(DownloadFiles.root.lastPathComponent, "LocalAIAgent-Downloads")
    }

    func testDownloadDestinationLivesInProcessFolder() throws {
        let destination = try DownloadFiles.destination(filename: "report.txt")
        defer { try? FileManager.default.removeItem(at: destination.deletingLastPathComponent()) }
        XCTAssertEqual(destination.deletingLastPathComponent().deletingLastPathComponent(),
                       DownloadFiles.root.appendingPathComponent(String(getpid()), isDirectory: true))
        XCTAssertEqual(destination.lastPathComponent, "report.txt")
    }

    func testHostWatchDetectsDescriptorCreatedInMissingDirectory() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("host-watch-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        let remoteDir = root.appendingPathComponent("LocalAIAgent/remote", isDirectory: true)
        let createdExpectation = expectation(description: "detect directory and host.json creation")
        let replacedExpectation = expectation(description: "detect host.json atomic replacement after watch promotion")
        var events = 0
        var sawFirst = false
        var sawSecond = false

        let watch = HostWatch(directory: remoteDir) {
            events += 1
            let hostFile = remoteDir.appendingPathComponent("host.json")
            if let text = try? String(contentsOf: hostFile, encoding: .utf8) {
                if text == "v1", !sawFirst {
                    sawFirst = true
                    createdExpectation.fulfill()
                } else if text == "v2", !sawSecond {
                    sawSecond = true
                    replacedExpectation.fulfill()
                }
            }
        }
        XCTAssertNotNil(watch)
        defer { watch?.cancel() }

        try fm.createDirectory(at: remoteDir, withIntermediateDirectories: true)
        try Data("v1".utf8).write(to: remoteDir.appendingPathComponent("host.json"), options: .atomic)
        wait(for: [createdExpectation], timeout: 5)

        try Data("v2".utf8).write(to: remoteDir.appendingPathComponent("host.json"), options: .atomic)
        wait(for: [replacedExpectation], timeout: 5)
        XCTAssertGreaterThanOrEqual(events, 2)
    }

    func testStandaloneBackendDetect() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("standalone-detect-\(UUID().uuidString)", isDirectory: true)
        let remoteDir = root.appendingPathComponent("remote", isDirectory: true)
        try fm.createDirectory(at: remoteDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: root) }

        let manager = StandaloneBackendManager(descriptorDirectory: remoteDir, fallbackExecutable: nil)
        XCTAssertEqual(manager.detect(), .notInstalled)

        // installation.json pointing to a missing binary is not installed.
        let missingBin = root.appendingPathComponent("missing-agent")
        try JSONEncoder().encode(["executable": missingBin.path]).write(to: remoteDir.appendingPathComponent("installation.json"))
        XCTAssertEqual(manager.detect(), .notInstalled)

        // Non-executable file is not treated as installed.
        let nonExec = root.appendingPathComponent("non-exec-agent")
        try Data("#!/bin/sh\n".utf8).write(to: nonExec)
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: nonExec.path)
        try JSONEncoder().encode(["executable": nonExec.path]).write(to: remoteDir.appendingPathComponent("installation.json"))
        XCTAssertEqual(manager.detect(), .notInstalled)

        // Executable file referenced by installation.json is detected.
        let execBin = root.appendingPathComponent("local-ai-agent")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: execBin)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: execBin.path)
        try JSONEncoder().encode(["executable": execBin.path]).write(to: remoteDir.appendingPathComponent("installation.json"))
        XCTAssertEqual(manager.detect(), .installed(executable: execBin))

        // Without installation.json, fallback executable is detected when provided.
        try fm.removeItem(at: remoteDir.appendingPathComponent("installation.json"))
        let withFallback = StandaloneBackendManager(descriptorDirectory: remoteDir, fallbackExecutable: execBin)
        XCTAssertEqual(withFallback.detect(), .installed(executable: execBin))
    }

    private func decode(address: String = "http://127.0.0.1:7001", protocolVersion: Int = 1, mode: String? = "standalone",
                        token: String = "test", remote: String = "") throws -> LocalHostDescriptor {
        var fields: [String: Any] = ["protocol": protocolVersion, "url": address, "token": token, "remote_url": remote]
        fields["mode"] = mode
        return try JSONDecoder().decode(LocalHostDescriptor.self, from: JSONSerialization.data(withJSONObject: fields))
    }
}
