package dev.ideaagent

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import javax.sound.sampled.AudioFileFormat
import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioInputStream
import javax.sound.sampled.AudioSystem
import javax.sound.sampled.DataLine
import javax.sound.sampled.TargetDataLine
import kotlin.math.sqrt

internal interface VoiceCapture : AutoCloseable {
    fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray
}

/** Bounded in-memory recording; audio is never written to a project or temp file. */
internal class VoiceRecorder(private val maxSeconds: Int = 120) : VoiceCapture {
    @Volatile private var line: TargetDataLine? = null
    @Volatile private var closed = false

    override fun record(stopped: () -> Boolean, onLevel: (Double, Int) -> Unit): ByteArray {
        val format = AudioFormat(16000f, 16, 1, true, false)
        val source = AudioSystem.getLine(DataLine.Info(TargetDataLine::class.java, format)) as TargetDataLine
        line = source
        try {
            if (closed || stopped()) return byteArrayOf()
            source.open(format)
            if (closed || stopped()) return byteArrayOf()
            source.start()
            val pcm = ByteArrayOutputStream()
            val buffer = ByteArray(3200)
            val limit = 16000 * 2 * maxSeconds.coerceIn(1, 120)
            while (!closed && !stopped() && pcm.size() < limit) {
                val count = source.read(buffer, 0, minOf(buffer.size, limit - pcm.size()))
                if (count <= 0) break
                pcm.write(buffer, 0, count)
                onLevel(pcmLevel(buffer, count), pcm.size() / 32)
            }
            if (pcm.size() < 3200) return byteArrayOf()
            return ByteArrayOutputStream().use { output ->
                AudioInputStream(ByteArrayInputStream(pcm.toByteArray()), format, (pcm.size() / 2).toLong()).use {
                    AudioSystem.write(it, AudioFileFormat.Type.WAVE, output)
                }
                output.toByteArray()
            }
        } finally {
            source.close()
            line = null
        }
    }

    override fun close() {
        closed = true
        line?.close()
    }
}

internal fun pcmLevel(bytes: ByteArray, length: Int): Double {
    val samples = length / 2
    if (samples == 0) return 0.0
    var sum = 0.0
    for (i in 0 until samples) {
        val value = ((bytes[i * 2].toInt() and 255) or (bytes[i * 2 + 1].toInt() shl 8)) / 32768.0
        sum += value * value
    }
    return (sqrt(sum / samples) * 4).coerceIn(0.0, 1.0)
}
