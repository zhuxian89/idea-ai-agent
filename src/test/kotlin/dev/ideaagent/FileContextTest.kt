package dev.ideaagent

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbService
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.newvfs.impl.VfsRootAccess
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files
import java.nio.file.Path

class FileContextTest : BasePlatformTestCase() {
    private lateinit var directory: Path

    override fun setUp() {
        super.setUp()
        directory = Files.createTempDirectory("idea-agent-file-context")
        VfsRootAccess.allowRootAccess(testRootDisposable, directory.toString(), directory.toRealPath().toString())
    }

    override fun tearDown() {
        try {
            FileEditorManager.getInstance(project).openFiles.forEach {
                FileEditorManager.getInstance(project).closeFile(it)
            }
            directory.toFile().deleteRecursively()
        } finally {
            super.tearDown()
        }
    }

    private fun file(name: String): VirtualFile {
        val path = Files.writeString(directory.resolve(name), "original content of $name")
        return requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path))
    }

    fun testCurrentReferenceFollowsTheActiveEighthTabAndDoesNotIncludeContent() {
        val files = (1..10).map { file("file-$it.txt") }
        val manager = FileEditorManager.getInstance(project)
        files.forEach { manager.openFile(it, true) }
        manager.openFile(files[7], true)
        assertEquals("文件：${files[7].path}", FileContext.current(project))
        manager.openFile(files[2], true)
        assertEquals("文件：${files[2].path}", FileContext.current(project))
    }

    fun testAnUnopenedPopupFileDoesNotResolveToTheActiveEditor() {
        val active = file("active.txt")
        val clicked = file("中文 file with spaces.txt")
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(active, true)
        assertEquals("文件：${clicked.path}", FileContext.reference(clicked))
        assertFalse(manager.isFileOpen(clicked))
        assertEquals("文件：${active.path}", FileContext.current(project))
    }

    fun testNoActiveFileDoesNotFallBackToAnotherSource() {
        assertNull(FileContext.current(project))
        val folder = requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(directory))
        assertNull(FileContext.reference(folder))
    }

    fun testSelectedUnsavedCodeStillUsesTheOriginalContentCapture() {
        val file = file("unsaved.txt")
        val original = Files.readString(Path.of(file.path))
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(file, true)
        val editor = requireNotNull(manager.selectedTextEditor)
        WriteCommandAction.runWriteCommandAction(project) {
            editor.document.setText("first line\nselected unsaved code\nlast line")
        }
        editor.selectionModel.setSelection(11, 32)
        val code = requireNotNull(EditorContext.capture(project, editor))
        assertTrue(code.contains(":2（编辑器中未保存的内容）"))
        assertTrue(code.contains("selected unsaved code"))
        assertFalse(code.contains("first line"))
        assertFalse(code.contains("last line"))
        assertEquals("文件：${file.path}", FileContext.current(project))
        assertTrue(FileDocumentManager.getInstance().isDocumentUnsaved(editor.document))
        assertEquals(original, Files.readString(Path.of(file.path)))
    }

    fun testFileActionIsRegisteredInBothPopupsAndAvailableDuringIndexing() {
        val manager = ActionManager.getInstance()
        val action = requireNotNull(manager.getAction("IdeaAgent.AddFileContext"))
        assertTrue(action is AddFileContextAction)
        assertTrue(DumbService.isDumbAware(action))
        val clicked = file("clicked.txt")
        val context = DataContext { key ->
            when (key) {
                CommonDataKeys.PROJECT.name -> project
                CommonDataKeys.VIRTUAL_FILE.name -> clicked
                else -> null
            }
        }
        val event = AnActionEvent.createFromDataContext("test", null, context)
        action.update(event)
        assertTrue(event.presentation.isEnabledAndVisible)
        for (groupId in listOf("ProjectViewPopupMenu", "EditorTabPopupMenu")) {
            val group = manager.getAction(groupId) as ActionGroup
            assertTrue("file action missing from $groupId", group.getChildren(event).contains(action))
        }
    }
}
