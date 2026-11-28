import Foundation

struct LoopbackOrigin: Equatable {
    let url: URL
    let host: String
    let port: Int

    init?(_ address: String) {
        guard var parts = URLComponents(string: address), parts.scheme == "http",
              parts.user == nil, parts.password == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.percentEncodedQuery == nil, parts.fragment == nil,
              let host = parts.percentEncodedHost,
              let canonicalHost = Self.loopbackHost(host),
              let port = parts.port, (1...65535).contains(port) else { return nil }
        parts.host = canonicalHost
        parts.port = port
        parts.path = "/"
        guard let url = parts.url else { return nil }
        self.url = url
        self.host = canonicalHost
        self.port = port
    }

    func contains(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: true),
              parts.user == nil, parts.password == nil, let host = parts.percentEncodedHost else { return false }
        return matches(scheme: parts.scheme ?? "", host: host, port: parts.port ?? 80)
    }

    func matches(scheme: String, host: String, port: Int) -> Bool {
        scheme == "http" && self.port == (port == 0 ? 80 : port) && Self.loopbackHost(host) == self.host
    }

    func replacingOrigin(of target: URL) -> URL {
        guard var parts = URLComponents(url: target, resolvingAgainstBaseURL: true), parts.scheme == "http" else { return url }
        parts.host = host
        parts.port = port
        return parts.url ?? url
    }

    private static func loopbackHost(_ host: String) -> String? {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, host, &ipv4) == 1 {
            return UInt32(bigEndian: ipv4.s_addr) >> 24 == 127 ? host : nil
        }
        let literal = host.hasPrefix("[") && host.hasSuffix("]") ? String(host.dropFirst().dropLast()) : host
        var ipv6 = in6_addr()
        guard inet_pton(AF_INET6, literal, &ipv6) == 1 else { return nil }
        let bytes = withUnsafeBytes(of: ipv6) { Array($0) }
        if bytes.prefix(15).allSatisfy({ $0 == 0 }), bytes[15] == 1 { return "[::1]" }
        guard bytes.prefix(10).allSatisfy({ $0 == 0 }), bytes[10] == 255, bytes[11] == 255,
              bytes[12] == 127 else { return nil }
        return "[::ffff:\(String(format: "%x", Int(bytes[12]) * 256 + Int(bytes[13]))):\(String(format: "%x", Int(bytes[14]) * 256 + Int(bytes[15])))]"
    }
}

struct LocalHostDescriptor: Decodable, Equatable {
    let origin: LoopbackOrigin
    let token: String

    private enum Keys: String, CodingKey { case `protocol`, url, token, mode, remoteURL = "remote_url" }

    init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Keys.self)
        guard try fields.decode(Int.self, forKey: .protocol) == 1 else { throw DescriptorError.protocolVersion }
        // The IDEA plugin publishes the same file without a mode; its control port only accepts bearer requests.
        guard try fields.decodeIfPresent(String.self, forKey: .mode) == "standalone" else { throw DescriptorError.notStandalone }
        let address = try fields.decode(String.self, forKey: .url)
        let token = try fields.decode(String.self, forKey: .token)
        let remote = try fields.decodeIfPresent(String.self, forKey: .remoteURL) ?? ""
        guard let origin = LoopbackOrigin(address), remote.isEmpty || LoopbackOrigin(remote) != nil,
              !token.isEmpty else { throw DescriptorError.invalid }
        self.origin = origin
        self.token = token
    }

    static func read(directory: URL) throws -> Self {
        let data = try Data(contentsOf: directory.appendingPathComponent("host.json"))
        return try JSONDecoder().decode(Self.self, from: data)
    }

    var signInURL: URL {
        var parts = URLComponents(url: origin.url, resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "ide_token", value: token)]
        // Go's query parser treats a literal plus as a space.
        parts.percentEncodedQuery = parts.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return parts.url!
    }

    enum DescriptorError: Error { case protocolVersion, notStandalone, invalid }
}
