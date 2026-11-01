package dev.ideaagent.remote

import com.google.gson.JsonObject
import java.net.HttpURLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

// Local packages precede the matching marketplace release; older IDE windows
// must never replace a host already upgraded by another window.
internal fun needsRemoteHostUpgrade(running: String, requested: String): Boolean {
    fun version(value: String): List<Int> {
        val match = requireNotNull(Regex("(\\d+)\\.(\\d+)\\.(\\d+)(?:-local\\.(\\d+))?").matchEntire(value)) {
            "Unsupported remote host version"
        }
        return (1..3).map { match.groupValues[it].toInt() } +
            (match.groupValues[4].takeIf { it.isNotEmpty() }?.toInt() ?: Int.MAX_VALUE)
    }
    val target = version(requested)
    if (running.isEmpty()) return true // Published local.1–3 did not report a version.
    return version(running).zip(target).firstOrNull { it.first != it.second }?.let { it.first < it.second } ?: false
}

internal fun stopRemoteHostForUpgrade(host: RunningRemoteHost, dataDir: Path) {
    if (host.version.isEmpty()) stopLegacyRemoteHost(host, dataDir)
    else {
        val connection = host.endpoint.resolve("/control/upgrade-stop").toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 1000
        connection.readTimeout = 2000
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer ${host.token}")
        connection.setRequestProperty("Content-Type", "application/json")
        try {
            val body = JsonObject().apply { addProperty("runtime_version", host.version) }.toString()
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            check(connection.responseCode == 200) { "Remote host upgrade was rejected" }
            connection.inputStream.use { it.readBytes() }
        } finally { connection.disconnect() }
    }
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
    while (System.nanoTime() < deadline) {
        val current = readRunningRemoteHost(dataDir)
        if (current == null || current.token != host.token || current.endpoint != host.endpoint) return
        Thread.sleep(100)
    }
    error("Remote host did not stop for upgrade")
}

// Only the original unversioned host needs OS process discovery. New versions
// use the authenticated control endpoint above, without inspecting processes.
private fun stopLegacyRemoteHost(host: RunningRemoteHost, dataDir: Path) {
    val pid = legacyListenerPid(host.endpoint.port)
    val process = ProcessHandle.of(pid).orElseThrow { IllegalStateException("Legacy remote host exited") }
    val info = process.info()
    val started = info.startInstant().orElseThrow { IllegalStateException("Cannot identify legacy remote host") }
    requireLegacyHostExecutable(Path.of(info.command().orElseThrow {
        IllegalStateException("Cannot identify legacy remote host executable")
    }), info.arguments().orElse(null))
    // Recheck the authenticated descriptor and listening socket immediately
    // before stopping this specific process. Never stop by executable name.
    val current = readRunningRemoteHost(dataDir)
    check(current != null && current.version.isEmpty() && current.token == host.token && current.endpoint == host.endpoint &&
        legacyListenerPid(host.endpoint.port) == pid && process.info().startInstant().orElse(null) == started) {
        "Legacy remote host changed during upgrade"
    }
    check(process.destroy()) { "Cannot stop legacy remote host" }
    process.onExit().get(10, TimeUnit.SECONDS)
}

internal fun requireLegacyHostExecutable(executable: Path, arguments: Array<String>?) {
    val directory = requireNotNull(executable.parent) { "Invalid legacy runtime directory" }
    val fingerprint = directory.fileName.toString()
    check(Regex("[a-f0-9]{64}").matches(fingerprint) &&
        directory.parent?.fileName?.toString() == "runtime" &&
        directory.parent?.parent?.fileName?.toString() == "idea-ai-agent" &&
        Regex("idea-agent-(windows|darwin|linux)-(amd64|arm64)(\\.exe)?").matches(executable.fileName.toString()) &&
        Files.isRegularFile(executable) && Files.readString(directory.resolve(".complete")) == fingerprint) {
        "Legacy process is not a cached plugin runtime"
    }
    check(arguments == null || arguments.contentEquals(arrayOf("--remote-host"))) {
        "Legacy process is not the shared remote host"
    }
}

internal fun parseWindowsListenerPid(output: String, port: Int): Long {
    val pids = output.lineSequence().map { it.trim().split(Regex("\\s+")) }
        .filter { it.size == 5 && it[0] == "TCP" && it[1] == "127.0.0.1:$port" && it[3] == "LISTENING" }
        .mapNotNull { it[4].toLongOrNull() }.filter { it > 0 }.toSet()
    check(pids.size == 1) { "Cannot identify legacy remote host listener" }
    return pids.single()
}

private fun legacyListenerPid(port: Int): Long {
    val windows = System.getProperty("os.name").lowercase().startsWith("windows")
    val command = if (windows) listOf(
        Path.of(requireNotNull(System.getenv("SystemRoot")), "System32", "netstat.exe").toString(), "-ano", "-p", "TCP"
    ) else listOf("/usr/sbin/lsof", "-nP", "-a", "-iTCP@127.0.0.1:$port", "-sTCP:LISTEN", "-Fp")
    val output = Files.createTempFile("idea-remote-listener-", ".txt")
    try {
        val child = ProcessBuilder(command).redirectOutput(output.toFile()).redirectError(ProcessBuilder.Redirect.DISCARD).start()
        try {
            check(child.waitFor(5, TimeUnit.SECONDS)) { "Remote host listener lookup timed out" }
            check(child.exitValue() == 0) { "Remote host listener lookup failed" }
            // netstat headings use the Windows console code page. The socket
            // columns are ASCII; do not fail UTF-8 decoding on a Chinese OS.
            val raw = String(Files.readAllBytes(output), Charsets.US_ASCII)
            if (windows) return parseWindowsListenerPid(raw, port)
            val pids = raw.lineSequence().filter { it.startsWith("p") }.mapNotNull { it.drop(1).toLongOrNull() }.toSet()
            check(pids.size == 1) { "Cannot identify legacy remote host listener" }
            return pids.single()
        } finally { if (child.isAlive) child.destroyForcibly() }
    } finally { Files.deleteIfExists(output) }
}
