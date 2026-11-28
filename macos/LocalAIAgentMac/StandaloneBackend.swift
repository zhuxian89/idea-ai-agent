import Darwin
import Foundation

enum StandaloneInstallState: Equatable {
    case notInstalled
    case installed(executable: URL)
}

enum StandaloneBackendError: LocalizedError {
    case invalidResponse(Int)
    case emptyScript
    case processFailed(Int32)
    case cancelled

    var errorDescription: String? {
        switch self {
        case .invalidResponse(let code):
            return "下载安装脚本失败（HTTP \(code)）。请检查网络连接后重试。"
        case .emptyScript:
            return "下载到的安装脚本为空，未对系统做任何更改。"
        case .processFailed(let status):
            return "执行失败（退出码 \(status)），请查看下方日志。"
        case .cancelled:
            return "已取消操作。"
        }
    }
}

/// Manages detecting, starting, and installing the macOS standalone backend (`local-ai-agent`).
final class StandaloneBackendManager {
    static let installScriptURL = URL(string: "https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh")!
    static let terminalInstallCommand = "curl -fsSL https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/install.sh | sh"
    static let defaultExecutableURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Applications/LocalAIAgent/local-ai-agent")

    typealias ScriptFetcher = () async throws -> Data
    typealias ProcessRunner = (_ executable: URL, _ arguments: [String], _ environment: [String: String], _ onOutput: @escaping @Sendable (String) -> Void) async throws -> Int32

    let descriptorDirectory: URL
    let fallbackExecutable: URL?
    private let fetchScript: ScriptFetcher
    private let customRunProcess: ProcessRunner?
    private let lock = NSLock()
    private var activeProcess: Process?
    private var wasCancelled = false

    private struct InstallationRecord: Decodable {
        let executable: String
    }

    init(
        descriptorDirectory: URL,
        fallbackExecutable: URL? = nil,
        fetchScript: ScriptFetcher? = nil,
        runProcess: ProcessRunner? = nil
    ) {
        self.descriptorDirectory = descriptorDirectory
        self.fallbackExecutable = fallbackExecutable
        self.fetchScript = fetchScript ?? Self.defaultFetchScript
        self.customRunProcess = runProcess
    }

    func detect() -> StandaloneInstallState {
        let fm = FileManager.default
        let recordURL = descriptorDirectory.appendingPathComponent("installation.json")
        if let data = try? Data(contentsOf: recordURL),
           let record = try? JSONDecoder().decode(InstallationRecord.self, from: data) {
            let trimmed = record.executable.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, fm.isExecutableFile(atPath: trimmed) {
                return .installed(executable: URL(fileURLWithPath: trimmed))
            }
        }
        if let fallback = fallbackExecutable, fm.isExecutableFile(atPath: fallback.path) {
            return .installed(executable: fallback)
        }
        return .notInstalled
    }

    func startInstalled(_ executable: URL, onOutput: @escaping @Sendable (String) -> Void) async throws {
        resetCancel()
        onOutput("正在启动本机独立后台：\(executable.path)\n")
        let status = try await executeProcess(executable: executable, arguments: ["-no-browser"], environment: buildEnvironment(), onOutput: onOutput)
        if checkCancelled() { throw StandaloneBackendError.cancelled }
        if status != 0 { throw StandaloneBackendError.processFailed(status) }
        onOutput("启动命令已完成，正在等待后台就绪…\n")
    }

    func installAndStart(onOutput: @escaping @Sendable (String) -> Void) async throws {
        resetCancel()
        onOutput("正在获取官方安装脚本（HTTPS）…\n")
        let scriptData = try await fetchScript()
        if checkCancelled() { throw StandaloneBackendError.cancelled }
        guard !scriptData.isEmpty else { throw StandaloneBackendError.emptyScript }

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("local-ai-agent-install-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let scriptFile = tempDir.appendingPathComponent("install.sh")
        try scriptData.write(to: scriptFile, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: scriptFile.path)

        onOutput("开始下载并安装独立后台，请稍候…\n")
        let status = try await executeProcess(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [scriptFile.path],
            environment: buildEnvironment(),
            onOutput: onOutput
        )
        if checkCancelled() { throw StandaloneBackendError.cancelled }
        if status != 0 { throw StandaloneBackendError.processFailed(status) }
        onOutput("安装完成，正在连接本机独立后台…\n")
    }

    func cancel() {
        lock.lock()
        wasCancelled = true
        let proc = activeProcess
        lock.unlock()
        if let proc, proc.isRunning {
            proc.terminate()
        }
    }

    private func resetCancel() {
        lock.lock()
        wasCancelled = false
        lock.unlock()
    }

    private func checkCancelled() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return wasCancelled
    }

    private func executeProcess(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        onOutput: @escaping @Sendable (String) -> Void
    ) async throws -> Int32 {
        if let customRunProcess {
            return try await customRunProcess(executable, arguments, environment, onOutput)
        }
        return try await defaultRunProcess(executable: executable, arguments: arguments, environment: environment, onOutput: onOutput)
    }

    private func buildEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        let standardPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        if let existing = env["PATH"], !existing.isEmpty {
            env["PATH"] = existing + ":" + standardPath
        } else {
            env["PATH"] = standardPath
        }
        // Preserve isolated remote host dir if overridden (tests or custom launch).
        if let override = ProcessInfo.processInfo.environment["IDE_AGENT_REMOTE_HOST_DIR"], !override.isEmpty {
            env["IDE_AGENT_REMOTE_HOST_DIR"] = override
        }
        return env
    }

    private static func defaultFetchScript() async throws -> Data {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: installScriptURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw StandaloneBackendError.invalidResponse(http.statusCode)
        }
        return data
    }

    private func defaultRunProcess(
        executable: URL,
        arguments: [String],
        environment: [String: String],
        onOutput: @escaping @Sendable (String) -> Void
    ) async throws -> Int32 {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            process.environment = environment
            process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = pipe
            let readHandle = pipe.fileHandleForReading
            let writeHandle = pipe.fileHandleForWriting

            readHandle.readabilityHandler = { fileHandle in
                let chunk = fileHandle.availableData
                guard !chunk.isEmpty else { return }
                onOutput(String(decoding: chunk, as: UTF8.self))
            }

            process.terminationHandler = { [weak self] finished in
                readHandle.readabilityHandler = nil
                // Drain only already-buffered bytes in non-blocking mode so a detached daemon child
                // inheriting the pipe descriptor can never hang process completion.
                let drained = Self.drainNonBlocking(fd: readHandle.fileDescriptor)
                if !drained.isEmpty {
                    onOutput(String(decoding: drained, as: UTF8.self))
                }
                try? readHandle.close()
                self?.lock.lock()
                if self?.activeProcess === finished { self?.activeProcess = nil }
                self?.lock.unlock()
                continuation.resume(returning: finished.terminationStatus)
            }

            lock.lock()
            if wasCancelled {
                lock.unlock()
                readHandle.readabilityHandler = nil
                try? writeHandle.close()
                try? readHandle.close()
                continuation.resume(throwing: StandaloneBackendError.cancelled)
                return
            }
            activeProcess = process
            lock.unlock()

            do {
                try process.run()
                // Close parent's copy of write end so EOF arrives promptly when child exits.
                try? writeHandle.close()
            } catch {
                readHandle.readabilityHandler = nil
                try? writeHandle.close()
                try? readHandle.close()
                lock.lock()
                if activeProcess === process { activeProcess = nil }
                lock.unlock()
                continuation.resume(throwing: error)
            }
        }
    }

    private static func drainNonBlocking(fd: Int32) -> Data {
        guard fd >= 0 else { return Data() }
        let flags = fcntl(fd, F_GETFL)
        if flags >= 0 {
            _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = Darwin.read(fd, &buffer, buffer.count)
            if count > 0 {
                data.append(buffer, count: count)
            } else {
                break
            }
        }
        return data
    }
}
