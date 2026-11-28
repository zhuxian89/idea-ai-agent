import Foundation

enum ConnectionMode: String {
    case local, relay
}

struct LocalConnection {
    enum Step: Equatable {
        case signingIn(URL)
        case restoring(URL)
        case ready

        var target: URL? {
            switch self {
            case .signingIn(let target), .restoring(let target): return target
            case .ready: return nil
            }
        }
    }

    let descriptor: LocalHostDescriptor
    var step: Step
    private var retried = false

    init(descriptor: LocalHostDescriptor, target: URL? = nil) {
        self.descriptor = descriptor
        step = .signingIn(target.map { descriptor.origin.replacingOrigin(of: $0) } ?? descriptor.origin.url)
    }

    func recover(failedURL: URL, readDescriptor: () throws -> LocalHostDescriptor) throws -> Self? {
        guard !retried else { return nil }
        var connection = Self(descriptor: try readDescriptor(), target: step.target ?? failedURL)
        connection.retried = true
        return connection
    }

    mutating func signInFinished(at url: URL) -> URL? {
        guard case .signingIn(let target) = step else { return nil }
        if withoutEmptyQuery(target) == withoutEmptyQuery(url) {
            pageFinished()
            return nil
        }
        step = .restoring(target)
        return target
    }

    mutating func pageFinished() {
        step = .ready
        retried = false
    }

    private func withoutEmptyQuery(_ url: URL) -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false), parts.percentEncodedQuery == "" else { return url }
        parts.percentEncodedQuery = nil
        return parts.url!
    }
}

struct BridgeOrigin {
    let mode: ConnectionMode
    let local: LoopbackOrigin?

    var url: URL? { mode == .local ? local?.url : AppleShell.relayBaseURL }

    func allows(mainFrame: Bool, scheme: String, host: String, port: Int) -> Bool {
        guard mainFrame else { return false }
        if mode == .local { return local?.matches(scheme: scheme, host: host, port: port) == true }
        return scheme == "https" && host.lowercased() == AppleShell.relayBaseURL.host && (port == 0 || port == 443)
    }
}
