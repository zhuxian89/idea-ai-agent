package dev.ideaagent

import com.google.gson.Gson
import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.AppExecutorUtil
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import java.util.HexFormat
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

@Service(Service.Level.PROJECT)
class LocalRuntime(private val project: Project) : Disposable {
    data class Ready(val url: String, val rootId: String)
    data class Connection(val endpoint: URI, val rootId: String, val token: String)

    private val lock = Any()
    private var future: CompletableFuture<Connection>? = null
    private var process: Process? = null
    private var disposed = false

    init {
        instances.add(this)
    }

    fun start(): CompletableFuture<Connection> = synchronized(lock) {
        check(!disposed) { "Project is closed" }
        future?.let { return@synchronized it }
        val result = CompletableFuture<Connection>()
        future = result
        AppExecutorUtil.getAppExecutorService().execute { launch(result) }
        result.orTimeout(45, TimeUnit.SECONDS).whenComplete { _, error ->
            if (error != null) stopFailed(result)
        }
        result
    }

    private fun launch(result: CompletableFuture<Connection>) {
        try {
            val projectPath = Path.of(requireNotNull(project.basePath) { "Open a project directory first" }).toRealPath()
            val descriptor = requireNotNull(PluginManager.getInstance().findEnabledPlugin(PluginId.getId("dev.ideaagent.local")))
            val bundledRuntime = descriptor.pluginPath.resolve("runtime")
            val os = System.getProperty("os.name").lowercase().let {
                when { it.contains("win") -> "windows"; it.contains("mac") -> "darwin"; else -> "linux" }
            }
            val arch = when (System.getProperty("os.arch")) {
                "amd64", "x86_64" -> "amd64"
                "aarch64", "arm64" -> "arm64"
                else -> error("Unsupported CPU architecture")
            }
            val executableName = "idea-agent-$os-$arch" + if (os == "windows") ".exe" else ""
            val executable = materializeRuntime(bundledRuntime, executableName,
                Path.of(PathManager.getSystemPath(), "idea-ai-agent", "runtime"))
            val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(projectPath.toString().toByteArray()))
            val dataDir = Path.of(PathManager.getConfigPath(), "idea-ai-agent", hash)
            Files.createDirectories(dataDir)
            val token = HexFormat.of().formatHex(ByteArray(32).also { SecureRandom().nextBytes(it) })
            val builder = runtimeProcess(executable, projectPath, dataDir, token)
            val child = synchronized(lock) {
                if (disposed || result.isDone) return
                builder.start().also { process = it }
            }
            // Drain diagnostics without copying agent prompts or credentials into IDEA logs.
            AppExecutorUtil.getAppExecutorService().execute { child.errorStream.use { it.transferTo(java.io.OutputStream.nullOutputStream()) } }
            child.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                lines.forEach { line ->
                    if (line.startsWith("IDE_AGENT_READY ") && !result.isDone) {
                        val ready = Gson().fromJson(line.removePrefix("IDE_AGENT_READY "), Ready::class.java)
                        require(ready.rootId.isNotBlank()) { "Missing project identity" }
                        result.complete(Connection(LocalEndpoint.parse(ready.url), ready.rootId, token))
                    }
                }
            }
            val exitCode = child.waitFor()
            result.completeExceptionally(IllegalStateException("Local Agent service exited ($exitCode). Check CLI installation and project access."))
            synchronized(lock) {
                if (process === child) process = null
                if (future === result) future = null
            }
        } catch (error: Exception) {
            result.completeExceptionally(error)
        }
    }

    private fun stopFailed(result: CompletableFuture<Connection>) {
        val child = synchronized(lock) {
            if (future !== result) return
            future = null
            process.also { process = null }
        }
        child?.let(::shutdownAsync)
    }

    private fun shutdownAsync(child: Process) =
        AppExecutorUtil.getAppExecutorService().execute { stopRuntimeProcess(child) }

    private fun shutdownForUnload() {
        val child = synchronized(lock) {
            disposed = true
            val active = process
            process = null
            future?.cancel(false)
            future = null
            active
        }
        child?.let(::stopRuntimeProcess)
    }

    override fun dispose() {
        instances.remove(this)
        val child = synchronized(lock) {
            disposed = true
            val active = process
            process = null
            future?.cancel(false)
            future = null
            active
        }
        child?.let(::shutdownAsync)
    }

    companion object {
        private val instances = Collections.newSetFromMap(ConcurrentHashMap<LocalRuntime, Boolean>())

        internal fun shutdownAllForUnload() {
            instances.toList().forEach { it.shutdownForUnload() }
        }
    }
}

internal fun stopRuntimeProcess(child: Process) {
    val descendants = runCatching { child.descendants().use { it.toList() } }.getOrDefault(emptyList())
    runCatching { child.outputStream.write("shutdown\n".toByteArray()); child.outputStream.flush() }
    runCatching { child.waitFor(8, TimeUnit.SECONDS) }
    descendants.reversed().forEach { descendant ->
        if (descendant.isAlive) runCatching { descendant.destroyForcibly() }
    }
    if (child.isAlive) {
        runCatching { child.destroyForcibly() }
        runCatching { child.waitFor(3, TimeUnit.SECONDS) }
    }
    descendants.forEach { descendant ->
        if (descendant.isAlive) runCatching { descendant.onExit().get(3, TimeUnit.SECONDS) }
    }
    runCatching { child.outputStream.close() }
}
