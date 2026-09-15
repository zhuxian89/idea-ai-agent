package dev.ideaagent

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.BrowserUtil
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JScrollPane
import java.awt.BorderLayout
import java.awt.Dimension

internal fun interface VoiceSettingsListener { fun changed() }

@Service(Service.Level.APP)
@State(name = "LocalAIAgentVoice", storages = [Storage("local-ai-agent-voice.xml")])
class VoiceSettings : PersistentStateComponent<VoiceSettings.Settings> {
    companion object {
        internal val TOPIC = com.intellij.util.messages.Topic.create("Voice settings changed", VoiceSettingsListener::class.java)
    }
    data class Settings(var endpoint: String = "", var model: String = "", var provider: String = "") {
        // UI summary uses the saved selection only; it never opens the Password Safe.
        internal fun activeProvider(): String? {
            if (provider.isBlank() && endpoint.isBlank()) return null
            val selected = selectedProvider()
            if (selected == VoiceProvider.CUSTOM && (endpoint.isBlank() || model.isBlank())) return null
            return selected.id
        }

        internal fun selectedProvider(): VoiceProvider = when (provider) {
            "tencent" -> VoiceProvider.TENCENT
            "siliconflow" -> VoiceProvider.SILICONFLOW
            "custom" -> VoiceProvider.CUSTOM
            // Preserve local.4 custom settings; fresh installs start with Tencent.
            else -> if (endpoint.isNotBlank()) VoiceProvider.CUSTOM else VoiceProvider.TENCENT
        }
    }
    @Volatile private var settings = Settings()
    private val configuring = java.util.concurrent.atomic.AtomicBoolean(false)
    private val customCredentials = CredentialAttributes("Local AI Agent: Voice transcription", null, null, false, true)
    private val tencentCredentials = CredentialAttributes("Local AI Agent: Tencent voice transcription", null, null, false, true)
    private val siliconCredentials = CredentialAttributes("Local AI Agent: SiliconFlow voice transcription", null, null, false, true)
    override fun getState(): Settings = settings
    override fun loadState(state: Settings) {
        settings = state.copy(provider = if (state.provider.isNotBlank() || state.endpoint.isNotBlank()) state.selectedProvider().id else "")
    }

    internal fun config(): VoiceServiceConfig? {
        val value = settings
        if (value.selectedProvider() == VoiceProvider.TENCENT) {
            val saved = PasswordSafe.instance.get(tencentCredentials) ?: return null
            val id = saved.userName.orEmpty()
            val key = saved.getPasswordAsString().orEmpty()
            if (id.isBlank() || key.isBlank()) return null
            return VoiceServiceConfig(TENCENT_VOICE_ENDPOINT, TENCENT_VOICE_MODEL, provider = VoiceProvider.TENCENT, secretId = id, secretKey = key)
        }
        if (value.selectedProvider() == VoiceProvider.SILICONFLOW) {
            val key = PasswordSafe.instance.getPassword(siliconCredentials).orEmpty()
            return key.takeIf { it.isNotBlank() }?.let(::siliconVoiceConfig)
        }
        if (value.endpoint.isBlank() || value.model.isBlank()) return null
        return VoiceServiceConfig(value.endpoint, value.model, PasswordSafe.instance.getPassword(customCredentials).orEmpty())
    }

    internal fun configure(project: Project, english: Boolean) {
        if (!configuring.compareAndSet(false, true)) return
        // Keychain access may prompt or block. Read it off the UI thread.
        val app = ApplicationManager.getApplication()
        app.executeOnPooledThread {
            val credentials = try {
                Triple(PasswordSafe.instance.get(tencentCredentials), PasswordSafe.instance.getPassword(customCredentials).orEmpty(),
                    PasswordSafe.instance.getPassword(siliconCredentials).orEmpty())
            } catch (_: Exception) {
                configuring.set(false)
                app.invokeLater {
                    if (!project.isDisposed) com.intellij.openapi.ui.Messages.showErrorDialog(project,
                        if (english) "Cannot read the IDE Password Safe. Unlock it and try again." else "无法读取 IDEA 密码保险箱，请解锁后重试。",
                        if (english) "Voice input" else "语音输入")
                }
                return@executeOnPooledThread
            }
            val (saved, savedCustomKey, savedSiliconKey) = credentials
            app.invokeLater {
                if (project.isDisposed) { configuring.set(false); return@invokeLater }
                try {
                    val form = VoiceSettingsForm(settings.copy(), saved?.userName.orEmpty(), !saved?.getPasswordAsString().isNullOrBlank(), english, savedSiliconKey.isNotBlank(), BrowserUtil::browse)
                    val dialog = object : DialogWrapper(project) {
                        val testPanel = VoiceTestPanel(english,
                            snapshot = { form.draftConfig(saved?.getPasswordAsString().orEmpty(), savedCustomKey, savedSiliconKey) },
                            validation = { form.validateInput()?.message },
                            onBusy = { busy -> form.setInputEnabled(!busy); setOKActionEnabled(!busy) },
                        )
                        init {
                            title = if (english) "Voice input configuration and test" else "语音输入配置与测试"
                            init()
                            setOKButtonText(if (english) "Save" else "保存")
                        }
                        override fun createCenterPanel(): JComponent = voiceSettingsContent(form, testPanel)
                        override fun doValidate(): ValidationInfo? = if (testPanel.isBusy)
                            ValidationInfo(if (english) "Finish or cancel the test before saving." else "请先完成或取消测试，再保存配置。")
                        else form.validateInput()
                        override fun doOKAction() {
                            if (!testPanel.isBusy) super.doOKAction()
                        }
                        override fun getPreferredFocusedComponent(): JComponent = when (form.selectedProvider) {
                            VoiceProvider.TENCENT -> form.secretId
                            VoiceProvider.SILICONFLOW -> form.siliconApiKey
                            VoiceProvider.CUSTOM -> form.endpoint
                        }
                    }
                    try {
                        if (dialog.showAndGet()) save(form)
                    } finally { dialog.testPanel.close(); form.clearPasswords() }
                } finally { configuring.set(false) }
            }
        }
    }

    private fun save(form: VoiceSettingsForm) {
        if (form.selectedProvider == VoiceProvider.TENCENT) {
            val key = String(form.secretKey.password).trim()
            if (key.isNotBlank()) PasswordSafe.instance.set(tencentCredentials, Credentials(form.secretId.text.trim(), key))
            settings = settings.copy(provider = VoiceProvider.TENCENT.id)
        } else if (form.selectedProvider == VoiceProvider.SILICONFLOW) {
            val key = String(form.siliconApiKey.password).trim()
            if (key.isNotBlank()) PasswordSafe.instance.set(siliconCredentials, Credentials("voice", key))
            settings = settings.copy(provider = VoiceProvider.SILICONFLOW.id)
        } else {
            val key = String(form.apiKey.password).trim()
            if (form.clearKey.isSelected || (form.endpoint.text.trim() != settings.endpoint && key.isBlank())) PasswordSafe.instance.set(customCredentials, null)
            else if (key.isNotBlank()) PasswordSafe.instance.set(customCredentials, Credentials("voice", key))
            settings = Settings(form.endpoint.text.trim(), form.model.text.trim(), VoiceProvider.CUSTOM.id)
        }
        ApplicationManager.getApplication().messageBus.syncPublisher(TOPIC).changed()
    }
}

/** Keep recording controls visible while long provider instructions scroll above. */
internal fun voiceSettingsContent(form: VoiceSettingsForm, testPanel: VoiceTestPanel): JPanel =
    JPanel(BorderLayout(0, 16)).apply {
        add(JScrollPane(form).apply {
            border = null
            preferredSize = Dimension(form.preferredSize.width + 24, minOf(form.preferredSize.height + 4, 400))
        }, BorderLayout.CENTER)
        add(testPanel, BorderLayout.SOUTH)
    }
