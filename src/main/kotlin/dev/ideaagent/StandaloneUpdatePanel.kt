package dev.ideaagent

import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.JTextArea

internal data class StandaloneUpdateState(
    val version: String = "", val latest: String = "", val checking: Boolean = false,
    val updating: Boolean = false, val error: String = "",
) {
    val available: Boolean = latest.isNotEmpty() && version.isNotEmpty() && standaloneUpdateAvailable(version, latest)
}

/** Compact update entry for backend pages that predate the web settings bridge. */
internal class StandaloneUpdatePanel(
    private val english: Boolean,
    check: () -> Unit,
    update: () -> Unit,
) : JPanel(BorderLayout(0, 4)) {
    private fun label(cn: String, en: String) = if (english) en else cn
    private val description = JTextArea().apply {
        font = UIUtil.getLabelFont(); isEditable = false; isOpaque = false; lineWrap = true; wrapStyleWord = true
    }
    val checkButton = JButton(label("检查更新", "Check for updates"))
    val updateButton = JButton(label("更新并重启", "Update & restart"))

    init {
        border = JBUI.Borders.empty(6, 10)
        add(description, BorderLayout.CENTER)
        add(JPanel(FlowLayout(FlowLayout.LEFT, JBUI.scale(6), 0)).apply {
            add(checkButton); add(updateButton)
        }, BorderLayout.SOUTH)
        checkButton.addActionListener { check() }
        updateButton.addActionListener { update() }
        showState(StandaloneUpdateState())
    }

    fun showState(state: StandaloneUpdateState) {
        val name = label("独立后台", "Standalone service")
        description.text = when {
            state.updating -> label("正在更新，完成后重启 IDEA…", "Updating; IDEA will restart when finished…")
            state.error.isNotEmpty() -> "$name ${state.version}\n${state.error}"
            state.available -> "$name ${state.version} → ${state.latest}\n" + label("更新将重启后台和 IDEA，请先结束当前回复。", "Updating restarts the service and IDEA. Finish the current response first.")
            state.latest.isNotEmpty() -> "$name ${state.version} · " + label("已是最新版本", "Up to date")
            else -> "$name ${state.version}"
        }
        checkButton.text = if (state.checking) label("检查中…", "Checking…") else label("检查更新", "Check for updates")
        checkButton.isEnabled = !state.checking && !state.updating
        updateButton.isVisible = state.available
        updateButton.isEnabled = !state.checking && !state.updating
        revalidate(); repaint()
    }
}
