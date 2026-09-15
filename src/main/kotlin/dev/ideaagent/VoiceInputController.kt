package dev.ideaagent

import java.util.concurrent.Executors
import java.util.concurrent.Future

internal data class VoiceInputEvent(val id: String, val state: String, val level: Double = 0.0, val elapsedMs: Int = 0, val text: String? = null, val error: String? = null, val limitSeconds: Int = 120, val provider: String? = null)

internal class VoiceInputController(
    private val config: () -> VoiceServiceConfig?,
    private val emit: (VoiceInputEvent) -> Unit,
    private val capture: (VoiceServiceConfig) -> VoiceCapture = { VoiceRecorder(it.maxRecordingSeconds) },
    private val transcribe: (VoiceServiceConfig, ByteArray) -> String = ::transcribeVoice,
) : AutoCloseable {
    private class Run(val id: String) {
        @Volatile var cancelled = false
        @Volatile var stopped = false
        @Volatile var capture: VoiceCapture? = null
        var future: Future<*>? = null
        var limitSeconds: Int = 120
        var provider: String? = null
    }
    private val worker = Executors.newCachedThreadPool { task -> Thread(task, "idea-agent-voice").apply { isDaemon = true } }
    private var active: Run? = null
    private var closed = false

    @Synchronized fun start(id: String) {
        if (closed || id.length !in 1..100 || active != null) return
        val run = Run(id)
        active = run
        run.future = worker.submit {
            try {
                val settings = config()
                run.provider = settings?.provider?.id
                run.limitSeconds = settings?.maxRecordingSeconds ?: 120
                publish(run, "starting")
                if (settings == null) { publish(run, "configuration"); return@submit }
                val recorder = capture(settings)
                run.capture = recorder
                val wav = recorder.use {
                    it.record({ run.stopped || run.cancelled }) { level, elapsed ->
                        publish(run, "recording", level = level, elapsedMs = elapsed)
                    }
                }
                if (run.cancelled) return@submit
                if (wav.isEmpty()) throw VoiceFailure("empty")
                publish(run, "transcribing")
                val text = transcribe(settings, wav)
                publish(run, "done", text = text)
            } catch (error: Exception) {
                if (!run.cancelled) publish(run, "error", error = when (error) {
                    is VoiceFailure -> error.code
                    is javax.sound.sampled.LineUnavailableException, is SecurityException, is IllegalArgumentException -> "microphone"
                    else -> "service"
                })
            } finally {
                synchronized(this) { if (active === run) active = null }
            }
        }
    }

    @Synchronized fun stop(id: String) {
        active?.takeIf { it.id == id }?.let { it.stopped = true }
    }

    @Synchronized fun cancel(id: String? = null) {
        val run = active ?: return
        if (id != null && id != run.id) return
        active = null
        run.cancelled = true
        run.future?.cancel(true)
        worker.submit { run.capture?.close() }
    }

    @Synchronized private fun publish(run: Run, state: String, level: Double = 0.0, elapsedMs: Int = 0, text: String? = null, error: String? = null) {
        if (active === run && !run.cancelled && !closed) emit(VoiceInputEvent(run.id, state, level, elapsedMs, text, error, run.limitSeconds, run.provider))
    }

    @Synchronized override fun close() {
        cancel()
        closed = true
        worker.shutdown()
    }
}
