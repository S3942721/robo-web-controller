// import { isAudioPlaying, setAudioPlaying } from "../hooks/useAudioPlaying";
import { AudioPlayer } from "../lib/play/AudioPlayer"
import { arrayBufferToBase64 } from "../utils/tools"
import { sendMessage } from "./websocket"
import { setStatus, status } from "../hooks/useStatusManager"
import { resetHistory } from "../hooks/useHistory"

const setStreamingStatus = (status) => {
    setStatus('session-streaming', status)
}
const setAudioPlaying = (status) => {
    setStatus('audio-playing', status)
}
const setAudioInitialized = (initialized) => {
    setStatus('audio-initialized', initialized)
}

let audioContext
let samplingRatio = 1
let audioStream
let isStreaming = false
let processor
let sourceNode
let sessionInitialized = false
let analyser
let visualizationCanvas
let visualizationContext

export const audioPlayer = new AudioPlayer()
const isFirefox = navigator.userAgent.toLowerCase().includes('firefox')
const TARGET_SAMPLE_RATE = 16000

let handleAudioEnded = () => {
    setAudioPlaying(false)
    // Use custom WebSocket if available, otherwise use default
    if (window.novaWebSocket && window.novaWebSocket.readyState === WebSocket.OPEN) {
        window.novaWebSocket.send(JSON.stringify({ action: 'playback-finished' }))
    } else {
        sendMessage("playback-finished", {})
    }
}

export async function initAudio () {
    if (audioContext) return

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        })

        if (isFirefox) {
            audioContext = new AudioContext()
        } else {
            audioContext = new AudioContext({
                sampleRate: TARGET_SAMPLE_RATE
            })
        }

        samplingRatio = audioContext.sampleRate / TARGET_SAMPLE_RATE
        await audioPlayer.start()

        audioPlayer.addEventListener("onAudioEnded", handleAudioEnded)

        setAudioInitialized(true)

        if (typeof window !== 'undefined') {
            if (window.ws) {
                window.ws.addEventListener('message', (event) => {
                    const msg = JSON.parse(event.data)

                    if (msg.action === 'transcript_download') {
                        const binary = atob(msg.base64)
                        const bytes = new Uint8Array(binary.length)
                        for (let i = 0; i < binary.length; i++) {
                            bytes[i] = binary.charCodeAt(i)
                        }
                        const blob = new Blob([bytes], { type: msg.mime || 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = msg.filename || 'transcript.txt'
                        a.click()

                        if (msg.s3url) {
                            console.log("Transcript also uploaded to S3:", msg.s3url)
                        }
                    }

                    if (msg.action === 'session_interrupted' && msg.reason === 'timeout') {
                        const retry = window.confirm('Session timed out. Would you like to retry?')
                        if (retry && window.ws?.readyState === WebSocket.OPEN) {
                            window.ws.send(JSON.stringify({ action: 'retrySession' }))
                        }
                    }
                })
            }
        }

        return true
    } catch (error) {
        setAudioInitialized(false)
        console.error('Error accessing microphone', error)
        throw error
    }
}

export function initializeSession () {
    if (sessionInitialized) return
    sendMessage('startSession')
}

export function playAudio (audioData) {
    audioPlayer.playAudio(audioData)
    setAudioPlaying(true)
}

/**
 * Sets up the canvas element for audio visualization
 * @param {HTMLCanvasElement} canvas - The canvas element to use for visualization
 */
export function setupVisualization (canvas) {
    visualizationCanvas = canvas
    visualizationContext = canvas.getContext('2d')

    if (visualizationCanvas.width !== visualizationCanvas.clientWidth) {
        visualizationCanvas.width = visualizationCanvas.clientWidth
    }
    if (visualizationCanvas.height !== visualizationCanvas.clientHeight) {
        visualizationCanvas.height = visualizationCanvas.clientHeight
    }

    function draw () {
        if (!analyser || !visualizationContext || status['session-ended']) return

        const width = visualizationCanvas.width
        const height = visualizationCanvas.height
        const centerY = height / 2

        visualizationContext.clearRect(0, 0, width, height)

        // Only show waveform when not playing AI audio and streaming is active
        if (!status['audio-playing'] && isStreaming) {
            const bufferLength = analyser.frequencyBinCount
            const dataArray = new Uint8Array(bufferLength)
            analyser.getByteTimeDomainData(dataArray)
            const amplitude = height

            visualizationContext.beginPath()
            visualizationContext.moveTo(0, centerY)

            for (let i = 0; i < bufferLength; i++) {
                const x = (i / bufferLength) * width
                const y = centerY - ((dataArray[i] - 128) / 128) * amplitude
                visualizationContext.lineTo(x, y)
            }

            for (let i = bufferLength - 1; i >= 0; i--) {
                const x = (i / bufferLength) * width
                const y = centerY - ((dataArray[i] - 128) / 128) * amplitude
                const mirroredY = centerY + (centerY - y)
                visualizationContext.lineTo(x, mirroredY)
            }

            visualizationContext.closePath()
            visualizationContext.fillStyle = "rgba(0, 153, 255, 0.2)"
            visualizationContext.fill()
            visualizationContext.lineWidth = 1.5
            visualizationContext.strokeStyle = "rgba(0, 123, 255, 0.5)"
            visualizationContext.stroke()
        } else {
            // Draw flat line when AI is speaking or not streaming
            visualizationContext.beginPath()
            visualizationContext.moveTo(0, centerY)
            visualizationContext.lineTo(width, centerY)
            visualizationContext.lineWidth = 1
            visualizationContext.strokeStyle = "rgba(0, 123, 255, 0.3)"
            visualizationContext.stroke()
        }

        requestAnimationFrame(draw)
    }

    draw()
}


export function startStreaming () {
    if (isStreaming || status['paused'] || status['audio-playing']) return

    try {
        // First, make sure the session is initialized
        if (!sessionInitialized) {
            initializeSession()
        }

        // Create audio processor
        sourceNode = audioContext.createMediaStreamSource(audioStream)

        // Set up analyzer for visualization
        analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        sourceNode.connect(analyser)

        // Use ScriptProcessorNode for audio processing
        if (audioContext.createScriptProcessor) {
            processor = audioContext.createScriptProcessor(512, 1, 1)

            processor.onaudioprocess = (e) => {
                if (!isStreaming || status['audio-playing']) return

                const inputData = e.inputBuffer.getChannelData(0)
                const numSamples = Math.round(inputData.length / samplingRatio)
                const pcmData = isFirefox ? (new Int16Array(numSamples)) : (new Int16Array(inputData.length))

                if (isFirefox) {
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i * samplingRatio])) * 0x7FFF
                    }
                } else {
                    for (let i = 0; i < inputData.length; i++) {
                        pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF
                    }
                }

                const base64Data = arrayBufferToBase64(pcmData.buffer)

                // Send to server - use Nova WebSocket if available
                if (window.novaWebSocket && window.novaWebSocket.readyState === WebSocket.OPEN) {
                    window.novaWebSocket.send(JSON.stringify({ action: 'audioInput', base64Data }))
                } else {
                    sendMessage('audioInput', { base64Data })
                }
            }

            sourceNode.connect(processor)
            processor.connect(audioContext.destination)
        }

        isStreaming = true
        setStreamingStatus(true)
    } catch (error) {
        console.error("Error starting recording:", error)
    }
}

/**
 * Manually end the interview session
 * Called by UI button directly
 */
//changed
export function endSessionManually () {
    stopStreaming()
    audioPlayer.stop()
    setStatus('session-ended', true)
    sendMessage('endSession', { manual: true })
}

export async function stopStreaming () {
    if (!isStreaming) return

    if (audioPlayer?.awaitPlaybackFinished) {
        await audioPlayer.awaitPlaybackFinished()
    }
    isStreaming = false
    // Clean up audio processing
    if (processor) {
        processor.disconnect()
        sourceNode.disconnect()
    }
    if (analyser) {
        analyser.disconnect()
    }
    // Stop visualization
    if (visualizationContext) {
        cancelAnimationFrame(visualizationContext.animationFrame)
    }

    audioPlayer.stop()
    audioPlayer.removeEventListener("onAudioEnded", handleAudioEnded)
    sessionInitialized = false
    audioContext = null
    sendMessage('stopAudio')
    resetHistory()
    setStreamingStatus(false)
    setAudioInitialized(false)
}
