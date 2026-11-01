package dev.ideaagent

import com.sun.net.httpserver.HttpServer
import dev.ideaagent.remote.RemoteHostProtocolException
import dev.ideaagent.remote.RemoteHostSupervisor
import dev.ideaagent.remote.remoteHostAvailable
import dev.ideaagent.remote.remoteHostDataDir
import dev.ideaagent.remote.remoteHostProcess
import dev.ideaagent.remote.needsRemoteHostUpgrade
import dev.ideaagent.remote.requireLegacyHostExecutable
import dev.ideaagent.remote.parseWindowsListenerPid
import dev.ideaagent.remote.readRunningRemoteHost
import dev.ideaagent.remote.stopRemoteHostForUpgrade
import dev.ideaagent.remote.ensureRemoteHost
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class RemoteHostTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun unversionedHostIsReplacedWithNewAssetsAndItsIdentityIsPreserved() {
        val runtime = System.getenv("IDE_AGENT_UPGRADE_TEST_RUNTIME")
        org.junit.Assume.assumeTrue("Requires a host-platform test runtime", !runtime.isNullOrBlank())
        val base = temporary.root.toPath()
        val oldCache = base.resolve("idea-ai-agent/runtime/" + "a".repeat(64))
        val newCache = base.resolve("idea-ai-agent/runtime/" + "b".repeat(64))
        val os = if (System.getProperty("os.name").lowercase().startsWith("windows")) "windows" else "darwin"
        val arch = if (System.getProperty("os.arch") in listOf("aarch64", "arm64")) "arm64" else "amd64"
        val name = "idea-agent-$os-$arch" + if (os == "windows") ".exe" else ""
        for ((cache, marker) in listOf(oldCache to "old", newCache to "new")) {
            Files.createDirectories(cache.resolve("web"))
            Files.copy(Path.of(runtime!!), cache.resolve(name))
            cache.resolve(name).toFile().setExecutable(true)
            Files.writeString(cache.resolve(".complete"), cache.fileName.toString())
            Files.writeString(cache.resolve("web/index.html"), marker)
        }
        val data = base.resolve("remote")
        val environment = mapOf("PATH" to "", "HOME" to base.toString(), "MINDFS_RELAY_BASE_URL" to "http://127.0.0.1:1")
        val legacy = remoteHostProcess(oldCache.resolve(name), data, environment).start()
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
            while (readRunningRemoteHost(data) == null && System.nanoTime() < deadline) Thread.sleep(100)
            assertEquals("", requireNotNull(readRunningRemoteHost(data)).version)
            val key = Files.readString(data.resolve("e2ee.json"))
            ensureRemoteHost(newCache.resolve(name), data, "0.1.25-local.4")
            assertFalse(legacy.isAlive)
            val upgraded = requireNotNull(readRunningRemoteHost(data))
            try {
                assertEquals("0.1.25-local.4", upgraded.version)
                assertEquals(key, Files.readString(data.resolve("e2ee.json")))
                // An older IDEA window must reuse the upgraded process.
                ensureRemoteHost(oldCache.resolve(name), data, "0.1.25-local.3")
                assertEquals(upgraded.token, requireNotNull(readRunningRemoteHost(data)).token)
            } finally { stopRemoteHostForUpgrade(upgraded, data) }
        } finally {
            if (legacy.isAlive) legacy.destroyForcibly()
            legacy.waitFor(5, TimeUnit.SECONDS)
        }
    }

    @Test fun hostUpgradeNeverDowngradesANewerWindowOrMarketplaceRelease() {
        assertTrue(needsRemoteHostUpgrade("", "0.1.25-local.4"))
        assertTrue(needsRemoteHostUpgrade("0.1.25-local.3", "0.1.25-local.4"))
        assertTrue(needsRemoteHostUpgrade("0.1.25-local.9", "0.1.25-local.10"))
        assertTrue(needsRemoteHostUpgrade("0.1.25-local.4", "0.1.25"))
        assertFalse(needsRemoteHostUpgrade("0.1.25", "0.1.25-local.4"))
        assertFalse(needsRemoteHostUpgrade("0.1.25-local.4", "0.1.25-local.3"))
        assertFalse(needsRemoteHostUpgrade("0.1.26-local.1", "0.1.25"))
        assertFalse(needsRemoteHostUpgrade("0.1.25-local.4", "0.1.25-local.4"))
        assertThrows(IllegalArgumentException::class.java) { needsRemoteHostUpgrade("unknown", "0.1.25") }
    }

    @Test fun legacyUpgradeOnlyTargetsTheExactListenerAndCompletedCachedHost() {
        val output = """
            TCP  127.0.0.1:3145  0.0.0.0:0  LISTENING  111
            TCP  127.0.0.1:31450  0.0.0.0:0  LISTENING  222
            TCP  127.0.0.1:3145  127.0.0.1:4555  ESTABLISHED  333
            TCP  0.0.0.0:3145  0.0.0.0:0  LISTENING  444
        """.trimIndent()
        assertEquals(111L, parseWindowsListenerPid(output, 3145))
        assertThrows(IllegalStateException::class.java) { parseWindowsListenerPid(output, 9) }
        val fingerprint = "a".repeat(64)
        val cache = temporary.root.toPath().resolve("idea-ai-agent/runtime/$fingerprint")
        Files.createDirectories(cache)
        val executable = Files.createFile(cache.resolve("idea-agent-windows-amd64.exe"))
        Files.writeString(cache.resolve(".complete"), fingerprint)
        requireLegacyHostExecutable(executable, arrayOf("--remote-host"))
        requireLegacyHostExecutable(executable, null) // Windows ProcessHandle may omit arguments.
        assertThrows(IllegalStateException::class.java) { requireLegacyHostExecutable(executable, arrayOf("--local-only")) }
        assertThrows(IllegalStateException::class.java) { requireLegacyHostExecutable(executable, emptyArray()) }
        Files.writeString(cache.resolve(".complete"), "incomplete")
        assertThrows(IllegalStateException::class.java) { requireLegacyHostExecutable(executable, arrayOf("--remote-host")) }
    }

    @Test fun versionedUpgradeAuthenticatesAndDoesNotDisableOrRebindTheNode() {
        val data = temporary.newFolder("versioned").toPath()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val stops = AtomicInteger()
        server.createContext("/control/status") { exchange ->
            assertEquals("Bearer upgrade-secret", exchange.requestHeaders.getFirst("Authorization"))
            val body = "{\"protocol\":1,\"runtime_version\":\"0.1.25-local.3\"}".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/control/upgrade-stop") { exchange ->
            assertEquals("POST", exchange.requestMethod)
            assertEquals("Bearer upgrade-secret", exchange.requestHeaders.getFirst("Authorization"))
            assertEquals("{\"runtime_version\":\"0.1.25-local.3\"}", exchange.requestBody.bufferedReader().use { it.readText() })
            stops.incrementAndGet()
            Files.delete(data.resolve("host.json"))
            exchange.sendResponseHeaders(200, 2)
            exchange.responseBody.use { it.write("{}".toByteArray()) }
        }
        server.start()
        try {
            Files.writeString(data.resolve("host.json"), "{\"protocol\":1,\"url\":\"http://127.0.0.1:${server.address.port}\",\"token\":\"upgrade-secret\"}")
            val host = requireNotNull(readRunningRemoteHost(data))
            assertEquals("0.1.25-local.3", host.version)
            stopRemoteHostForUpgrade(host, data)
            assertEquals(1, stops.get())
        } finally { server.stop(0) }
    }

    @Test fun sharedIdentityUsesTheOsUserDirectoryInsteadOfProjectOrIdeVersion() {
        val user = temporary.newFolder("user with spaces").toPath()
        assertEquals(user.resolve("Library/Application Support/LocalAIAgent/remote"),
            remoteHostDataDir("Mac OS X", user.toString(), mapOf("IDE_AGENT_DATA_DIR" to "/old-project")))
        val roaming = user.resolve("AppData/Roaming")
        assertEquals(roaming.resolve("LocalAIAgent/remote"),
            remoteHostDataDir("Windows 11", user.toString(), mapOf("AppData" to roaming.toString())))
        assertThrows(IllegalArgumentException::class.java) {
            remoteHostDataDir("Windows 11", user.toString(), emptyMap())
        }
    }

    @Test fun hostLaunchIsIndependentOfProjectAndDoesNotCarryTheIdeaCredential() {
        val executable = temporary.root.toPath().resolve("runtime/idea-agent")
        val data = temporary.root.toPath().resolve("shared remote")
        val environment = mapOf("PATH" to "/custom/bin", "IDE_AGENT_TOKEN" to "old-private-token",
            "IDE_AGENT_DATA_DIR" to "/old-project", "IDE_AGENT_REMOTE_HOST_DIR" to "/old-host",
            "MINDFS_STATIC_DIR" to "/old-assets")
        val host = remoteHostProcess(executable, data, environment)
        assertEquals(listOf(executable.toString(), "--remote-host"), host.command())
        assertNull(host.environment()["IDE_AGENT_TOKEN"])
        assertNull(host.environment()["IDE_AGENT_DATA_DIR"])
        assertEquals(data.toString(), host.environment()["IDE_AGENT_REMOTE_HOST_DIR"])
        assertEquals(executable.parent.resolve("web").toString(), host.environment()["MINDFS_STATIC_DIR"])
        assertEquals(ProcessBuilder.Redirect.DISCARD, host.redirectOutput())
        assertEquals(ProcessBuilder.Redirect.DISCARD, host.redirectError())
        assertEquals("old-private-token", environment["IDE_AGENT_TOKEN"])
    }

    @Test fun healthAuthenticatesTheDescriptorAndRejectsIncompatibleHostWithoutLeakingToRedirects() {
        val data = temporary.newFolder("remote").toPath()
        assertFalse(remoteHostAvailable(data))
        val calls = AtomicInteger()
        val status = AtomicInteger(200)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/control/status") { exchange ->
            calls.incrementAndGet()
            assertEquals("Bearer test-secret", exchange.requestHeaders.getFirst("Authorization"))
            val body = "{\"protocol\":1}".toByteArray()
            exchange.responseHeaders.add("Location", "/must-not-follow")
            exchange.sendResponseHeaders(status.get(), body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.createContext("/must-not-follow") { exchange ->
            fail("Host credential must not be forwarded through redirects")
            exchange.close()
        }
        server.start()
        try {
            val descriptor = data.resolve("host.json")
            Files.writeString(descriptor, "{\"protocol\":1,\"url\":\"http://127.0.0.1:${server.address.port}\",\"token\":\"test-secret\"}")
            assertTrue(remoteHostAvailable(data))
            status.set(302)
            assertThrows(IllegalStateException::class.java) { remoteHostAvailable(data) }
            assertEquals(2, calls.get())
            Files.writeString(descriptor, "{\"protocol\":2,\"url\":\"http://127.0.0.1:${server.address.port}\",\"token\":\"test-secret\"}")
            assertThrows(RemoteHostProtocolException::class.java) { remoteHostAvailable(data) }
            assertEquals(2, calls.get())
            Files.writeString(descriptor, "{\"protocol\":1,\"url\":\"https://example.com\",\"token\":\"test-secret\"}")
            assertThrows(IllegalArgumentException::class.java) { remoteHostAvailable(data) }
            assertEquals(2, calls.get())
        } finally {
            server.stop(0)
        }
    }

    @Test fun releasingTheFirstProjectDoesNotStopOtherProjectsAndLastReleaseStopsSupervision() {
        val firstCheck = CountDownLatch(1)
        val releaseCheck = CountDownLatch(1)
        val nextCheck = CountDownLatch(1)
        val calls = AtomicInteger()
        val supervisor = RemoteHostSupervisor({ _, _ ->
            if (calls.incrementAndGet() == 1) {
                firstCheck.countDown()
                assertTrue(releaseCheck.await(3, TimeUnit.SECONDS))
            } else nextCheck.countDown()
        }, { throw AssertionError(it) }, 20)
        try {
            val first = supervisor.acquire(Path.of("idea-A/runtime"), temporary.root.toPath())
            assertTrue(firstCheck.await(3, TimeUnit.SECONDS))
            val second = supervisor.acquire(Path.of("idea-B/runtime"), temporary.root.toPath())
            val third = supervisor.acquire(Path.of("idea-C/runtime"), temporary.root.toPath())
            first.close()
            assertEquals(1, calls.get()) // No parallel launcher while the first check is running.
            releaseCheck.countDown()
            assertTrue(nextCheck.await(3, TimeUnit.SECONDS))
            second.close()
            third.close()
            Thread.sleep(60) // Let any in-flight check finish before measuring the stopped supervisor.
            val afterRelease = calls.get()
            Thread.sleep(60)
            assertEquals(afterRelease, calls.get())
        } finally {
            releaseCheck.countDown()
            supervisor.close()
        }
    }

    @Test fun startupFailureDoesNotFailAcquiringALocalProjectAndIsRetried() {
        val recovered = CountDownLatch(1)
        val failures = AtomicInteger()
        val calls = AtomicInteger()
        val supervisor = RemoteHostSupervisor({ _, _ ->
            if (calls.incrementAndGet() == 1) error("host unavailable")
            recovered.countDown()
        }, { failures.incrementAndGet() }, 20)
        try {
            val lease = supervisor.acquire(Path.of("runtime"), temporary.root.toPath())
            assertTrue(recovered.await(3, TimeUnit.SECONDS))
            assertEquals(1, failures.get())
            lease.close()
        } finally {
            supervisor.close()
        }
    }
}
