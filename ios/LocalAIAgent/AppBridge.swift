import UIKit
import WebKit

final class AppBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WebViewController?
    init(owner: WebViewController) { self.owner = owner }

    static var script: String {
        let info = ["version": Config.version, "build": Config.build, "bundleId": Config.bundleId]
        let json = String(data: try! JSONSerialization.data(withJSONObject: info, options: [.sortedKeys]), encoding: .utf8)!
        return """
        (() => {
          const info = \(json);
          window.MindFSIOSApp = Object.freeze({platform: 'ios', ...info,
            call(method, params = {}) {
              return window.webkit.messageHandlers.mindfsApp.postMessage({method, params});
            }
          });
          let previous = '';
          const report = () => {
            const meta = document.querySelector('meta[name="theme-color"]');
            const body = document.body && getComputedStyle(document.body).backgroundColor;
            const candidates = [meta && meta.content, body, '#101827'];
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext('2d', {willReadFrequently: true});
            if (!ctx) return;
            for (const value of candidates) {
              if (!value || !CSS.supports('color', value)) continue;
              ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
              const pixel = ctx.getImageData(0, 0, 1, 1).data;
              if (pixel[3] !== 255) continue;
              const color = '#' + Array.from(pixel).slice(0, 3).map(x => x.toString(16).padStart(2, '0')).join('');
              if (color !== previous) {
                previous = color;
                window.MindFSIOSApp.call('setChrome', {color}).catch(() => {});
              }
              return;
            }
          };
          let scheduled = false;
          const schedule = () => {
            if (scheduled) return; scheduled = true;
            requestAnimationFrame(() => { scheduled = false; report(); });
          };
          new MutationObserver(schedule).observe(document, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['content', 'style', 'class', 'data-theme', 'media', 'name']
          });
          document.addEventListener('DOMContentLoaded', report);
          window.addEventListener('load', report);
          matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);
        })();
        """
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "https",
              origin.host.lowercased() == Config.relayBaseURL.host?.lowercased(),
              origin.port == 0 || origin.port == 443 else {
            Diagnostics.record("bridge rejected origin \(origin.protocol)://\(origin.host)")
            replyHandler(nil, "Native bridge is only available to the Relay origin.")
            return
        }
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else {
            replyHandler(nil, "Expected {method, params}."); return
        }
        let params = body["params"] as? [String: Any] ?? [:]
        guard let owner else { replyHandler(nil, "App view is no longer available."); return }
        switch method {
        case "getAppInfo":
            replyHandler(["version": Config.version, "build": Config.build, "bundleId": Config.bundleId,
                          "osVersion": UIDevice.current.systemVersion], nil)
        case "openExternalURL":
            guard let raw = params["url"] as? String, let url = NavigationPolicy.bridgeExternalURL(raw) else {
                replyHandler(nil, "Unsupported external URL. Expected https, http, mailto or tel."); return
            }
            ExternalLinks.open(url) { opened in
                replyHandler(opened ? true : nil, opened ? nil : "The system could not open the URL.")
            }
        case "copyText":
            guard let text = params["text"] as? String else { replyHandler(nil, "Expected text."); return }
            UIPasteboard.general.string = text
            replyHandler(true, nil)
        case "saveBase64":
            guard let base64 = params["dataBase64"] as? String, let name = params["filename"] as? String else {
                replyHandler(nil, "Expected dataBase64 and filename."); return
            }
            // MIME is advisory; never execute content or infer a filesystem path from it.
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let data = try DownloadFiles.decodeBase64(base64)
                    let url = try DownloadFiles.destination(filename: name)
                    try data.write(to: url, options: .atomic)
                    DispatchQueue.main.async { [weak owner] in
                        guard let owner else { replyHandler(nil, "App view is no longer available."); return }
                        owner.share(url)
                        replyHandler(["filename": url.lastPathComponent], nil)
                    }
                } catch {
                    DispatchQueue.main.async { replyHandler(nil, error.localizedDescription) }
                }
            }
        case "setChrome":
            guard let value = params["color"] as? String, let color = ThemeColor(hex: value) else {
                replyHandler(nil, "Expected an opaque hex color."); return
            }
            owner.setChrome(color)
            replyHandler(true, nil)
        default: replyHandler(nil, "Unknown native method: \(method)")
        }
    }
}
