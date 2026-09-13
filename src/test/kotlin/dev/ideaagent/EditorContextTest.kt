package dev.ideaagent

import org.junit.Assert.assertTrue
import org.junit.Test

class EditorContextTest {
    @Test fun preservesTheEndOfLargeUnsavedFiles() {
        val text = "a".repeat(128_001) + "\n````\n尾部尚未保存😀"
        val context = formatEditorContext("src/Example.java", 7, text, true)
        assertTrue(context.contains(text))
        assertTrue(context.startsWith("文件：src/Example.java:7（编辑器中未保存的内容）"))
        assertTrue(context.endsWith("\n`````"))
    }
}
