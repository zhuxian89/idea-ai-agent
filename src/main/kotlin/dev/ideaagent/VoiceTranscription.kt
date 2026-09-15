package dev.ideaagent

import com.google.gson.JsonParser
import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

internal enum class VoiceProvider(val id: String) { TENCENT("tencent"), SILICONFLOW("siliconflow"), CUSTOM("custom") }
internal const val SILICON_VOICE_ENDPOINT = "https://api.siliconflow.cn/v1/audio/transcriptions"
internal const val SILICON_VOICE_MODEL = "FunAudioLLM/SenseVoiceSmall"
internal const val SILICON_VOICE_CONSOLE = "https://cloud.siliconflow.cn/"
internal const val SILICON_VOICE_KEYS = "https://cloud.siliconflow.cn/account/ak"
internal const val SILICON_VOICE_PRICING = "https://siliconflow.cn/pricing"
internal const val SILICON_VOICE_LIMITS = "https://docs.siliconflow.cn/cn/userguide/rate-limits/rate-limit-and-upgradation"

internal fun siliconVoiceConfig(apiKey: String) = VoiceServiceConfig(
    SILICON_VOICE_ENDPOINT, SILICON_VOICE_MODEL, apiKey, VoiceProvider.SILICONFLOW,
)

internal data class VoiceServiceConfig(
    val endpoint: String, val model: String, val apiKey: String = "",
    val provider: VoiceProvider = VoiceProvider.CUSTOM, val secretId: String = "", val secretKey: String = "",
) {
    val maxRecordingSeconds: Int get() = if (provider == VoiceProvider.TENCENT) 60 else 120
}
internal class VoiceFailure(val code: String) : RuntimeException(code)

internal fun validateVoiceEndpoint(endpoint: String): URI {
    val uri = URI(endpoint.trim())
    require(uri.host != null && uri.userInfo == null && uri.fragment == null && uri.query == null)
    require(uri.scheme == "https" || (uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "[::1]")))
    return uri
}

/** Compatible multipart transcription endpoint; no Agent credentials are reused. */
internal fun transcribeVoice(config: VoiceServiceConfig, wav: ByteArray): String {
    if (config.provider == VoiceProvider.TENCENT) {
        return parseTencentVoiceResponse(sendVoiceRequest(tencentVoiceRequest(config, wav), "tencentAuthentication"))
    }
    val request = multipartVoiceRequest(config, wav)
    val bytes = sendVoiceRequest(request, if (config.provider == VoiceProvider.SILICONFLOW) "siliconAuthentication" else "authentication")
    val result = try {
        val field = JsonParser.parseString(String(bytes, Charsets.UTF_8)).asJsonObject.get("text")
        if (field == null || !field.isJsonPrimitive || !field.asJsonPrimitive.isString) throw VoiceFailure("service")
        field.asString.trim()
    } catch (_: Exception) { throw VoiceFailure("service") }
    if (result.isBlank()) throw VoiceFailure("empty")
    return result
}

internal fun multipartVoiceRequest(settings: VoiceServiceConfig, wav: ByteArray): HttpRequest {
    val config = if (settings.provider == VoiceProvider.SILICONFLOW) siliconVoiceConfig(settings.apiKey) else settings
    val uri = validateVoiceEndpoint(config.endpoint)
    require(config.model.isNotBlank() && config.model.length <= 200 && !config.model.contains('\n') && !config.model.contains('\r'))
    val boundary = "idea-voice-${UUID.randomUUID()}"
    val body = ByteArrayOutputStream()
    fun text(value: String) = body.write(value.toByteArray(Charsets.UTF_8))
    text("--$boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n${config.model}\r\n")
    text("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n")
    body.write(wav)
    text("\r\n--$boundary--\r\n")
    val request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(90))
        .header("Content-Type", "multipart/form-data; boundary=$boundary")
        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()))
    if (config.apiKey.isNotBlank()) request.header("Authorization", "Bearer ${config.apiKey}")
    return request.build()
}

internal fun sendVoiceRequest(request: HttpRequest, authenticationError: String = "authentication"): ByteArray {
    val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build()
    val response = client.send(request, HttpResponse.BodyHandlers.ofInputStream())
    val bytes = response.body().use { it.readNBytes(1024 * 1024 + 1) }
    if (response.statusCode() !in 200..299) throw VoiceFailure(when (response.statusCode()) {
        401, 403 -> authenticationError
        429 -> "rateLimit"
        else -> "service"
    })
    if (bytes.size > 1024 * 1024) throw VoiceFailure("service")
    return bytes
}
