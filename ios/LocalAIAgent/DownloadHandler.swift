import UIKit
import WebKit

struct DownloadFiles {
    static let maximumBytes = 200 * 1024 * 1024
    static let root = FileManager.default.temporaryDirectory.appendingPathComponent("LocalAIAgent-Downloads", isDirectory: true)

    static func cleanPreviousLaunch() { try? FileManager.default.removeItem(at: root) }

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
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
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

final class DownloadHandler: NSObject, WKDownloadDelegate {
    weak var owner: WebViewController?
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var destinations: [ObjectIdentifier: URL] = [:]

    init(owner: WebViewController) { self.owner = owner }

    func receive(_ download: WKDownload) {
        downloads[ObjectIdentifier(download)] = download
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            let url = try DownloadFiles.destination(filename: suggestedFilename)
            destinations[ObjectIdentifier(download)] = url
            Diagnostics.record("download destination \(url.lastPathComponent)")
            completionHandler(url)
        } catch {
            completionHandler(nil)
            owner?.showError(error)
            clear(download)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let url = destinations[ObjectIdentifier(download)]
        clear(download)
        guard let url else { return }
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1
        Diagnostics.record("download finished \(url.lastPathComponent) bytes=\(bytes)")
        owner?.share(url)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let url = destinations[ObjectIdentifier(download)]
        clear(download)
        if let url { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        Diagnostics.record("download failed \(error.localizedDescription)")
        owner?.showError(error)
    }

    private func clear(_ download: WKDownload) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}
