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
        toolWindow.setTitleActions(NativeAgentCommands.all.map { command ->
            NativeAgentCommandAction(command, panel::sendNativeCommand,
                NativeAgentCommands.title(command), NativeAgentCommands.description(command),
                NativeAgentCommands.icon(command))
        })
        toolWindow.setAdditionalGearActions(DefaultActionGroup(
            object : DumbAwareAction("重新连接", "重新连接本地 Agent 聊天界面", AllIcons.Actions.Refresh) {
                override fun getActionUpdateThread() = ActionUpdateThread.EDT
                override fun actionPerformed(event: AnActionEvent) = panel.start()
            },
            object : DumbAwareAction("语音配置与测试 / Voice settings", "修改语音识别供应商、密钥并测试录音识别", AllIcons.General.Settings) {
                override fun getActionUpdateThread() = ActionUpdateThread.EDT
                override fun actionPerformed(event: AnActionEvent) {
                    panel.openVoiceSettings()
                }
            },
        ))
        panel.start()
    }
}

internal object NativeAgentCommands {
    val all = listOf("new", "history", "settings")

    fun title(command: String): String = when (command) {
        "new" -> "新会话"
        "history" -> "聊天历史"
        else -> "Agent 配置"
    }

    fun description(command: String): String = when (command) {
        "new" -> "开始一个新的 Agent 会话"
        "history" -> "打开或返回聊天历史"
        else -> "打开或返回 Agent 配置与安装"
    }

    fun icon(command: String): Icon = when (command) {
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
    override fun actionPerformed(event: AnActionEvent) = fire()

    internal fun fire() = send(command)
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
    private val status = JLabel("正在启动本地 Agent…")
    private var browser: JBCefBrowser? = null
    private var connection: LocalRuntime.Connection? = null
    private var loaded = false
    private var closed = false
    private val pendingContexts = mutableListOf<String>()
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
    }

    fun addCurrentEditorContext() {
        FileEditorManager.getInstance(project).selectedTextEditor?.let { editor ->
            EditorContext.capture(project, editor)?.let(::addContext)
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

    fun start() {
        if (closed) return
        if (!JBCefApp.isSupported()) {
            showStatus("当前运行环境不支持 JCEF。请使用 IDEA 自带的 JetBrains Runtime。")
            return
        }
        // A (re)connect detaches the old page right away; keep every action
        // queued until the new webview has loaded, or clicks would fire into
        // the view that is about to be replaced and be lost.
        voice.cancel()
        loaded = false
        showStatus("正在启动本地 Agent…")
        project.getService(LocalRuntime::class.java).start().whenComplete { ready, error ->
            ApplicationManager.getApplication().invokeLater {
                if (closed || project.isDisposed) return@invokeLater
                if (error != null) showStatus("启动失败：${error.cause?.message ?: error.message}")
                else attach(ready)
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
                    "setLocale" -> preferences.setLocale(request.get("locale").asString)
                    "setAppearance" -> preferences.setAppearance(request.get("appearance").asString)
                    "addContext" -> ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) addCurrentEditorContext()
                    }
                    "addFileContext" -> ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            val context = FileContext.current(project)
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
        view.loadURL("${ready.endpoint}/?ide_token=${ready.token}&ide_theme=$theme&ide_chrome=1")
    }

    private fun openExternal(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) BrowserUtil.browse(url)
    }

    fun addContext(text: String) {
        if (closed) return
        if (!loaded) { pendingContexts.add(text); return }
        sendNativeCommand("chat")
        execute("window.ideaAgentReceiveContext?.(${gson.toJson(text)});")
    }

    fun openVoiceSettings() {
        if (closed || project.isDisposed) return
        voice.cancel()
        execute("window.dispatchEvent(new Event(\"ideaAgentVoiceSettingsOpening\"));")
        ApplicationManager.getApplication().getService(VoiceSettings::class.java)
            .configure(project, ApplicationManager.getApplication().getService(AgentPreferences::class.java).state.locale == "en-US")
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
