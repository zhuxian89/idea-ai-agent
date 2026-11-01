package dev.ideaagent.remote

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@Service(Service.Level.APP)
class RemoteHostService : Disposable {
    private val pluginVersion = requireNotNull(com.intellij.ide.plugins.PluginManagerCore.getPlugin(
        com.intellij.openapi.extensions.PluginId.getId("dev.ideaagent.local"))).version
    private val supervisor = RemoteHostSupervisor({ executable, dataDir -> ensureRemoteHost(executable, dataDir, pluginVersion) }, reportFailure = { error ->
        // Exceptions from descriptor parsing may include input. Report only a
        // stable category; the local remote-access panel provides current status.
        Logger.getInstance(RemoteHostService::class.java).warn(
            if (error is RemoteHostProtocolException) "Remote host protocol incompatible; update all IDEA plugin instances"
            else "Remote host unavailable (${error.javaClass.simpleName}); local Agent remains available"
        )
    })

    internal fun acquire(executable: Path, dataDir: Path): AutoCloseable = supervisor.acquire(executable, dataDir)

    override fun dispose() = supervisor.close()
}

/** Supervises reachability, not process ownership: releasing a lease never kills the shared host. */
internal class RemoteHostSupervisor(
    private val ensureHost: (Path, Path) -> Unit,
    private val reportFailure: (Exception) -> Unit,
    private val healthyDelayMillis: Long = 5000,
) : AutoCloseable {
    private val executor = Executors.newSingleThreadScheduledExecutor { task ->
        Thread(task, "idea-agent-remote-host").apply { isDaemon = true }
    }
    private val lock = Any()
    private val participants = linkedMapOf<Any, Pair<Path, Path>>()
    private var next: ScheduledFuture<*>? = null
    private var checking = false
    private var closed = false
    private var failures = 0

    fun acquire(executable: Path, dataDir: Path): AutoCloseable {
        val key = Any()
        synchronized(lock) {
            check(!closed) { "Remote host supervisor is disposed" }
            participants[key] = executable to dataDir
            if (next == null && !checking) schedule(0)
        }
        val released = AtomicBoolean()
        return AutoCloseable {
            if (released.compareAndSet(false, true)) synchronized(lock) {
                participants.remove(key)
                if (participants.isEmpty()) {
                    next?.cancel(false)
                    next = null
                    failures = 0
                }
            }
        }
    }

    private fun schedule(delay: Long) {
        next = executor.schedule(::checkHost, delay, TimeUnit.MILLISECONDS)
    }

    private fun checkHost() {
        val participant = synchronized(lock) {
            next = null
            if (closed || participants.isEmpty()) return
            checking = true
            participants.values.last()
        }
        var failure: Exception? = null
        try {
            ensureHost(participant.first, participant.second)
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (error: Exception) {
            failure = error
        } finally {
            synchronized(lock) {
                checking = false
                if (!closed && participants.isNotEmpty()) {
                    if (failure == null) failures = 0 else {
                        if (failures == 0) reportFailure(failure)
                        failures = (failures + 1).coerceAtMost(5)
                    }
                    val delay = if (failures == 0) healthyDelayMillis
                    else (healthyDelayMillis * (1L shl (failures - 1))).coerceAtMost(60000)
                    schedule(delay)
                }
            }
        }
    }

    override fun close() {
        synchronized(lock) {
            closed = true
            participants.clear()
            next?.cancel(false)
            next = null
        }
        executor.shutdownNow()
    }
}
