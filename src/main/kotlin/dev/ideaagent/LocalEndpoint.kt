package dev.ideaagent

import java.net.URI
import java.nio.file.Path

internal object LocalEndpoint {
    fun parse(value: String): URI {
        val uri = URI(value)
        require(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port in 1..65535 &&
            uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            (uri.path.isNullOrEmpty() || uri.path == "/")) { "Invalid local runtime endpoint" }
        return uri
    }

    fun sameOrigin(base: URI, target: String): Boolean = runCatching {
        val uri = URI(target)
        uri.scheme == base.scheme && uri.host == base.host && uri.port == base.port && uri.rawUserInfo == null
    }.getOrDefault(false)

    fun projectFile(projectRoot: Path, relative: String): Path {
        require(relative.isNotBlank() && !relative.contains('\u0000')) { "Invalid file path" }
        val root = projectRoot.toRealPath()
        val candidate = root.resolve(relative).normalize().toRealPath()
        require(candidate.startsWith(root) && candidate != root) { "File is outside this IDEA project" }
        return candidate
    }
}
