package dev.ideaagent

import com.intellij.openapi.ui.ValidationInfo
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Component
import java.awt.GridLayout
import javax.swing.DefaultListCellRenderer
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JPasswordField
import javax.swing.JTextField
import javax.swing.JCheckBox
import javax.swing.event.HyperlinkEvent

internal const val TENCENT_VOICE_PRICING = "https://cloud.tencent.com/document/product/1093/35686"

/** Provider-specific forms keep managed endpoint/model separate from custom inputs. */
internal class VoiceSettingsForm(
    val saved: VoiceSettings.Settings,
    private val savedTencentId: String,
    private val hasTencentKey: Boolean,
    private val english: Boolean,
    private val hasSiliconKey: Boolean = false,
    openLink: (String) -> Unit,
) : JPanel(BorderLayout(0, 12)) {
    val provider = JComboBox(VoiceProvider.values())
    val secretId = JTextField(savedTencentId, 36)
    val secretKey = JPasswordField(36)
    val endpoint = JTextField(saved.endpoint, 36)
    val model = JTextField(saved.model, 36)
    val apiKey = JPasswordField(36)
    val clearKey = JCheckBox(if (english) "Remove saved API key (local service)" else "清除已保存的 API Key（本地服务）")
    val tencentEndpoint = JTextField(TENCENT_VOICE_ENDPOINT, 36).apply { isEditable = false }
    val tencentModel = JTextField(if (english) "Chinese general · $TENCENT_VOICE_MODEL" else "中文通用 · $TENCENT_VOICE_MODEL", 36).apply { isEditable = false }
    val siliconEndpoint = JTextField(SILICON_VOICE_ENDPOINT, 36).apply { isEditable = false }
    val siliconModel = JTextField(SILICON_VOICE_MODEL, 36).apply { isEditable = false }
    val siliconApiKey = JPasswordField(36)
    val siliconPanel = JPanel(GridLayout(0, 1, 0, 6))
    private val cards = CardLayout()
    val tencentPanel = JPanel(GridLayout(0, 1, 0, 6))
    val customPanel = JPanel(GridLayout(0, 1, 0, 6))
    private val content = JPanel(cards)
    val help = JEditorPane("text/html", helpHtml(english)).apply {
        isEditable = false
        isOpaque = false
        putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, true)
        addHyperlinkListener { event ->
            if (event.eventType == HyperlinkEvent.EventType.ACTIVATED) {
                event.url?.toString()?.takeIf { it in helpLinks || it in siliconHelpLinks }?.let(openLink)
            }
        }
    }

    init {
        provider.renderer = object : DefaultListCellRenderer() {
            override fun getListCellRendererComponent(list: JList<*>?, value: Any?, index: Int, selected: Boolean, focus: Boolean): Component =
                super.getListCellRendererComponent(list, when (value) {
                    VoiceProvider.TENCENT -> if (english) "Tencent Cloud" else "腾讯云"
                    VoiceProvider.SILICONFLOW -> if (english) "SiliconFlow" else "硅基流动"
                    else -> if (english) "Custom service" else "自定义服务"
                }, index, selected, focus)
        }
        provider.selectedItem = saved.selectedProvider()
        add(JPanel(BorderLayout(8, 0)).apply {
            add(JLabel(if (english) "Provider" else "供应商"), BorderLayout.WEST)
            add(provider, BorderLayout.CENTER)
        }, BorderLayout.NORTH)
        tencentPanel.apply {
            field(if (english) "Service URL (automatic)" else "接口地址（自动带出）", tencentEndpoint)
            field(if (english) "Default model (automatic)" else "默认模型（自动带出）", tencentModel)
            field("SecretId", secretId)
            field(if (hasTencentKey) "SecretKey" + if (english) " (saved; leave blank to keep)" else "（已保存，留空保留）" else "SecretKey", secretKey)
        }
        customPanel.apply {
            field(if (english) "Full transcription URL (HTTPS, or local HTTP)" else "完整识别接口地址（HTTPS 或本地 HTTP）", endpoint)
            field(if (english) "Speech model" else "语音识别模型", model)
            field(if (english) "API Key (leave blank to keep)" else "API Key（留空保留）", apiKey)
            add(clearKey)
            add(JLabel(if (english) "Compatible with /audio/transcriptions." else "兼容 /audio/transcriptions 接口。"))
        }
        siliconPanel.apply {
            field(if (english) "Service URL (automatic)" else "接口地址（自动带出）", siliconEndpoint)
            field(if (english) "Default model (free)" else "默认模型（免费）", siliconModel)
            field(if (hasSiliconKey) "API Key" + if (english) " (saved; leave blank to keep)" else "（已保存，留空保留）" else "API Key", siliconApiKey)
        }
        content.add(siliconPanel, VoiceProvider.SILICONFLOW.id)
        content.add(tencentPanel, VoiceProvider.TENCENT.id)
        content.add(customPanel, VoiceProvider.CUSTOM.id)
        add(content, BorderLayout.CENTER)
        add(help, BorderLayout.SOUTH)
        fun refresh() {
            cards.show(content, selectedProvider.id)
            help.isVisible = selectedProvider != VoiceProvider.CUSTOM
            help.text = if (selectedProvider == VoiceProvider.SILICONFLOW) siliconHelpHtml(english) else helpHtml(english)
            help.caretPosition = 0
            revalidate(); repaint()
        }
        provider.addActionListener { refresh() }
        refresh()
    }

    val selectedProvider: VoiceProvider get() = provider.selectedItem as VoiceProvider

    fun validateInput(): ValidationInfo? {
        fun text(zh: String, en: String) = if (english) en else zh
        if (selectedProvider == VoiceProvider.TENCENT) {
            if (secretId.text.trim().isEmpty()) return ValidationInfo(text("请填写 SecretId，可通过下方链接获取。", "Enter SecretId. Use the link below to obtain it."), secretId)
            if (secretId.text.any { it.isWhitespace() }) return ValidationInfo(text("SecretId 不能含空格或换行。", "SecretId cannot contain whitespace."), secretId)
            if (String(secretKey.password).isBlank() && (!hasTencentKey || secretId.text.trim() != savedTencentId)) return ValidationInfo(text("请填写与 SecretId 对应的 SecretKey。", "Enter the SecretKey paired with this SecretId."), secretKey)
        } else if (selectedProvider == VoiceProvider.SILICONFLOW) {
            if (String(siliconApiKey.password).isBlank() && !hasSiliconKey) return ValidationInfo(text("请填写 API Key，可通过下方链接获取。", "Enter an API key using the link below."), siliconApiKey)
            if (String(siliconApiKey.password).trim().any { it.isWhitespace() }) return ValidationInfo(text("API Key 不能含空格或换行。", "API key cannot contain whitespace."), siliconApiKey)
        } else {
            try { validateVoiceEndpoint(endpoint.text) } catch (_: Exception) {
                return ValidationInfo(text("请输入 HTTPS 地址，或本机 localhost HTTP 地址。", "Enter an HTTPS URL, or a localhost HTTP URL."), endpoint)
            }
            if (model.text.isBlank() || model.text.length > 200 || model.text.any { it == '\r' || it == '\n' }) return ValidationInfo(text("请填写语音识别模型。", "Enter a speech model."), model)
        }
        return null
    }

    fun draftConfig(savedTencentKey: String, savedCustomKey: String, savedSiliconKey: String = ""): VoiceServiceConfig {
        check(validateInput() == null) { "Invalid voice configuration" }
        return if (selectedProvider == VoiceProvider.TENCENT) {
            VoiceServiceConfig(TENCENT_VOICE_ENDPOINT, TENCENT_VOICE_MODEL, provider = VoiceProvider.TENCENT,
                secretId = secretId.text.trim(), secretKey = String(secretKey.password).trim().ifEmpty { savedTencentKey })
        } else if (selectedProvider == VoiceProvider.SILICONFLOW) {
            siliconVoiceConfig(String(siliconApiKey.password).trim().ifEmpty { savedSiliconKey })
        } else {
            val key = if (clearKey.isSelected) "" else String(apiKey.password).trim().ifEmpty {
                if (endpoint.text.trim() == saved.endpoint) savedCustomKey else ""
            }
            VoiceServiceConfig(endpoint.text.trim(), model.text.trim(), key)
        }
    }

    fun setInputEnabled(enabled: Boolean) {
        listOf(provider, secretId, secretKey, endpoint, model, apiKey, clearKey, siliconApiKey).forEach { it.isEnabled = enabled }
    }

    fun clearPasswords() { secretKey.text = ""; apiKey.text = ""; siliconApiKey.text = "" }

    private fun JPanel.field(label: String, input: JComponent) { add(JLabel(label).apply { labelFor = input }); add(input) }

    companion object {
        val siliconHelpLinks = setOf(SILICON_VOICE_CONSOLE, SILICON_VOICE_KEYS, SILICON_VOICE_PRICING, SILICON_VOICE_LIMITS)
        fun siliconHelpHtml(english: Boolean): String = if (english) """
            <html><body style="width: 420px; margin: 0;">
            <p><b>Only an API key is required.</b> URL and model are filled automatically.</p>
            <p>1. <a href="$SILICON_VOICE_CONSOLE">Register or sign in to SiliconFlow</a> and complete identity verification.<br>
            2. <a href="$SILICON_VOICE_KEYS">Create an API key</a>, paste it above, then test and save.</p>
            <p><b>SenseVoiceSmall is currently free</b>, subject to account rate limits. <a href="$SILICON_VOICE_PRICING">Official pricing</a> · <a href="$SILICON_VOICE_LIMITS">Rate limits</a></p>
            <p>Each recording in this plugin is limited to 120 seconds. Your key stays in the IDE Password Safe. Audio is uploaded after recording stops; test results stay in this window.</p>
            </body></html>
        """.trimIndent() else """
            <html><body style="width: 420px; margin: 0;">
            <p><b>只需填写 API Key。</b>接口地址和模型自动带出。</p>
            <p>1. <a href="$SILICON_VOICE_CONSOLE">注册或登录硅基流动</a>，按提示完成实名认证。<br>
            2. <a href="$SILICON_VOICE_KEYS">创建 API Key</a>，复制到上方，测试通过后保存。</p>
            <p><b>SenseVoiceSmall 当前免费</b>，受账号调用频率限制。<a href="$SILICON_VOICE_PRICING">查看官方价格</a> · <a href="$SILICON_VOICE_LIMITS">查看限流说明</a></p>
            <p>插件单次录音最多 120 秒。密钥保存在 IDEA 密码保险箱；停止录音后上传识别，测试结果仅显示在当前窗口。</p>
            </body></html>
        """.trimIndent()

        val helpLinks = setOf(TENCENT_VOICE_REGISTER, TENCENT_VOICE_ACTIVATE, TENCENT_VOICE_KEYS, TENCENT_VOICE_PRICING)
        fun helpHtml(english: Boolean): String = if (english) """
            <html><body style="width: 420px; margin: 0;">
            <p><b>Only SecretId and SecretKey are required.</b></p>
            <p>1. <a href="$TENCENT_VOICE_REGISTER">Register a Tencent Cloud account</a> and complete identity verification.<br>
            2. <a href="$TENCENT_VOICE_ACTIVATE">Activate speech recognition</a> in the ASR console.<br>
            3. <a href="$TENCENT_VOICE_KEYS">Get SecretId / SecretKey</a>: create a key, then paste both values above and save.</p>
            <p>Sentence recognition includes <b>5,000 free successful calls per month</b>, usually enough for personal use. Each recording is limited to 60 seconds.<br>
            Beyond the quota, billing or suspension follows your account settings. <a href="$TENCENT_VOICE_PRICING">Official quota and pricing</a></p>
            <p>Credentials stay in the IDE Password Safe. Audio is sent after recording stops; text is added to your draft.</p>
            </body></html>
        """.trimIndent() else """
            <html><body style="width: 420px; margin: 0;">
            <p><b>只需填写 SecretId 和 SecretKey。</b></p>
            <p>1. <a href="$TENCENT_VOICE_REGISTER">注册腾讯云账号</a>，按提示完成实名认证。<br>
            2. <a href="$TENCENT_VOICE_ACTIVATE">开通语音识别</a>，在控制台点击“立即开通”。<br>
            3. <a href="$TENCENT_VOICE_KEYS">获取 SecretId / SecretKey</a>：点击“新建密钥”，将两项内容复制到上方并保存。</p>
            <p>一句话识别<b>每月免费 5,000 次</b>（成功识别次数），个人日常使用通常足够。单次录音最多 60 秒。<br>
            超出额度后按账号设置计费或停服。<a href="$TENCENT_VOICE_PRICING">查看官方额度与计费说明</a></p>
            <p>密钥保存在 IDEA 密码保险箱。停止录音后上传识别，文字加入草稿，不自动发送。</p>
            </body></html>
        """.trimIndent()
    }
}
