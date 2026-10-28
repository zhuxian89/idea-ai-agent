package dev.ideaagent

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.wm.ToolWindowManager

abstract class AnalyzeConsoleAction(private val target: String) : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(event: AnActionEvent) {
        val english = isEnglish()
        event.presentation.text = if (target == "new") {
            if (english) "Analyze in New Agent Session" else "在新会话中分析"
        } else {
            if (english) "Analyze in Current Agent Session" else "交给当前会话分析"
        }
        event.presentation.description = if (english) "Add selected console output to a draft without sending" else "将选中的控制台输出加入草稿，不自动发送"
        val editor = event.getData(CommonDataKeys.EDITOR)
        event.presentation.isVisible = event.project != null && editor?.project == event.project && editor?.editorKind == EditorKind.CONSOLE
        event.presentation.isEnabled = event.presentation.isVisible && editor?.selectionModel?.selectedText?.isNotBlank() == true
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        if (editor.editorKind != EditorKind.CONSOLE || editor.project != project) return
        val selection = editor.selectionModel.selectedText ?: return
        val text = ConsoleContext.format(selection, isEnglish()) ?: return
        val window = ToolWindowManager.getInstance(project).getToolWindow("AI Agent") ?: return
        // Capture before focus moves away from the originating console.
        window.activate({
            if (!project.isDisposed) {
                (window.contentManager.selectedContent?.component as? AgentPanel)?.addContext(IdeaContextRequest(text, target))
            }
        }, true)
    }

    private fun isEnglish() = ApplicationManager.getApplication().getService(AgentPreferences::class.java).state.locale == "en-US"
}

class AnalyzeConsoleCurrentAction : AnalyzeConsoleAction("current")
class AnalyzeConsoleNewAction : AnalyzeConsoleAction("new")
