package dev.ideaagent

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.LocalFileSystem
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
import java.awt.FlowLayout
import java.nio.file.Path
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel

class AgentToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = AgentPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
        panel.start()
    }
}

class AgentPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
    private val body = JPanel(BorderLayout())
    private val status = JLabel("正在启动本地 Agent…")
    private var browser: JBCefBrowser? = null
    private var connection: LocalRuntime.Connection? = null
    private var loaded = false
    private var closed = false
    private val pendingContexts = mutableListOf<String>()
    private val gson = Gson()

    init {
        val toolbar = JPanel(FlowLayout(FlowLayout.LEFT, 6, 3))
        toolbar.add(JButton("加入当前代码").apply {
            toolTipText = "将选中代码或当前文件加入输入框"
            addActionListener {
                FileEditorManager.getInstance(project).selectedTextEditor?.let { editor ->
                    EditorContext.capture(project, editor)?.let(::addContext)
                }
            }
        })
        toolbar.add(JButton("重新连接").apply { addActionListener { start() } })
        add(toolbar, BorderLayout.NORTH)
        body.add(status, BorderLayout.CENTER)
        add(body, BorderLayout.CENTER)
        project.messageBus.connect(this).subscribe(LafManagerListener.TOPIC, LafManagerListener { syncTheme() })
    }

    fun start() {
        if (closed) return
        if (!JBCefApp.isSupported()) {
            showStatus("当前运行环境不支持 JCEF。请使用 IDEA 自带的 JetBrains Runtime。")
            return
        }
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
        browser?.let { Disposer.dispose(it) }
        loaded = false
        connection = ready
        val view = JBCefBrowser()
        browser = view
        Disposer.register(this, view)
        // Select the supported overload; the JBCefBrowser overload is scheduled for removal.
        val query = JBCefJSQuery.create(view as JBCefBrowserBase)
        Disposer.register(view, query)
        query.addHandler { payload ->
            if (closed || payload.length > 16384 || !LocalEndpoint.sameOrigin(ready.endpoint, view.cefBrowser.url)) {
                JBCefJSQuery.Response("Rejected", 1, "Invalid IDE request")
            } else try {
                val request = JsonParser.parseString(payload).asJsonObject
                when (request.get("action")?.asString) {
                    "openFile" -> {
                        require(request.get("rootId")?.asString == ready.rootId) { "Different project" }
                        val filePath = LocalEndpoint.projectFile(Path.of(requireNotNull(project.basePath)), request.get("path").asString)
                        val line = (request.get("line")?.asInt ?: 1).coerceAtLeast(1) - 1
                        ApplicationManager.getApplication().invokeLater {
                            if (!project.isDisposed) LocalFileSystem.getInstance().refreshAndFindFileByNioFile(filePath)?.let {
                                OpenFileDescriptor(project, it, line, 0).navigate(true)
                            }
                        }
                    }
                    "refresh" -> VirtualFileManager.getInstance().asyncRefresh(null)
                    else -> error("Unsupported IDE request")
                }
                JBCefJSQuery.Response("ok")
            } catch (_: Exception) {
                JBCefJSQuery.Response("Rejected", 1, "Cannot open this file in the current IDEA project")
            }
        }
        view.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(cefBrowser: CefBrowser, frame: CefFrame, statusCode: Int) {
                if (!frame.isMain || !LocalEndpoint.sameOrigin(ready.endpoint, frame.url)) return
                cefBrowser.executeJavaScript("window.ideaAgent = { postMessage: payload => { ${query.inject("JSON.stringify(payload)")} } };", frame.url, 0)
                ApplicationManager.getApplication().invokeLater {
                    if (closed || browser !== view) return@invokeLater
                    loaded = true
                    syncTheme()
                    val contexts = pendingContexts.toList()
                    pendingContexts.clear()
                    contexts.forEach(::addContext)
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
        view.loadURL("${ready.endpoint}/?ide_token=${ready.token}")
    }

    private fun openExternal(url: String) {
        if (url.startsWith("https://") || url.startsWith("http://")) BrowserUtil.browse(url)
    }

    fun addContext(text: String) {
        if (closed) return
        if (!loaded) { pendingContexts.add(text); return }
        execute("window.ideaAgentReceiveContext?.(${gson.toJson(text)});")
    }

    private fun syncTheme() {
        if (!loaded) return
        val background = UIUtil.getPanelBackground()
        val dark = (background.red * 299 + background.green * 587 + background.blue * 114) / 1000 < 128
        execute("window.ideaAgentSetTheme?.(${gson.toJson(if (dark) "dark" else "light")});")
    }

    private fun execute(script: String) {
        val view = browser ?: return
        val ready = connection ?: return
        if (LocalEndpoint.sameOrigin(ready.endpoint, view.cefBrowser.url)) view.cefBrowser.executeJavaScript(script, ready.endpoint.toString(), 0)
    }

    override fun dispose() { closed = true; pendingContexts.clear() }
}
