package dev.ideaagent

internal data class IdeaContextRequest(val text: String, val target: String = "current")

/** Only explicit selections are captured. Never inspect files, environment or other consoles. */
internal object ConsoleContext {
    const val MAX_CHARS = 24_000

    fun format(selection: String, english: Boolean = false): String? {
        if (selection.isBlank()) return null
        val sanitized = redact(selection.replace("\r\n", "\n").replace('\r', '\n'))
        val truncated = sanitized.length > MAX_CHARS
        // Prefer complete boundary lines, but retain useful content even for a
        // giant single-line error. Never split a UTF-16 surrogate pair.
        val text = if (truncated) {
            val prefix = sanitized.take(MAX_CHARS / 2).let { if (it.last().isHighSurrogate()) it.dropLast(1) else it }
            val suffix = sanitized.takeLast(MAX_CHARS / 2).let { if (it.first().isLowSurrogate()) it.drop(1) else it }
            val head = prefix.substringBeforeLast('\n', prefix)
            val tail = suffix.substringAfter('\n', suffix)
            "$head\n${if (english) "[Selection truncated: middle omitted]" else "[选区过长：中间内容已省略]"}\n$tail"
        } else sanitized
        val fence = "`".repeat(maxOf(3, Regex("`+").findAll(text).maxOfOrNull { it.value.length + 1 } ?: 3))
        return if (english) {
            "Analyze this console output. Explain the cause and suggest a fix; do not modify code yet.\n\n" +
                "Source: IDEA Run/Debug console selection (not the complete log).\n" +
                "Common credentials are redacted; review for sensitive information before sending.\n$fence\n$text\n$fence"
        } else {
            "请分析以下控制台输出，先解释原因和修复建议，不要直接修改代码。\n\n" +
                "来源：IDEA Run/Debug 控制台选区（并非完整日志）。\n" +
                "已遮盖常见凭证，发送前请检查是否仍有敏感信息。\n$fence\n$text\n$fence"
        }
    }

    private fun redact(text: String): String = text
        .replace(Regex("-----BEGIN [^-]*PRIVATE KEY-----[\\s\\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)"), "[REDACTED PRIVATE KEY]")
        .replace(Regex("(?i)\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]+"), "$1 [REDACTED]")
        .replace(Regex("(?i)([\\\"']?(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|authorization|cookie|set-cookie)[\\\"']?\\s*[:=]\\s*)(\\\"[^\\\"\\n]*\\\"|'[^'\\n]*'|[^\\s,;&]+)"), "$1[REDACTED]")
        .replace(Regex("(?i)(https?://)[^/\\s:@]+:[^/\\s@]+@"), "$1[REDACTED]@")
}
