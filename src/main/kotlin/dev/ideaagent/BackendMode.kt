package dev.ideaagent

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import dev.ideaagent.remote.readRunningRemoteHost
import dev.ideaagent.remote.stopRemoteHostForUpgrade
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption.*

internal enum class BackendMode(val value: String) {
    EMBEDDED("embedded"), STANDALONE("standalone");

    companion object {
        fun parse(value: String): BackendMode = entries.firstOrNull { it.value == value }
            ?: error("Unknown backend mode: $value")
    }
}

internal fun readBackendMode(file: Path): BackendMode? {
    val raw = try { Files.readString(file) } catch (_: NoSuchFileException) { return null }
    val value = JsonParser.parseString(raw).asJsonObject.get("mode")
    require(value != null && value.isJsonPrimitive && value.asJsonPrimitive.isString) { "Invalid backend mode preference" }
    return BackendMode.parse(value.asString)
}

internal fun writeBackendMode(file: Path, mode: BackendMode) {
    Files.createDirectories(file.parent)
    val temporary = Files.createTempFile(file.parent, "backend-mode-", ".tmp")
    try {
        Files.writeString(temporary, Gson().toJson(mapOf("mode" to mode.value)))
        Files.move(temporary, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    } finally { Files.deleteIfExists(temporary) }
}

/** Shared by this IDEA's projects; another IDEA keeps its current data writer until it also exits. */
internal class BackendModeSession private constructor(
    val mode: BackendMode, private val channel: FileChannel, private val lease: FileLock,
) : AutoCloseable {
    override fun close() { lease.release(); channel.close() }

    companion object {
        fun open(dir: Path, prepare: (BackendMode, BackendMode?) -> Unit): BackendModeSession {
            Files.createDirectories(dir)
            FileChannel.open(dir.resolve("backend-switch.lock"), CREATE, WRITE).use { switching ->
                switching.lock().use {
                    val clients = FileChannel.open(dir.resolve("ide-clients.lock"), CREATE, READ, WRITE)
                    try {
                        val exclusive = try { clients.tryLock() } catch (_: OverlappingFileLockException) { null }
                        val activeFile = dir.resolve("active-backend.json")
                        val mode = if (exclusive != null) exclusive.use {
                            val previous = readBackendMode(activeFile)
                            val installed = Files.exists(dir.resolve("installation.json")) || Files.exists(dir.resolve("core.json"))
                            val preferred = readBackendMode(dir.resolve("backend-preference.json"))
                            val wanted = if (installed && preferred != BackendMode.EMBEDDED) BackendMode.STANDALONE else BackendMode.EMBEDDED
                            prepare(wanted, previous)
                            writeBackendMode(activeFile, wanted)
                            wanted
                        } else requireNotNull(readBackendMode(activeFile)) { "Missing active IDEA backend mode" }
                        return BackendModeSession(mode, clients, clients.lock(0, Long.MAX_VALUE, true))
                    } catch (error: Exception) { clients.close(); throw error }
                }
            }
        }
    }
}

@Service(Service.Level.APP)
internal class BackendModeService : Disposable {
    private val sessions = mutableMapOf<Path, BackendModeSession>()
    private val remoteErrors = mutableMapOf<Path, String>()

    @Synchronized fun prepare(dir: Path, executable: Path): BackendMode = sessions.getOrPut(dir) {
        BackendModeSession.open(dir) { mode, previous ->
            if (mode == BackendMode.EMBEDDED) {
                runBackendCommand(executable, dir, "--prepare-embedded-core")
                prepareRemote(dir) { runBackendCommand(executable, dir, "--prepare-embedded-remote") }
            } else if (previous == BackendMode.EMBEDDED) {
                prepareRemote(dir) {
                    val installed = requireNotNull(standaloneExecutable(dir)) { "Install the standalone service first" }
                    readRunningRemoteHost(dir)?.takeIf { it.mode != "standalone" }?.let { stopRemoteHostForUpgrade(it, dir) }
                    runBackendCommand(installed, dir, "-install")
                    runBackendCommand(installed, dir, "-no-browser")
                }
            }
        }
    }.mode

    private fun prepareRemote(dir: Path, action: () -> Unit) {
        try { action() } catch (error: Exception) {
            // Remote startup errors must not prevent the local chat from opening.
            Logger.getInstance(BackendModeService::class.java).warn("Remote mode setup failed (${error.javaClass.simpleName}); see the remote panel")
            remoteErrors[dir] = error.message.orEmpty()
        }
    }

    @Synchronized fun state(dir: Path, current: BackendMode): Map<String, Any> {
        val saved = readBackendMode(dir.resolve("backend-preference.json"))
        val installation = runCatching { standaloneExecutable(dir) }
        val running = if (installation.getOrNull() != null) runCatching { readRunningRemoteHost(dir)?.mode == "standalone" } else null
        val installer = com.intellij.openapi.application.ApplicationManager.getApplication().getService(StandaloneInstaller::class.java)
        return mapOf("current" to current.value, "selected" to (saved ?: current).value,
            "confirmed" to (saved != null), "installed" to (installation.getOrNull() != null),
            "running" to (running?.getOrNull() == true), "installing" to (installer.installing && !installer.updating), "installError" to installer.error,
            "installationError" to installation.exceptionOrNull()?.message.orEmpty(),
            "setupError" to remoteErrors[dir].orEmpty())
    }

    @Synchronized fun save(dir: Path, mode: BackendMode) = writeBackendMode(dir.resolve("backend-preference.json"), mode)
    @Synchronized fun clearRemoteError(dir: Path) { remoteErrors.remove(dir) }

    @Synchronized override fun dispose() { sessions.values.forEach { it.close() }; sessions.clear() }
}
