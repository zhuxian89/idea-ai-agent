package dev.ideaagent

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

internal object FileContext {
    fun current(project: Project): String? {
        // Resolve the active tab at click time, even after focus moves to the
        // Agent. openFiles and the project tree selection are not the active tab.
        val file = FileEditorManager.getInstance(project).selectedEditor?.file ?: return null
        return reference(file)
    }

    fun isAvailable(file: VirtualFile): Boolean = file.isValid && !file.isDirectory && file.isInLocalFileSystem

    fun reference(file: VirtualFile): String? =
        if (isAvailable(file)) "文件：${file.path}" else null

    fun notifyUnavailable(project: Project) {
        NotificationGroupManager.getInstance().getNotificationGroup("IdeaAgent.Context")
            .createNotification("未能加入文件", "请先在编辑器中打开一个本地文件，再点击“加入当前文件”。", NotificationType.INFORMATION)
            .notify(project)
    }
}
