package dev.ideaagent

import com.google.gson.Gson
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.net.HttpURLConnection
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

class StandaloneReconnectTest : BasePlatformTestCase() {
    fun testEmbeddedChoiceKeepsLocalChatWhenRemoteSetupFails() {
        myFixture.addFileToProject("existing.txt", "existing project data")
        val dir = Path.of(requireNotNull(project.basePath)).resolve("embedded-discovery")
        Files.createDirectories(dir)
        writeBackendMode(dir.resolve("backend-preference.json"), BackendMode.EMBEDDED)
        Files.writeString(dir.resolve("installation.json"), Gson().toJson(mapOf("executable" to dir.resolve("missing-remote").toString())))
        Files.writeString(dir.resolve("host.json"), "invalid remote descriptor")
        val runtime = LocalRuntime(project)
        try {
            val first = runtime.start(dir).get(40, TimeUnit.SECONDS)
            assertFalse(first.standalone)
            val service = com.intellij.openapi.application.ApplicationManager.getApplication().getService(BackendModeService::class.java)
            assertTrue((service.state(dir, BackendMode.EMBEDDED)["setupError"] as String).isNotEmpty())
            service.save(dir, BackendMode.STANDALONE)
            assertEquals(first, runtime.start(dir).get(10, TimeUnit.SECONDS))
            assertEquals("standalone", service.state(dir, BackendMode.EMBEDDED)["selected"])
            val request = first.endpoint.resolve("/?ide_token=" + first.token).toURL().openConnection() as HttpURLConnection
            request.instanceFollowRedirects = false
            try { assertEquals(303, request.responseCode) } finally { request.disconnect() }
        } finally { runtime.dispose() }
    }

    fun testRemoteFailureDoesNotBlockPluginStartupOrReconnect() {
        myFixture.addFileToProject("existing.txt", "existing project data")
        val dir = Path.of(requireNotNull(project.basePath)).resolve("standalone-discovery")
        Files.createDirectories(dir)
        // Even an unavailable remote executable must not prevent local work.
        Files.writeString(dir.resolve("installation.json"), Gson().toJson(mapOf("executable" to dir.resolve("missing-remote").toString())))
        Files.writeString(dir.resolve("host.json"), "invalid remote descriptor")
        val runtime = LocalRuntime(project)
        try {
            val first = runtime.start(dir).get(40, TimeUnit.SECONDS)
            assertTrue(first.standalone)
            assertTrue(Files.exists(dir.resolve("core.json")))
            val request = first.endpoint.resolve("/?ide_token=" + first.token).toURL().openConnection() as HttpURLConnection
            request.instanceFollowRedirects = false
            try { assertEquals(303, request.responseCode) } finally { request.disconnect() }
            // Remote shutdown removes only host.json; the project's login survives.
            Files.delete(dir.resolve("host.json"))
            val second = runtime.start(dir).get(10, TimeUnit.SECONDS)
            assertEquals(first, second)
            val descriptor = com.google.gson.JsonParser.parseString(Files.readString(dir.resolve("core.json"))).asJsonObject
            assertEquals(first.token, descriptor.get("token").asString)
        } finally {
            runtime.dispose()
            val descriptor = com.google.gson.JsonParser.parseString(Files.readString(dir.resolve("core.json"))).asJsonObject
            val stop = java.net.URI(descriptor.get("url").asString).resolve("/control/stop").toURL().openConnection() as HttpURLConnection
            stop.requestMethod = "POST"
            stop.setRequestProperty("Authorization", "Bearer " + descriptor.get("token").asString)
            try { assertEquals(200, stop.responseCode) } finally { stop.disconnect() }
        }
    }
}
