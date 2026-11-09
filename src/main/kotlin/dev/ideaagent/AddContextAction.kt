package dev.ideaagent

import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import java.nio.file.Path

class AddContextAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(event: AnActionEvent) {
        event.presentation.text = localized("发送到 AI Agent", "Send to AI Agent")
        event.presentation.description = localized("将选中代码或当前文件加入 AI Agent 输入框",
            "Add the selected code or the current file to the AI Agent draft")
        event.presentation.isEnabledAndVisible = event.project != null && event.getData(CommonDataKeys.EDITOR) != null
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        val context = EditorContext.capture(project, editor, isEnglishUi()) ?: return
        addContextToAgent(project, context)
    }
}

internal object EditorContext {
    fun capture(project: Project, editor: Editor, english: Boolean = false): String? {
        val file = FileDocumentManager.getInstance().getFile(editor.document) ?: return null
        val projectRoot = project.basePath ?: return null
        val path = runCatching { Path.of(projectRoot).relativize(file.toNioPath()).toString().replace('\\', '/') }.getOrDefault(file.path)
        val selection = editor.selectionModel
        val text = selection.selectedText ?: editor.document.text
        val startLine = if (selection.hasSelection()) editor.document.getLineNumber(selection.selectionStart) + 1 else 1
        val unsaved = FileDocumentManager.getInstance().isDocumentUnsaved(editor.document)
        return formatEditorContext(path, startLine, text, unsaved, english)
    }
}

internal fun formatEditorContext(path: String, startLine: Int, text: String, unsaved: Boolean, english: Boolean = false): String {
    val fence = "`".repeat(maxOf(3, Regex("`+").findAll(text).maxOfOrNull { it.value.length + 1 } ?: 3))
    val label = if (english) "File: $path:$startLine${if (unsaved) " (unsaved editor content)" else ""}"
    else "文件：$path:$startLine${if (unsaved) "（编辑器中未保存的内容）" else ""}"
    return "$label\n$fence\n$text\n$fence"
}

internal fun addContextToAgent(project: Project, context: String) {
    val window = ToolWindowManager.getInstance(project).getToolWindow("AI Agent") ?: return
    window.activate({ (window.contentManager.selectedContent?.component as? AgentPanel)?.addContext(context) }, true)
}
