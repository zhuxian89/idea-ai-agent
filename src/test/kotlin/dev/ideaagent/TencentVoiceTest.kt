package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.URL
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Flow
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO
import java.awt.image.BufferedImage
import javax.swing.SwingUtilities
import javax.swing.event.HyperlinkEvent

class TencentVoiceTest {
    private val config = VoiceServiceConfig("https://must-not-receive-keys.invalid", "wrong-custom-model", "custom-key", VoiceProvider.TENCENT, "AKIDTESTONLY", "test-secret-only")

    @Test fun `Tencent request uses managed defaults and TC3 signature verified by independent Python vector`() {
        val request = tencentVoiceRequest(config, byteArrayOf(82, 73, 70, 70), 1551113065)
        assertEquals(TENCENT_VOICE_ENDPOINT, request.uri().toString())
        assertEquals("SentenceRecognition", request.headers().firstValue("X-TC-Action").get())
        assertEquals("2019-06-14", request.headers().firstValue("X-TC-Version").get())
        assertEquals("1551113065", request.headers().firstValue("X-TC-Timestamp").get())
        assertEquals("application/json; charset=utf-8", request.headers().firstValue("Content-Type").get())
        val body = ByteArrayOutputStream()
        val complete = CompletableFuture<Unit>()
        request.bodyPublisher().get().subscribe(object : Flow.Subscriber<ByteBuffer> {
            override fun onSubscribe(subscription: Flow.Subscription) { subscription.request(Long.MAX_VALUE) }
            override fun onNext(buffer: ByteBuffer) { val bytes = ByteArray(buffer.remaining()); buffer.get(bytes); body.write(bytes) }
            override fun onError(error: Throwable) { complete.completeExceptionally(error) }
            override fun onComplete() { complete.complete(Unit) }
        })
        complete.get(2, TimeUnit.SECONDS)
        assertEquals("{\"EngSerViceType\":\"16k_zh\",\"SourceType\":1,\"VoiceFormat\":\"wav\",\"Data\":\"UklGRg==\",\"DataLen\":4}", body.toString("UTF-8"))
        assertEquals("TC3-HMAC-SHA256 Credential=AKIDTESTONLY/2019-02-25/asr/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=926935c433d632ea801a4300e4cf4bb3a4a972a305fe2adede2de41fd9917114", request.headers().firstValue("Authorization").get())
        assertFalse(request.headers().toString().contains("custom-key"))
        assertFalse(body.toString("UTF-8").contains("test-secret-only"))
        assertNotEquals(request.headers().firstValue("Authorization").get(), tencentVoiceAuthorization("AKIDTESTONLY", "test-secret-only", 1551113066, body.toByteArray()))
    }

    @Test fun `Tencent native response and error envelope are parsed without leaking server details`() {
        assertEquals("你好世界", parseTencentVoiceResponse("{\"Response\":{\"Result\":\" 你好世界 \",\"RequestId\":\"synthetic\"}}".toByteArray()))
        for ((code, expected) in mapOf("AuthFailure.SignatureFailure" to "tencentAuthentication", "AuthFailure.ServiceNotOpened" to "tencentActivation", "AuthFailure.SignatureExpire" to "clock", "LimitExceeded" to "rateLimit", "InvalidParameterValue.ErrorVoicedataTooLong" to "tooLong")) {
            try { parseTencentVoiceResponse("{\"Response\":{\"Error\":{\"Code\":\"$code\",\"Message\":\"secret diagnostic\"}}}".toByteArray()); fail(code) }
            catch (e: VoiceFailure) { assertEquals(expected, e.code); assertFalse(e.message!!.contains("secret diagnostic")) }
        }
        try { parseTencentVoiceResponse("{\"Response\":{\"Result\":\"\"}}".toByteArray()); fail() } catch (e: VoiceFailure) { assertEquals("empty", e.code) }
    }

    @Test fun `fresh config defaults to Tencent and old custom endpoint remains custom`() {
        assertEquals(VoiceProvider.TENCENT, VoiceSettings.Settings().selectedProvider())
        val service = VoiceSettings()
        service.loadState(VoiceSettings.Settings("http://localhost:8080/transcribe", "old-model"))
        assertEquals(VoiceProvider.CUSTOM, service.state.selectedProvider())
        assertEquals("old-model", service.state.model)
        service.loadState(service.state.copy(provider = "tencent"))
        assertEquals(VoiceProvider.TENCENT, service.state.selectedProvider())
        assertEquals("http://localhost:8080/transcribe", service.state.endpoint)
    }

    @Test fun `Tencent form needs only two credentials and provider switching preserves custom draft`() {
        SwingUtilities.invokeAndWait {
            val form = VoiceSettingsForm(VoiceSettings.Settings(), "", false, false) {}
            assertEquals(VoiceProvider.TENCENT, form.selectedProvider)
            assertTrue(form.tencentPanel.isVisible)
            assertFalse(form.customPanel.isVisible)
            assertEquals(TENCENT_VOICE_ENDPOINT, form.tencentEndpoint.text)
            assertTrue(form.tencentModel.text.contains("16k_zh"))
            assertFalse(form.tencentEndpoint.isEditable)
            assertFalse(form.tencentModel.isEditable)
            assertNotNull(form.validateInput())
            form.secretId.text = "AKIDTESTONLY"
            assertNotNull(form.validateInput())
            form.secretKey.text = "synthetic-key"
            assertNull(form.validateInput())
            form.provider.selectedItem = VoiceProvider.CUSTOM
            assertFalse(form.tencentPanel.isVisible)
            assertTrue(form.customPanel.isVisible)
            assertFalse(form.help.isVisible)
            form.endpoint.text = "http://localhost:8080/transcribe"
            form.model.text = "custom-model"
            form.apiKey.text = "custom-key"
            assertNull(form.validateInput())
            form.provider.selectedItem = VoiceProvider.TENCENT
            assertNull(form.validateInput())
            form.provider.selectedItem = VoiceProvider.CUSTOM
            assertEquals("custom-model", form.model.text)
            assertEquals("custom-key", String(form.apiKey.password))
            form.clearPasswords()
            assertEquals(0, form.secretKey.password.size)
            assertEquals(0, form.apiKey.password.size)
        }
    }

    @Test fun `saved Tencent key can be kept only for the same SecretId`() {
        SwingUtilities.invokeAndWait {
            val form = VoiceSettingsForm(VoiceSettings.Settings(), "saved-id", true, false) {}
            assertNull(form.validateInput())
            form.secretId.text = "different-id"
            assertNotNull(form.validateInput())
            form.secretKey.text = "new-key"
            assertNull(form.validateInput())
        }
    }

    @Test fun `onboarding links open their official targets and explain monthly free quota`() {
        SwingUtilities.invokeAndWait {
            val opened = mutableListOf<String>()
            val form = VoiceSettingsForm(VoiceSettings.Settings(), "", false, false, openLink = opened::add)
            val visibleText = form.help.document.getText(0, form.help.document.length)
            assertTrue(visibleText.contains("5,000"))
            assertTrue(visibleText.contains("个人日常使用通常足够"))
            assertTrue(visibleText.contains("新建密钥"))
            for (link in VoiceSettingsForm.helpLinks) {
                assertTrue(form.help.text.contains(link))
                form.help.hyperlinkListeners.forEach { it.hyperlinkUpdate(HyperlinkEvent(form.help, HyperlinkEvent.EventType.ACTIVATED, URL(link))) }
            }
            assertEquals(VoiceSettingsForm.helpLinks, opened.toSet())
            form.help.hyperlinkListeners.forEach { it.hyperlinkUpdate(HyperlinkEvent(form.help, HyperlinkEvent.EventType.ACTIVATED, URL("https://unrelated.invalid"))) }
            assertEquals(4, opened.size)
            // Render the actual Swing form once; no real account/credentials or browser is used.
            if (System.getenv("VOICE_CAPTURE_SETTINGS") == "1") {
                val size = form.preferredSize
                form.setSize(size)
                fun layout(component: java.awt.Container) { component.doLayout(); component.components.filterIsInstance<java.awt.Container>().forEach(::layout) }
                layout(form)
                val image = BufferedImage(size.width, size.height, BufferedImage.TYPE_INT_RGB)
                image.createGraphics().let { g -> form.printAll(g); g.dispose() }
                val directory = Path.of("build/reports/tencent-voice")
                Files.createDirectories(directory)
                ImageIO.write(image, "png", directory.resolve("settings-tencent.png").toFile())
            }
        }
    }

    @Test fun `Tencent capture and frontend events receive the sixty second limit`() {
        val events = LinkedBlockingQueue<VoiceInputEvent>()
        val fake = object : VoiceCapture {
            override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray { onLevel(0.2, 500); return byteArrayOf(1) }
            override fun close() {}
        }
        VoiceInputController({ config }, events::add, { value -> assertEquals(60, value.maxRecordingSeconds); fake }, { _, _ -> "text" }).use {
            it.start("duration")
            assertEquals("starting", events.poll(2, TimeUnit.SECONDS).state)
            assertEquals(60, events.poll(2, TimeUnit.SECONDS).limitSeconds)
            assertEquals("transcribing", events.poll(2, TimeUnit.SECONDS).state)
            assertEquals("done", events.poll(2, TimeUnit.SECONDS).state)
        }
    }
}
