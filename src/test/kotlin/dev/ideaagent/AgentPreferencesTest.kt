package dev.ideaagent

import com.intellij.util.xmlb.XmlSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AgentPreferencesTest {
    @Test fun chosenLanguageSurvivesStateSerializationAndANewPluginInstance() {
        for (locale in listOf("zh-CN", "en-US")) {
            val previous = AgentPreferences()
            previous.setLocale(locale)
            val saved = XmlSerializer.serialize(previous.getState())
            val reinstalled = AgentPreferences()
            reinstalled.loadState(XmlSerializer.deserialize(saved, AgentPreferences.Preferences::class.java))
            assertEquals(locale, reinstalled.getState().locale)
        }
    }

    @Test fun missingOrInvalidSavedLanguageDoesNotForceEnglish() {
        val preferences = AgentPreferences()
        assertNull(preferences.getState().locale)
        preferences.loadState(AgentPreferences.Preferences("invalid"))
        assertNull(preferences.getState().locale)
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidBridgeLanguageIsRejected() {
        AgentPreferences().setLocale("unsupported")
    }

    @Test fun appearanceAndLanguageSurviveTogetherWithoutOverwritingEachOther() {
        for (appearance in listOf("dark", "light", "system", "meadow", "moss")) {
            val previous = AgentPreferences()
            previous.setAppearance(appearance)
            previous.setLocale("zh-CN")
            val restored = AgentPreferences()
            restored.loadState(XmlSerializer.deserialize(XmlSerializer.serialize(previous.getState()), AgentPreferences.Preferences::class.java))
            assertEquals("zh-CN", restored.getState().locale)
            assertEquals(appearance, restored.getState().appearance)
            restored.setAppearance("system")
            assertEquals("zh-CN", restored.getState().locale)
        }
    }

    @Test fun invalidStoredAppearanceDoesNotDiscardTheLanguage() {
        val preferences = AgentPreferences()
        preferences.loadState(AgentPreferences.Preferences("zh-CN", "invalid"))
        assertEquals("zh-CN", preferences.getState().locale)
        assertNull(preferences.getState().appearance)
    }

    @Test(expected = IllegalArgumentException::class)
    fun invalidBridgeAppearanceIsRejected() {
        AgentPreferences().setAppearance("unsupported")
    }
}
