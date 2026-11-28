import Foundation

enum Config {
    static let relayBaseURL = AppleShell.relayBaseURL
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
    static let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
    static let bundleId = Bundle.main.bundleIdentifier ?? "com.localaiagent.app"
    /// Only DEBUG fixtures may replace the navigation origin. Bridge trust is never relaxed.
    static var navigationOrigin: URL {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-startURL"),
           ["http", "https"].contains(startURL.scheme ?? "") { return startURL }
        #endif
        return relayBaseURL
    }
    static var startURL: URL {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "-startURL"), args.indices.contains(index + 1),
           let url = URL(string: args[index + 1]) { return url }
        #endif
        return relayBaseURL.appendingPathComponent("nodes")
    }
}

/// Opt-in simulator evidence only. No page URLs or diagnostic files are recorded in Release.
enum Diagnostics {
    static func record(_ event: String) {
        #if DEBUG
        NSLog("LocalAIAgent %@", event)
        guard ProcessInfo.processInfo.arguments.contains("-diagnostics") else { return }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ios-diagnostics.log")
        let data = Data((event + "\n").utf8)
        if !FileManager.default.fileExists(atPath: url.path) { try? data.write(to: url) }
        else if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
        }
        #endif
    }
}
