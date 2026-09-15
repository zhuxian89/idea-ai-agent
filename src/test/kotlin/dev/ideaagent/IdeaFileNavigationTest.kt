package dev.ideaagent

import com.intellij.openapi.application.ReadAction
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Path

class IdeaFileNavigationTest : BasePlatformTestCase() {
    fun testClassNameLinkFindsItsJavaSourceInsideTheProject() {
        val source = myFixture.addFileToProject(
            "src/main/java/example/CheckPlanAutoJobStatusEnum.java",
            "package example; enum CheckPlanAutoJobStatusEnum { ACTIVE }",
        ).virtualFile

        val found = ReadAction.compute<com.intellij.openapi.vfs.VirtualFile?, RuntimeException> {
            findIdeaProjectFile(project, Path.of(requireNotNull(project.basePath)),
                IdeaFileReference("CheckPlanAutoJobStatusEnum", 1))
        }

        assertEquals(source, found)
    }

    fun testAPathWithAnExtractedLineStillUsesTheExactProjectFile() {
        val source = myFixture.addFileToProject("src/main/kotlin/example/Worker.kt", "class Worker").virtualFile
        val reference = parseIdeaFileReference("src/main/kotlin/example/Worker.kt#L27")

        val found = ReadAction.compute<com.intellij.openapi.vfs.VirtualFile?, RuntimeException> {
            findIdeaProjectFile(project, Path.of(requireNotNull(project.basePath)), reference)
        }

        assertEquals(27, reference.line)
        assertEquals(source, found)
    }
}
