package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Flow
import java.util.concurrent.TimeUnit
import javax.swing.SwingUtilities
import javax.swing.event.HyperlinkEvent
import java.net.URL

class SiliconVoiceTest {
    @Test fun `preset pins endpoint and model and sends the documented multipart contract`() {
        val request = multipartVoiceRequest(VoiceServiceConfig("https://wrong.invalid", "wrong-model", "silicon-test-key",
            VoiceProvider.SILICONFLOW, "tencent-id", "tencent-secret"), byteArrayOf(82, 73, 70, 70))
        assertEquals(SILICON_VOICE_ENDPOINT, request.uri().toString())
        assertEquals("Bearer silicon-test-key", request.headers().firstValue("Authorization").get())
        val bytes = ByteArrayOutputStream()
        val done = CompletableFuture<Unit>()
        request.bodyPublisher().get().subscribe(object : Flow.Subscriber<ByteBuffer> {
            override fun onSubscribe(subscription: Flow.Subscription) = subscription.request(Long.MAX_VALUE)
            override fun onNext(buffer: ByteBuffer) { val chunk = ByteArray(buffer.remaining()); buffer.get(chunk); bytes.write(chunk) }
            override fun onError(error: Throwable) { done.completeExceptionally(error) }
            override fun onComplete() { done.complete(Unit) }
        })
        done.get(2, TimeUnit.SECONDS)
        val body = bytes.toString("UTF-8")
        assertTrue(body.contains("name=\"model\"\r\n\r\nFunAudioLLM/SenseVoiceSmall"))
        assertTrue(body.contains("Content-Type: audio/wav\r\n\r\nRIFF"))
        assertFalse(body.contains("free-asr-model"))
        assertFalse(body.contains("tencent-secret"))
        assertFalse(body.contains("wrong-model"))
        assertEquals(120, siliconVoiceConfig("key").maxRecordingSeconds)
    }

    @Test fun `provider selection survives reload and preserves custom settings`() {
        val settings = VoiceSettings()
        settings.loadState(VoiceSettings.Settings("http://localhost/transcribe", "custom-model", "siliconflow"))
        assertEquals(VoiceProvider.SILICONFLOW, settings.state.selectedProvider())
        assertEquals("http://localhost/transcribe", settings.state.endpoint)
        assertEquals("custom-model", settings.state.model)
        assertEquals(VoiceProvider.TENCENT, VoiceSettings.Settings(provider = "tencent").selectedProvider())
        assertEquals(VoiceProvider.CUSTOM, VoiceSettings.Settings("http://localhost/test", "legacy").selectedProvider())
    }

    @Test fun `only silicon key is required and provider drafts remain isolated`() {
        SwingUtilities.invokeAndWait {
            val form = VoiceSettingsForm(VoiceSettings.Settings(provider = "siliconflow"), "saved-id", true, false) {}
            assertTrue(form.siliconPanel.isVisible)
            assertFalse(form.siliconEndpoint.isEditable)
            assertFalse(form.siliconModel.isEditable)
            assertEquals(SILICON_VOICE_ENDPOINT, form.siliconEndpoint.text)
            assertEquals(SILICON_VOICE_MODEL, form.siliconModel.text)
            assertNotNull(form.validateInput())
            form.siliconApiKey.text = "silicon-key"
            assertNull(form.validateInput())
            assertEquals("silicon-key", form.draftConfig("tencent-key", "custom-key").apiKey)
            form.provider.selectedItem = VoiceProvider.TENCENT
            assertEquals("tencent-key", form.draftConfig("tencent-key", "custom-key").secretKey)
            form.provider.selectedItem = VoiceProvider.CUSTOM
            form.endpoint.text = "http://localhost/asr"
            form.model.text = "custom"
            form.apiKey.text = "entered-custom-key"
            form.provider.selectedItem = VoiceProvider.SILICONFLOW
            assertEquals("silicon-key", form.draftConfig("tencent-key", "custom-key").apiKey)
            form.setInputEnabled(false)
            assertFalse(form.siliconApiKey.isEnabled)
            form.clearPasswords()
            assertEquals(0, form.siliconApiKey.password.size)
            assertEquals(0, form.apiKey.password.size)
            val saved = VoiceSettingsForm(VoiceSettings.Settings(provider = "siliconflow"), "", false, false, true) {}
            assertNull(saved.validateInput())
            assertEquals("saved-silicon", saved.draftConfig("tencent-key", "custom-key", "saved-silicon").apiKey)
            saved.siliconApiKey.text = "bad\nkey"
            assertNotNull(saved.validateInput())
        }
    }

    @Test fun `free pricing and account guidance remain visible with working official links`() {
        SwingUtilities.invokeAndWait {
            for (english in listOf(false, true)) {
                val links = mutableListOf<String>()
                val form = VoiceSettingsForm(VoiceSettings.Settings(provider = "siliconflow"), "", false, english, openLink = links::add)
                val text = form.help.document.getText(0, form.help.document.length)
                assertTrue(text.contains(if (english) "currently free" else "当前免费"))
                assertTrue(text.contains(if (english) "identity verification" else "实名认证"))
                assertTrue(text.contains("120"))
                for (link in VoiceSettingsForm.siliconHelpLinks) {
                    assertTrue(form.help.text.contains(link))
                    form.help.hyperlinkListeners.forEach { it.hyperlinkUpdate(HyperlinkEvent(form.help, HyperlinkEvent.EventType.ACTIVATED, URL(link))) }
                }
                assertEquals(VoiceSettingsForm.siliconHelpLinks, links.toSet())
                VoiceTestPanel(english, { error("must not record") }, { "missing" }).use { panel ->
                    val body = voiceSettingsContent(form, panel)
                    body.setSize(body.preferredSize)
                    fun layout(component: java.awt.Container) {
                        component.doLayout()
                        component.components.filterIsInstance<java.awt.Container>().forEach(::layout)
                    }
                    layout(body)
                    assertTrue(panel.bounds.maxY <= body.height)
                    if (System.getenv("VOICE_CAPTURE_SETTINGS") == "1") {
                        val image = java.awt.image.BufferedImage(body.width, body.height, java.awt.image.BufferedImage.TYPE_INT_RGB)
                        image.createGraphics().let { graphics -> body.printAll(graphics); graphics.dispose() }
                        val target = java.nio.file.Path.of("build/reports/silicon-voice/settings-${if (english) "en" else "zh"}.png")
                        java.nio.file.Files.createDirectories(target.parent)
                        javax.imageio.ImageIO.write(image, "png", target.toFile())
                    }
                }
            }
        }
    }
}
