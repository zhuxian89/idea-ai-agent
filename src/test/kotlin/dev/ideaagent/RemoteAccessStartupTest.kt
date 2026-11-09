package dev.ideaagent

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.security.MessageDigest
import java.util.HexFormat

class RemoteAccessStartupTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun startupReadsTheExistingRuntimeSettingsWithoutCreatingOrChangingThem() {
        val project = temporary.newFolder("project with spaces").toPath()
        val config = temporary.newFolder("idea-config").toPath()
        // Keep the pre-existing project's SHA-256 directory contract across this refactor.
        val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
            .digest(project.toRealPath().toString().toByteArray()))
        val data = config.resolve("idea-ai-agent").resolve(hash)
        assertEquals(data, runtimeDataDir(project.resolve("."), config))
        assertFalse(remoteAccessEnabled(data))
        assertFalse(Files.exists(data))

        Files.createDirectories(data)
        val settings = data.resolve("remote-access.json")
        for ((json, expected) in listOf("{}" to false, "{\"enabled\":false}" to false, "{\"enabled\":true}" to true)) {
            Files.writeString(settings, json)
            assertEquals(expected, remoteAccessEnabled(runtimeDataDir(project, config)))
            assertEquals(json, Files.readString(settings))
        }
        val otherProject = temporary.newFolder("other-project").toPath()
        assertFalse(remoteAccessEnabled(runtimeDataDir(otherProject, config)))
    }

    @Test fun invalidSettingsAreReportedInsteadOfEnablingRemoteAccessOrSilentlyDisablingIt() {
        val data = temporary.newFolder("data").toPath()
        for (json in listOf("broken json", "[]", "{\"enabled\":\"true\"}", "{\"enabled\":1}")) {
            Files.writeString(data.resolve("remote-access.json"), json)
            assertThrows(Exception::class.java) { remoteAccessEnabled(data) }
        }
    }

    @Test fun sharedRemoteEntryStartsOnlyForProjectsThatUsedRemoteAccess() {
        val data = temporary.newFolder("project-data").toPath()
        val host = temporary.newFolder("remote-host").toPath()
        assertFalse("never used remote access: start on demand", remoteHostWanted(data, host))

        Files.writeString(data.resolve("remote-access.json"), "{\"enabled\":false}")
        assertFalse(remoteHostWanted(data, host))

        Files.writeString(host.resolve("credentials.json"), "{}")
        assertTrue("computer is already bound: keep the entry available", remoteHostWanted(data, host))
        Files.delete(host.resolve("credentials.json"))

        Files.writeString(data.resolve("remote-access.json"), "{\"enabled\":true}")
        assertTrue(remoteHostWanted(data, host))

        Files.writeString(data.resolve("remote-access.json"), "broken json")
        assertTrue("unreadable settings must surface in the panel, not silently disable remote", remoteHostWanted(data, host))
    }
}
