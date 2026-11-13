package dev.ideaagent

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit

class BackendModeTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun choiceIsSavedWithoutChangingTheCurrentSessionAndAppliesOnReopen() {
        val dir = temporary.root.toPath()
        val preparations = mutableListOf<BackendMode>()
        BackendModeSession.open(dir) { mode, _ -> preparations.add(mode) }.use { first ->
            assertEquals(BackendMode.EMBEDDED, first.mode)
            writeBackendMode(dir.resolve("backend-preference.json"), BackendMode.STANDALONE)
            assertEquals(BackendMode.EMBEDDED, first.mode)
            assertEquals(listOf(BackendMode.EMBEDDED), preparations)
        }
        // An uninstalled choice stays pending and does not prevent local work.
        BackendModeSession.open(dir) { mode, _ -> preparations.add(mode) }.use {
            assertEquals(BackendMode.EMBEDDED, it.mode)
        }
        Files.writeString(dir.resolve("installation.json"), "{}")
        BackendModeSession.open(dir) { mode, previous ->
            assertEquals(BackendMode.EMBEDDED, previous)
            preparations.add(mode)
        }.use { assertEquals(BackendMode.STANDALONE, it.mode) }
        writeBackendMode(dir.resolve("backend-preference.json"), BackendMode.EMBEDDED)
        BackendModeSession.open(dir) { mode, previous ->
            assertEquals(BackendMode.STANDALONE, previous)
            preparations.add(mode)
        }.use { assertEquals(BackendMode.EMBEDDED, it.mode) }
        assertTrue(Files.exists(dir.resolve("installation.json")))
    }

    @Test fun existingInstallationKeepsStandaloneUntilUserChoosesOtherwise() {
        val dir = temporary.root.toPath()
        Files.writeString(dir.resolve("installation.json"), "{}")
        BackendModeSession.open(dir) { _, _ -> }.use { assertEquals(BackendMode.STANDALONE, it.mode) }
        assertNull(readBackendMode(dir.resolve("backend-preference.json")))
        Files.writeString(dir.resolve("backend-preference.json"), """{"mode":"unknown"}""")
        assertThrows(IllegalStateException::class.java) { BackendModeSession.open(dir) { _, _ -> } }
    }

    @Test fun anotherIdeaProcessKeepsItsModeUntilItsSharedLeaseIsReleased() {
        val dir = temporary.root.toPath()
        writeBackendMode(dir.resolve("active-backend.json"), BackendMode.STANDALONE)
        writeBackendMode(dir.resolve("backend-preference.json"), BackendMode.EMBEDDED)
        val source = dir.resolve("Lease.java")
        Files.writeString(source, """
            import java.nio.channels.*;
            import java.nio.file.*;
            class Lease {
                public static void main(String[] args) throws Exception {
                    try (var file = FileChannel.open(Path.of(args[0]), StandardOpenOption.CREATE, StandardOpenOption.READ, StandardOpenOption.WRITE);
                         var lock = file.lock(0, Long.MAX_VALUE, true)) {
                        System.out.println("ready"); System.out.flush(); System.in.read();
                    }
                }
            }
        """.trimIndent())
        val java = Path.of(System.getProperty("java.home"), "bin", if (System.getProperty("os.name").startsWith("Windows")) "java.exe" else "java")
        val child = ProcessBuilder(java.toString(), source.toString(), dir.resolve("ide-clients.lock").toString()).redirectErrorStream(true).start()
        try {
            assertEquals("ready", child.inputStream.bufferedReader().readLine())
            BackendModeSession.open(dir) { _, _ -> fail("Must not stop another IDEA's backend") }.use {
                assertEquals(BackendMode.STANDALONE, it.mode)
            }
        } finally {
            child.outputStream.close()
            if (!child.waitFor(10, TimeUnit.SECONDS)) child.destroyForcibly()
        }
        BackendModeSession.open(dir) { mode, _ -> assertEquals(BackendMode.EMBEDDED, mode) }.use {
            assertEquals(BackendMode.EMBEDDED, it.mode)
        }
    }
}
