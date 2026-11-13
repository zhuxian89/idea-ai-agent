package dev.ideaagent

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.util.EnvironmentUtil
import com.intellij.util.messages.Topic
import java.net.HttpURLConnection
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.util.concurrent.TimeUnit

internal interface StandaloneBackendListener {
    fun changed(action: String)

    companion object {
        val TOPIC = Topic.create("Local AI Agent service lifecycle", StandaloneBackendListener::class.java)
    }
}

internal fun standaloneExecutable(dir: Path): Path? {
    val raw = try { Files.readString(dir.resolve("installation.json")) }
        catch (_: NoSuchFileException) { return null }
    val value = JsonParser.parseString(raw).asJsonObject.get("executable")
    require(value != null && value.isJsonPrimitive && value.asJsonPrimitive.isString) { "Invalid Local AI Agent installation record" }
    val executable = Path.of(value.asString)
    require(executable.isAbsolute && Files.isRegularFile(executable)) { "Local AI Agent executable is missing. Reinstall the standalone package." }
    return executable
}

internal fun ensureLocalCore(executable: Path, dir: Path) {
    runBackendCommand(executable, dir, "--start-local-core")
}

internal fun runBackendCommand(executable: Path, dir: Path, vararg args: String) {
    val builder = ProcessBuilder(listOf(executable.toString()) + args).redirectErrorStream(true)
    builder.environment().clear()
    builder.environment().putAll(agentRuntimeEnvironment(EnvironmentUtil.getEnvironmentMap()))
    builder.environment().remove("IDE_AGENT_TOKEN")
    builder.environment()["IDE_AGENT_REMOTE_HOST_DIR"] = dir.toString()
    builder.environment()["MINDFS_STATIC_DIR"] = executable.parent.resolve("web").toString()
    val child = builder.start()
    if (!child.waitFor(30, TimeUnit.SECONDS)) {
        child.destroyForcibly()
        error("Local AI Agent command timed out")
    }
    val output = child.inputStream.bufferedReader().use { it.readText() }
    check(child.exitValue() == 0) { output.trim() }
}

internal fun connectLocalCore(dir: Path, projectPath: Path, legacyDataDir: Path): LocalRuntime.Connection {
    val descriptor = JsonParser.parseString(Files.readString(dir.resolve("core.json"))).asJsonObject
    require(descriptor.get("protocol")?.asInt == 1 && descriptor.get("mode")?.asString == "core") { "Invalid local data service descriptor" }
    val endpoint = LocalEndpoint.parse(descriptor.get("url").asString)
    val token = descriptor.get("token").asString
    require(token.isNotBlank()) { "Missing local data service credential" }
    val connection = endpoint.resolve("/control/open-project").toURL().openConnection() as HttpURLConnection
    connection.connectTimeout = 3000
    connection.readTimeout = 10000
    connection.instanceFollowRedirects = false
    connection.requestMethod = "POST"
    connection.doOutput = true
    connection.setRequestProperty("Authorization", "Bearer $token")
    connection.setRequestProperty("Content-Type", "application/json")
    try {
        connection.outputStream.use { it.write(Gson().toJson(mapOf("path" to projectPath.toString(), "legacy_data_dir" to legacyDataDir.toString())).toByteArray(Charsets.UTF_8)) }
        check(connection.responseCode == 200) {
            "Cannot open project in Local AI Agent: ${connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()}"
        }
        val result = connection.inputStream.bufferedReader().use { JsonParser.parseReader(it).asJsonObject }
        val root = result.get("root_id").asString
        require(root.isNotBlank()) { "Missing project identity" }
        return LocalRuntime.Connection(endpoint, root, token, standalone = true)
    } finally { connection.disconnect() }
}

internal fun manageStandalone(dir: Path, action: String) {
    require(action in listOf("start", "restart", "stop"))
    val executable = requireNotNull(standaloneExecutable(dir)) { "Local AI Agent is not installed" }
    val command = mutableListOf(executable.toString(), "-no-browser")
    if (action != "start") command.add("-$action")
    val builder = ProcessBuilder(command).redirectErrorStream(true)
    builder.environment().clear()
    builder.environment().putAll(agentRuntimeEnvironment(EnvironmentUtil.getEnvironmentMap()))
    builder.environment()["IDE_AGENT_REMOTE_HOST_DIR"] = dir.toString()
    val child = builder.start()
    if (!child.waitFor(25, TimeUnit.SECONDS)) {
        child.destroyForcibly()
        error("Local AI Agent control command timed out")
    }
    val output = child.inputStream.bufferedReader().use { it.readText() }
    check(child.exitValue() == 0) { output.trim() }
}
