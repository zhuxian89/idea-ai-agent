package dev.ideaagent

import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.JTextArea

internal class EmbeddedRecoveryPanel(english: Boolean, switchMode: () -> Unit) : JPanel(BorderLayout(0, JBUI.scale(6))) {
    init {
        border = JBUI.Borders.empty(10)
        val message = if (english) {
            "The standalone service isn’t responding. Switch to built-in mode to keep chatting in IDEA.\n\n" +
                "Switching stops active conversations and disconnects remote devices. Quit other IDEA instances first. This IDEA will restart."
        } else {
            "独立后台没有响应。切换到内置模式后，可以继续在 IDEA 里聊天。\n\n" +
                "切换会关闭独立后台，中断正在进行的对话和远程访问。请先退出其他 IDEA 实例，当前 IDEA 将重启。"
        }
        add(JTextArea(message).apply {
            font = UIUtil.getLabelFont()
            isEditable = false
            isOpaque = false
            lineWrap = true
            wrapStyleWord = true
        }, BorderLayout.CENTER)
        val button = JButton(if (english) "Switch to built-in mode" else "切换到内置模式")
        button.addActionListener {
            button.isEnabled = false
            switchMode()
        }
        add(JPanel(FlowLayout(FlowLayout.LEADING, 0, 0)).apply { add(button) }, BorderLayout.SOUTH)
    }
}
