package dev.ideaagent.remote

import com.google.gson.JsonParser
import com.intellij.util.EnvironmentUtil
import dev.ideaagent.LocalEndpoint
import dev.ideaagent.agentRuntimeEnvironment
import java.net.HttpURLConnection
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path

internal const val REMOTE_HOST_PROTOCOL = 1

internal fun remoteHostDataDir(
    osName: String = System.getProperty("os.name"),
    userHome: String = System.getProperty("user.home"),
    environment: Map<String, String> = System.getenv(),
): Path {
    val config = when {
        osName.lowercase().startsWith("windows") -> Path.of(requireNotNull(environment.entries
            .firstOrNull { it.key.equals("APPDATA", ignoreCase = true) }?.value?.takeIf { it.isNotBlank() }) {
            "APPDATA is required for the shared remote directory"
        })
        osName.lowercase().contains("mac") -> Path.of(userHome, "Library", "Application Support")
        else -> environment["XDG_CONFIG_HOME"]?.takeIf { it.isNotBlank() }?.let(Path::of)
            ?: Path.of(userHome, ".config")
    }
    return config.resolve("LocalAIAgent").resolve("remote")
}

internal fun remoteHostProcess(
    executable: Path,
    dataDir: Path,
    shellEnvironment: Map<String, String> = EnvironmentUtil.getEnvironmentMap(),
    pluginVersion: String = "",
): ProcessBuilder {
    val builder = ProcessBuilder(executable.toString(), "--remote-host")
        .directory(executable.parent.toFile())
        // The descriptor carries a credential. Do not pipe startup output to IDEA logs.
        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
        .redirectError(ProcessBuilder.Redirect.DISCARD)
    builder.environment().clear()
    builder.environment().putAll(agentRuntimeEnvironment(shellEnvironment))
    builder.environment().remove("IDE_AGENT_TOKEN")
    builder.environment().remove("IDE_AGENT_DATA_DIR")
    builder.environment()["IDE_AGENT_REMOTE_VERSION"] = pluginVersion
    builder.environment()["IDE_AGENT_REMOTE_HOST_DIR"] = dataDir.toString()
    builder.environment()["MINDFS_STATIC_DIR"] = executable.parent.resolve("web").toString()
    return builder
}

internal class RemoteHostProtocolException : IllegalStateException("remote_protocol_incompatible")

internal class RunningRemoteHost(val endpoint: java.net.URI, val token: String, val version: String)

internal fun remoteHostAvailable(dataDir: Path): Boolean = readRunningRemoteHost(dataDir) != null

internal fun readRunningRemoteHost(dataDir: Path): RunningRemoteHost? {
    val raw = try {
        Files.readString(dataDir.resolve("host.json"))
    } catch (_: NoSuchFileException) {
        return null
    }
    val descriptor = JsonParser.parseString(raw).asJsonObject
    val protocol = descriptor.get("protocol")
    require(protocol != null && protocol.isJsonPrimitive && protocol.asJsonPrimitive.isNumber) {
        "Invalid remote host descriptor protocol"
    }
    if (protocol.asString != REMOTE_HOST_PROTOCOL.toString()) throw RemoteHostProtocolException()
    val url = descriptor.get("url")
    val token = descriptor.get("token")
    require(url != null && url.isJsonPrimitive && url.asJsonPrimitive.isString &&
        token != null && token.isJsonPrimitive && token.asJsonPrimitive.isString && token.asString.isNotBlank()) {
        "Invalid remote host descriptor"
    }
    val endpoint = LocalEndpoint.parse(url.asString)
    val connection = endpoint.resolve("/control/status").toURL().openConnection() as HttpURLConnection
    connection.connectTimeout = 1000
    connection.readTimeout = 2000
    connection.instanceFollowRedirects = false
    connection.setRequestProperty("Authorization", "Bearer ${token.asString}")
    try {
        val status = try {
            connection.responseCode
        } catch (_: java.net.ConnectException) {
            return null // A crashed host can leave its descriptor until the next lock owner starts.
        }
        if (status == 409) throw RemoteHostProtocolException()
        check(status == 200) { "Remote host health check failed ($status)" }
        val response = connection.inputStream.bufferedReader().use { JsonParser.parseReader(it).asJsonObject }
        if (response.get("protocol")?.asString != REMOTE_HOST_PROTOCOL.toString()) {
            throw RemoteHostProtocolException()
        }
        return RunningRemoteHost(endpoint, token.asString, response.get("runtime_version")?.asString.orEmpty())
    } finally {
        connection.disconnect()
    }
}

internal fun ensureRemoteHost(executable: Path, dataDir: Path, pluginVersion: String) {
    val current = readRunningRemoteHost(dataDir)
    if (current != null && !needsRemoteHostUpgrade(current.version, pluginVersion)) return
    Files.createDirectories(dataDir)
    java.nio.channels.FileChannel.open(dataDir.resolve("host-upgrade.lock"),
        java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.WRITE).use { channel ->
        val lock = try { channel.tryLock() } catch (_: java.nio.channels.OverlappingFileLockException) { null }
        if (lock == null) return // Another IDEA instance is replacing this user's entry.
        lock.use {
            val running = readRunningRemoteHost(dataDir)
            if (running != null) {
                if (!needsRemoteHostUpgrade(running.version, pluginVersion)) return
                stopRemoteHostForUpgrade(running, dataDir)
            }
            // The host owns its own OS lock. Only the entry process is replaced;
            // project runtimes and their active Agent writers remain untouched.
            val child = remoteHostProcess(executable, dataDir, pluginVersion = pluginVersion).start()
            child.outputStream.close()
            val deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(10)
            while (System.nanoTime() < deadline) {
                val ready = readRunningRemoteHost(dataDir)
                if (ready != null && !needsRemoteHostUpgrade(ready.version, pluginVersion)) return
                if (!child.isAlive && child.exitValue() != 0) error("Remote host startup failed (${child.exitValue()})")
                Thread.sleep(100)
            }
            error("Remote host startup timed out")
        }
    }
}
