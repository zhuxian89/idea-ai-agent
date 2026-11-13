package dev.ideaagent

import com.intellij.openapi.components.Service
import com.intellij.util.EnvironmentUtil
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption.*
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal fun installedStandaloneVersion(dir: Path): String? {
    val executable = standaloneExecutable(dir) ?: return null
    val child = ProcessBuilder(executable.toString(), "-version").redirectErrorStream(true).start()
    if (!child.waitFor(5, TimeUnit.SECONDS)) {
        child.destroyForcibly()
        error("Reading the installed service version timed out")
    }
    val output = child.inputStream.bufferedReader().use { it.readText() }.trim()
    check(child.exitValue() == 0) { output }
    require(output.startsWith("Local AI Agent ")) { "Unexpected service version: $output" }
    return output.removePrefix("Local AI Agent ")
}

/**
 * True only when the recorded executable still exists. A record that points at a deleted
 * installation counts as not installed, so the installer can repair it instead of failing
 * before it downloads anything.
 */
internal fun isInstalled(dir: Path): Boolean = try {
    standaloneExecutable(dir) != null
} catch (_: IllegalArgumentException) { false }

/** Uses the published installer for first installation and user-requested updates. */
@Service(Service.Level.APP)
internal class StandaloneInstaller {
    private val busy = AtomicBoolean(false)
    val installing: Boolean get() = busy.get()
    @Volatile var updating: Boolean = false
        private set
    @Volatile var error: String = ""
        private set

    fun install(dir: Path, changed: () -> Unit, environment: Map<String, String> = EnvironmentUtil.getEnvironmentMap(), update: Boolean = false, version: String? = null): Boolean {
        if (!busy.compareAndSet(false, true)) return false
        error = ""
        updating = update
        changed()
        try {
            Files.createDirectories(dir)
            FileChannel.open(dir.resolve("standalone-install.lock"), CREATE, WRITE).use { channel ->
                val lease = requireNotNull(channel.tryLock()) { "An installation is running in another IDEA instance." }
                lease.use {
                    if (!update && isInstalled(dir)) return true
                    val target = version ?: latestStandaloneVersion()
                    if (update) {
                        val installed = requireNotNull(installedStandaloneVersion(dir)) { "Standalone service is not installed" }
                        if (!standaloneUpdateAvailable(installed, target)) return true
                    }
                    val windows = System.getProperty("os.name").startsWith("Windows")
                    val extension = if (windows) "ps1" else "sh"
                    val script = Files.createTempFile("local-ai-agent-install-", ".$extension")
                    try {
                        requireNotNull(javaClass.getResourceAsStream("/installers/install.$extension")).use {
                            Files.copy(it, script, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
                        }
                        val command = (if (windows) listOf("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
                            "-ExecutionPolicy", "Bypass", "-File", script.toString(), "-Version", target)
                        else listOf("/bin/sh", script.toString(), "--version", target)) +
                            if (update) emptyList() else listOf(if (windows) "-DeferStart" else "--defer-start")
                        val log = dir.resolve("logs/install.log")
                        Files.createDirectories(log.parent)
                        val builder = ProcessBuilder(command).redirectErrorStream(true).redirectOutput(log.toFile())
                        builder.environment().clear()
                        builder.environment().putAll(agentRuntimeEnvironment(environment))
                        builder.environment()["IDE_AGENT_REMOTE_HOST_DIR"] = dir.toString()
                        builder.environment().remove("IDE_AGENT_TOKEN")
                        builder.environment().remove("IDE_AGENT_DATA_DIR")
                        builder.environment().remove("MINDFS_STATIC_DIR")
                        val child = builder.start()
                        if (!child.waitFor(10, TimeUnit.MINUTES)) {
                            child.descendants().use { it.forEach { process -> process.destroyForcibly() } }
                            child.destroyForcibly().waitFor()
                            error("Installation timed out. See $log")
                        }
                        check(child.exitValue() == 0) { Files.readString(log).takeLast(8000).trim() }
                        check(standaloneExecutable(dir) != null) { "Installer finished without registering the standalone service. See $log" }
                        if (update) check(installedStandaloneVersion(dir) == target) { "The installed service version did not change. See $log" }
                    } finally { Files.deleteIfExists(script) }
                }
            }
            return true
        } catch (failure: Exception) {
            error = failure.message ?: failure.javaClass.simpleName
            return false
        } finally {
            updating = false
            busy.set(false)
            changed()
        }
    }
}
