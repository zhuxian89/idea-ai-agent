package dev.ideaagent

import com.google.gson.Gson
import com.sun.net.httpserver.HttpServer
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class StandaloneReleaseTest {
    private fun release(version: String, platform: String = "windows-amd64", checksum: Boolean = true, draft: Boolean = false): Map<String, Any> {
        val archive = "local-ai-agent-$version-$platform.${if (platform.startsWith("windows")) "zip" else "tar.gz"}"
        return mapOf("tag_name" to "standalone-v$version", "draft" to draft, "prerelease" to true,
            "assets" to (listOf(mapOf("name" to archive)) + if (checksum) listOf(mapOf("name" to "$archive.sha256")) else emptyList()))
    }

    @Test fun selectsNewestCompletePlatformReleaseIncludingPublishedPrereleases() {
        val json = Gson().toJson(listOf(
            release("0.1.26-standalone.9"), release("0.1.26-standalone.11", checksum = false),
            release("0.1.26-standalone.10"), release("0.1.26-standalone.12", draft = true),
            release("0.1.26-standalone.20", "macos-arm64"), release("../invalid"),
            mapOf("tag_name" to "plugin-v9.0.0", "assets" to emptyList<String>()),
        ))
        assertEquals("0.1.26-standalone.10", selectStandaloneRelease(json, "windows-amd64"))
        assertEquals("0.1.26-standalone.20", selectStandaloneRelease(json, "macos-arm64"))
        assertTrue(standaloneUpdateAvailable("0.1.26-standalone.9", "0.1.26-standalone.10"))
        assertFalse(standaloneUpdateAvailable("0.1.26-standalone.10", "0.1.26-standalone.10"))
        assertFalse(standaloneUpdateAvailable("0.1.26-standalone.20", "0.1.26-standalone.10"))
        assertFalse(standaloneUpdateAvailable("0.1.26", "0.1.26-standalone.99"))
        assertThrows(IllegalStateException::class.java) { selectStandaloneRelease(json, "linux-arm64") }
    }

    @Test fun eachCheckDiscoversNewReleasesAndReportsHttpAndPayloadErrors() {
        val body = AtomicReference(Gson().toJson(listOf(release("0.1.26-standalone.51"))))
        val status = AtomicInteger(200)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/releases") { exchange ->
            val bytes = body.get().toByteArray()
            exchange.sendResponseHeaders(status.get(), bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val endpoint = URI("http://127.0.0.1:${server.address.port}/releases")
            assertEquals("0.1.26-standalone.51", latestStandaloneVersion(endpoint, "windows-amd64"))
            body.set(Gson().toJson(listOf(release("0.1.26-standalone.52"))))
            assertEquals("0.1.26-standalone.52", latestStandaloneVersion(endpoint, "windows-amd64"))
            status.set(403)
            assertTrue(assertThrows(IllegalStateException::class.java) { latestStandaloneVersion(endpoint, "windows-amd64") }.message!!.contains("403"))
            status.set(200); body.set("not json")
            assertThrows(Exception::class.java) { latestStandaloneVersion(endpoint, "windows-amd64") }
        } finally { server.stop(0) }
    }
}
