import AppKit
import WebKit

@MainActor
final class MacBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "mindfsMacApp"
    static let info = [
        "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
        "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1",
        "bundleId": Bundle.main.bundleIdentifier ?? "com.localaiagent.mac",
    ]

    static var script: String {
        let metadata = String(decoding: try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]), as: UTF8.self)
        return """
        (() => {
          window.MindFSMacApp = Object.freeze({platform: 'macos', ...\(metadata),
            call(method, params = {}) {
              return window.webkit.messageHandlers.\(name).postMessage({method, params});
            }
          });
          let lastColor;
          const report = () => {
            const color = document.querySelector('meta[name="theme-color"]')?.content;
            if (color && color !== lastColor) {
              lastColor = color;
              window.MindFSMacApp.call('setChrome', {color}).catch(() => {});
            }
          };
          document.addEventListener('DOMContentLoaded', () => {
            report();
            new MutationObserver(report).observe(document.head, {
              childList: true, subtree: true, attributes: true, attributeFilter: ['content', 'name']
            });
          });
        })();
        """
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let frame = message.frameInfo
        let source = frame.securityOrigin
        guard let owner = message.webView?.navigationDelegate as? MacWindowController,
              owner.origin.allows(mainFrame: frame.isMainFrame, scheme: source.protocol, host: source.host, port: source.port) else {
            replyHandler(nil, "Native bridge is only available to the current main frame origin.")
            return
        }
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Expected {method, params}.")
            return
        }
        let params = body["params"] as? [String: Any] ?? [:]
        switch method {
        case "getAppInfo":
            var info = Self.info
            info["osVersion"] = ProcessInfo.processInfo.operatingSystemVersionString
            replyHandler(info, nil)
        case "openExternalURL":
            guard let raw = params["url"] as? String, let url = NavigationPolicy.bridgeExternalURL(raw) else {
                replyHandler(nil, "Unsupported external URL. Expected https, http, mailto or tel.")
                return
            }
            let opened = NSWorkspace.shared.open(url)
            replyHandler(opened ? true : nil, opened ? nil : "The system could not open the URL.")
        case "copyText":
            guard let text = params["text"] as? String else { replyHandler(nil, "Expected text."); return }
            NSPasteboard.general.clearContents()
            let copied = NSPasteboard.general.setString(text, forType: .string)
            replyHandler(copied ? true : nil, copied ? nil : "The system could not copy the text.")
        case "saveBase64":
            guard let base64 = params["dataBase64"] as? String, let name = params["filename"] as? String else {
                replyHandler(nil, "Expected dataBase64 and filename.")
                return
            }
            let activeOrigin = owner.origin.url
            Task { [weak owner] in
                do {
                    let data = try await Task.detached(priority: .userInitiated) { try DownloadFiles.decodeBase64(base64) }.value
                    guard let owner, owner.origin.url == activeOrigin else {
                        replyHandler(nil, "App view is no longer available.")
                        return
                    }
                    owner.downloads.save(name: name, source: .data(data)) { result in
                        switch result {
                        case .success(let filename): replyHandler(["filename": filename], nil)
                        case .failure(let error): replyHandler(nil, error.localizedDescription)
                        }
                    }
                } catch { replyHandler(nil, error.localizedDescription) }
            }
        case "setChrome":
            guard let value = params["color"] as? String, let color = ThemeColor(hex: value) else {
                replyHandler(nil, "Expected an opaque hex color.")
                return
            }
            owner.setChrome(color)
            replyHandler(true, nil)
        default:
            replyHandler(nil, "Unknown native method: \(method)")
        }
    }
}
