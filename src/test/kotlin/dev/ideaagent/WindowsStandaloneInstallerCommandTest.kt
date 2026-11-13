package dev.ideaagent

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.nio.file.Files
import java.util.concurrent.TimeUnit

class WindowsStandaloneInstallerCommandTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun windowsInstallerPreservesChineseErrorsAndQuotedPaths() {
        assumeTrue(System.getProperty("os.name").startsWith("Windows"))
        val script = temporary.root.toPath().resolve("installer with ' quote.ps1")
        val log = temporary.root.toPath().resolve("install.log")
        val message = "下载失败：中文错误详情"
        // 5.1 读取包含中文的脚本需要 BOM；输出仍必须由启动命令统一为 UTF-8。
        val content = """
            param([string]${'$'}Version, [switch]${'$'}DeferStart)
            if (${'$'}Version -ne '0.1.27' -or -not ${'$'}DeferStart) { throw 'Invalid installer arguments' }
            throw '$message'
        """.trimIndent()
        Files.writeString(script, "\uFEFF$content")
        val child = ProcessBuilder(windowsStandaloneInstallCommand(script, "0.1.27", deferStart = true))
            .redirectErrorStream(true).redirectOutput(log.toFile()).start()
        try {
            assertTrue("PowerShell timed out", child.waitFor(30, TimeUnit.SECONDS))
            assertNotEquals(0, child.exitValue())
            val output = Files.readString(log)
            assertTrue(output, output.contains(message))
            assertFalse(output, output.contains("Invalid installer arguments"))
        } finally { child.destroyForcibly() }
    }

    @Test fun windowsUpdateKeepsImmediateStartAndSuccessfulExit() {
        assumeTrue(System.getProperty("os.name").startsWith("Windows"))
        val script = temporary.root.toPath().resolve("update with spaces.ps1")
        val log = temporary.root.toPath().resolve("update.log")
        Files.writeString(script, """
            param([string]${'$'}Version, [switch]${'$'}DeferStart)
            if (${'$'}Version -ne '0.1.27' -or ${'$'}DeferStart) { throw 'Invalid update arguments' }
            Write-Output 'updated'
        """.trimIndent())
        val child = ProcessBuilder(windowsStandaloneInstallCommand(script, "0.1.27", deferStart = false))
            .redirectErrorStream(true).redirectOutput(log.toFile()).start()
        try {
            assertTrue("PowerShell timed out", child.waitFor(30, TimeUnit.SECONDS))
            val output = Files.readString(log)
            assertEquals(output, 0, child.exitValue())
            assertEquals("updated", output.trim())
        } finally { child.destroyForcibly() }
    }
}
