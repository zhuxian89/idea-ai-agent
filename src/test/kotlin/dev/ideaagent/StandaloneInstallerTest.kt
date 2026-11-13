package dev.ideaagent

import com.sun.net.httpserver.HttpServer
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.net.InetSocketAddress
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class StandaloneInstallerTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun bundledInstallerVerifiesDownloadsReportsFailureAndReusesAnInstallation() {
        val targetVersion = "0.1.26-standalone.42"
        val base = temporary.root.toPath()
        val dir = base.resolve("remote")
        val windows = System.getProperty("os.name").startsWith("Windows")
        val platform = if (windows) "windows" else if (System.getProperty("os.name").contains("Mac")) "macos" else "linux"
        val arch = if (System.getProperty("os.arch") in listOf("aarch64", "arm64")) "arm64" else "amd64"
        val bundle = "local-ai-agent-$targetVersion-$platform-$arch"
        val source = Files.createDirectory(base.resolve(bundle))
        val probeName = if (windows) "version-probe.exe" else "version-probe"
        val probeSource = base.resolve("version-probe.go")
        Files.writeString(probeSource, """
            package main
            import ("fmt"; "os"; "path/filepath")
            func main() {
                version, err := os.ReadFile(filepath.Join(filepath.Dir(os.Args[0]), "version.txt"))
                if err != nil { panic(err) }
                fmt.Printf("Local AI Agent %s", version)
            }
        """.trimIndent())
        val build = ProcessBuilder("go", "build", "-o", source.resolve(probeName).toString(), probeSource.toString()).redirectErrorStream(true).start()
        val buildOutput = build.inputStream.bufferedReader().use { it.readText() }
        assertEquals(buildOutput, 0, build.waitFor())
        val script = source.resolve(if (windows) "install.ps1" else "install.sh")
        // Exercise the real download and version commands without registering system jobs.
        Files.writeString(script, if (windows) """
            param([string]${'$'}Prefix = "", [switch]${'$'}DeferStart)
            ${'$'}exe = Join-Path ${'$'}env:IDE_AGENT_REMOTE_HOST_DIR 'installed.exe'
            Copy-Item (Join-Path ${'$'}PSScriptRoot '$probeName') ${'$'}exe -Force
            Set-Content -LiteralPath (Join-Path ${'$'}env:IDE_AGENT_REMOTE_HOST_DIR 'version.txt') -Value '$targetVersion'
            if (-not ${'$'}DeferStart) { Set-Content -LiteralPath (Join-Path ${'$'}env:IDE_AGENT_REMOTE_HOST_DIR 'updated') -Value 'yes' }
            @{ executable = ${'$'}exe } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path ${'$'}env:IDE_AGENT_REMOTE_HOST_DIR 'installation.json')
        """.trimIndent() else """
            #!/bin/sh
            set -eu
            cp "${'$'}(dirname "${'$'}0")/$probeName" "${'$'}IDE_AGENT_REMOTE_HOST_DIR/installed"
            printf '%s' '$targetVersion' > "${'$'}IDE_AGENT_REMOTE_HOST_DIR/version.txt"
            if [ "${'$'}2" != --defer-start ]; then touch "${'$'}IDE_AGENT_REMOTE_HOST_DIR/updated"; fi
            printf '{"executable":"%s/installed"}' "${'$'}IDE_AGENT_REMOTE_HOST_DIR" > "${'$'}IDE_AGENT_REMOTE_HOST_DIR/installation.json"
        """.trimIndent())
        val archive = base.resolve(bundle + if (windows) ".zip" else ".tar.gz")
        if (windows) ZipOutputStream(Files.newOutputStream(archive)).use {
            it.putNextEntry(ZipEntry("$bundle/install.ps1")); it.write(Files.readAllBytes(script)); it.closeEntry()
            it.putNextEntry(ZipEntry("$bundle/$probeName")); it.write(Files.readAllBytes(source.resolve(probeName))); it.closeEntry()
        } else {
            val process = ProcessBuilder("tar", "-czf", archive.toString(), bundle).directory(base.toFile()).start()
            assertEquals(0, process.waitFor())
        }
        val bytes = Files.readAllBytes(archive)
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val corrupted = AtomicBoolean(true)
        val requests = AtomicInteger()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/standalone-v$targetVersion/${archive.fileName}") { exchange ->
            requests.incrementAndGet()
            val content = if (exchange.requestURI.path.endsWith(".sha256")) ((if (corrupted.get()) "0".repeat(64) else digest) + "  ${archive.fileName}\n").toByteArray() else bytes
            exchange.sendResponseHeaders(200, content.size.toLong())
            exchange.responseBody.use { it.write(content) }
        }
        server.start()
        try {
            val environment = System.getenv() + mapOf("HOME" to base.toString(), "USERPROFILE" to base.toString(),
                "LOCAL_AI_AGENT_DOWNLOAD_BASE_URL" to "http://127.0.0.1:${server.address.port}")
            writeBackendMode(dir.resolve("backend-preference.json"), BackendMode.EMBEDDED)
            val installer = StandaloneInstaller()
            val states = mutableListOf<Boolean>()
            val changed = { states.add(installer.installing); Unit }
            // The user deleted the installation directory, but its record is still there.
            val deleted = base.resolve("deleted").resolve(if (windows) "local-ai-agent.exe" else "local-ai-agent")
            Files.writeString(dir.resolve("installation.json"), """{"executable":${com.google.gson.Gson().toJson(deleted.toString())}}""")
            assertFalse(isInstalled(dir))
            assertFalse(installer.install(dir, changed, environment, version = targetVersion))
            // Reaching the download (and failing its checksum) proves the stale record did not stop the install early.
            assertTrue(installer.error, installer.error.contains("SHA-256"))
            Files.delete(dir.resolve("installation.json"))
            assertNull(standaloneExecutable(dir))
            corrupted.set(false)
            assertTrue(installer.install(dir, changed, environment, version = targetVersion))
            assertEquals("", installer.error)
            assertNotNull(standaloneExecutable(dir))
            assertEquals(BackendMode.EMBEDDED, readBackendMode(dir.resolve("backend-preference.json")))
            assertFalse(Files.exists(dir.resolve("core.json")))
            val count = requests.get()
            assertTrue(installer.install(dir, changed, environment, version = targetVersion))
            assertEquals(count, requests.get())
            assertEquals(listOf(true, false, true, false, true, false), states)
            assertEquals(targetVersion, installedStandaloneVersion(dir))
            assertFalse(Files.exists(dir.resolve("updated")))

            Files.writeString(dir.resolve("version.txt"), "0.1.26-standalone.10")
            Files.writeString(dir.resolve("chat-history"), "existing chat")
            assertTrue(standaloneUpdateAvailable(requireNotNull(installedStandaloneVersion(dir)), targetVersion))
            corrupted.set(true)
            assertFalse(installer.install(dir, changed, environment, update = true, version = targetVersion))
            assertTrue(installer.error.contains("SHA-256"))
            assertEquals("0.1.26-standalone.10", installedStandaloneVersion(dir))
            assertFalse(Files.exists(dir.resolve("updated")))
            corrupted.set(false)
            assertTrue(installer.install(dir, changed, environment, update = true, version = targetVersion))
            assertEquals(targetVersion, installedStandaloneVersion(dir))
            assertTrue(Files.exists(dir.resolve("updated")))
            assertEquals("existing chat", Files.readString(dir.resolve("chat-history")))
            assertEquals(BackendMode.EMBEDDED, readBackendMode(dir.resolve("backend-preference.json")))
            val updatedCount = requests.get()
            assertTrue(installer.install(dir, changed, environment, update = true, version = targetVersion))
            Files.writeString(dir.resolve("version.txt"), "0.1.26-standalone.99")
            assertFalse(standaloneUpdateAvailable(requireNotNull(installedStandaloneVersion(dir)), targetVersion))
            assertTrue(installer.install(dir, changed, environment, update = true, version = targetVersion))
            assertEquals(updatedCount, requests.get())
            assertEquals("0.1.26-standalone.99", installedStandaloneVersion(dir))
        } finally { server.stop(0) }
    }
}
