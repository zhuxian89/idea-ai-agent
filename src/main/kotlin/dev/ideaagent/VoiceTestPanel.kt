package dev.ideaagent

import java.awt.BorderLayout
import java.awt.FlowLayout
import java.util.UUID
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.SwingUtilities

/** Uses the same recorder and transcription adapters as chat, but owns its result. */
internal class VoiceTestPanel(
    private val english: Boolean,
    private val snapshot: () -> VoiceServiceConfig,
    private val validation: () -> String?,
    private val onBusy: (Boolean) -> Unit = {},
    capture: (VoiceServiceConfig) -> VoiceCapture = { VoiceRecorder(it.maxRecordingSeconds) },
    transcribe: (VoiceServiceConfig, ByteArray) -> String = ::transcribeVoice,
) : JPanel(BorderLayout(0, 8)), AutoCloseable {
    val startButton = JButton(if (english) "Test speech recognition" else "测试语音识别")
    val stopButton = JButton(if (english) "Stop and transcribe" else "停止并识别")
    val cancelButton = JButton(if (english) "Cancel test" else "取消测试")
    val status = JTextArea(if (english) "Record a sentence to test the current form. Results stay here; nothing is sent to chat." else "录一句话测试当前填写的配置。结果仅显示在这里，不写入聊天。", 2, 40).apply { isEditable = false; isOpaque = false; lineWrap = true; wrapStyleWord = true }
    val result = JTextArea(3, 40).apply { isEditable = false; lineWrap = true; wrapStyleWord = true }
    @Volatile private var currentConfig: VoiceServiceConfig? = null
    private var activeId: String? = null
    val isBusy: Boolean get() = activeId != null
    private var closed = false
    private var stopping = false
    private val controller = VoiceInputController({ currentConfig }, { event ->
        SwingUtilities.invokeLater { if (!closed && event.id == activeId) receive(event) }
    }, capture, transcribe)

    init {
        border = BorderFactory.createCompoundBorder(BorderFactory.createMatteBorder(1, 0, 0, 0, javax.swing.UIManager.getColor("Separator.foreground") ?: java.awt.Color.GRAY), BorderFactory.createEmptyBorder(12, 0, 0, 0))
        val controls = JPanel(FlowLayout(FlowLayout.LEADING, 6, 0)).apply { add(startButton); add(stopButton); add(cancelButton) }
        add(JPanel(BorderLayout(0, 8)).apply { add(controls, BorderLayout.NORTH); add(status, BorderLayout.SOUTH) }, BorderLayout.NORTH)
        add(JScrollPane(result), BorderLayout.CENTER)
        stopButton.isEnabled = false
        cancelButton.isEnabled = false
        startButton.addActionListener { start() }
        stopButton.addActionListener {
            stopping = true
            activeId?.let(controller::stop)
            stopButton.isEnabled = false
            status.text = if (english) "Stopping recording…" else "正在停止录音…"
        }
        cancelButton.addActionListener { cancel() }
    }

    private fun start() {
        if (closed || activeId != null) return
        validation()?.let { status.text = it; return }
        stopping = false
        currentConfig = snapshot()
        result.text = ""
        status.text = if (english) "Opening microphone…" else "正在打开麦克风…"
        activeId = UUID.randomUUID().toString()
        startButton.isEnabled = false
        cancelButton.isEnabled = true
        onBusy(true)
        controller.start(activeId!!)
    }

    private fun receive(event: VoiceInputEvent) {
        when (event.state) {
            "recording" -> {
                if (stopping) return
                val seconds = event.elapsedMs / 1000
                status.text = if (english) "Listening · ${seconds}s / ${event.limitSeconds}s" else "正在聆听 · ${seconds} 秒 / ${event.limitSeconds} 秒"
                stopButton.isEnabled = true
            }
            "transcribing" -> { status.text = if (english) "Transcribing…" else "正在识别…"; stopButton.isEnabled = false }
            "done" -> {
                result.text = event.text.orEmpty()
                status.text = if (english) "Test passed. Review the text below, then save your configuration." else "测试成功。请查看下方识别结果，再保存配置。"
                finish()
            }
            "error", "configuration" -> {
                status.text = if (english) "Test failed. See the details below." else "测试失败，请查看下方说明。"
                result.text = voiceTestError(event.error.orEmpty(), english)
                finish()
            }
        }
    }

    private fun finish() {
        activeId = null
        currentConfig = null
        startButton.isEnabled = true
        stopButton.isEnabled = false
        cancelButton.isEnabled = false
        onBusy(false)
    }

    fun cancel() {
        activeId?.let(controller::cancel)
        finish()
        status.text = if (english) "Test cancelled. Your configuration has not been changed." else "测试已取消，配置未改变。"
    }

    override fun close() {
        if (closed) return
        closed = true
        cancel()
        controller.close()
        result.text = ""
    }
}

internal fun voiceTestError(code: String, english: Boolean): String {
    val texts = when (code) {
        "microphone" -> "无法打开麦克风，请检查系统权限和输入设备。" to "Cannot open the microphone. Check system permission and input device."
        "tencentAuthentication" -> "腾讯云认证失败，请检查 SecretId / SecretKey 是否匹配，以及语音识别权限。" to "Tencent Cloud authentication failed. Check the SecretId/SecretKey pair and speech permissions."
        "tencentActivation" -> "请先通过上方“开通语音识别”链接开通腾讯云服务。" to "Activate Tencent speech recognition using the link above."
        "siliconAuthentication" -> "硅基流动认证或权限校验失败，请检查 API Key、实名认证和模型访问权限。" to "SiliconFlow authentication or permission check failed. Check your API key, identity verification and model access."
        "authentication" -> "认证失败，请检查自定义服务的 API Key。" to "Authentication failed. Check the custom service API key."
        "rateLimit" -> "额度或请求频率受限，请检查服务用量或稍后重试。" to "Quota or rate limit reached. Check service usage or retry later."
        "empty" -> "没有识别到语音，请靠近麦克风说一句话后重试。" to "No speech recognized. Speak closer to the microphone and retry."
        "clock" -> "系统时间校验失败，请同步电脑时间后重试。" to "Request time rejected. Synchronize your system clock and retry."
        "tooLong" -> "录音超过服务限制，请缩短后重试。" to "Recording exceeds service limits. Try a shorter recording."
        else -> "识别服务请求失败，请检查网络；自定义服务还需检查接口地址与模型。" to "Speech service request failed. Check your connection; for custom services, also check the URL and model."
    }
    return if (english) texts.second else texts.first
}
