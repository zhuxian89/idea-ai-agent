package dev.ideaagent

import com.intellij.ide.AppLifecycleListener
import com.intellij.ide.plugins.DynamicPluginListener
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.openapi.extensions.PluginId

class AgentPluginLifecycleListener : DynamicPluginListener, AppLifecycleListener {
    override fun beforePluginUnload(pluginDescriptor: IdeaPluginDescriptor, isUpdate: Boolean) {
        if (pluginDescriptor.pluginId == PLUGIN_ID) LocalRuntime.shutdownAllForUnload()
    }

    override fun appWillBeClosed(isRestart: Boolean) {
        LocalRuntime.shutdownAllForUnload()
    }

    private companion object {
        val PLUGIN_ID: PluginId = PluginId.getId("dev.ideaagent.local")
    }
}
