import AppKit
import WebKit

@MainActor
final class MacDownloads: NSObject, WKDownloadDelegate {
    enum Source {
        case file(URL)
        case data(Data)
    }

    private struct ActiveDownload {
        let download: WKDownload
        var destination: URL?
    }

    weak var owner: MacWindowController?
    private var active: [ObjectIdentifier: ActiveDownload] = [:]
    private var isClosed = false

    init(owner: MacWindowController) { self.owner = owner }

    func receive(_ download: WKDownload) {
        active[ObjectIdentifier(download)] = ActiveDownload(download: download)
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        // A download link sent a stale cookie. Drop the refusal page and fetch the file again after the session is renewed.
        if let owner, let url = owner.rejectedURL(response) {
            active.removeValue(forKey: ObjectIdentifier(download))
            completionHandler(nil)
            owner.recoverLocalSession(failedURL: download.originalRequest?.url ?? url)
            return
        }
        do {
            let url = try DownloadFiles.destination(filename: suggestedFilename)
            active[ObjectIdentifier(download)]?.destination = url
            completionHandler(url)
        } catch {
            active.removeValue(forKey: ObjectIdentifier(download))
            completionHandler(nil)
            presentError(error)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = active.removeValue(forKey: ObjectIdentifier(download))?.destination else { return }
        save(name: url.lastPathComponent, source: .file(url)) { [weak self] result in
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            if case .failure(let error) = result { self?.presentError(error) }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = active.removeValue(forKey: ObjectIdentifier(download))?.destination {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        presentError(error)
    }

    func windowClosed() {
        isClosed = true
        let downloads = active.values
        active.removeAll()
        for item in downloads {
            item.download.cancel { _ in
                if let url = item.destination { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            }
        }
    }

    func save(name: String, source: Source, completion: @escaping (Result<String, Error>) -> Void) {
        guard let window = windowForSheet() else {
            completion(.failure(CocoaError(.userCancelled)))
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = DownloadFiles.sanitize(name)
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let destination = panel.url else {
                completion(.failure(CocoaError(.userCancelled)))
                return
            }
            Task {
                do {
                    try await Task.detached(priority: .userInitiated) {
                        switch source {
                        case .data(let data): try data.write(to: destination, options: .atomic)
                        case .file(let from):
                            try Data(contentsOf: from, options: .mappedIfSafe).write(to: destination, options: .atomic)
                        }
                    }.value
                    completion(.success(destination.lastPathComponent))
                } catch { completion(.failure(error)) }
            }
        }
    }

    private func presentError(_ error: Error) {
        let code = (error as NSError).code
        guard code != NSUserCancelledError, code != NSURLErrorCancelled, let window = windowForSheet() else { return }
        let alert = NSAlert()
        alert.messageText = "下载失败"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }

    private func windowForSheet() -> NSWindow? {
        guard !isClosed, let window = owner?.window else { return nil }
        if NSApp.isHidden || window.isMiniaturized || !window.isVisible {
            if NSApp.isHidden { NSApp.unhide(nil) }
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        }
        return window
    }
}
