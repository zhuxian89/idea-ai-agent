package dev.ideaagent

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.project.DumbService
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class AnalyzeConsoleActionTest : BasePlatformTestCase() {
    fun testBothActionsAreInConsolePopupAndRequireAnExplicitConsoleSelection() {
        val manager = ActionManager.getInstance()
        val group = manager.getAction("ConsoleEditorPopupMenu") as ActionGroup
        val factory = EditorFactory.getInstance()
        for (kind in listOf(EditorKind.CONSOLE, EditorKind.MAIN_EDITOR)) {
            val editor = factory.createEditor(factory.createDocument("Exception: example failure"), project, kind)
            try {
                val context = DataContext { key -> when (key) {
                    CommonDataKeys.PROJECT.name -> project
                    CommonDataKeys.EDITOR.name -> editor
                    else -> null
                } }
                for (id in listOf("IdeaAgent.AnalyzeConsoleCurrent", "IdeaAgent.AnalyzeConsoleNew")) {
                    val action = requireNotNull(manager.getAction(id))
                    assertTrue(DumbService.isDumbAware(action))
                    val event = AnActionEvent.createFromDataContext("test", null, context)
                    assertTrue(group.getChildren(event).contains(action))
                    editor.selectionModel.removeSelection()
                    action.update(event)
                    assertFalse(event.presentation.isEnabled)
                    editor.selectionModel.setSelection(0, editor.document.textLength)
                    action.update(event)
                    assertEquals(kind == EditorKind.CONSOLE, event.presentation.isEnabledAndVisible)
                }
            } finally {
                factory.releaseEditor(editor)
            }
        }
    }

    fun testLabelsFollowPluginLanguage() {
        val preferences = ApplicationManager.getApplication().getService(AgentPreferences::class.java)
        val previous = preferences.state
        try {
            val action = AnalyzeConsoleNewAction()
            val event = AnActionEvent.createFromDataContext("test", null, DataContext.EMPTY_CONTEXT)
            preferences.setLocale("en-US")
            action.update(event)
            assertEquals("Analyze in New Agent Session", event.presentation.text)
            preferences.setLocale("zh-CN")
            action.update(event)
            assertEquals("在新会话中分析", event.presentation.text)
        } finally {
            preferences.loadState(previous)
        }
    }
}
