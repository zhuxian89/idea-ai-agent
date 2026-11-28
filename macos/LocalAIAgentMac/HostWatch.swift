import Foundation

/// Watches `directory` for descriptor changes (e.g. `host.json` written or atomically replaced).
/// If `directory` does not exist yet on a first-time Mac, it watches the nearest existing ancestor
/// and automatically promotes the watch to `directory` as soon as it is created.
final class HostWatch {
    private let directory: URL
    private let onChange: () -> Void
    private var watchedPath: String?
    private var source: DispatchSourceFileSystemObject?
    private var cancelled = false

    init?(directory: URL, onChange: @escaping () -> Void) {
        self.directory = directory.standardizedFileURL
        self.onChange = onChange
        guard attach() else { return nil }
    }

    deinit {
        cancel()
    }

    func cancel() {
        cancelled = true
        source?.cancel()
        source = nil
        watchedPath = nil
    }

    @discardableResult
    private func attach() -> Bool {
        guard !cancelled else { return false }
        let target = nearestExistingDirectory(for: directory)
        if target.path == watchedPath, source != nil {
            return true
        }
        source?.cancel()
        source = nil
        watchedPath = nil

        // The backend replaces host.json by renaming a temporary file in the same directory.
        let fd = open(target.path, O_EVTONLY)
        guard fd >= 0 else { return false }
        let newSource = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write, .rename, .delete],
            queue: .main
        )
        watchedPath = target.path
        newSource.setEventHandler { [weak self] in
            guard let self, !self.cancelled else { return }
            if self.watchedPath != self.directory.path {
                self.attach()
            }
            self.onChange()
        }
        newSource.setCancelHandler { close(fd) }
        source = newSource
        newSource.resume()
        return true
    }

    private func nearestExistingDirectory(for url: URL) -> URL {
        let fm = FileManager.default
        var current = url.standardizedFileURL
        while true {
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: current.path, isDirectory: &isDir), isDir.boolValue {
                return current
            }
            let parent = current.deletingLastPathComponent()
            if parent.path == current.path {
                return current
            }
            current = parent
        }
    }
}
