package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test
import java.awt.Container
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO
import javax.swing.SwingUtilities

class StandaloneUpdatePanelTest {
    @Test fun updateAndLaterButtonsStayNativeAndFailureAllowsRetry() {
        SwingUtilities.invokeAndWait {
            var updates = 0
            var checks = 0
            val panel = StandaloneUpdatePanel(false, { checks++ }, { updates++ })
            assertEquals("更新并重启", panel.updateButton.text)
            assertFalse(panel.updateButton.isVisible)
            panel.checkButton.doClick()
            assertEquals(1, checks)
            val available = StandaloneUpdateState(version = "0.1.26-standalone.10", latest = "0.1.26-standalone.42")
            panel.showState(available)
            assertTrue(panel.updateButton.isVisible)
            assertTrue(com.google.gson.Gson().toJson(available).contains("\"available\":true"))
            panel.updateButton.doClick()
            assertEquals(1, updates)
            panel.showState(available.copy(updating = true))
            assertFalse(panel.updateButton.isEnabled)
            assertFalse(panel.checkButton.isEnabled)
            panel.updateButton.doClick()
            assertEquals(1, updates)
            panel.showState(available.copy(error = "SHA-256 verification failed; installation was not changed."))
            assertTrue(panel.updateButton.isEnabled)
            assertTrue(panel.checkButton.isEnabled)
            panel.updateButton.doClick()
            assertEquals(2, updates)

            fun layout(container: Container) {
                container.doLayout()
                container.components.filterIsInstance<Container>().forEach(::layout)
            }
            for ((width, english) in listOf(375 to false, 375 to true, 640 to true)) {
                val preview = StandaloneUpdatePanel(english, {}, {}).apply { showState(available) }
                preview.setSize(width, 250)
                layout(preview)
                preview.setSize(width, preview.preferredSize.height)
                layout(preview)
                assertTrue(preview.updateButton.x + preview.updateButton.width <= preview.updateButton.parent.width)
                assertTrue(preview.checkButton.x + preview.checkButton.width <= preview.checkButton.parent.width)
                assertTrue(preview.updateButton.y + preview.updateButton.height <= preview.updateButton.parent.height)
                assertTrue(preview.checkButton.y + preview.checkButton.height <= preview.checkButton.parent.height)
                val image = BufferedImage(width, preview.height, BufferedImage.TYPE_INT_ARGB)
                image.createGraphics().let { graphics -> preview.paint(graphics); graphics.dispose() }
                val output = Path.of("build/reports/in-plugin-update-${if (english) "en" else "zh"}-$width.png")
                Files.createDirectories(output.parent)
                ImageIO.write(image, "png", output.toFile())
            }
        }
    }
}
