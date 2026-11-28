import Foundation

struct DownloadFiles {
    static let maximumBytes = 200 * 1024 * 1024
    /// Earlier builds kept `LocalAIAgent-Downloads/<UUID>` and wiped that folder on launch. This root is separate,
    /// so neither a running old build nor this one can delete the other's pending attachment.
    static let root = FileManager.default.temporaryDirectory.appendingPathComponent("LocalAIAgent-Downloads-v2", isDirectory: true)

    /// Each process keeps its files under `root/<pid>`, so a launch can tell abandoned folders from ones still in use.
    static func cleanPreviousLaunch(in directory: URL = root) {
        let entries = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for entry in entries where !isRunningOtherProcess(folder: entry) {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    private static func isRunningOtherProcess(folder: URL) -> Bool {
        guard let pid = pid_t(folder.lastPathComponent), pid != getpid() else { return false }
        return kill(pid, 0) == 0 || errno == EPERM
    }

    static func sanitize(_ suggested: String) -> String {
        // Treat both kinds of path separator as separators, regardless of the host OS.
        let leaf = suggested.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? ""
        let invalid = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: ":/?\\<>|\""))
        var name = leaf.components(separatedBy: invalid).joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".")))
        if name.isEmpty { name = "download" }
        // Stay below filesystem byte limits, preserving a useful extension when possible.
        if name.utf8.count > 220 {
            let ext = (name as NSString).pathExtension
            let suffix = !ext.isEmpty && ext.utf8.count < 32 ? "." + ext : ""
            var stem = (name as NSString).deletingPathExtension
            while stem.utf8.count + suffix.utf8.count > 220 { stem.removeLast() }
            name = stem + suffix
        }
        return name
    }

    static func destination(filename: String) throws -> URL {
        let directory = root.appendingPathComponent(String(getpid()), isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent(sanitize(filename), isDirectory: false)
    }

    static func decodeBase64(_ value: String) throws -> Data {
        guard value.utf8.count <= ((maximumBytes + 2) / 3) * 4 else { throw FileError.tooLarge }
        guard let data = Data(base64Encoded: value) else { throw FileError.invalidBase64 }
        guard data.count <= maximumBytes else { throw FileError.tooLarge }
        return data
    }

    enum FileError: LocalizedError {
        case tooLarge, invalidBase64
        var errorDescription: String? {
            switch self {
            case .tooLarge: return "文件超过 200 MB 限制。"
            case .invalidBase64: return "文件内容不是有效的 Base64。"
            }
        }
    }
}
