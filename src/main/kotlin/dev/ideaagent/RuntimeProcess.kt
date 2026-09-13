package dev.ideaagent

import com.intellij.util.EnvironmentUtil
import java.nio.file.Path

internal fun runtimeProcess(executable: Path, projectPath: Path, dataDir: Path, token: String): ProcessBuilder {
    val runtime = executable.parent
    val builder = ProcessBuilder(executable.toString(), "--project", projectPath.toString())
        .directory(runtime.toFile())
    // GUI launchers on macOS omit terminal PATH/configuration. Use the environment
    // IDEA recovered from the user's shell for both CLI discovery and execution.
    builder.environment().clear()
    builder.environment().putAll(agentRuntimeEnvironment(EnvironmentUtil.getEnvironmentMap()))
    builder.environment()["IDE_AGENT_DATA_DIR"] = dataDir.toString()
    builder.environment()["IDE_AGENT_TOKEN"] = token
    builder.environment()["MINDFS_STATIC_DIR"] = runtime.resolve("web").toString()
    return builder
}

internal fun agentRuntimeEnvironment(
    shellEnvironment: Map<String, String>,
    osName: String = System.getProperty("os.name"),
    userHome: String = System.getProperty("user.home"),
): Map<String, String> {
    if (osName.lowercase().startsWith("windows")) {
        val pathKey = shellEnvironment.keys.firstOrNull { it.equals("PATH", ignoreCase = true) } ?: "Path"
        val home = (shellEnvironment["USERPROFILE"] ?: userHome).trimEnd('\\', '/')
        val extra = listOfNotNull("$home\\.local\\bin",
            shellEnvironment["APPDATA"]?.trimEnd('\\', '/')?.let { "$it\\npm" })
        val paths = (shellEnvironment[pathKey].orEmpty().split(';').filter { it.isNotBlank() } + extra)
            .distinctBy { it.lowercase() }
        return shellEnvironment + (pathKey to paths.joinToString(";"))
    }
    if (!osName.lowercase().contains("mac")) return shellEnvironment
    val home = (shellEnvironment["HOME"] ?: userHome).trimEnd('/')
    // Append even when these directories do not exist yet: native installers can
    // create them while IDEA is running. Keep the user's shell PATH precedence.
    val paths = (shellEnvironment["PATH"].orEmpty().split(':').filter { it.isNotBlank() } +
        listOf("$home/.local/bin", "$home/.hermes/node/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"))
        .distinct()
    return shellEnvironment + ("PATH" to paths.joinToString(":"))
}
