package dev.ideaagent

import org.junit.Assert.*
import org.junit.Test

class ConsoleContextTest {
    @Test fun capturesOnlyTheSelectionAndKeepsNestedCauses() {
        val selection = "Exception\r\n at example.Order.run(Order.java:86)\r\nCaused by: SQL failure😀\n````"
        val context = requireNotNull(ConsoleContext.format(selection))
        assertTrue(context.contains("Order.java:86"))
        assertTrue(context.contains("Caused by: SQL failure😀"))
        assertTrue(context.contains("不要直接修改代码"))
        assertTrue(context.endsWith("\n`````"))
        assertFalse(context.contains('\r'))
        assertNull(ConsoleContext.format(" \n\t"))
    }

    @Test fun redactsCommonCredentialsWithoutRemovingErrorLocations() {
        val context = requireNotNull(ConsoleContext.format("""
            Authorization: Bearer abcSECRET123
            api_key=keySECRET123 password="pass SECRET123"
            {"access_token":"tokenSECRET123"}
            https://admin:secretSECRET123@example.test/path
            -----BEGIN RSA PRIVATE KEY-----
            privateSECRET123
            -----END RSA PRIVATE KEY-----
            at example.Order.run(Order.java:86)
        """.trimIndent()))
        assertFalse(context.contains("SECRET123"))
        assertTrue(context.contains("Order.java:86"))
        assertTrue(context.contains("[REDACTED]"))
    }

    @Test fun boundsLargeSelectionsAndExplicitlyKeepsHeadAndTail() {
        val text = "First exception\n" + "middle log\n".repeat(10_000) + "Caused by: final failure"
        val context = requireNotNull(ConsoleContext.format(text, true))
        assertTrue(context.contains("First exception"))
        assertTrue(context.contains("Caused by: final failure"))
        assertTrue(context.contains("Selection truncated"))
        assertTrue(context.length < ConsoleContext.MAX_CHARS + 1000)
    }

    @Test fun giantSingleLineDoesNotLeakPartialCredentialsOrBreakSurrogates() {
        val context = requireNotNull(ConsoleContext.format("😀".repeat(30_000)))
        assertTrue(context.contains("中间内容已省略"))
        assertTrue(context.contains("😀"))
        assertTrue(context.length < ConsoleContext.MAX_CHARS + 1000)
        assertFalse(context.contains('\uFFFD'))
    }
}
