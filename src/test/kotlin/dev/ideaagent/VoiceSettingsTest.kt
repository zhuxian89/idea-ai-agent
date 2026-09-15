package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.swing.SwingUtilities

class VoiceSettingsTest {
    private fun edt(action: () -> Unit) = SwingUtilities.invokeAndWait(action)
    private fun until(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (System.nanoTime() < deadline) {
            var ready = false
            edt { ready = condition() }
            if (ready) return
            Thread.sleep(10)
        }
        fail("Timed out waiting for voice UI")
    }

    @Test fun `active provider summary reflects saved selection and never the unsaved form`() {
        val service = VoiceSettings()
        assertNull(service.state.activeProvider())
        service.loadState(VoiceSettings.Settings())
        assertNull(service.state.activeProvider())
        assertEquals(VoiceProvider.TENCENT, service.state.selectedProvider())
        for (provider in listOf("tencent", "siliconflow", "custom")) {
            service.loadState(VoiceSettings.Settings("http://localhost/transcribe", "local-model", provider))
            assertEquals(provider, service.state.activeProvider())
            edt {
                val form = VoiceSettingsForm(service.state.copy(), "", false, false) {}
                form.provider.selectedItem = VoiceProvider.SILICONFLOW
                assertEquals(provider, service.state.activeProvider())
            }
        }
        service.loadState(VoiceSettings.Settings("http://localhost/transcribe", "old-model"))
        assertEquals("custom", service.state.activeProvider())
        service.loadState(VoiceSettings.Settings(provider = "custom"))
        assertNull(service.state.activeProvider())
    }

    @Test fun `settings keep test controls visible below scrollable configuration`() {
        edt {
            val form = VoiceSettingsForm(VoiceSettings.Settings(), "", false, false) {}
            VoiceTestPanel(false, { error("visual fixture must not record") }, { "missing" }).use { panel ->
                val body = voiceSettingsContent(form, panel)
                body.setSize(body.preferredSize)
                fun layout(component: java.awt.Container) {
                    component.doLayout()
                    component.components.filterIsInstance<java.awt.Container>().forEach(::layout)
                }
                layout(body)
                assertTrue(panel.bounds.maxY <= body.height)
                assertTrue(panel.height > 100)
                if (System.getenv("VOICE_CAPTURE_SETTINGS") == "1") {
                    val image = java.awt.image.BufferedImage(body.width, body.height, java.awt.image.BufferedImage.TYPE_INT_RGB)
                    image.createGraphics().let { graphics -> body.printAll(graphics); graphics.dispose() }
                    val target = java.nio.file.Path.of("build/reports/voice-settings/dialog-content.png")
                    java.nio.file.Files.createDirectories(target.parent)
                    javax.imageio.ImageIO.write(image, "png", target.toFile())
                }
            }
        }
    }

    @Test fun `draft snapshots preserve only credentials belonging to the selected endpoint and provider`() {
        edt {
            val form = VoiceSettingsForm(VoiceSettings.Settings("https://old.example/transcribe", "saved-model", "custom"), "saved-id", true, false) {}
            assertEquals("custom-saved", form.draftConfig("tencent-saved", "custom-saved").apiKey)
            form.endpoint.text = "https://new.example/transcribe"
            form.model.text = "unsaved-model"
            assertEquals("", form.draftConfig("tencent-saved", "custom-saved").apiKey)
            form.apiKey.text = "new-key"
            assertEquals("new-key", form.draftConfig("tencent-saved", "custom-saved").apiKey)
            form.clearKey.isSelected = true
            assertEquals("", form.draftConfig("tencent-saved", "custom-saved").apiKey)
            form.provider.selectedItem = VoiceProvider.TENCENT
            val tencent = form.draftConfig("tencent-saved", "custom-saved")
            assertEquals(TENCENT_VOICE_ENDPOINT, tencent.endpoint)
            assertEquals("tencent-saved", tencent.secretKey)
            assertEquals("", tencent.apiKey)
            form.secretId.text = "new-id"
            assertNotNull(form.validateInput())
            form.secretKey.text = "new-tencent-key"
            assertEquals("new-tencent-key", form.draftConfig("tencent-saved", "custom-saved").secretKey)
        }
    }

    @Test fun `test records using unsaved form values and keeps transcription in its result panel`() {
        lateinit var panel: VoiceTestPanel
        lateinit var form: VoiceSettingsForm
        val used = AtomicReference<VoiceServiceConfig>()
        edt {
            form = VoiceSettingsForm(VoiceSettings.Settings("https://old.example/transcribe", "old", "custom"), "", false, false) {}
            form.endpoint.text = "https://new.example/transcribe"
            form.model.text = "new-model"
            panel = VoiceTestPanel(false, { form.draftConfig("", "old-key") }, { form.validateInput()?.message },
                { form.setInputEnabled(!it) }, { object : VoiceCapture {
                    override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray {
                        onLevel(0.5, 1000)
                        while (!stopped()) Thread.sleep(5)
                        onLevel(0.5, 1100)
                        return byteArrayOf(1)
                    }
                    override fun close() {}
                } }, { config, _ -> used.set(config); "测试结果" })
            panel.startButton.doClick()
            assertFalse(form.provider.isEnabled)
            assertTrue(panel.isBusy)
        }
        try {
            until { panel.stopButton.isEnabled }
            edt { panel.stopButton.doClick(); assertFalse(panel.stopButton.isEnabled) }
            until { panel.startButton.isEnabled }
            edt {
                assertEquals("测试结果", panel.result.text)
                assertTrue(form.provider.isEnabled)
                assertFalse(panel.isBusy)
                assertFalse(panel.result.isEditable)
            }
            assertEquals("new-model", used.get().model)
            assertEquals("https://new.example/transcribe", used.get().endpoint)
            assertEquals("", used.get().apiKey)
        } finally { edt { panel.close() } }
    }

    @Test fun `validation prevents capture and service errors offer actionable recovery`() {
        lateinit var panel: VoiceTestPanel
        var invalid = true
        edt {
            panel = VoiceTestPanel(false, { VoiceServiceConfig("http://localhost/test", "model") }, { if (invalid) "请填写密钥" else null },
                capture = { object : VoiceCapture {
                    override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit) = byteArrayOf(1)
                    override fun close() {}
                } }, transcribe = { _, _ -> throw VoiceFailure("tencentAuthentication") })
            panel.startButton.doClick()
            assertEquals("请填写密钥", panel.status.text)
            assertTrue(panel.startButton.isEnabled)
            invalid = false
            panel.startButton.doClick()
        }
        try {
            until { panel.startButton.isEnabled }
            edt { assertTrue(panel.result.text.contains("SecretId / SecretKey")) }
        } finally { edt { panel.close() } }
    }

    @Test fun `cancel and dialog close discard even a noninterruptible late result`() {
        for (close in listOf(false, true)) {
            val reached = CountDownLatch(1)
            val release = CountDownLatch(1)
            val returned = CountDownLatch(1)
            lateinit var panel: VoiceTestPanel
            edt {
                panel = VoiceTestPanel(false, { VoiceServiceConfig("http://localhost/test", "model") }, { null },
                    capture = { object : VoiceCapture {
                        override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit) = byteArrayOf(1)
                        override fun close() {}
                    } }, transcribe = { _, _ ->
                        reached.countDown()
                        while (true) { try { release.await(); break } catch (_: InterruptedException) {} }
                        returned.countDown()
                        "late text"
                    })
                panel.startButton.doClick()
            }
            try {
                assertTrue(reached.await(3, TimeUnit.SECONDS))
                edt { if (close) panel.close() else panel.cancelButton.doClick() }
                release.countDown()
                assertTrue(returned.await(3, TimeUnit.SECONDS))
                edt { assertEquals("", panel.result.text); assertFalse(panel.stopButton.isEnabled) }
            } finally { release.countDown(); edt { panel.close() } }
        }
    }
}
