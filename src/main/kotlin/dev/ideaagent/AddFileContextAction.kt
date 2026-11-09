package dev.ideaagent

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAwareAction

class AddFileContextAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(event: AnActionEvent) {
        event.presentation.text = localized("加入 AI Agent 对话", "Add to AI Agent Chat")
        event.presentation.description = localized("将此文件的路径加入当前 AI Agent 对话草稿，不自动发送",
            "Add this file's path to the current AI Agent draft without sending")
        event.presentation.isEnabledAndVisible = event.project != null &&
            event.getData(CommonDataKeys.VIRTUAL_FILE)?.let(FileContext::isAvailable) == true
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        // Popup data identifies the clicked file, which need not be the active editor.
        val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val context = FileContext.reference(file, isEnglishUi())
        if (context == null) FileContext.notifyUnavailable(project)
        else addContextToAgent(project, context)
    }
}
