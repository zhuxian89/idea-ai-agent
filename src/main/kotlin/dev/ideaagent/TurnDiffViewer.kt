package dev.ideaagent

import com.google.gson.Gson
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.DiffDialogHints
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.AppExecutorUtil
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import java.time.Duration

internal data class TurnDiffSide(
    val present: Boolean = false,
    val binary: Boolean = false,
    val mode: Long = 0,
    val dataBase64: String? = null,
)

internal data class TurnDiffArtifact(
    val path: String = "",
    val before: TurnDiffSide? = null,
    val after: TurnDiffSide? = null,
)

internal data class GitFileCompareSide(
    val present: Boolean = false,
    val binary: Boolean = false,
    val dataBase64: String? = null,
)

internal data class GitFileCompareArtifact(
    val path: String = "",
    val head: GitFileCompareSide? = null,
    val worktree: GitFileCompareSide? = null,
)

internal object TurnDiffViewer {
    private val gson = Gson()

    fun compare(project: Project, connection: LocalRuntime.Connection, sessionKey: String, snapshotId: String, path: String) {
        AppExecutorUtil.getAppExecutorService().execute {
            try {
                val artifact = fetch(connection, sessionKey, snapshotId, path)
                require(artifact.before != null && artifact.after != null) { "Incomplete turn snapshot" }
                require(!artifact.before.binary && !artifact.after.binary) { "Binary files cannot be compared in this viewer" }
                ApplicationManager.getApplication().invokeLater {
                    if (project.isDisposed) return@invokeLater
                    showTextDiff(
                        project,
                        "Turn diff: ${artifact.path}",
                        artifact.path,
                        artifact.before.present,
                        artifact.before.binary,
                        artifact.before.dataBase64,
                        artifact.after.present,
                        artifact.after.binary,
                        artifact.after.dataBase64,
                        "Before this turn",
                        "After this turn",
                    )
                }
            } catch (error: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    if (!project.isDisposed) notifyError(project, error.message)
                }
            }
        }
    }

    fun compareGitWorktree(
        project: Project,
        connection: LocalRuntime.Connection,
        path: String,
        repoPath: String? = null,
        repoKind: String? = null,
    ) {
        AppExecutorUtil.getAppExecutorService().execute {
            try {
                val artifact = fetchGitFileCompare(connection, path, repoPath, repoKind)
                val head = requireNotNull(artifact.head) { "Incomplete Git comparison" }
                val worktree = requireNotNull(artifact.worktree) { "Incomplete Git comparison" }
                ApplicationManager.getApplication().invokeLater {
                    if (project.isDisposed) return@invokeLater
                    showTextDiff(
                        project,
                        "Git diff: ${artifact.path}",
                        artifact.path,
                        head.present,
                        head.binary,
                        head.dataBase64,
                        worktree.present,
                        worktree.binary,
                        worktree.dataBase64,
                        "HEAD",
                        "Working tree",
                    )
                }
            } catch (error: Exception) {
                notifyGitCompareError(project, error.message)
            }
        }
    }

    private fun showTextDiff(
        project: Project,
        title: String,
        path: String,
        beforePresent: Boolean,
        beforeBinary: Boolean,
        beforeDataBase64: String?,
        afterPresent: Boolean,
        afterBinary: Boolean,
        afterDataBase64: String?,
        beforeTitle: String,
        afterTitle: String,
    ) {
        require(!beforeBinary && !afterBinary) { "Binary files cannot be compared in this viewer" }
        val factory = DiffContentFactory.getInstance()
        val fileType = runCatching {
            FileTypeRegistry.getInstance().getFileTypeByFileName(path)
        }.getOrNull() ?: PlainTextFileType.INSTANCE
        val before = if (beforePresent)
            factory.create(project, decodeText(beforeDataBase64), fileType)
        else factory.createEmpty()
        val after = if (afterPresent)
            factory.create(project, decodeText(afterDataBase64), fileType)
        else factory.createEmpty()
        DiffManager.getInstance().showDiff(
            project,
            SimpleDiffRequest(title, before, after, beforeTitle, afterTitle),
            DiffDialogHints.DEFAULT,
        )
    }

    private fun fetchGitFileCompare(
        connection: LocalRuntime.Connection,
        path: String,
        repoPath: String?,
        repoKind: String?,
    ): GitFileCompareArtifact {
        val query = StringBuilder("?root=").append(encode(connection.rootId))
            .append("&path=").append(encode(path))
        if (!repoPath.isNullOrBlank()) query.append("&repo_path=").append(encode(repoPath))
        if (!repoKind.isNullOrBlank()) query.append("&repo_kind=").append(encode(repoKind))
        val url = URI.create("${connection.endpoint}/api/git/related-file/compare$query")
        val request = HttpRequest.newBuilder(url)
            .timeout(Duration.ofSeconds(10))
            .header("X-MindFS-Local-CLI-Token", connection.token)
            .GET()
            .build()
        val response = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build()
            .send(request, HttpResponse.BodyHandlers.ofString())
        require(response.statusCode() == 200) { "Git comparison unavailable (${response.statusCode()})" }
        return gson.fromJson(response.body(), GitFileCompareArtifact::class.java)
    }

    private fun fetch(connection: LocalRuntime.Connection, sessionKey: String, snapshotId: String, path: String): TurnDiffArtifact {
        val url = URI.create(
            "${connection.endpoint}/api/sessions/${encode(sessionKey)}/turn-diffs/${encode(snapshotId)}" +
                "?root=${encode(connection.rootId)}&path=${encode(path)}"
        )
        val request = HttpRequest.newBuilder(url)
            .timeout(Duration.ofSeconds(10))
            .header("X-MindFS-Local-CLI-Token", connection.token)
            .GET()
            .build()
        val response = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build()
            .send(request, HttpResponse.BodyHandlers.ofString())
        require(response.statusCode() == 200) { "Turn diff unavailable (${response.statusCode()})" }
        return gson.fromJson(response.body(), TurnDiffArtifact::class.java)
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8)

    private fun decodeText(value: String?): String {
        val bytes = java.util.Base64.getDecoder().decode(value.orEmpty())
        byteOrderMark(bytes)?.let { return String(bytes, it.charset).drop(it.skipChars) }
        return try {
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (_: CharacterCodingException) {
            String(bytes, Charset.forName("GB18030"))
        }
    }

    private data class Bom(val bytes: ByteArray, val charset: java.nio.charset.Charset, val skipChars: Int)

    private fun byteOrderMark(bytes: ByteArray): Bom? = when {
        bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte() ->
            Bom(byteArrayOf(), StandardCharsets.UTF_8, 1)
        bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte() ->
            Bom(byteArrayOf(0xFE.toByte(), 0xFF.toByte()), StandardCharsets.UTF_16BE, 1)
        bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte() ->
            Bom(byteArrayOf(0xFF.toByte(), 0xFE.toByte()), StandardCharsets.UTF_16LE, 1)
        else -> null
    }

    private fun notifyGitCompareError(project: Project, message: String?) {
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed) {
                NotificationGroupManager.getInstance().getNotificationGroup("IdeaAgent.Context")
                    .createNotification("无法打开 Git 对比", message ?: "当前文件没有未提交修改。", NotificationType.WARNING)
                    .notify(project)
            }
        }
    }

    private fun notifyError(project: Project, message: String?) {
        NotificationGroupManager.getInstance().getNotificationGroup("IdeaAgent.Context")
            .createNotification("无法打开本轮对比", message ?: "快照不可用或已过期。", NotificationType.WARNING)
            .notify(project)
    }
}
