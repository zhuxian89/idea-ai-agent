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
    builder.environment().putAll(EnvironmentUtil.getEnvironmentMap())
    builder.environment()["IDE_AGENT_DATA_DIR"] = dataDir.toString()
    builder.environment()["IDE_AGENT_TOKEN"] = token
    builder.environment()["MINDFS_STATIC_DIR"] = runtime.resolve("web").toString()
    return builder
}
