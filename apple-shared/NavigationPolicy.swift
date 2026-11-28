import Foundation

enum NavigationDecision: Equatable { case allow, external, cancel }

enum NavigationPolicy {
    static func sameOrigin(_ url: URL, _ relay: URL = AppleShell.relayBaseURL) -> Bool {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        return url.scheme?.lowercased() == relay.scheme?.lowercased()
            && url.host?.lowercased() == relay.host?.lowercased() && port(url) == port(relay)
            && url.user == nil && url.password == nil
    }

    static func decide(url: URL, mainFrame: Bool, linkActivated: Bool,
                       popup: Bool = false, relay: URL = AppleShell.relayBaseURL) -> NavigationDecision {
        guard mainFrame else { return .allow }
        let scheme = url.scheme?.lowercased() ?? ""
        if ["about", "blob", "data"].contains(scheme) || sameOrigin(url, relay) { return .allow }
        if scheme == "http" || scheme == "https" { return linkActivated || popup ? .external : .allow }
        // Do not hand dangerous local/script URLs to the OS.
        if ["", "file", "javascript"].contains(scheme) { return .cancel }
        return .external
    }

    static func bridgeExternalURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              ["https", "http", "mailto", "tel"].contains(scheme),
              url.user == nil, url.password == nil else { return nil }
        if ["https", "http"].contains(scheme), url.host == nil { return nil }
        return url
    }
}
