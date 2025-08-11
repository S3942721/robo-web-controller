import { showForm } from "../hooks/useForms"
import { addOrUpdateMessage, resetHistory } from "../hooks/useHistory"
import { setStatus } from "../hooks/useStatusManager"
import { base64ToFloat32Array } from "../utils/tools"
import { playAudio, stopStreaming } from "./audio"

const speculativeContentPool = []

function handleContentStart ({ type, role, contentId, additionalModelFields }) {
    if (type === "TEXT" && role === 'ASSISTANT') {
        try {
            if (additionalModelFields) {
                const additionalFields = JSON.parse(additionalModelFields)
                if (additionalFields.generationStage === 'SPECULATIVE') {
                    if (contentId && !speculativeContentPool.includes(contentId)) {
                        speculativeContentPool.push(contentId)
                    }
                }
            }
        } catch (error) {
            console.error('[handleContentStart] Failed to parse additionalModelFields:', error)
        }
    }
}

function handleContentEnd ({ contentId }) {
    const speculativeContentPoolIndex = speculativeContentPool.indexOf(contentId)
    if (speculativeContentPoolIndex !== -1) {
        speculativeContentPool.splice(speculativeContentPoolIndex, 1)
    }
}

function handleTextOutput ({ role, content, contentId }) {
    if (!content || typeof content !== 'string') {
        console.warn("[handleTextOutput] Skipping empty or invalid content:", content)
        return
    }

    // Skip speculative content for ASSISTANT role
    if (role === 'ASSISTANT' && speculativeContentPool.includes(contentId)) {
        console.log("[handleTextOutput] Skipping speculative content:", content)
        return
    }

    addOrUpdateMessage(role, content)
}

function handleAudioOutput ({ audioData }) {
    if (!audioData || !audioData.content) {
        console.warn("[handleAudioOutput] Missing or invalid audio content:", audioData)
        return
    }

    try {
        const audioArrayBuffer = base64ToFloat32Array(audioData.content)
        playAudio(audioArrayBuffer)
    } catch (err) {
        console.error("[handleAudioOutput] Failed to decode/play audio:", err, audioData)
    }
}

function handleInterviewEnd () {
    console.log("[Frontend] 📩 Received interviewEnd action")
    stopStreaming()
    resetHistory()
    setStatus('session-ended', true)
    setStatus('paused', false)
}

let transcriptDownloaded = false

function handleTranscriptDownload ({ base64, filename, mime }) {
    if (transcriptDownloaded) {
        console.warn("[handleTranscriptDownload] Already downloaded, skipping.")
        return
    }
    transcriptDownloaded = true
    console.trace("[handleTranscriptDownload] triggered")

    try {
        const byteCharacters = atob(base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: mime })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename || 'transcript.txt'
        link.click()
        URL.revokeObjectURL(url)
        console.log("[handleTranscriptDownload] File downloaded successfully.")
    } catch (err) {
        console.error("[handleTranscriptDownload] Failed to download transcript:", err)
    } finally {
        setStatus('transcript-downloading', false)
    }
}


function handleToolCall ({ toolName, toolUseId, content }) {
    switch (toolName) {
        case 'RequestTranscriptForm':
            showForm('request-transcript-form', { toolUseId }); break
        case 'RequestHearBackForm':
            showForm('request-hear-back-form', { toolUseId, ...content }); break
    }
}

function handlePlaybackFinished () {
    console.log("[handlePlaybackFinished] Audio playback has completed.")
}

function handleEndSession () {
    stopStreaming()
    setStatus('session-ended', true)
    setStatus('paused', false)
}

function handleTranscriptDownloadUrl ({ url, error }) {
    if (error || !url) {
        alert('Transcript download failed: ' + (error || 'No URL received.'))
        setStatus('transcript-downloading', false)
        setStatus('transcript-status', 'ready')
        return
    }

    try {
        const link = document.createElement('a')
        link.href = url
        link.download = ''
        link.target = '_self'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        console.log("[handleTranscriptDownloadUrl] Download triggered via <a href=... download>.")
    } catch (err) {
        console.error('[handleTranscriptDownloadUrl] Download trigger failed:', err)
        alert('Download failed.')
    } finally {
        setStatus('transcript-downloading', false)
        setStatus('transcript-status', 'ready')
    }
}


export function handleWsActions (action, data) {
    try {
        switch (action) {
            case "contentStart":
                return handleContentStart(data)
            case "contentEnd":
                return handleContentEnd(data)
            case "textOutput":
                return handleTextOutput(data)
            case "audioOutput":
                return handleAudioOutput(data)
            case "streamComplete":
                return stopStreaming()
            case "toolUse":
                return handleToolCall(data)
            case "interviewEnd":
                return handleInterviewEnd()
            case "playback-finished":
                return handlePlaybackFinished()
            case "interview_failed":
                return showForm("retry-interview-form", { reason: data?.reason })
            case "endSession":
                return handleEndSession()
            case "transcript_download":
                return handleTranscriptDownload(data)
            case "transcriptDownloadUrl":
                return handleTranscriptDownloadUrl(data)
            case "transcriptStatusUpdate":
                if (typeof data.status === 'string') {
                    setStatus('transcript-status', data.status)
                }
                return
            default:
                console.warn(`[handleWsActions] Unknown action received: ${action}`, data)
        }
    } catch (error) {
        console.error(`[handleWsActions] Error processing action '${action}':`, error, data)
    }
}


