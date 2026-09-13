package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class LocalEndpointTest {
    @Test fun `only private listener endpoints are accepted`() {
        for (url in listOf("https://127.0.0.1:1234", "http://example.com:1234", "http://127.0.0.1", "http://user@127.0.0.1:1234", "http://127.0.0.1:1234/?token=x")) {
            assertTrue(url, runCatching { LocalEndpoint.parse(url) }.isFailure)
        }
        val base = LocalEndpoint.parse("http://127.0.0.1:1234")
        assertTrue(LocalEndpoint.sameOrigin(base, "http://127.0.0.1:1234/?root=test"))
        assertFalse(LocalEndpoint.sameOrigin(base, "http://127.0.0.1:1235/"))
        assertFalse(LocalEndpoint.sameOrigin(base, "file:///etc/passwd"))
    }

    @Test fun `IDE file requests cannot escape the project`() {
        val parent = Files.createTempDirectory("idea-agent-test")
        val root = Files.createDirectory(parent.resolve("project"))
        val inside = Files.writeString(root.resolve("Example.kt"), "class Example")
        val outside = Files.writeString(parent.resolve("secret.txt"), "outside")
        try {
            assertEquals(inside.toRealPath(), LocalEndpoint.projectFile(root, "Example.kt"))
            assertTrue(runCatching { LocalEndpoint.projectFile(root, "../secret.txt") }.isFailure)
            assertTrue(runCatching { LocalEndpoint.projectFile(root, outside.toString()) }.isFailure)
        } finally {
            Files.delete(inside); Files.delete(outside); Files.delete(root); Files.delete(parent)
        }
    }
}
