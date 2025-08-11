import { ObjectExt } from '../util/ObjectExt.js'
import AudioPlayerWorkletUrl from './AudioPlayerProcessor.worklet.js?url'

export class AudioPlayer {
    constructor() {
        this.onAudioPlayedListeners = []
        this.onAudioEndedListeners = []
        this.initialized = false
    }

    addEventListener (event, callback) {
        switch (event) {
            case "onAudioPlayed":
                this.onAudioPlayedListeners.push(callback)
                break
            case "onAudioEnded":
                this.onAudioEndedListeners.push(callback)
                break
            default:
                console.error("Listener registered for unsupported event:", event)
        }
    }

    removeEventListener (event, callback) {
        switch (event) {
            case "onAudioPlayed":
                this.onAudioPlayedListeners = this.onAudioPlayedListeners.filter(cb => cb !== callback)
                break
            case "onAudioEnded":
                this.onAudioEndedListeners = this.onAudioEndedListeners.filter(cb => cb !== callback)
                break
            default:
                console.error("Tried to remove unsupported listener type:", event)
        }
    }

    async start () {
        this.audioContext = new AudioContext({ sampleRate: 24000 })
        this.analyser = this.audioContext.createAnalyser()
        this.analyser.fftSize = 512

        await this.audioContext.audioWorklet.addModule(AudioPlayerWorkletUrl)
        this.workletNode = new AudioWorkletNode(this.audioContext, "audio-player-processor")

        this.gainNode = this.audioContext.createGain()
        this.gainNode.gain.value = 1.0
        this.workletNode.connect(this.gainNode)
        this.gainNode.connect(this.analyser)
        this.analyser.connect(this.audioContext.destination)

        this.workletNode.port.onmessage = (event) => {
            if (event.data.type === "buffer-empty") {
                this.onAudioEndedListeners.forEach(listener => listener())
            }
        }

        this.recorderNode = this.audioContext.createScriptProcessor(512, 1, 1)
        this.recorderNode.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0)
            const outputData = event.outputBuffer.getChannelData(0)
            outputData.set(inputData)

            const samples = new Float32Array(outputData.length)
            samples.set(outputData)
            this.onAudioPlayedListeners.forEach(listener => listener(samples))
        }

        this.#maybeOverrideInitialBufferLength()
        this.initialized = true
    }

    setVolume (value) {
        if (this.gainNode) {
            this.gainNode.gain.value = value
        }
    }

    bargeIn () {
        this.workletNode.port.postMessage({ type: "barge-in" })
    }

    stop () {
        if (this.workletNode?.port) {
            this.workletNode.port.postMessage({ type: "clear-buffer" })
        }

        if (ObjectExt.exists(this.audioContext)) {
            this.audioContext.close()
        }
        if (ObjectExt.exists(this.analyser)) this.analyser.disconnect()
        if (ObjectExt.exists(this.gainNode)) this.gainNode.disconnect()
        if (ObjectExt.exists(this.workletNode)) this.workletNode.disconnect()
        if (ObjectExt.exists(this.recorderNode)) this.recorderNode.disconnect()

        this.initialized = false
        this.audioContext = null
        this.analyser = null
        this.gainNode = null
        this.workletNode = null
        this.recorderNode = null

        this.onAudioEndedListeners.forEach(cb => cb())
    }

    //new
    clearBuffer () {
        if (this.workletNode?.port) {
            this.workletNode.port.postMessage({ type: "clear-buffer" })
        }
    }

    #maybeOverrideInitialBufferLength () {
        const params = new URLSearchParams(window.location.search)
        const value = params.get("audioPlayerInitialBufferLength")
        if (value === null) return

        const bufferLength = parseInt(value)
        if (isNaN(bufferLength)) {
            console.error("Invalid audioPlayerInitialBufferLength value:", value)
            return
        }

        this.workletNode.port.postMessage({
            type: "initial-buffer-length",
            bufferLength: bufferLength
        })
    }

    playAudio (samples) {
        if (!this.initialized) {
            console.error("The audio player is not initialized. Call start() first.")
            return
        }

        this.workletNode.port.postMessage({
            type: "audio",
            audioData: samples
        })
    }

    getSamples () {
        if (!this.initialized) return null
        const bufferLength = this.analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        this.analyser.getByteTimeDomainData(dataArray)
        return [...dataArray].map(e => e / 128 - 1)
    }

    getVolume () {
        if (!this.initialized) return 0
        const bufferLength = this.analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        this.analyser.getByteTimeDomainData(dataArray)
        const normSamples = [...dataArray].map(e => e / 128 - 1)
        const sum = normSamples.reduce((acc, val) => acc + val * val, 0)
        return Math.sqrt(sum / normSamples.length)
    }

    awaitPlaybackFinished () {
        return new Promise(resolve => {
            if (!this.initialized) return resolve()

            const onEnded = () => {
                this.removeEventListener("onAudioEnded", onEnded)
                resolve()
            }

            this.addEventListener("onAudioEnded", onEnded)
        })
    }
}
