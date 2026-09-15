package dev.ideaagent

import com.sun.net.httpserver.HttpServer
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class VoiceInputTest {
    @Test fun `events identify the provider pinned to this recording even when saved selection changes`() {
        val events = LinkedBlockingQueue<VoiceInputEvent>()
        val selected = java.util.concurrent.atomic.AtomicReference(siliconVoiceConfig("test-key"))
        val fake = object : VoiceCapture {
            override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray {
                onLevel(0.2, 100)
                while (!stopped()) Thread.sleep(5)
                return byteArrayOf(1)
            }
            override fun close() {}
        }
        VoiceInputController(selected::get, events::add, { fake }, { config, _ ->
            assertEquals(VoiceProvider.SILICONFLOW, config.provider)
            "text"
        }).use { controller ->
            controller.start("provider")
            val starting = events.poll(2, TimeUnit.SECONDS)
            assertEquals("starting", starting.state)
            assertEquals("siliconflow", starting.provider)
            assertEquals("siliconflow", events.poll(2, TimeUnit.SECONDS).provider)
            selected.set(VoiceServiceConfig(TENCENT_VOICE_ENDPOINT, TENCENT_VOICE_MODEL, provider = VoiceProvider.TENCENT))
            controller.stop("provider")
            for (state in listOf("transcribing", "done")) {
                val event = events.poll(2, TimeUnit.SECONDS)
                assertEquals(state, event.state)
                assertEquals("siliconflow", event.provider)
                assertFalse(com.google.gson.Gson().toJson(event).contains("test-key"))
                assertFalse(com.google.gson.Gson().toJson(event).contains("SenseVoiceSmall"))
            }
        }
    }

    @Test fun `pcm level reflects silence and actual sample magnitude`() {
        assertEquals(0.0, pcmLevel(ByteArray(100), 100), 0.0001)
        assertEquals(1.0, pcmLevel(byteArrayOf(0, 64, 0, 64), 4), 0.0001)
        assertEquals(0.5, pcmLevel(byteArrayOf(0, 16, 0, 16), 4), 0.0001)
    }

    @Test fun `unconfigured input never opens microphone`() {
        val events = LinkedBlockingQueue<VoiceInputEvent>()
        VoiceInputController({ null }, events::add, { error("must not open") }).use {
            it.start("missing")
            assertEquals("starting", events.poll(2, TimeUnit.SECONDS).state)
            assertEquals("configuration", events.poll(2, TimeUnit.SECONDS).state)
        }
    }

    @Test fun `stop transcribes once and returns text without agent send`() {
        val events = LinkedBlockingQueue<VoiceInputEvent>()
        val opened = CountDownLatch(1)
        val closed = AtomicBoolean()
        val fake = object : VoiceCapture {
            override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray {
                opened.countDown()
                onLevel(0.5, 100)
                while (!stopped()) Thread.sleep(5)
                return byteArrayOf(1, 2, 3)
            }
            override fun close() { closed.set(true) }
        }
        VoiceInputController({ VoiceServiceConfig("http://localhost/test", "speech") }, events::add, { fake }, { _, audio ->
            assertArrayEquals(byteArrayOf(1, 2, 3), audio); "识别文字"
        }).use {
            it.start("one"); assertTrue(opened.await(2, TimeUnit.SECONDS)); it.stop("other")
            it.stop("one")
            val received = (1..4).map { events.poll(2, TimeUnit.SECONDS) }
            assertEquals(listOf("starting", "recording", "transcribing", "done"), received.map { it.state })
            assertEquals("识别文字", received.last().text)
            assertTrue(closed.get())
        }
    }

    @Test fun `cancel suppresses late transcription and releases capture`() {
        val events = LinkedBlockingQueue<VoiceInputEvent>()
        val reached = CountDownLatch(1)
        val release = CountDownLatch(1)
        val fake = object : VoiceCapture {
            override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit) = byteArrayOf(1)
            override fun close() {}
        }
        VoiceInputController({ VoiceServiceConfig("http://localhost/test", "speech") }, events::add, { fake }, { _, _ ->
            reached.countDown()
            try { release.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) { }
            "late text"
        }).use {
            it.start("cancelled"); assertTrue(reached.await(2, TimeUnit.SECONDS)); it.cancel("cancelled"); release.countDown()
            assertEquals("starting", events.poll(2, TimeUnit.SECONDS).state)
            assertEquals("transcribing", events.poll(2, TimeUnit.SECONDS).state)
            assertNull(events.poll(150, TimeUnit.MILLISECONDS))
        }
    }

    @Test fun `transcription sends multipart to configured endpoint and does not follow redirects`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var request = ""
        var auth = ""
        server.createContext("/transcribe") { exchange ->
            request = String(exchange.requestBody.readBytes(), Charsets.ISO_8859_1)
            auth = exchange.requestHeaders.getFirst("Authorization")
            val response = "{\"text\":\" 你好，世界 \"}".toByteArray()
            exchange.sendResponseHeaders(200, response.size.toLong()); exchange.responseBody.use { it.write(response) }
        }
        server.createContext("/redirect") { exchange ->
            exchange.responseHeaders.add("Location", "/transcribe"); exchange.sendResponseHeaders(302, -1); exchange.close()
        }
        server.start()
        try {
            val base = "http://127.0.0.1:${server.address.port}"
            assertEquals("你好，世界", transcribeVoice(VoiceServiceConfig("$base/transcribe", "my-speech-model", "test-only-key"), byteArrayOf(82, 73, 70, 70)))
            assertTrue(request.contains("name=\"model\"\r\n\r\nmy-speech-model"))
            assertTrue(request.contains("filename=\"recording.wav\""))
            assertTrue(request.contains("Content-Type: audio/wav"))
            assertEquals("Bearer test-only-key", auth)
            try { transcribeVoice(VoiceServiceConfig("$base/redirect", "model"), byteArrayOf(1)); fail("followed redirect") }
            catch (e: VoiceFailure) { assertEquals("service", e.code) }
        } finally { server.stop(0) }
    }

    @Test fun `service errors do not leak response secrets`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            val response = "secret internal diagnostic".toByteArray()
            exchange.sendResponseHeaders(401, response.size.toLong()); exchange.responseBody.use { it.write(response) }
        }
        server.start()
        try {
            try { transcribeVoice(VoiceServiceConfig("http://127.0.0.1:${server.address.port}/", "m"), byteArrayOf(1)); fail() }
            catch (e: VoiceFailure) { assertEquals("authentication", e.message) }
        } finally { server.stop(0) }
    }

    @Test fun `only encrypted remote endpoints or local HTTP are accepted`() {
        validateVoiceEndpoint("https://speech.example/v1/audio/transcriptions")
        validateVoiceEndpoint("http://localhost:8080/v1/audio/transcriptions")
        for (url in listOf("http://remote.example/transcribe", "https://user:secret@example.com/transcribe", "file:///tmp/a", "https://example.com/?key=secret")) {
            try { validateVoiceEndpoint(url); fail(url) } catch (_: IllegalArgumentException) { }
        }
    }
}
