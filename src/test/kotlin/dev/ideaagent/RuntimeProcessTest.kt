package dev.ideaagent

import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class RuntimeProcessTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun terminalInstallationsAreFoundByTheRuntimeAndItsChildren() {
        val root = temporary.root.toPath()
        val nodeBin = Files.createDirectories(root.resolve("user with spaces/.hermes/node/bin"))
        val localBin = Files.createDirectories(root.resolve("user with spaces/.local/bin"))
        val windows = System.getProperty("os.name").startsWith("Windows")
        for ((name, bin) in listOf("codex" to nodeBin, "node" to nodeBin, "claude" to localBin)) {
            val script = bin.resolve(name + if (windows) ".cmd" else "")
            Files.writeString(script, if (windows) "@echo $name\r\n" else "#!/bin/sh\nprintf '%s\\n' '$name'\n")
            if (!windows) assertTrue(script.toFile().setExecutable(true, true))
        }
        val shellEnvironment = HashMap(System.getenv())
        shellEnvironment.keys.removeIf { it.equals("PATH", ignoreCase = true) }
        val systemPath = if (windows) Path.of(System.getenv("SystemRoot"), "System32").toString() else "/usr/bin:/bin"
        shellEnvironment["PATH"] = listOf(nodeBin.toString(), localBin.toString(), systemPath).joinToString(File.pathSeparator)
        shellEnvironment["IDE_AGENT_TEST_SHELL_VALUE"] = "terminal custom value"

        withShellEnvironment(shellEnvironment) {
            val builder = runtimeProcess(root.resolve("runtime"), root, root.resolve("data"), "test-token")
            // Substitute a harmless probe for the Go executable, preserving the real launch environment.
            val java = Path.of(System.getProperty("java.home"), "bin", if (windows) "java.exe" else "java")
            val classes = Files.createDirectories(root.resolve("probe-classes"))
            val classFile = classes.resolve("dev/ideaagent/RuntimeEnvironmentProbe.class")
            Files.createDirectories(classFile.parent)
            requireNotNull(RuntimeEnvironmentProbe::class.java.getResourceAsStream("/dev/ideaagent/RuntimeEnvironmentProbe.class"))
                .use { Files.copy(it, classFile) }
            builder.command(java.toString(), "-cp", classes.toString(), RuntimeEnvironmentProbe::class.java.name)
            val child = builder.redirectErrorStream(true).start()
            try {
                assertTrue("Runtime probe timed out", child.waitFor(20, TimeUnit.SECONDS))
                val output = child.inputStream.bufferedReader().readText()
                assertEquals(output, 0, child.exitValue())
                assertEquals(listOf("codex", "claude", "node"), output.lineSequence().filter { it.isNotBlank() }.toList())
            } finally {
                if (child.isAlive) child.destroyForcibly().waitFor(5, TimeUnit.SECONDS)
            }
        }
    }

    @Test fun pluginPathsAndCredentialOverrideShellValuesWithoutChangingTheShellEnvironment() {
        val root = temporary.root.toPath()
        val executable = root.resolve("runtime with spaces/idea-agent")
        val project = root.resolve("project with spaces")
        val data = root.resolve("data")
        val shellEnvironment = mapOf("PATH" to "/custom/bin:/usr/bin", "CODEX_HOME" to "/custom/codex",
            "IDE_AGENT_DATA_DIR" to "stale-data", "IDE_AGENT_TOKEN" to "stale-token", "MINDFS_STATIC_DIR" to "stale-web")
        withShellEnvironment(shellEnvironment) {
            val builder = runtimeProcess(executable, project, data, "fresh-token")
            assertEquals(listOf(executable.toString(), "--project", project.toString()), builder.command())
            assertEquals(executable.parent.toFile(), builder.directory())
            assertEquals("/custom/bin:/usr/bin", builder.environment()["PATH"])
            assertEquals("/custom/codex", builder.environment()["CODEX_HOME"])
            assertEquals(data.toString(), builder.environment()["IDE_AGENT_DATA_DIR"])
            assertEquals("fresh-token", builder.environment()["IDE_AGENT_TOKEN"])
            assertEquals(executable.parent.resolve("web").toString(), builder.environment()["MINDFS_STATIC_DIR"])
            assertEquals("stale-token", EnvironmentUtil.getEnvironmentMap()["IDE_AGENT_TOKEN"])
        }
    }

    private fun withShellEnvironment(environment: Map<String, String>, action: () -> Unit) {
        // IDEA 2024.1 stores its recovered shell environment here. Only the test seeds this cache;
        // production uses the public getEnvironmentMap API. Restore it even when an assertion fails.
        val field = EnvironmentUtil::class.java.getDeclaredField("ourEnvGetter").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val cache = field.get(null) as AtomicReference<Any?>
        val previous = cache.getAndSet(CompletableDeferred(environment))
        try { action() } finally { cache.set(previous) }
    }
}
