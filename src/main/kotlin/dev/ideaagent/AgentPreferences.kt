package dev.ideaagent

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import java.util.Locale

@Service(Service.Level.APP)
@State(name = "LocalAIAgentPreferences", storages = [Storage("local-ai-agent.xml")])
class AgentPreferences : PersistentStateComponent<AgentPreferences.Preferences> {
    data class Preferences(var locale: String? = null, var appearance: String? = null, var remoteSetupProject: String? = null)

    @Volatile private var preferences = Preferences()

    override fun getState(): Preferences = preferences

    override fun loadState(state: Preferences) {
        preferences = Preferences(state.locale?.takeIf(::isSupportedLocale), state.appearance?.takeIf(::isSupportedAppearance), state.remoteSetupProject)
    }

    /** A saved choice wins; before one exists, follow the system language the way the web UI does. */
    fun isEnglish(systemLanguage: String = Locale.getDefault().language): Boolean =
        useEnglish(preferences.locale, systemLanguage)

    @Synchronized fun setLocale(locale: String) {
        require(isSupportedLocale(locale)) { "Unsupported language" }
        preferences = preferences.copy(locale = locale)
    }

    @Synchronized fun setAppearance(appearance: String) {
        require(isSupportedAppearance(appearance)) { "Unsupported appearance" }
        preferences = preferences.copy(appearance = appearance)
    }

    @Synchronized fun continueRemoteAfterRestart(project: String) {
        preferences = preferences.copy(remoteSetupProject = project)
    }

    @Synchronized fun consumeRemoteContinuation(project: String): Boolean {
        if (preferences.remoteSetupProject != project) return false
        preferences = preferences.copy(remoteSetupProject = null)
        return true
    }

    private fun isSupportedLocale(locale: String): Boolean = locale == "zh-CN" || locale == "en-US"
    private fun isSupportedAppearance(appearance: String): Boolean = appearance in setOf("dark", "light", "system", "meadow", "moss")
}

/** The web UI falls back to Chinese for any language other than Chinese or English; keep the IDE side identical. */
internal fun useEnglish(saved: String?, systemLanguage: String): Boolean =
    if (saved != null) saved == "en-US" else systemLanguage == "en"

internal fun isEnglishUi(): Boolean =
    ApplicationManager.getApplication().getService(AgentPreferences::class.java).isEnglish()

/** Chooses IDE-side text when it is shown; pure formatting code takes an explicit flag instead. */
internal fun localized(zh: String, en: String): String = if (isEnglishUi()) en else zh
