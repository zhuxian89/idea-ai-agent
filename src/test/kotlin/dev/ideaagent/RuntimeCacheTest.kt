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

    private fun testRuntime(source: Path): Path {
        Files.createDirectories(source.resolve("web"))
        Files.writeString(source.resolve("web/index.html"), "web-v1")
        Files.writeString(source.resolve("agents.json"), "{}")
        Files.writeString(source.resolve("idea-agent-windows-amd64.exe"), "windows-amd64")
        Files.writeString(source.resolve("idea-agent-darwin-arm64"), "darwin-arm64")
        return source
    }
}
