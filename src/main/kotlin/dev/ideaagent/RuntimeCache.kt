package dev.ideaagent

import java.io.IOException
import java.nio.charset.StandardCharsets
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.FileTime
import java.time.Instant
import java.security.MessageDigest
import java.util.HexFormat

/**
 * Copies the platform runtime out of the plugin installation directory before it is launched.
 * Windows locks a running executable, so executing the bundled copy would prevent IDEA from
 * replacing the plugin during an update.
 */
internal fun materializeRuntime(source: Path, executableName: String, cacheRoot: Path): Path {
    require(Files.isDirectory(source)) { "Missing bundled runtime directory: $source" }
    val files = runtimeFiles(source, executableName)
    require(files.any { source.relativize(it).toString() == executableName }) {
        "This plugin package does not include $executableName"
    }
    val fingerprint = runtimeFingerprint(source, files)
    Files.createDirectories(cacheRoot)
    val target = cacheRoot.resolve(fingerprint)
    target.takeIf { cachedRuntimeReady(it, executableName, fingerprint) }
        ?.let {
            markRuntimeUsed(it)
            pruneRuntimeCache(cacheRoot, it)
            return it.resolve(executableName)
        }

    val staging = Files.createTempDirectory(cacheRoot, ".install-")
    try {
        for (file in files) {
            val relative = source.relativize(file)
            val destination = staging.resolve(relative.toString())
            Files.createDirectories(destination.parent)
            Files.copy(file, destination)
        }
        val stagedExecutable = staging.resolve(executableName)
        if (!executableName.endsWith(".exe")) {
            check(stagedExecutable.toFile().setExecutable(true, true)) { "Cannot enable runtime executable" }
        }
        Files.writeString(staging.resolve(COMPLETE_MARKER), fingerprint, StandardCharsets.UTF_8)
        moveRuntimeIntoPlace(staging, target, executableName, fingerprint)
    } finally {
        if (Files.exists(staging)) deleteTree(staging)
    }
    check(cachedRuntimeReady(target, executableName, fingerprint)) { "Runtime cache is incomplete: $target" }
    markRuntimeUsed(target)
    pruneRuntimeCache(cacheRoot, target)
    return target.resolve(executableName)
}

/** The marker's mtime records the last launch, so pruning can rank cached versions by use. */
private fun markRuntimeUsed(runtime: Path) {
    runCatching { Files.setLastModifiedTime(runtime.resolve(COMPLETE_MARKER), FileTime.from(Instant.now())) }
}

/**
 * Every plugin update leaves a ~30 MB fingerprint directory behind. Keep the current runtime and the
 * most recently used older ones, plus every runtime still used by a process (including the independent
 * core). Only complete fingerprint directories are touched, never `.install-*` staging
 * directories of concurrent windows. Best effort: a locked file (Windows) is retried on a later start.
 */
internal fun pruneRuntimeCache(cacheRoot: Path, current: Path, keepPrevious: Int = 1) {
    runCatching {
        val runningDirectories = ProcessHandle.allProcesses().use { processes ->
            processes.toList().mapNotNull { process ->
                process.info().command().orElse(null)?.let { command ->
                    // Processes may exit while their executable directory is being resolved.
                    runCatching { Path.of(command).parent?.toRealPath() }.getOrNull()
                }
            }.toSet()
        }
        val others = Files.list(cacheRoot).use { entries ->
            entries.filter { it != current && Files.isDirectory(it) && FINGERPRINT.matches(it.fileName.toString()) }.toList()
        }.mapNotNull { dir ->
            runCatching { dir to Files.getLastModifiedTime(dir.resolve(COMPLETE_MARKER)) }.getOrNull()
        }.sortedByDescending { it.second }
        others.drop(keepPrevious).forEach { (dir, _) ->
            if (dir.toRealPath() !in runningDirectories) deleteTree(dir)
        }
    }
}

private fun runtimeFiles(source: Path, executableName: String): List<Path> =
    Files.walk(source).use { paths ->
        paths.filter { path ->
            if (!Files.isRegularFile(path)) return@filter false
            val name = path.fileName.toString()
            !name.startsWith(RUNTIME_PREFIX) || name == executableName
        }.toList().sortedBy { source.relativize(it).toString().replace('\\', '/') }
    }

private fun runtimeFingerprint(source: Path, files: List<Path>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    for (file in files) {
        val relative = source.relativize(file).toString().replace('\\', '/')
        digest.update(relative.toByteArray(StandardCharsets.UTF_8))
        digest.update(0)
        Files.newInputStream(file).use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
    }
    return HexFormat.of().formatHex(digest.digest())
}

private fun moveRuntimeIntoPlace(staging: Path, target: Path, executableName: String, fingerprint: String) {
    try {
        Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE)
    } catch (unsupported: AtomicMoveNotSupportedException) {
        try {
            Files.move(staging, target)
        } catch (error: IOException) {
            if (!cachedRuntimeReady(target, executableName, fingerprint)) throw error
        }
    } catch (error: IOException) {
        // Another IDEA window may have populated the same content-addressed cache first.
        if (!cachedRuntimeReady(target, executableName, fingerprint)) throw error
    }
}

private fun cachedRuntimeReady(target: Path, executableName: String, fingerprint: String): Boolean =
    Files.isRegularFile(target.resolve(executableName)) &&
        runCatching { Files.readString(target.resolve(COMPLETE_MARKER), StandardCharsets.UTF_8) == fingerprint }
            .getOrDefault(false)

private fun deleteTree(root: Path) {
    runCatching {
        Files.walk(root).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}

private const val RUNTIME_PREFIX = "idea-agent-"
private const val COMPLETE_MARKER = ".complete"
private val FINGERPRINT = Regex("[a-f0-9]{64}")
