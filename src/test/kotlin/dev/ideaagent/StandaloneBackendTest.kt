package dev.ideaagent

import com.google.gson.Gson
import com.sun.net.httpserver.HttpServer
import dev.ideaagent.remote.ensureRemoteHost
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicReference

class StandaloneBackendTest {
    @get:Rule val temporary = TemporaryFolder()

    private fun install(dir: Path) {
        Files.createDirectories(dir)
        val executable = Files.createFile(dir.resolve("local-ai-agent"))
        Files.writeString(dir.resolve("installation.json"), Gson().toJson(mapOf("executable" to executable.toString())))
    }

    @Test fun absentInstallationKeepsEmbeddedSelection() {
        val dir = temporary.root.toPath()
        assertNull(standaloneExecutable(dir))
    }

    @Test fun installationRecordIsValidatedOnlyForRemoteControl() {
        val dir = temporary.root.toPath()
        install(dir)
        assertNotNull(standaloneExecutable(dir))
        Files.delete(dir.resolve("local-ai-agent"))
        assertThrows(IllegalArgumentException::class.java) { standaloneExecutable(dir) }
    }

    @Test fun standaloneConnectsToProjectAndIsNeverReplacedByANewerPlugin() {
        val dir = temporary.root.toPath()
        install(dir)
        val token = "a".repeat(64)
        val opened = AtomicReference<String>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/control/status") { exchange ->
            assertEquals("Bearer $token", exchange.requestHeaders.getFirst("Authorization"))
            val body = """{"protocol":1,"mode":"standalone","runtime_version":"0.1.0"}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/control/open-project") { exchange ->
            assertEquals("Bearer $token", exchange.requestHeaders.getFirst("Authorization"))
            opened.set(exchange.requestBody.bufferedReader().use { it.readText() })
            val body = """{"root_id":"project-one"}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()
        try {
            val endpoint = "http://127.0.0.1:${server.address.port}"
            Files.writeString(dir.resolve("host.json"), Gson().toJson(mapOf("protocol" to 1, "url" to endpoint, "token" to token, "mode" to "standalone")))
            Files.writeString(dir.resolve("core.json"), Gson().toJson(mapOf("protocol" to 1, "url" to endpoint, "token" to token, "mode" to "core")))
            val connection = connectLocalCore(dir, dir.resolve("project-one"), dir.resolve("legacy"))
            assertEquals(endpoint, connection.endpoint.toString())
            assertEquals("project-one", connection.rootId)
            assertTrue(connection.standalone)
            assertTrue(opened.get().contains("legacy_data_dir"))
            // A nonexistent bundled executable would fail immediately if replacement were attempted.
            ensureRemoteHost(dir.resolve("missing-bundled-runtime"), dir, "99.0.0")
        } finally { server.stop(0) }
    }
}
