import XCTest

final class ShellUITests: XCTestCase {
    private var app: XCUIApplication!
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-startURL", "http://127.0.0.1:8765/", "-diagnostics"]
    }
    private func start() {
        app.launch()
        XCTAssertTrue(app.webViews.staticTexts["Shell Test Fixture"].waitForExistence(timeout: 20))
    }
    /// The system bar button follows the app's language (the app declares Chinese and English).
    private var doneButton: XCUIElement {
        app.navigationBars.buttons.matching(NSPredicate(format: "label IN %@", ["Done", "完成"])).firstMatch
    }
    private func screenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func tapWeb(_ label: String) {
        let element = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 10))
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [hittable], timeout: 10), .completed)
        element.tap()
    }
    /// Arriving from a page that is inset by the safe area (Relay's own pages) must not leave the
    /// next page with a viewport that is shorter by the status bar and home indicator when it starts.
    func testNodePageStartsWithTheFullViewportAfterAnInsetPage() {
        app.launchArguments = ["-startURL", "http://127.0.0.1:8765/start", "-diagnostics"]
        app.launch()
        XCTAssertTrue(app.webViews.staticTexts["startup-viewport:full"].waitForExistence(timeout: 30),
                      "the page started with a short viewport")
    }
    /// With the keyboard up the home indicator is covered, so the bottom safe area the page pads its
    /// composer with must drop to 0 (as Safari reports it) and come back when the keyboard goes away.
    /// What the page reads is checked, not how an OS version scrolls the page: that differs per version.
    func testBottomSafeAreaIsZeroWhileTheKeyboardIsUp() {
        app.launchArguments = ["-startURL", "http://127.0.0.1:8765/n/composer/", "-diagnostics"]
        app.launch()
        func sees(_ bottom: String) -> XCUIElement {
            app.webViews.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", " sab:\(bottom)")).firstMatch
        }
        let before = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS ' sab:'")).firstMatch
        XCTAssertTrue(before.waitForExistence(timeout: 30))
        XCTAssertTrue(sees("34.00px").waitForExistence(timeout: 10), "home indicator inset is published before the keyboard opens: \(before.label)")
        app.webViews.textFields.firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 15), "the keyboard did not appear")
        XCTAssertTrue(sees("0.00px").waitForExistence(timeout: 10), "bottom inset stayed at the home indicator's height with the keyboard up: \(before.label)")
        app.webViews.textFields.firstMatch.typeText("\n")
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), "the keyboard did not close")
        XCTAssertTrue(sees("34.00px").waitForExistence(timeout: 10), "bottom inset must come back when the keyboard goes away: \(before.label)")
    }
    func testConfirmAcceptAndCancel() {
        start()
        tapWeb("Confirm")
        XCTAssertTrue(app.alerts["127.0.0.1"].waitForExistence(timeout: 5))
        screenshot("confirm")
        app.alerts.buttons["确定"].tap()
        XCTAssertTrue(app.webViews.staticTexts["confirm=true"].waitForExistence(timeout: 5))
        tapWeb("Confirm")
        app.alerts.buttons["取消"].tap()
        XCTAssertTrue(app.webViews.staticTexts["confirm=false"].waitForExistence(timeout: 5))
    }
    func testAlert() {
        start()
        tapWeb("Alert")
        XCTAssertTrue(app.alerts.staticTexts["Alert fixture"].waitForExistence(timeout: 5))
        app.alerts.buttons["好"].tap()
        XCTAssertTrue(app.webViews.staticTexts["alert=done"].waitForExistence(timeout: 5))
    }
    func testPrompt() {
        start()
        tapWeb("Prompt")
        XCTAssertTrue(app.alerts.textFields.firstMatch.waitForExistence(timeout: 5))
        app.alerts.buttons["确定"].tap()
        XCTAssertTrue(app.webViews.staticTexts["prompt=seed"].waitForExistence(timeout: 5))
    }
    private func assertDownload(_ label: String, filename: String) {
        start()
        tapWeb(label)
        // UIActivityViewController exposes the filename and standard sharing actions.
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 20), app.debugDescription)
        let title = app.otherElements["ActivityListView"].descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", filename)).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5), app.debugDescription)
        screenshot(filename + "-share")
    }
    func testRealFileDownload() { assertDownload("Real file download", filename: "real") }
    func testBlobDownload() { assertDownload("Blob download", filename: "blob") }
    func testAttachmentDownload() { assertDownload("Attachment download", filename: "attachment") }
    func testPopupReplacement() {
        start()
        tapWeb("Blank then replace")
        XCTAssertTrue(doneButton.waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.staticTexts["Popup reached"].waitForExistence(timeout: 15))
        screenshot("fixture-popup")
        doneButton.tap()
        XCTAssertTrue(app.webViews.staticTexts["Shell Test Fixture"].waitForExistence(timeout: 10))
    }
    func testWindowClose() {
        start()
        tapWeb("Closable blank")
        XCTAssertTrue(doneButton.waitForExistence(timeout: 10))
        screenshot("closable-popup-before-close")
        let close = app.webViews.buttons["Close popup"].firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        // XCTest's WebKit hit-test reports false for a document.write-created about:blank
        // document. Tap its visible screen coordinates instead; this is still a real UI tap.
        let frame = close.frame
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
        XCTAssertTrue(app.webViews.staticTexts["Shell Test Fixture"].waitForExistence(timeout: 10))
        XCTAssertFalse(doneButton.exists)
    }
    func testExternalBlank() {
        start()
        tapWeb("External blank")
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 15))
        screenshot("external-safari")
    }
    func testDeepLinksColdWarmAndRejectedHost() {
        start()
        func open(_ value: String) {
            XCUIDevice.shared.system.open(URL(string: value)!)
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let confirmation = springboard.buttons.matching(NSPredicate(format: "label == '打开' OR label == 'Open'")).firstMatch
            if confirmation.waitForExistence(timeout: 3) { confirmation.tap() }
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 15))
        }
        open("localaiagent://open?path=%2Fnodes%3FiosProbe%3Dwarm")
        XCTAssertTrue(app.webViews.staticTexts["登录 Relay"].waitForExistence(timeout: 20))
        screenshot("warm-deep-link")
        open("localaiagent://open?url=https%3A%2F%2Fexample.com%2Fnodes")
        XCTAssertTrue(app.webViews.staticTexts["登录 Relay"].exists)
        XCTAssertFalse(app.alerts.firstMatch.exists)
        app.terminate()
        open("localaiagent://open?path=%2Fnodes%3FiosProbe%3Dcold")
        XCTAssertTrue(app.webViews.staticTexts["登录 Relay"].waitForExistence(timeout: 20))
        screenshot("cold-deep-link")
    }
    func testOfflineOverlayAndRetry() {
        app.launchArguments = ["-startURL", "http://127.0.0.1:18765/", "-diagnostics"]
        app.launch()
        XCTAssertTrue(app.buttons["retryLoad"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["loadErrorDetail"].label.contains("127.0.0.1:18765"))
        screenshot("offline-overlay")
        app.buttons["retryLoad"].tap()
        XCTAssertTrue(app.buttons["retryLoad"].waitForExistence(timeout: 20))
    }
}
