package dev.ideaagent

import com.intellij.openapi.project.DumbService
import org.junit.Assert.assertTrue
import org.junit.Test

class IndexingAvailabilityTest {
    @Test fun toolWindowIsAvailableDuringIndexing() {
        assertTrue(DumbService.isDumbAware(AgentToolWindowFactory()))
    }

    @Test fun editorContextActionIsAvailableDuringIndexing() {
        assertTrue(DumbService.isDumbAware(AddContextAction()))
    }
}
