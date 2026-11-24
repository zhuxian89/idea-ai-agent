import XCTest
@testable import LocalAIAgent

final class DeepLinkTests: XCTestCase {
    private func link(_ value: String) -> URL { link("path", value) }
    private func link(_ key: String, _ value: String) -> URL {
        var parts = URLComponents(string: "localaiagent://open")!
        parts.queryItems = [URLQueryItem(name: key, value: value)]
        return parts.url!
    }
    func testPathAndQuery() { XCTAssertEqual(DeepLink.parse(link("/nodes?n=one&session=two"))?.absoluteString, "https://relay.20260310.best/nodes?n=one&session=two") }
    func testAbsoluteURL() { XCTAssertEqual(DeepLink.parse(link("url", "https://relay.20260310.best/n/a/p/b/?session=x"))?.absoluteString, "https://relay.20260310.best/n/a/p/b/?session=x") }
    func testWrongHost() { XCTAssertNil(DeepLink.parse(link("url", "https://example.com/nodes"))) }
    func testSuffixHost() { XCTAssertNil(DeepLink.parse(link("url", "https://relay.20260310.best.evil.test/nodes"))) }
    func testUserInfo() { XCTAssertNil(DeepLink.parse(link("url", "https://x@relay.20260310.best/nodes"))) }
    func testHTTP() { XCTAssertNil(DeepLink.parse(link("url", "http://relay.20260310.best/nodes"))) }
    func testJavascript() { XCTAssertNil(DeepLink.parse(link("url", "javascript:alert(1)"))) }
    func testProtocolRelativePath() { XCTAssertNil(DeepLink.parse(link("//example.com/nodes"))) }
    func testBackslash() { XCTAssertNil(DeepLink.parse(link("/\\example.com/nodes"))) }
    func testRelativePath() { XCTAssertNil(DeepLink.parse(link("nodes"))) }
    func testLongInput() { XCTAssertNil(DeepLink.parse(link("/" + String(repeating: "x", count: 17_000)))) }
    func testDuplicateTarget() { XCTAssertNil(DeepLink.parse(URL(string: "localaiagent://open?path=%2Fnodes&url=https%3A%2F%2Frelay.20260310.best")!)) }
    func testWrongSchemeHostPort() {
        for value in ["other://open?path=%2Fnodes", "localaiagent://closed?path=%2Fnodes", "localaiagent://open:443?path=%2Fnodes"] {
            XCTAssertNil(DeepLink.parse(URL(string: value)!))
        }
    }
    func testWrongTargetPort() { XCTAssertNil(DeepLink.parse(link("url", "https://relay.20260310.best:8443/nodes"))) }
    func testDefaultHTTPSPort() { XCTAssertNotNil(DeepLink.parse(link("url", "https://relay.20260310.best:443/nodes"))) }
    func testControlCharacter() { XCTAssertNil(DeepLink.parse(link("/nodes\n"))) }
}

final class NavigationPolicyTests: XCTestCase {
    private func decide(_ value: String, link: Bool = true, main: Bool = true, popup: Bool = false) -> NavigationDecision {
        NavigationPolicy.decide(url: URL(string: value)!, mainFrame: main, linkActivated: link, popup: popup)
    }
    func testRelayAllowed() { XCTAssertEqual(decide("https://relay.20260310.best/nodes"), .allow) }
    func testExternalLink() { XCTAssertEqual(decide("https://example.com"), .external) }
    func testExternalScriptNavigationAllowedInMain() { XCTAssertEqual(decide("https://example.com", link: false), .allow) }
    func testPopupExternalScriptNavigation() { XCTAssertEqual(decide("https://example.com", link: false, popup: true), .external) }
    func testSubframesUntouched() { XCTAssertEqual(decide("tel:123", main: false), .allow) }
    func testSpecialPagesAllowed() { for value in ["about:blank", "blob:https://relay.20260310.best/id", "data:text/html,hello"] { XCTAssertEqual(decide(value), .allow) } }
    func testSystemSchemes() { for value in ["mailto:x@example.com", "tel:123", "sms:123", "itms-apps://apps.apple.com/id1"] { XCTAssertEqual(decide(value), .external) } }
    func testUnsafeSchemes() { for value in ["file:///tmp/a", "javascript:alert(1)"] { XCTAssertEqual(decide(value), .cancel) } }
    func testOriginIncludesPortAndScheme() {
        XCTAssertFalse(NavigationPolicy.sameOrigin(URL(string: "http://relay.20260310.best")!))
        XCTAssertFalse(NavigationPolicy.sameOrigin(URL(string: "https://relay.20260310.best:444")!))
        XCTAssertTrue(NavigationPolicy.sameOrigin(URL(string: "https://relay.20260310.best:443")!))
    }
    func testBridgeAllowlist() {
        for value in ["https://example.com", "http://example.com", "mailto:a@example.com", "tel:123"] { XCTAssertNotNil(NavigationPolicy.bridgeExternalURL(value)) }
        for value in ["javascript:alert(1)", "file:///tmp/a", "data:text/plain,a", "sms:123", "https:/missinghost"] { XCTAssertNil(NavigationPolicy.bridgeExternalURL(value)) }
    }
}

final class DownloadFilesTests: XCTestCase {
    func testPathTraversal() { XCTAssertEqual(DownloadFiles.sanitize("../../private/test.txt"), "test.txt") }
    func testWindowsPathTraversal() { XCTAssertEqual(DownloadFiles.sanitize("..\\..\\file.txt"), "file.txt") }
    func testEmptyNames() { for value in ["", ".", "..", "/", "  ... "] { XCTAssertEqual(DownloadFiles.sanitize(value), "download") } }
    func testControlAndInvalidCharacters() { XCTAssertEqual(DownloadFiles.sanitize("a\nb:c.txt"), "a_b_c.txt") }
    func testLongUnicodeFilename() {
        let value = DownloadFiles.sanitize(String(repeating: "文", count: 120) + ".txt")
        XCTAssertLessThanOrEqual(value.utf8.count, 220)
        XCTAssertTrue(value.hasSuffix(".txt"))
    }
    func testBase64() throws { XCTAssertEqual(try DownloadFiles.decodeBase64("aGVsbG8="), Data("hello".utf8)) }
    func testInvalidBase64() { XCTAssertThrowsError(try DownloadFiles.decodeBase64("not base64!?")) }
    func testUniqueDirectory() throws {
        let first = try DownloadFiles.destination(filename: "same.txt")
        let second = try DownloadFiles.destination(filename: "same.txt")
        defer {
            try? FileManager.default.removeItem(at: first.deletingLastPathComponent())
            try? FileManager.default.removeItem(at: second.deletingLastPathComponent())
        }
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first.lastPathComponent, "same.txt")
        XCTAssertTrue(first.path.hasPrefix(DownloadFiles.root.path + "/"))
    }
}

final class ThemeColorTests: XCTestCase {
    func testBlack() { XCTAssertEqual(ThemeColor(hex: "#000")!.luminance, 0); XCTAssertTrue(ThemeColor(hex: "#000")!.lightStatusBar) }
    func testWhite() { XCTAssertEqual(ThemeColor(hex: "#ffffff")!.luminance, 1, accuracy: 0.0001); XCTAssertFalse(ThemeColor(hex: "#fff")!.lightStatusBar) }
    func testGreenLuminance() { XCTAssertEqual(ThemeColor(hex: "#00ff00")!.luminance, 0.7152, accuracy: 0.0001) }
    func testInvalidColor() { for value in ["red", "#1234", "#xyz", "#ffffff00"] { XCTAssertNil(ThemeColor(hex: value)) } }
}

final class SafeAreaPolicyTests: XCTestCase {
    private func url(_ value: String) -> URL { URL(string: value)! }
    func testNodeAppExtendsUnderSafeArea() {
        XCTAssertTrue(SafeAreaPolicy.extendsUnderSafeArea(url: url("https://relay.20260310.best/n/abc/")))
        XCTAssertTrue(SafeAreaPolicy.extendsUnderSafeArea(url: url("https://relay.20260310.best/n/abc/p/x/?root=r&session=s")))
        XCTAssertTrue(SafeAreaPolicy.extendsUnderSafeArea(url: url("https://relay.20260310.best/n")))
    }
    func testRelayOwnPagesAreInset() {
        for path in ["/login", "/nodes", "/bind", "/", "/nodesx", "/node/n/1"] {
            XCTAssertFalse(SafeAreaPolicy.extendsUnderSafeArea(url: url("https://relay.20260310.best\(path)")), path)
        }
    }
    func testUnknownURLKeepsEdgeToEdge() { XCTAssertTrue(SafeAreaPolicy.extendsUnderSafeArea(url: nil)) }
    func testBehaviorMapping() {
        XCTAssertEqual(SafeAreaPolicy.behavior(extendsUnderSafeArea: true), .never)
        XCTAssertEqual(SafeAreaPolicy.behavior(extendsUnderSafeArea: false), .always)
    }
    func testPublishScriptSetsTheVariablesTheWebReads() {
        let script = SafeAreaPolicy.publishScript(top: 62, bottom: 34)
        XCTAssertTrue(script.contains("'--mindfs-safe-area-top','62.00px'"))
        XCTAssertTrue(script.contains("'--mindfs-safe-area-bottom','34.00px'"))
        XCTAssertTrue(script.contains("new CustomEvent('mindfs:safe-area-updated')"))
        XCTAssertTrue(SafeAreaPolicy.publishScript(top: -5, bottom: 0).contains("'--mindfs-safe-area-top','0.00px'"))
    }
}
