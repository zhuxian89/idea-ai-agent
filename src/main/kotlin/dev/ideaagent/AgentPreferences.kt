package dev.ideaagent

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@Service(Service.Level.APP)
@State(name = "LocalAIAgentPreferences", storages = [Storage("local-ai-agent.xml")])
class AgentPreferences : PersistentStateComponent<AgentPreferences.Preferences> {
    data class Preferences(var locale: String? = null, var appearance: String? = null)

    @Volatile private var preferences = Preferences()

    override fun getState(): Preferences = preferences

    override fun loadState(state: Preferences) {
        preferences = Preferences(state.locale?.takeIf(::isSupportedLocale), state.appearance?.takeIf(::isSupportedAppearance))
    }

    @Synchronized fun setLocale(locale: String) {
        require(isSupportedLocale(locale)) { "Unsupported language" }
        preferences = preferences.copy(locale = locale)
    }

    @Synchronized fun setAppearance(appearance: String) {
        require(isSupportedAppearance(appearance)) { "Unsupported appearance" }
        preferences = preferences.copy(appearance = appearance)
    }

    private fun isSupportedLocale(locale: String): Boolean = locale == "zh-CN" || locale == "en-US"
    private fun isSupportedAppearance(appearance: String): Boolean = appearance in setOf("dark", "light", "system", "meadow", "moss")
}
