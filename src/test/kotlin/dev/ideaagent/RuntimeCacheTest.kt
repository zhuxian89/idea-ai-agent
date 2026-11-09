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

    private fun testRuntime(source: Path): Path {
        Files.createDirectories(source.resolve("web"))
        Files.writeString(source.resolve("web/index.html"), "web-v1")
        Files.writeString(source.resolve("agents.json"), "{}")
        Files.writeString(source.resolve("idea-agent-windows-amd64.exe"), "windows-amd64")
        Files.writeString(source.resolve("idea-agent-darwin-arm64"), "darwin-arm64")
        return source
    }
}
