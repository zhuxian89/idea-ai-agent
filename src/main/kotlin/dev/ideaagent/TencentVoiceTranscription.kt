package dev.ideaagent

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.net.URI
import java.net.http.HttpRequest
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal const val TENCENT_VOICE_ENDPOINT = "https://asr.tencentcloudapi.com"
internal const val TENCENT_VOICE_MODEL = "16k_zh"
internal const val TENCENT_VOICE_REGISTER = "https://cloud.tencent.com/register"
internal const val TENCENT_VOICE_KEYS = "https://console.cloud.tencent.com/cam/capi"
internal const val TENCENT_VOICE_ACTIVATE = "https://console.cloud.tencent.com/asr"
internal const val TENCENT_VOICE_GUIDE = "https://cloud.tencent.com/document/product/1093/54362"

/** TC3 v3: https://cloud.tencent.com/document/api/1093/35641. */
internal fun tencentVoiceAuthorization(secretId: String, secretKey: String, timestamp: Long, payload: ByteArray): String {
    fun hash(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    fun hmac(key: ByteArray, value: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256")); doFinal(value.toByteArray(Charsets.UTF_8))
    }
    val headers = "content-type;host;x-tc-action"
    val canonical = "POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:asr.tencentcloudapi.com\nx-tc-action:sentencerecognition\n\n$headers\n${hash(payload)}"
    val date = Instant.ofEpochSecond(timestamp).atOffset(ZoneOffset.UTC).toLocalDate().toString()
    val scope = "$date/asr/tc3_request"
    val toSign = "TC3-HMAC-SHA256\n$timestamp\n$scope\n${hash(canonical.toByteArray(Charsets.UTF_8))}"
    val signing = hmac(hmac(hmac("TC3$secretKey".toByteArray(Charsets.UTF_8), date), "asr"), "tc3_request")
    val signature = hmac(signing, toSign).joinToString("") { "%02x".format(it) }
    return "TC3-HMAC-SHA256 Credential=$secretId/$scope, SignedHeaders=$headers, Signature=$signature"
}

internal fun tencentVoiceRequest(config: VoiceServiceConfig, wav: ByteArray, timestamp: Long = Instant.now().epochSecond): HttpRequest {
    if (config.secretId.isBlank() || config.secretKey.isBlank()) throw VoiceFailure("tencentAuthentication")
    // SentenceRecognition accepts at most 60s and 3MB after base64 encoding.
    val encoded = Base64.getEncoder().encodeToString(wav)
    if (encoded.length > 3_000_000) throw VoiceFailure("tooLong")
    val payload = JsonObject().apply {
        addProperty("EngSerViceType", TENCENT_VOICE_MODEL)
        addProperty("SourceType", 1)
        addProperty("VoiceFormat", "wav")
        addProperty("Data", encoded)
        addProperty("DataLen", wav.size)
    }.toString().toByteArray(Charsets.UTF_8)
    // Host and model are provider-owned; custom service fields cannot redirect Tencent credentials.
    return HttpRequest.newBuilder(URI(TENCENT_VOICE_ENDPOINT)).timeout(Duration.ofSeconds(90))
        .header("Content-Type", "application/json; charset=utf-8")
        .header("X-TC-Action", "SentenceRecognition")
        .header("X-TC-Version", "2019-06-14")
        .header("X-TC-Timestamp", timestamp.toString())
        .header("Authorization", tencentVoiceAuthorization(config.secretId, config.secretKey, timestamp, payload))
        .POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build()
}

internal fun parseTencentVoiceResponse(bytes: ByteArray): String {
    val response = try { JsonParser.parseString(String(bytes, Charsets.UTF_8)).asJsonObject.getAsJsonObject("Response") }
        catch (_: Exception) { throw VoiceFailure("service") }
        ?: throw VoiceFailure("service")
    val error = response.getAsJsonObject("Error")
    if (error != null) {
        val code = error.get("Code")?.asString.orEmpty()
        throw VoiceFailure(when {
            code == "AuthFailure.SignatureExpire" -> "clock"
            code == "AuthFailure.ServiceNotOpened" || code == "FailedOperation.ServiceNotOpened" -> "tencentActivation"
            code == "FailedOperation.UserNotAuthorized" -> "tencentActivation"
            code.startsWith("AuthFailure") || code == "UnauthorizedOperation" -> "tencentAuthentication"
            code.contains("Quota") || code.contains("Balance") || code.contains("Limit") || code.contains("ResourcePackage") -> "rateLimit"
            code.contains("VoicedataTooLong") -> "tooLong"
            code.contains("NoValidFragment") -> "empty"
            else -> "service"
        })
    }
    val field = response.get("Result")
    if (field == null || !field.isJsonPrimitive || !field.asJsonPrimitive.isString) throw VoiceFailure("service")
    return field.asString.trim().ifEmpty { throw VoiceFailure("empty") }
}
