import AppKit
import WebKit

extension MacWindowController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame == true, let url = action.request.url else {
            decisionHandler(.allow)
            return
        }
        switch policy(url) {
        case .allow:
            if !action.shouldPerformDownload { requestedURL = url }
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
            if action.shouldPerformDownload { navigationBecameDownload() }
        case .external:
            decisionHandler(.cancel)
            NSWorkspace.shared.open(url)
            if isPopup, webView.url == nil || webView.url?.scheme == "about" { close() }
        case .cancel: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame else { decisionHandler(.allow); return }
        let http = response.response as? HTTPURLResponse
        navigationStatus = http?.statusCode
        if let url = rejectedURL(response.response) {
            let target = requestedURL ?? url
            navigationDiscarded()
            decisionHandler(.cancel)
            recoverLocalSession(failedURL: target)
            return
        }
        let disposition = http?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let attachment = disposition.split(separator: ";").first?.trimmingCharacters(in: .whitespaces).lowercased() == "attachment"
        let download = attachment || !response.canShowMIMEType
        decisionHandler(download ? .download : .allow)
        if download { navigationBecameDownload() }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { navigationStarted(navigation) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { navigationFinished(navigation) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(navigation, error: error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(navigation, error: error)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.receive(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.receive(download) }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let url = action.request.url ?? URL(string: "about:blank")!
        switch policy(url) {
        case .external: NSWorkspace.shared.open(url); return nil
        case .cancel: return nil
        case .allow:
            guard let appDelegate else { return nil }
            let child = MacWindowController(mode: mode, directory: descriptorDirectory,
                                            popupConfiguration: configuration, localDescriptor: local?.descriptor)
            appDelegate.present(child)
            return child.webView
        }
    }

    func webViewDidClose(_ webView: WKWebView) { if isPopup { close() } }

    private func policy(_ url: URL) -> NavigationDecision {
        guard let base = origin.url else { return .cancel }
        return NavigationPolicy.decide(url: url, mainFrame: true, linkActivated: true, relay: base)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        presentDialog(message, from: frame) { alert in
            alert.addButton(withTitle: "好")
        } completion: { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        presentDialog(message, from: frame, configure: addConfirmButtons) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let input = NSTextField(string: defaultText ?? "")
        input.frame.size.width = 280
        presentDialog(prompt, from: frame) { alert in
            addConfirmButtons(alert)
            alert.accessoryView = input
            alert.window.initialFirstResponder = input
        } completion: { completionHandler($0 == .alertFirstButtonReturn ? input.stringValue : nil) }
    }

    private func addConfirmButtons(_ alert: NSAlert) {
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
    }

    private func presentDialog(_ message: String, from frame: WKFrameInfo, configure: (NSAlert) -> Void,
                               completion: @escaping (NSApplication.ModalResponse) -> Void) {
        guard let window else { completion(.abort); return }
        let alert = NSAlert()
        alert.messageText = frame.securityOrigin.host
        alert.informativeText = message
        configure(alert)
        alert.beginSheetModal(for: window, completionHandler: completion)
    }
}
