import Foundation

enum DeepLink {
    static let maximumLength = 16_384

    static func parse(_ input: URL, relay: URL = AppleShell.relayBaseURL) -> URL? {
        guard input.absoluteString.utf8.count <= maximumLength,
              let parts = URLComponents(url: input, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "localaiagent", parts.host == "open",
              parts.user == nil, parts.password == nil, parts.port == nil,
              parts.path.isEmpty, parts.fragment == nil else { return nil }
        let items = parts.queryItems ?? []
        // Ambiguous targets are ignored, rather than guessing which one the sender intended.
        guard items.count == 1, let item = items.first, let value = item.value,
              !value.isEmpty, value.utf8.count <= maximumLength,
              !value.contains("\\"), !value.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else { return nil }
        let target: URL?
        switch item.name {
        case "url": target = URL(string: value)
        case "path":
            guard value.hasPrefix("/"), !value.hasPrefix("//"),
                  let path = URLComponents(string: value), path.scheme == nil, path.host == nil else { return nil }
            target = URL(string: value, relativeTo: relay)?.absoluteURL
        default: return nil
        }
        guard let target, let result = URLComponents(url: target, resolvingAgainstBaseURL: true),
              result.scheme?.lowercased() == "https",
              result.host?.lowercased() == relay.host?.lowercased(),
              result.user == nil, result.password == nil,
              result.port == nil || result.port == 443 else { return nil }
        return target
    }
}
