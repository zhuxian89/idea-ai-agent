package dev.ideaagent

import com.google.gson.JsonParser
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

internal fun standalonePlatform(): String {
    val os = System.getProperty("os.name")
    val platform = when {
        os.startsWith("Windows") -> "windows"
        os.startsWith("Mac") -> "macos"
        os.startsWith("Linux") -> "linux"
        else -> error("Unsupported system: $os")
    }
    val architecture = when (val arch = System.getProperty("os.arch")) {
        "aarch64", "arm64" -> "arm64"
        "amd64", "x86_64" -> "amd64"
        else -> error("Unsupported architecture: $arch")
    }
    return "$platform-$architecture"
}

/** Releases are selected by version and complete assets, including the project's standalone prereleases. */
internal fun selectStandaloneRelease(json: String, platform: String): String {
    val versions = JsonParser.parseString(json).asJsonArray.mapNotNull { value ->
        val release = value.asJsonObject
        if (release.get("draft")?.asBoolean == true) return@mapNotNull null
        val tag = release.get("tag_name")?.asString ?: return@mapNotNull null
        val match = Regex("standalone-v(\\d+\\.\\d+\\.\\d+(?:-standalone\\.\\d+)?)").matchEntire(tag) ?: return@mapNotNull null
        val version = match.groupValues[1]
        val extension = if (platform.startsWith("windows-")) "zip" else "tar.gz"
        val archive = "local-ai-agent-$version-$platform.$extension"
        val assets = release.getAsJsonArray("assets").map { it.asJsonObject.get("name").asString }.toSet()
        if (archive in assets && "$archive.sha256" in assets) version else null
    }
    return versions.maxWithOrNull { a, b -> compareStandaloneVersions(a, b) }
        ?: error("No standalone release with a package and checksum for $platform")
}

internal fun latestStandaloneVersion(
    endpoint: URI = URI("https://api.github.com/repos/zhuxian89/idea-ai-agent/releases?per_page=100"),
    platform: String = standalonePlatform(),
): String {
    val request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(20))
        .header("Accept", "application/vnd.github+json").header("User-Agent", "Local-AI-Agent-IDEA").GET().build()
    val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofString())
    check(response.statusCode() == 200) { "GitHub Releases returned HTTP ${response.statusCode()}" }
    return selectStandaloneRelease(response.body(), platform)
}

internal fun standaloneUpdateAvailable(installed: String, latest: String): Boolean =
    compareStandaloneVersions(installed, latest) < 0


private fun compareStandaloneVersions(left: String, right: String): Int {
    fun parts(value: String): List<Long> {
        val match = requireNotNull(Regex("(\\d+)\\.(\\d+)\\.(\\d+)(?:-standalone\\.(\\d+))?").matchEntire(value)) {
            "Unrecognized standalone version: $value"
        }
        return (1..3).map { match.groupValues[it].toLong() } +
            (match.groups[4]?.value?.toLong() ?: Long.MAX_VALUE)
    }
    val a = parts(left)
    val b = parts(right)
    for (i in a.indices) if (a[i] != b[i]) return a[i].compareTo(b[i])
    return 0
}
