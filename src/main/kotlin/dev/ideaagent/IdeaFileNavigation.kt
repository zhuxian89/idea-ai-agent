package dev.ideaagent

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.search.FilenameIndex
import com.intellij.psi.search.GlobalSearchScope
import java.nio.file.Path

internal data class IdeaFileReference(val path: String, val line: Int)

internal fun parseIdeaFileReference(rawPath: String, explicitLine: Int? = null): IdeaFileReference {
    var path = rawPath.trim()
    var parsedLine: Int? = null

    val fragment = LINE_FRAGMENT.find(path)
    if (fragment != null) {
        parsedLine = fragment.groupValues[1].toIntOrNull()
        path = path.removeRange(fragment.range)
    } else {
        val suffix = LINE_SUFFIX.find(path)
        if (suffix != null) {
            parsedLine = suffix.groupValues[1].toIntOrNull()
            path = path.removeRange(suffix.range)
        }
    }

    require(path.isNotBlank()) { "Missing file or class name" }
    return IdeaFileReference(path, (explicitLine ?: parsedLine ?: 1).coerceAtLeast(1))
}

internal fun findIdeaProjectFile(project: Project, projectRoot: Path, reference: IdeaFileReference): VirtualFile? {
    runCatching { LocalEndpoint.projectFile(projectRoot, reference.path) }
        .getOrNull()
        ?.let { LocalFileSystem.getInstance().refreshAndFindFileByNioFile(it) }
        ?.let { return it }

    val requested = reference.path.replace('\\', '/').trimEnd('/')
    val basename = requested.substringAfterLast('/')
    if (basename.isBlank()) return null

    val candidates = linkedSetOf(basename)
    if (SOURCE_EXTENSIONS.none { basename.endsWith(it, ignoreCase = true) }) {
        val simpleName = basename.substringAfterLast('.')
        SOURCE_EXTENSIONS.forEach { candidates.add(simpleName + it) }
    }

    val scope = GlobalSearchScope.projectScope(project)
    return candidates.withIndex().flatMap { (candidateOrder, name) ->
        FilenameIndex.getVirtualFilesByName(name, scope).map { candidateOrder to it }
    }.filter { !it.second.isDirectory }
        .minWithOrNull(compareBy<Pair<Int, VirtualFile>>(
            { if (it.second.path.replace('\\', '/').endsWith(requested)) 0 else 1 },
            { it.first },
            { it.second.path.length },
            { it.second.path },
        ))?.second
}

private val LINE_FRAGMENT = Regex("#L(\\d+)(?:C\\d+)?(?:-L?\\d+(?:C\\d+)?)?$")
private val LINE_SUFFIX = Regex(":(\\d+)(?::\\d+)?$")
private val SOURCE_EXTENSIONS = listOf(".java", ".kt", ".kts", ".groovy", ".scala")
