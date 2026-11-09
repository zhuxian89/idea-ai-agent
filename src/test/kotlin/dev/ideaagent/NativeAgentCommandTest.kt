package dev.ideaagent

import com.intellij.icons.AllIcons
import com.intellij.openapi.project.DumbService
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

class NativeAgentCommandTest {
    private val factorySource = Files.readString(Path.of("src/main/kotlin/dev/ideaagent/AgentToolWindowFactory.kt"))
    private val bridgeSource = Files.readString(Path.of("runtime/web/src/services/ideaBridge.ts"))

    @Test fun toolWindowCommandsMatchTheWebviewBridge() {
        assertEquals(listOf("new", "history", "settings", "remote"), NativeAgentCommands.all)
        for (command in NativeAgentCommands.all) {
            assertTrue("webview bridge must accept native command $command", bridgeSource.contains("\"$command\""))
        }
    }

    @Test fun editorCaptureIsDeclaredOnBothSidesOfTheBridge() {
        assertTrue("the IDE query handler must capture editor context", factorySource.contains("\"addContext\" ->"))
        assertTrue("the composer entry must request IDE capture", bridgeSource.contains("action: \"addContext\""))
    }

    @Test fun titleActionsStayAvailableDuringIndexingAndForwardTheirCommand() {
        val seen = mutableListOf<String>()
        for (command in NativeAgentCommands.all) {
            val action = NativeAgentCommandAction(command, seen::add, "title", "description", AllIcons.General.Add)
            assertTrue(DumbService.isDumbAware(action))
            action.fire()
        }
        assertEquals(listOf("new", "history", "settings", "remote"), seen)
    }

    @Test fun commandsQueuedBeforeTheWebviewLoadsFlushExactlyOnce() {
        val queue = WebviewCommandQueue()
        queue.offer("new")
        queue.offer("history")
        assertEquals(listOf("new", "history"), queue.drain())
        assertTrue("each load flushes the queue exactly once", queue.drain().isEmpty())
    }

    @Test fun clicksKeepQueueingAcrossFirstLoadAndReconnect() {
        val queue = WebviewCommandQueue()
        queue.offer("new")
        assertEquals(listOf("new"), queue.drain())
        queue.offer("history")
        assertEquals(listOf("history"), queue.drain())
        assertTrue(queue.drain().isEmpty())
    }

    @Test fun reconnectingStopsDeliveryUntilTheNextWebviewLoads() {
        val start = factorySource.indexOf("fun start()")
        assertTrue(start >= 0)
        val body = factorySource.substring(start, factorySource.indexOf("private fun showStatus", start))
        assertTrue("a reconnect must queue clicks instead of firing into the detached page", body.contains("loaded = false"))
        val end = factorySource.indexOf("queuedCommands.drain().forEach(::sendNativeCommand)")
        assertTrue("queued commands must replay once the webview loads", end > start)
    }

    @Test fun everyCommandHasATitleAndDescriptionInBothLanguages() {
        for (command in NativeAgentCommands.all) {
            val zh = NativeAgentCommands.title(command)
            val en = NativeAgentCommands.title(command, english = true)
            assertTrue("$command needs a Chinese title", zh.any { it.code in 0x4e00..0x9fff } || zh.startsWith("Agent"))
            assertTrue("$command needs an English title", en.isNotBlank() && en.none { it.code in 0x4e00..0x9fff })
            assertTrue(NativeAgentCommands.description(command, english = true).none { it.code in 0x4e00..0x9fff })
            assertTrue(NativeAgentCommands.description(command).isNotBlank())
        }
    }
}
