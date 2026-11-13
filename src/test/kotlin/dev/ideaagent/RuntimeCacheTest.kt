package dev.ideaagent

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RuntimeCacheTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun copiesOnlyTheSelectedRuntimeIntoAContentAddressedSystemCache() {
        val root = temporary.root.toPath()
        val source = testRuntime(root.resolve("plugin/runtime"))
        val cache = root.resolve("system cache")

        val executable = materializeRuntime(source, "idea-agent-windows-amd64.exe", cache)

        assertTrue(executable.startsWith(cache))
        assertEquals("windows-amd64", Files.readString(executable))
        assertEquals("web-v1", Files.readString(executable.parent.resolve("web/index.html")))
        assertEquals("{}", Files.readString(executable.parent.resolve("agents.json")))
        assertFalse(Files.exists(executable.parent.resolve("idea-agent-darwin-arm64")))
        assertEquals(executable, materializeRuntime(source, "idea-agent-windows-amd64.exe", cache))
    }

    @Test fun changedRuntimeUsesANewCacheWithoutOverwritingTheOldOne() {
        val root = temporary.root.toPath()
        val source = testRuntime(root.resolve("plugin/runtime"))
        val cache = root.resolve("system")
        val first = materializeRuntime(source, "idea-agent-darwin-arm64", cache)

        Files.writeString(source.resolve("web/index.html"), "web-v2")
        val second = materializeRuntime(source, "idea-agent-darwin-arm64", cache)

        assertNotEquals(first.parent, second.parent)
        assertEquals("web-v1", Files.readString(first.parent.resolve("web/index.html")))
        assertEquals("web-v2", Files.readString(second.parent.resolve("web/index.html")))
    }

    @Test fun concurrentProjectsReuseOneCompleteCache() {
        val root = temporary.root.toPath()
        val source = testRuntime(root.resolve("plugin/runtime"))
        val cache = root.resolve("system")
        val pool = Executors.newFixedThreadPool(4)
        try {
            val results = (1..8).map {
                pool.submit<Path> { materializeRuntime(source, "idea-agent-windows-amd64.exe", cache) }
            }.map { it.get(10, TimeUnit.SECONDS) }
            assertEquals(1, results.toSet().size)
            assertEquals("web-v1", Files.readString(results.first().parent.resolve("web/index.html")))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test fun updatesKeepTheCurrentAndOneRecentlyUsedRuntimeAndDeleteOlderOnes() {
        val cache = temporary.newFolder("system").toPath()
        // Built by hand: materializeRuntime prunes on every install, which would hide the ranking under test.
        val fingerprints = ('a'..'d').map { letter ->
            Files.createDirectories(cache.resolve(letter.toString().repeat(64))).also { dir ->
                Files.writeString(dir.resolve(".complete"), dir.fileName.toString())
                Files.setLastModifiedTime(dir.resolve(".complete"),
                    java.nio.file.attribute.FileTime.fromMillis(1_000_000L * (letter - 'a' + 1)))
            }
        }
        val staging = Files.createDirectories(cache.resolve(".install-other-window"))
        // The current runtime is not the newest by mtime: it is excluded from ranking, not kept by it.
        val current = fingerprints[0]
        pruneRuntimeCache(cache, current)

        assertTrue(Files.isDirectory(current))
        assertTrue("most recently used other runtime survives", Files.isDirectory(fingerprints[3]))
        assertFalse(Files.exists(fingerprints[2]))
        assertFalse(Files.exists(fingerprints[1]))
        assertTrue("a concurrent window's staging directory is never touched", Files.isDirectory(staging))
    }

    @Test fun installingANewRuntimePrunesOlderOnesAndMarksTheNewOneUsed() {
        val root = temporary.root.toPath()
        val source = testRuntime(root.resolve("plugin/runtime"))
        val cache = root.resolve("system")
        val dirs = (1..3).map { version ->
            Files.writeString(source.resolve("web/index.html"), "web-v$version")
            materializeRuntime(source, "idea-agent-darwin-arm64", cache).parent
        }
        assertFalse("two updates ago is gone", Files.exists(dirs[0]))
        assertTrue("previous version is kept for windows still running it", Files.isDirectory(dirs[1]))
        assertTrue(Files.isDirectory(dirs[2]))
        assertEquals(dirs[2], materializeRuntime(source, "idea-agent-darwin-arm64", cache).parent)
    }

    @Test fun pruningIgnoresIncompleteAndForeignDirectories() {
        val cache = temporary.newFolder("system").toPath()
        val current = Files.createDirectories(cache.resolve("c".repeat(64)))
        Files.writeString(current.resolve(".complete"), "c".repeat(64))
        val incomplete = Files.createDirectories(cache.resolve("d".repeat(64)))
        val foreign = Files.createDirectories(cache.resolve("notes"))

        pruneRuntimeCache(cache, current, keepPrevious = 0)

        assertTrue(Files.isDirectory(current))
        assertTrue("no completion marker: not ours to rank or delete", Files.isDirectory(incomplete))
        assertTrue(Files.isDirectory(foreign))
    }

    @Test fun runningCoreResourcesSurviveUpdatesAndArePrunedAfterExit() {
        val runtime = System.getenv("IDE_AGENT_UPGRADE_TEST_RUNTIME")
        org.junit.Assume.assumeTrue("Requires a host-platform test runtime", !runtime.isNullOrBlank())
        val root = temporary.root.toPath()
        val source = testRuntime(root.resolve("plugin/runtime"))
        val windows = System.getProperty("os.name").startsWith("Windows")
        val executableName = if (windows) "idea-agent-windows-amd64.exe" else "idea-agent-darwin-arm64"
        Files.copy(Path.of(runtime!!), source.resolve(executableName), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        val cache = root.resolve("system")
        val first = materializeRuntime(source, executableName, cache)
        val discovery = root.resolve("remote")
        val builder = ProcessBuilder(first.toString(), "--local-core").redirectErrorStream(true)
            .redirectOutput(root.resolve("core.log").toFile())
        builder.environment().apply {
            put("HOME", root.toString())
            put("USERPROFILE", root.toString())
            put("IDE_AGENT_REMOTE_HOST_DIR", discovery.toString())
            put("IDE_AGENT_DATA_DIR", discovery.toString())
            put("MINDFS_STATIC_DIR", first.parent.resolve("web").toString())
            put("MINDFS_RELAY_BASE_URL", "http://127.0.0.1:1")
            put("PATH", "")
            remove("IDE_AGENT_TOKEN")
        }
        val process = builder.start()
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (!Files.exists(discovery.resolve("core.json")) && process.isAlive && System.nanoTime() < deadline) {
                process.waitFor(50, TimeUnit.MILLISECONDS)
            }
            assertTrue(Files.readString(root.resolve("core.log")), Files.exists(discovery.resolve("core.json")))
            val newest = (2..3).map { version ->
                Files.writeString(source.resolve("web/index.html"), "web-v$version")
                materializeRuntime(source, executableName, cache)
            }.last()
            assertTrue(process.isAlive)
            assertTrue(Files.isRegularFile(first))
            assertEquals("web-v1", Files.readString(first.parent.resolve("web/index.html")))

            process.destroyForcibly().waitFor(5, TimeUnit.SECONDS)
            pruneRuntimeCache(cache, newest.parent)
            assertFalse("exited runtime can be reclaimed", Files.exists(first.parent))
        } finally {
            process.destroyForcibly().waitFor(5, TimeUnit.SECONDS)
        }
    }

    private fun testRuntime(source: Path): Path {
        Files.createDirectories(source.resolve("web"))
        Files.writeString(source.resolve("web/index.html"), "web-v1")
        Files.writeString(source.resolve("agents.json"), "{}")
        Files.writeString(source.resolve("idea-agent-windows-amd64.exe"), "windows-amd64")
        Files.writeString(source.resolve("idea-agent-darwin-arm64"), "darwin-arm64")
        return source
    }
}
