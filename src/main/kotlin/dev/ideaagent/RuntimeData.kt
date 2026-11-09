package dev.ideaagent

import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat

internal fun runtimeDataDir(projectPath: Path, configDir: Path): Path {
    val canonicalPath = projectPath.toRealPath().toString()
    val hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonicalPath.toByteArray()))
    return configDir.resolve("idea-ai-agent").resolve(hash)
}

/**
 * The shared remote entry is only needed once the user has used remote access: this project enabled it,
 * or the computer was bound to Relay before (credentials.json). Everyone else starts it on demand when
 * the remote panel opens. An unreadable settings file keeps the entry on, as before, so the panel can
 * report the problem.
 */
internal fun remoteHostWanted(dataDir: Path, remoteHostDir: Path): Boolean =
    runCatching { remoteAccessEnabled(dataDir) }.getOrDefault(true) ||
        Files.isRegularFile(remoteHostDir.resolve("credentials.json"))

internal fun remoteAccessEnabled(dataDir: Path): Boolean {
    val saved = try {
        Files.readString(dataDir.resolve("remote-access.json"))
    } catch (_: NoSuchFileException) {
        return false // Projects that have never enabled remote access stay lazy.
    }
    val config = JsonParser.parseString(saved).asJsonObject
    val enabled = config.get("enabled") ?: return false
    require(enabled.isJsonPrimitive && enabled.asJsonPrimitive.isBoolean) {
        "remote-access.json: enabled must be a boolean"
    }
    return enabled.asBoolean
}
