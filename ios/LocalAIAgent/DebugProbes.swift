#if DEBUG
import WebKit

/// Explicit launch-argument probes for simulator acceptance. Entirely absent from Release.
enum DebugProbes {
    static func run(in webView: WKWebView) {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-diagnostics") else { return }
        var script = "return await window.MindFSIOSApp.call('getAppInfo').then(x => 'bridge accepted ' + x.version).catch(e => 'bridge denied ' + e)"
        if NavigationPolicy.sameOrigin(webView.url ?? Config.startURL), args.contains("-probeBridge") {
            script = """
            const call = (m, p = {}) => window.MindFSIOSApp.call(m, p);
            const info = await call('getAppInfo');
            const copied = await call('copyText', {text: 'iOS simulator clipboard fixture'});
            let unknown = false, unsafe = false;
            try { await call('unknownProbe'); } catch(e) { unknown = String(e).includes('Unknown native method'); }
            try { await call('openExternalURL', {url:'javascript:alert(1)'}); } catch(e) { unsafe = String(e).includes('Unsupported external URL'); }
            const saved = await call('saveBase64', {dataBase64:'aU9TIGJyaWRnZSBmaXh0dXJlCg==', filename:'../../bridge.txt', mimeType:'text/plain'});
            return JSON.stringify({info, copied, unknown, unsafe, saved});
            """
        } else if args.contains("-probeFetch") {
            // Same cross-origin requests the web's update check makes, from the Relay origin.
            script = """
            const out = {origin: location.origin, ua: navigator.userAgent};
            const attempt = async (name, url, init) => {
              try { const r = await fetch(url, init); out[name] = r.status + ' ' + (await r.text()).slice(0, 24).replace(/\\s+/g, ' '); }
              catch (e) { out[name] = 'ERROR ' + e; }
            };
            await attempt('raw', 'https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/standalone/version.txt', {cache: 'no-store'});
            await attempt('api', 'https://api.github.com/repos/zhuxian89/idea-ai-agent/releases?per_page=1', {headers: {Accept: 'application/vnd.github+json'}, cache: 'no-store'});
            return JSON.stringify(out);
            """
        } else if NavigationPolicy.sameOrigin(webView.url ?? Config.startURL), args.contains("-probeTheme") {
            script = """
            let meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
            meta.content = '#ffffff';
            document.body.style.backgroundColor = '#ffffff';
            return 'theme white requested';
            """
        }
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): Diagnostics.record("probe \(value)")
            case .failure(let error): Diagnostics.record("probe failed \(error.localizedDescription)")
            }
        }
    }
}
#endif
