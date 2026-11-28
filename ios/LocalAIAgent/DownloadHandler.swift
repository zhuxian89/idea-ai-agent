import UIKit
import WebKit

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
