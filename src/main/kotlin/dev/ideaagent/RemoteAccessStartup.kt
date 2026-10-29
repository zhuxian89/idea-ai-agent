package dev.ideaagent

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withContext
import java.nio.file.Path

class RemoteAccessStartup : ProjectActivity {
    override suspend fun execute(project: Project) {
        val projectPath = project.basePath ?: return
        try {
            withContext(Dispatchers.IO) {
                val dataDir = runtimeDataDir(Path.of(projectPath), Path.of(PathManager.getConfigPath()))
                if (remoteAccessEnabled(dataDir) && !project.isDisposed) {
                    // Share the same guarded startup future used by the tool window.
                    project.getService(LocalRuntime::class.java).start().await()
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Logger.getInstance(RemoteAccessStartup::class.java).warn("Remote access startup failed", error)
            if (!project.isDisposed) {
                NotificationGroupManager.getInstance().getNotificationGroup("IdeaAgent.Context")
                    .createNotification("远程访问启动失败 / Remote access startup failed",
                        "请打开 AI Agent 面板查看并重试。Open the AI Agent panel to check and retry.",
                        NotificationType.ERROR)
                    .notify(project)
            }
        }
    }
}
