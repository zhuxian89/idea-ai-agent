package dev.ideaagent

import com.google.gson.Gson
import com.intellij.ide.plugins.PluginManagerCore
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
import java.util.HexFormat
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@Service(Service.Level.PROJECT)
class LocalRuntime(private val project: Project) : Disposable {
    data class Ready(val url: String, val rootId: String)
    data class Connection(val endpoint: URI, val rootId: String, val token: String)

    private val lock = Any()
    private var future: CompletableFuture<Connection>? = null
    private var process: Process? = null
    private var disposed = false

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
            val descriptor = requireNotNull(PluginManagerCore.getPlugin(PluginId.getId("dev.ideaagent.local")))
            val runtime = descriptor.pluginPath.resolve("runtime")
            val os = System.getProperty("os.name").lowercase().let {
                when { it.contains("win") -> "windows"; it.contains("mac") -> "darwin"; else -> "linux" }
            }
            val arch = when (System.getProperty("os.arch")) {
                "amd64", "x86_64" -> "amd64"
                "aarch64", "arm64" -> "arm64"
                else -> error("Unsupported CPU architecture")
            }
            val executable = runtime.resolve("idea-agent-$os-$arch" + if (os == "windows") ".exe" else "")
            check(Files.isRegularFile(executable)) { "This plugin package does not include the $os/$arch runtime" }
            if (os != "windows") check(executable.toFile().setExecutable(true, true)) { "Cannot enable runtime executable" }
            val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(projectPath.toString().toByteArray()))
            val dataDir = Path.of(PathManager.getConfigPath(), "idea-ai-agent", hash)
            Files.createDirectories(dataDir)
            val token = HexFormat.of().formatHex(ByteArray(32).also { SecureRandom().nextBytes(it) })
            val builder = ProcessBuilder(executable.toString(), "--project", projectPath.toString())
                .directory(runtime.toFile())
            builder.environment()["IDE_AGENT_DATA_DIR"] = dataDir.toString()
            builder.environment()["IDE_AGENT_TOKEN"] = token
            builder.environment()["MINDFS_STATIC_DIR"] = runtime.resolve("web").toString()
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
        child?.let(::shutdown)
    }

    private fun shutdown(child: Process) {
        AppExecutorUtil.getAppExecutorService().execute {
            val descendants = runCatching { child.descendants().use { it.toList() } }.getOrDefault(emptyList())
            runCatching { child.outputStream.write("shutdown\n".toByteArray()); child.outputStream.flush() }
            runCatching { child.waitFor(8, TimeUnit.SECONDS) }
            descendants.reversed().forEach { if (it.isAlive) runCatching { it.destroyForcibly() } }
            if (child.isAlive) child.destroyForcibly()
            runCatching { child.outputStream.close() }
        }
    }

    override fun dispose() {
        val child = synchronized(lock) {
            disposed = true
            val active = process
            process = null
            future?.cancel(false)
            future = null
            active
        }
        child?.let(::shutdown)
    }
}
