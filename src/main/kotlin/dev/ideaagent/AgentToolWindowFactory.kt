package dev.ideaagent

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.DumbService
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.UIUtil
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.network.CefRequest
import java.awt.BorderLayout
import java.awt.Color
import java.nio.file.Path
import javax.swing.Icon
import javax.swing.JLabel
import javax.swing.JPanel

class AgentToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = AgentPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
        // Keep a single "AI Agent" title on the native tool window stripe. The
        // web page drops its duplicated toolbar in ide_chrome mode, so these
        // title actions carry new/history/settings, and reconnecting moves into
        // the tool window gear menu.
        val english = isEnglishUi()
        toolWindow.setTitleActions(NativeAgentCommands.all.map { command ->
            NativeAgentCommandAction(command, panel::sendNativeCommand,
                NativeAgentCommands.title(command, english), NativeAgentCommands.description(command, english),
                NativeAgentCommands.icon(command))
        })
        toolWindow.setAdditionalGearActions(DefaultActionGroup(
            LocalizedAction({ localized("重新连接", "Reconnect") },
                { localized("重新连接本地 Agent 聊天界面", "Reconnect the local Agent chat view") },
                AllIcons.Actions.Refresh) { panel.start() },
            LocalizedAction({ "语音配置与测试 / Voice settings" },
                { localized("修改语音识别供应商、密钥并测试录音识别",
                    "Change the speech provider and credentials, and test recording") },
                AllIcons.General.Settings) { panel.openVoiceSettings() },
        ))
        panel.start()
    }
}

internal object NativeAgentCommands {
    val all = listOf("new", "history", "settings", "remote")

    fun title(command: String, english: Boolean = false): String = when (command) {
        "remote" -> if (english) "Remote access" else "远程访问"
        "new" -> if (english) "New session" else "新会话"
        "history" -> if (english) "Chat history" else "聊天历史"
        else -> if (english) "Agent settings" else "Agent 配置"
    }

    fun description(command: String, english: Boolean = false): String = when (command) {
        "remote" -> if (english) "Link Relay and continue this project's sessions in a browser" else "绑定 Relay，在浏览器中继续当前项目的会话"
        "new" -> if (english) "Start a new Agent session" else "开始一个新的 Agent 会话"
        "history" -> if (english) "Open or return from chat history" else "打开或返回聊天历史"
        else -> if (english) "Open or return from Agent settings and installation" else "打开或返回 Agent 配置与安装"
    }

    fun icon(command: String): Icon = when (command) {
        "remote" -> AllIcons.General.Web
        "new" -> AllIcons.General.Add
        "history" -> AllIcons.Vcs.History
        else -> AllIcons.General.Settings
    }
}

internal class NativeAgentCommandAction(
    private val command: String,
    private val send: (String) -> Unit,
    text: String,
    description: String,
    icon: Icon,
) : DumbAwareAction(text, description, icon) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT
    override fun update(event: AnActionEvent) {
        val english = isEnglishUi()
        event.presentation.text = NativeAgentCommands.title(command, english)
        event.presentation.description = NativeAgentCommands.description(command, english)
    }
    override fun actionPerformed(event: AnActionEvent) = fire()

    internal fun fire() = send(command)
}

/** Gear-menu entry whose text follows the plugin language each time the menu opens. */
private class LocalizedAction(
    private val text: () -> String,
    private val description: () -> String,
    icon: Icon,
    private val run: () -> Unit,
) : DumbAwareAction(text(), description(), icon) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT
    override fun update(event: AnActionEvent) {
        event.presentation.text = text()
        event.presentation.description = description()
    }
    override fun actionPerformed(event: AnActionEvent) = run()
}

/** Commands clicked before the webview finishes loading replay once it has. */
internal class WebviewCommandQueue {
    private val pending = mutableListOf<String>()

    fun offer(command: String) {
        pending.add(command)
    }

    fun drain(): List<String> =
        if (pending.isEmpty()) emptyList() else pending.toList().also { pending.clear() }
}

class AgentPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val body = JPanel(BorderLayout())
    private val status = JLabel(startingText())
    private var browser: JBCefBrowser? = null
    private var connection: LocalRuntime.Connection? = null
    private var loaded = false
    private var closed = false
    private var backendBusy = false
    private var updateState = StandaloneUpdateState()
    private var updatePanel: StandaloneUpdatePanel? = null
    private val pendingContexts = mutableListOf<IdeaContextRequest>()
    private val queuedCommands = WebviewCommandQueue()
    private val gson = Gson()
    private val voice = VoiceInputController(
        config = { ApplicationManager.getApplication().getService(VoiceSettings::class.java).config() },
        emit = { event -> ApplicationManager.getApplication().invokeLater {
            if (!closed && loaded) execute("window.ideaAgentVoiceEvent?.(${gson.toJson(event)});")
        } },
    )

    init {
        body.add(status, BorderLayout.CENTER)
        add(body, BorderLayout.CENTER)
        syncTheme()
        project.messageBus.connect(this).subscribe(LafManagerListener.TOPIC, LafManagerListener { syncTheme() })
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(VoiceSettings.TOPIC, VoiceSettingsListener {
            ApplicationManager.getApplication().invokeLater { syncVoiceSettings() }
        })
        ApplicationManager.getApplication().messageBus.connect(this).subscribe(StandaloneBackendListener.TOPIC, object : StandaloneBackendListener {
            override fun changed(action: String) {
                if (closed || project.isDisposed || !loaded) return
                execute("window.dispatchEvent(new CustomEvent('idea:backend-state', {detail: {busy: false}}));")
            }
        })
    }

    fun addCurrentEditorContext() {
        FileEditorManager.getInstance(project).selectedTextEditor?.let { editor ->
            EditorContext.capture(project, editor, isEnglishUi())?.let(::addContext)
        }
    }

    fun sendNativeCommand(command: String) {
        if (closed) return
        if (!loaded) {
            queuedCommands.offer(command)
            return
        }
        execute("window.ideaAgentNativeCommand?.(${gson.toJson(command)});")
    }

    private fun publishUpdate(state: StandaloneUpdateState) {
        updateState = state
        updatePanel?.showState(state)
        if (loaded) execute("window.dispatchEvent(new CustomEvent('idea:standalone-update', {detail: ${gson.toJson(state.copy())}}));")
    }

    private fun remoteUpdateEntry(webSettings: Boolean) {
        if (connection?.standalone != true) return
        if (webSettings) {
            updatePanel?.let { remove(it) }
            updatePanel = null
        } else if (updatePanel == null) {
            updatePanel = StandaloneUpdatePanel(isEnglishUi(), { checkStandaloneUpdate() }, { updateStandalone() })
            add(updatePanel, BorderLayout.NORTH)
            checkStandaloneUpdate()
        }
        revalidate(); repaint()
    }

    private fun checkStandaloneUpdate() {
        if (connection?.standalone != true) return
        if (updateState.checking || updateState.updating) { publishUpdate(updateState); return }
        publishUpdate(updateState.copy(checking = true, latest = "", error = ""))
        val app = ApplicationManager.getApplication()
        com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute {
            val result = runCatching {
                val installed = requireNotNull(installedStandaloneVersion(dev.ideaagent.remote.remoteHostDataDir())) { "Standalone service is not installed" }
                StandaloneUpdateState(version = installed, latest = latestStandaloneVersion())
            }
            app.invokeLater {
                if (closed || project.isDisposed) return@invokeLater
                publishUpdate(result.getOrElse { updateState.copy(checking = false, error = it.message.orEmpty()) })
            }
        }
    }

    private fun updateStandalone() {
        if (!updateState.available || updateState.checking || updateState.updating) return
        val app = ApplicationManager.getApplication()
        val installer = app.getService(StandaloneInstaller::class.java)
        if (installer.installing) {
            publishUpdate(updateState.copy(error = localized("已有安装或更新正在进行。", "An installation or update is already running.")))
            return
        }
        val target = updateState.latest
        publishUpdate(updateState.copy(updating = true, error = ""))
        com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute {
            val updated = installer.install(dev.ideaagent.remote.remoteHostDataDir(), changed = {
                app.invokeLater { app.messageBus.syncPublisher(StandaloneBackendListener.TOPIC).changed("update") }
            }, update = true, version = target)
            app.invokeLater {
                if (closed || project.isDisposed) return@invokeLater
                if (updated) {
                    app.getService(AgentPreferences::class.java).continueRemoteAfterRestart(project.locationHash)
                    app.restart()
                } else publishUpdate(updateState.copy(updating = false, error = installer.error))
            }
        }
    }

    fun start() {
        if (closed) return
        if (!JBCefApp.isSupported()) {
            showStatus(localized("当前运行环境不支持 JCEF。请使用 IDEA 自带的 JetBrains Runtime。",
                "This runtime does not support JCEF. Use the JetBrains Runtime bundled with IDEA."))
            return
        }
        // A (re)connect detaches the old page right away; keep every action
        // queued until the new webview has loaded, or clicks would fire into
        // the view that is about to be replaced and be lost.
        voice.cancel()
        loaded = false
        showStatus(startingText())
        project.getService(LocalRuntime::class.java).start().whenComplete { ready, error ->
            ApplicationManager.getApplication().invokeLater {
                if (closed || project.isDisposed) return@invokeLater
                if (error != null) showStatus(localized("启动失败：", "Failed to start: ") + (error.cause?.message ?: error.message))
                else attach(ready)
            }
        }
    }

    private fun startingText() = localized("正在启动本地 Agent…", "Starting local Agent…")

    private fun backendMode(ready: LocalRuntime.Connection, selected: String? = null) {
        com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute {
            val result = runCatching {
                val service = ApplicationManager.getApplication().getService(BackendModeService::class.java)
                val dir = dev.ideaagent.remote.remoteHostDataDir()
                if (selected != null) service.save(dir, BackendMode.parse(selected))
                service.state(dir, if (ready.standalone) BackendMode.STANDALONE else BackendMode.EMBEDDED)
            }
            ApplicationManager.getApplication().invokeLater {
                if (!closed && !project.isDisposed && loaded) {
                    val detail = result.getOrElse { mapOf("error" to it.message.orEmpty()) }
                    execute("window.dispatchEvent(new CustomEvent('idea:backend-mode', {detail: ${gson.toJson(detail)}}));")
                }
                if (selected != null && result.isSuccess) {
                    ApplicationManager.getApplication().messageBus.syncPublisher(StandaloneBackendListener.TOPIC).changed("mode")
                }
            }
        }
    }

    private fun showStatus(text: String) {
        status.text = text
        body.removeAll()
        body.add(status, BorderLayout.CENTER)
        body.revalidate()
        body.repaint()
    }

    private fun installBackend(ready: LocalRuntime.Connection) {
        val app = ApplicationManager.getApplication()
        com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute {
            val dir = dev.ideaagent.remote.remoteHostDataDir()
            val installed = app.getService(StandaloneInstaller::class.java).install(dir, changed = {
                app.invokeLater { app.messageBus.syncPublisher(StandaloneBackendListener.TOPIC).changed("install") }
            })
            backendMode(ready, if (installed) BackendMode.STANDALONE.value else null)
        }
    }

    private fun controlBackend(action: String) {
        ApplicationManager.getApplication().invokeLater {
            if (backendBusy) return@invokeLater
            if (action != "start" && com.intellij.openapi.ui.Messages.showYesNoDialog(project,
                    localized("此操作会断开远程设备。本地聊天继续运行。继续？", "This disconnects remote devices. Local chats keep running. Continue?"),
                    "Local AI Agent", com.intellij.openapi.ui.Messages.getWarningIcon()) != com.intellij.openapi.ui.Messages.YES) return@invokeLater
            backendBusy = true
            execute("window.dispatchEvent(new CustomEvent('idea:backend-state', {detail: {busy: true}}));")
            com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService().execute {
                val result = runCatching {
                    manageStandalone(dev.ideaagent.remote.remoteHostDataDir(), action)
                    ApplicationManager.getApplication().getService(BackendModeService::class.java)
                        .clearRemoteError(dev.ideaagent.remote.remoteHostDataDir())
                }
                ApplicationManager.getApplication().invokeLater completed@{
                    if (closed || project.isDisposed) return@completed
                    backendBusy = false
                    result.fold(onSuccess = {
                        ApplicationManager.getApplication().messageBus.syncPublisher(StandaloneBackendListener.TOPIC).changed(action)
                    }, onFailure = {
                        execute("window.dispatchEvent(new CustomEvent('idea:backend-state', {detail: ${gson.toJson(mapOf("busy" to false, "error" to it.message.orEmpty()))}}));")
                    })
                }
            }
        }
    }

    private fun attach(ready: LocalRuntime.Connection) {
        voice.cancel()
        browser?.let { Disposer.dispose(it) }
        loaded = false
        connection = ready
        val view = JBCefBrowser()
        browser = view
        val theme = syncTheme()
        Disposer.register(this, view)
        // Select the supported overload; the JBCefBrowser overload is scheduled for removal.
        val query = JBCefJSQuery.create(view as JBCefBrowserBase)
        Disposer.register(view, query)
        val preferences = ApplicationManager.getApplication().getService(AgentPreferences::class.java)
        query.addHandler { payload ->
            if (closed || payload.length > 16384 || !LocalEndpoint.sameOrigin(ready.endpoint, view.cefBrowser.url)) {
                JBCefJSQuery.Response("Rejected", 1, "Invalid IDE request")
            } else try {
                val request = JsonParser.parseString(payload).asJsonObject
                when (request.get("action")?.asString) {
                    "openFile" -> {
                        require(request.get("rootId")?.asString == ready.rootId) { "Different project" }
                        val reference = parseIdeaFileReference(
                            request.get("path")?.asString ?: "",
                            request.get("line")?.takeUnless { it.isJsonNull }?.asInt,
                        )
                        val projectRoot = Path.of(requireNotNull(project.basePath))
                        ApplicationManager.getApplication().invokeLater {
                            if (!project.isDisposed) DumbService.getInstance(project).runWhenSmart {
                                if (project.isDisposed) return@runWhenSmart
                                val file = ApplicationManager.getApplication().runReadAction<com.intellij.openapi.vfs.VirtualFile?> {
                                    findIdeaProjectFile(project, projectRoot, reference)
                                }
                                file?.let {
                                    OpenFileDescriptor(project, it, reference.line - 1, 0).navigate(true)
                                }
                            }
                        }
                    }
                    "voiceStart" -> voice.start(request.get("id").asString)
                    "remoteAccess" -> {
                        project.getService(LocalRuntime::class.java).requestRemoteHost()
                        ApplicationManager.getApplication().invokeLater {
                            if (!closed && !project.isDisposed) remoteUpdateEntry(request.get("updateUI")?.asBoolean == true)
                        }
                    }
                    "compareGitFile" -> {
                        require(request.get("rootId")?.asString == ready.rootId) { "Different project" }
                        TurnDiffViewer.compareGitWorktree(
                            project,
                            ready,
                            request.get("path").asString,
                            request.get("repo_path")?.takeUnless { it.isJsonNull }?.asString,
                            request.get("repo_kind")?.takeUnless { it.isJsonNull }?.asString,
                        )
                    }
                    "compareTurnDiff" -> {
                        require(request.get("rootId")?.asString == ready.rootId) { "Different project" }
                        TurnDiffViewer.compare(
                            project,
                            ready,
                            request.get("sessionKey").asString,
                            request.get("snapshotId").asString,
                            request.get("path").asString,
                        )
                    }
                    "voiceStop" -> voice.stop(request.get("id").asString)
                    "voiceCancel" -> voice.cancel(request.get("id").asString)
                    "voiceConfigure" -> ApplicationManager.getApplication().invokeLater {
                        openVoiceSettings()
                    }
                    "refresh" -> VirtualFileManager.getInstance().asyncRefresh(null)
                    "backendStart" -> controlBackend("start")
                    "backendRestart" -> controlBackend("restart")
                    "backendStop" -> controlBackend("stop")
                    "backendMode" -> backendMode(ready)
                    "setBackendMode" -> backendMode(ready, request.get("mode").asString)
                    "installBackend" -> installBackend(ready)
                    "checkBackendUpdate" -> ApplicationManager.getApplication().invokeLater {
                        if (!closed && !project.isDisposed) checkStandaloneUpdate()
                    }
                    "updateBackend" -> ApplicationManager.getApplication().invokeLater {
                        if (!closed && !project.isDisposed) updateStandalone()
                    }
                    "restartIdea" -> ApplicationManager.getApplication().invokeLater {
                        preferences.continueRemoteAfterRestart(project.locationHash)
                        ApplicationManager.getApplication().restart()
                    }
                    "setLocale" -> preferences.setLocale(request.get("locale").asString)
                    "setAppearance" -> preferences.setAppearance(request.get("appearance").asString)
                    "addContext" -> ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) addCurrentEditorContext()
                    }
                    "addFileContext" -> ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            val context = FileContext.current(project, isEnglishUi())
                            if (context == null) FileContext.notifyUnavailable(project)
                            else addContext(context)
                        }
                    }
                    else -> error("Unsupported IDE request")
                }
                JBCefJSQuery.Response("ok")
            } catch (_: Exception) {
                JBCefJSQuery.Response("Rejected", 1, "Cannot open this file in the current IDEA project")
            }
        }
        view.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadStart(cefBrowser: CefBrowser, frame: CefFrame, transitionType: org.cef.network.CefRequest.TransitionType) {
                if (frame.isMain) voice.cancel()
            }
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, statusCode: Int) {
                if (!frame.isMain || !LocalEndpoint.sameOrigin(ready.endpoint, frame.url)) return
                val saved = preferences.getState()
                val voiceProvider = ApplicationManager.getApplication().getService(VoiceSettings::class.java).state.activeProvider()
                cefBrowser.executeJavaScript("window.ideaAgent = { voiceProvider: ${gson.toJson(voiceProvider)}, locale: ${gson.toJson(saved.locale)}, appearance: ${gson.toJson(saved.appearance)}, theme: ${gson.toJson(theme)}, postMessage: payload => { ${query.inject("JSON.stringify(payload)")} } }; window.dispatchEvent(new Event(\"ideaAgentReady\"));", frame.url, 0)
                ApplicationManager.getApplication().invokeLater {
                    if (closed || browser !== view) return@invokeLater
                    loaded = true
                    syncVoiceSettings()
                    syncTheme()
                    val contexts = pendingContexts.toList()
                    pendingContexts.clear()
                    contexts.forEach(::addContext)
                    queuedCommands.drain().forEach(::sendNativeCommand)
                    if (preferences.consumeRemoteContinuation(project.locationHash)) sendNativeCommand("remote")
                }
            }
        }, view.cefBrowser)
        view.jbCefClient.addRequestHandler(object : CefRequestHandlerAdapter() {
            override fun onBeforeBrowse(cefBrowser: CefBrowser, frame: CefFrame, request: CefRequest, userGesture: Boolean, isRedirect: Boolean): Boolean {
                if (LocalEndpoint.sameOrigin(ready.endpoint, request.url)) return false
                if (frame.isMain && userGesture) openExternal(request.url)
                return true
            }
        }, view.cefBrowser)
        view.jbCefClient.addLifeSpanHandler(object : CefLifeSpanHandlerAdapter() {
            override fun onBeforePopup(cefBrowser: CefBrowser, frame: CefFrame, targetUrl: String, targetFrameName: String): Boolean {
                openExternal(targetUrl)
                return true
            }
        }, view.cefBrowser)
        body.removeAll()
        body.add(view.component, BorderLayout.CENTER)
        body.revalidate()
        body.repaint()
        view.loadURL("${ready.endpoint}/?ide_token=${ready.token}&root=${java.net.URLEncoder.encode(ready.rootId, Charsets.UTF_8)}&ide=1&ide_theme=$theme&ide_chrome=1")
    }

    private fun openExternal(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) BrowserUtil.browse(url)
    }

    fun addContext(text: String) = addContext(IdeaContextRequest(text))

    internal fun addContext(context: IdeaContextRequest) {
        if (closed) return
        if (!loaded) { pendingContexts.add(context); return }
        sendNativeCommand("chat")
        execute("window.ideaAgentReceiveContext?.(${gson.toJson(context.text)}, ${gson.toJson(context.target)});")
    }

    fun openVoiceSettings() {
        if (closed || project.isDisposed) return
        voice.cancel()
        execute("window.dispatchEvent(new Event(\"ideaAgentVoiceSettingsOpening\"));")
        ApplicationManager.getApplication().getService(VoiceSettings::class.java)
            .configure(project, isEnglishUi())
    }

    private fun syncVoiceSettings() {
        if (closed || !loaded) return
        val provider = ApplicationManager.getApplication().getService(VoiceSettings::class.java).state.activeProvider()
        execute("if (window.ideaAgent) { window.ideaAgent.voiceProvider = ${gson.toJson(provider)}; window.dispatchEvent(new Event(\"ideaAgentVoiceSettingsChanged\")); }")
    }

    private fun syncTheme(): String {
        val background = UIUtil.getPanelBackground() ?: Color(0x1e1f22)
        this.background = background
        body.background = background
        browser?.let { view ->
            view.component.background = background
            view.cefBrowser.uiComponent.background = background
            view.setPageBackgroundColor("#%06x".format(background.rgb and 0xffffff))
        }
        val dark = (background.red * 299 + background.green * 587 + background.blue * 114) / 1000 < 128
        val theme = if (dark) "dark" else "light"
        if (loaded) execute("window.ideaAgentSetTheme?.(${gson.toJson(theme)});")
        return theme
    }

    private fun execute(script: String) {
        val view = browser ?: return
        val ready = connection ?: return
        if (LocalEndpoint.sameOrigin(ready.endpoint, view.cefBrowser.url)) view.cefBrowser.executeJavaScript(script, ready.endpoint.toString(), 0)
    }

    override fun dispose() { closed = true; voice.close(); pendingContexts.clear(); queuedCommands.drain() }
}
