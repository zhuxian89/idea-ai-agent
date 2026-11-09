package dev.ideaagent

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

internal object FileContext {
    fun current(project: Project, english: Boolean = false): String? {
        // Resolve the active tab at click time, even after focus moves to the
        // Agent. openFiles and the project tree selection are not the active tab.
        val file = FileEditorManager.getInstance(project).selectedEditor?.file ?: return null
        return reference(file, english)
    }

    fun isAvailable(file: VirtualFile): Boolean = file.isValid && !file.isDirectory && file.isInLocalFileSystem

    fun reference(file: VirtualFile, english: Boolean = false): String? =
        if (!isAvailable(file)) null else if (english) "File: ${file.path}" else "文件：${file.path}"

    fun notifyUnavailable(project: Project) {
        NotificationGroupManager.getInstance().getNotificationGroup("IdeaAgent.Context")
            .createNotification(
                localized("未能加入文件", "Cannot add file"),
                localized("请先在编辑器中打开一个本地文件，再点击“加入当前文件”。",
                    "Open a local file in the editor first, then choose Add current file."),
                NotificationType.INFORMATION)
            .notify(project)
    }
}
