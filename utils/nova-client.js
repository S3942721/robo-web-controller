const { InvokeModelWithBidirectionalStreamCommand } = require("@aws-sdk/client-bedrock-runtime")
const { randomUUID } = require("crypto")
const PromiseQueue = require("./promise-queue.js")
const crypto = require('crypto')
const {
    DefaultAudioOutputConfiguration,
    DefaultTextConfiguration,
    DefaultSystemPrompt,
    DefaultInferenceConfiguration,
    DefaultAudioInputConfiguration,
    MAX_QUEUE_SIZE,
    MAX_CHUNKS_PER_BATCH,
    ToolsDefinition
} = require("./types.js")
const {
    parseToolContent,
    uploadToS3,
    mergeSequentialAudioFiles,
    saveModelAudio,
    saveUserAudio,
    generateTranscriptFile,
    generateResumeSummary,
    archiveFinalRecording,
    mergeFinalRecordings,
    parseTranscriptTextFile,
    formatTranscriptFileToString,
    recordingTxtClean
} = require("../utils/helpers.js")
const path = require('path')
const fs = require('fs')

class NovaClient {
    constructor(client, eventHandler, existingState = {}) {
        this.client = client
        this.eventHandler = eventHandler
        this.sessionId = existingState.sessionId || randomUUID()
        this.transcript = existingState.transcript || []
        this.userId = null
        this.sessionTimestamp = existingState.sessionTimestamp || this._generateReadableTimestamp()
        this.recordingsDir = null
        this._initialize()
        this._sessionEnded = false
        this._outputStreamFinished = {}
        this._outputStreamFinished.promise = new Promise((resolve, reject) => {
            this._outputStreamFinished.resolve = resolve
            this._outputStreamFinished.reject = reject
        })
    }
    _initialize () {
        this.events = new PromiseQueue()
        this.audioBufferQueue = []
        this.toolUse = {}
        this.promptName = randomUUID()
        this.audioContentId = randomUUID()

        this.isProcessingAudio = false
        this.speculativeContentPool = []

        this.modelAudioChunks = []
        this.userAudioChunks = []
        this.sequenceNumber = 0

        this.lastUserTextTimestamp = Date.now()
        this.silenceTextTimeout = null
        this.silencePromptTriggered = false

        this.speakingEndTimeout = null
        this.isModelSpeaking = false
        this.lastModelAudioTimestamp = Date.now()

        this.currMsg = ""
        this.seenMessageHashes = new Set()

        // Ensure directories exist
        this._ensureDirectoriesExist()
    }

    _ensureDirectoriesExist () {
        if (!this.userId || !this.recordingsDir) return

        const dirs = [this.recordingsDir, this._getFinalDir(), this._getFinalTxtDir()]
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
        })
    }

    async _startStreaming () {
        if (this.events.completed) {
            this._initialize()
        }

        try {
            this.setModelConfiguration()
            this.setPromptStart()
            this.setSystemPrompt()
            this.setStartAudio()

            const modelId = process.env.MODEL_ID || 'amazon.nova-sonic-v1:0';
            console.log('Environment variables check:');
            console.log('MODEL_ID:', process.env.MODEL_ID);
            console.log('BEDROCK_MODEL_REGION:', process.env.BEDROCK_MODEL_REGION);
            console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET');
            console.log('Using modelId:', modelId);
            
            const response = await this.client.send(
                new InvokeModelWithBidirectionalStreamCommand({
                    modelId: modelId,
                    body: this.inputHandler()
                })
            )
            await this.outputHandler(response)
        } catch (err) {
            console.error(" Failed to start model streaming:", err)
            this.events.complete()
            this.eventHandler('interviewEnd')
        }
    }

    // async iterable to send data through
    inputHandler () {
        return {
            [Symbol.asyncIterator]: () => {
                return {
                    next: async () => {
                        const nextEvent = await this.events.next()
                        if (!nextEvent && this.events.completed) {
                            return { value: null, done: true }
                        }
                        return {
                            value: {
                                chunk: {
                                    bytes: new TextEncoder().encode(JSON.stringify(nextEvent))
                                }
                            },
                            done: false
                        }
                    },
                    return: async () => {
                        return { value: null, done: true }
                    },
                    throw: async error => {
                        console.error("Iterator received error", error)
                        throw error
                    }
                }
            }
        }
    }

    // handle response from model
    async outputHandler (response) {
        console.log('Nova outputHandler started, response:', response)
        try {
            for await (const e of response.body) {
                if (this.events.completed) break

                const textResponse = new TextDecoder().decode(e.chunk.bytes)
                console.log('Received response chunk:', textResponse.substring(0, 200))
                try {
                    const jsonResponse = JSON.parse(textResponse)
                    const event = jsonResponse.event
                    console.log('Parsed event:', event ? event.constructor.name : 'no event', Object.keys(event || {}))
                    if (event) {
                        if (event.contentStart) {
                            this.eventHandler('contentStart', event.contentStart)
                            if (event.contentStart.type === 'TEXT' && event.contentStart.additionalModelFields) {
                                try {
                                    const additionalFields = JSON.parse(event.contentStart.additionalModelFields)
                                    if (event.contentStart.role === 'USER' && additionalFields.generationStage === 'FINAL' && this.userAudioChunks.length > 0) {
                                        await this._saveAudio('USER')
                                    } else if (event.contentStart.role === 'ASSISTANT' && additionalFields.generationStage === 'SPECULATIVE') {
                                        this.speculativeContentPool.push(event.contentStart.contentId)
                                    }
                                } catch (parseError) {
                                    console.error('Error parsing additionalModelFields:', parseError)
                                }
                            }
                        } else if (event.textOutput) {
                            this.eventHandler('textOutput', event.textOutput)
                            if (event.textOutput.role === 'USER') {
                                console.log("user")
                                this._addOrUpdateMessage(event.textOutput)
                                this.lastUserTextTimestamp = Date.now()
                                this.silencePromptTriggered = false
                            }
                            if (event.textOutput.role === 'ASSISTANT') {
                                console.log("assistant")
                                this._addOrUpdateMessage(event.textOutput)
                                const isSpeculative = this.speculativeContentPool.includes(event.textOutput.contentId)
                                if (!isSpeculative) {
                                    this.eventHandler('textOutput', event.textOutput)
                                    const content = event.textOutput.content?.toLowerCase() || ''
                                }
                                continue
                            }
                            // this._addOrUpdateMessage(event.textOutput)

                            if (event.textOutput.content?.includes('Take your time') ||
                                event.textOutput.content?.includes('ready') ||
                                event.textOutput.content?.includes('no rush')) {
                                console.log(' Model responded to silence token:', event.textOutput.content)
                            }
                        } else if (event.audioOutput) {
                            this.modelAudioChunks.push(event.audioOutput.content)
                            this.eventHandler('audioOutput', { audioData: event.audioOutput })

                            this.isModelSpeaking = true
                            this.lastModelAudioTimestamp = Date.now()
                            if (this.speakingEndTimeout) clearTimeout(this.speakingEndTimeout)
                            this.speakingEndTimeout = setTimeout(() => {
                                this.isModelSpeaking = false
                                console.log(" Model speaking window expired. isModelSpeaking set to false.")
                                // Reset for next input
                                this.lastUserTextTimestamp = Date.now()
                                this.silencePromptTriggered = false
                            }, 2000) // Reduced timeout

                        } else if (event.contentEnd) {
                            console.log('Content end event:', event.contentEnd.type, 'contentId:', event.contentEnd.contentId)
                            if (event.contentEnd.type === 'AUDIO') {
                                this.lastModelAudioTimestamp = Date.now()
                                if (this.modelAudioChunks.length > 0) {
                                    await this._saveAudio('ASSISTANT')
                                }
                                // Reset speaking state to allow new input
                                this.isModelSpeaking = false
                                console.log('Audio content ended, ready for new input')
                            } else if (event.contentEnd.type === 'TEXT') {
                                const idx = this.speculativeContentPool.indexOf(event.contentEnd.contentId)
                                if (idx !== -1) {
                                    this.speculativeContentPool.splice(idx, 1)
                                }
                            } else if (event.contentEnd.type === 'TOOL') {
                                this.eventHandler('toolUse', this.toolUse)
                                const result = await this._handleToolCall(this.toolUse)
                                if (result) {
                                    this.eventHandler('toolResult', { toolUseId: this.toolUse.toolUseId, result })
                                }
                                this.toolUse = {}
                            }
                            this.eventHandler('contentEnd', event.contentEnd)
                        } else {
                            console.log('Unknown event received:', jsonResponse)
                            this.eventHandler('unknownEvent', jsonResponse)
                        }
                    }
                } catch (err) {
                    if (err.name === 'ModelStreamErrorException' || err.name === 'ModelTimeoutException') {
                        const lastMessages = this.messageHistory[sessionId] || []
                        const lastAudioChunks = this.audioBuffers[sessionId] || []

                        this.failedSessions[sessionId] = {
                            reason: err.name,
                            messages: lastMessages,
                            audioChunks: lastAudioChunks
                        }

                        this._sendToClient(sessionId, {
                            action: 'interview_failed',
                            reason: err.name
                        })
                    } else {
                        throw err
                    }
                    try {
                        const finalDir = this._getFinalDir()
                        const finalTxtDir = this._getFinalTxtDir()
                        const sessionDir = this.recordingsDir
                        // force delete these so we dont double up 
                        if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true })
                        if (fs.existsSync(finalTxtDir)) fs.rmSync(finalTxtDir, { recursive: true, force: true })
                        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true })
                        console.log("Cleaned up files due to fatal error.")
                    } catch (cleanupErr) {
                        console.error("Failed during cleanup during fatal error:", cleanupErr)
                    }
                }
            }

            if (this.modelAudioChunks.length > 0) {
                await this._saveAudio('ASSISTANT')
            }
            this.events.complete()
            this._outputStreamFinished?.resolve()
        } catch (error) {
            console.error("❌ Output handler fatal error in session", this.sessionId, error)
            this.events.complete()
            this._outputStreamFinished?.resolve()

            try {
                if (this.modelAudioChunks.length > 0) {
                    await this._saveAudio('ASSISTANT')
                }
                await this._mergeAllAudioFiles(false)
                try {
                    let transcriptText

                    const rawTranscriptPath = path.join(this._getFinalTxtDir(), 'all_compiled_messages.txt')
                    if (fs.existsSync(rawTranscriptPath)) {
                        const raw = fs.readFileSync(rawTranscriptPath, 'utf-8')
                        const parsed = parseTranscriptTextFile(raw)
                        transcriptText = await generateTranscriptFile(parsed)
                        this.transcript = parsed
                        console.log(`[outputHandler fallback] Using fallback transcript with ${parsed.length} entries.`)
                    } else if (this.transcript.length) {
                        transcriptText = await generateTranscriptFile(this.transcript)
                    } else {
                        console.warn(`[outputHandler fallback] No transcript found or constructed`)
                        transcriptText = ''
                    }

                    if (transcriptText?.trim()) {
                        await uploadToS3(transcriptText, {
                            mediaType: 'text/plain',
                            sessionId: this.sessionId,
                            filename: 'transcript.txt',
                            userId: this.userId,
                            timestamp: this.sessionTimestamp
                        })

                        this.transcriptMeta = {
                            base64: Buffer.from(transcriptText, 'utf-8').toString('base64'),
                            filename: 'transcript.txt',
                            mime: 'text/plain',
                            s3url: `https://your-bucket-name.s3.amazonaws.com/${this.sessionId}/transcript.txt` // 若已知确切格式
                        }
                    }
                } catch (fallbackErr) {
                    console.error('[outputHandler fallback] Failed to construct/upload transcript:', fallbackErr)
                }

            } catch (mergeError) {
                console.error("❗ Failed to merge audio or upload transcript:", mergeError)
            }

            this.eventHandler('interviewEnd')
        }
    }

    _addOrUpdateMessage ({ role, content }) {
        if (typeof content !== 'string' || content.trim().startsWith('{') || !content.trim()) return

        const messageText = `${role}: ${content}`.trim()
        const hash = crypto.createHash('sha256').update(messageText).digest('hex') // feeds update messagetext into the createhash method, then digests it into a string 

        if (this.seenMessageHashes.has(hash)) {
            console.log(`[Deduplication] Skipped duplicate message: ${messageText}`)
            return
        }

        this.seenMessageHashes.add(hash)
        this.transcript.push({ role, content })

        const finalTxtDir = this._getFinalTxtDir()
        if (!fs.existsSync(finalTxtDir)) {
            fs.mkdirSync(finalTxtDir, { recursive: true })
        }

        const rawTranscriptPath = path.join(finalTxtDir, 'all_compiled_messages.txt')
        fs.appendFileSync(rawTranscriptPath, messageText + '\n', 'utf-8')
    }

    async resumeSession () {
        console.log("🔄 Resuming session...")

        // ===== STEP 1: Generate resume prompt first =====
        let resumePrompt = ""
        try {
            const txtFilePath = path.join(this._getFinalTxtDir(), "all_compiled_messages.txt")
            const txtFileStr = formatTranscriptFileToString(txtFilePath)
            if (txtFileStr && txtFileStr.trim().length > 0) {
                const summary = await generateResumeSummary(txtFileStr)
                resumePrompt += summary || ` Please continue the conversation from where we left off.`
            } else {
                resumePrompt += ` Please continue the conversation from where we left off.`
            }
            console.log("🔄 Resuming:", resumePrompt)
        } catch (err) {
            console.warn("⚠️ Failed to generate resume summary:", err)
            resumePrompt += ` Please continue the conversation from where we left off.`
        }

        // ===== STEP 2: Reinitialize internal state =====
        this.promptName = randomUUID()
        this.audioContentId = randomUUID()
        this.speculativeContentPool = []
        this.sequenceNumber = this.sequenceNumber || 0

        this.events = new PromiseQueue()
        this.audioBufferQueue = []
        this.isProcessingAudio = false
        this.toolUse = {}
        this.modelAudioChunks = []
        this.userAudioChunks = []

        this.lastUserTextTimestamp = Date.now()
        this.silencePromptTriggered = false
        this.isModelSpeaking = false

        // ===== STEP 3: Call prompt setup with resumePrompt =====
        this.setModelConfiguration()
        this.setPromptStart()
        this.setSystemPrompt(resumePrompt)
        this.setStartAudio()

        // ===== STEP 4: Start stream =====
        try {
            const response = await this.client.send(
                new InvokeModelWithBidirectionalStreamCommand({
                    modelId: process.env.MODEL_ID,
                    body: this.inputHandler()
                })
            )
            await this.outputHandler(response)
        } catch (err) {
            console.error("❌ Failed to resume model streaming:", err)
            this.events.complete()
            this.eventHandler('interviewEnd')
        }
    }


    async _handleToolCall ({ toolName, toolUseId, content }) {
        console.log(toolName)
        switch (toolName) {
            case 'RequestEndInterview':
                this.eventHandler('interviewEnd')
                this.sendEnd({ manual: true })

                // When interview ends, merge all audio files
                return null
            default:
                return null
        }
    }

    async cacheSession () {
        try {
            const cacheDir = path.resolve(__dirname, '..', 'cache', this.sessionId)
            fs.mkdirSync(cacheDir, { recursive: true })

            const transcriptText = await generateTranscriptFile(this.transcript)
            fs.writeFileSync(path.join(cacheDir, 'transcript.txt'), transcriptText, 'utf-8')

            const mergedAudioPath = path.resolve(__dirname, '..', 'recordings', this.sessionId, 'full_conversation.mp4')
            const targetPath = path.join(cacheDir, 'full_conversation.mp4')
            if (fs.existsSync(mergedAudioPath)) {
                fs.copyFileSync(mergedAudioPath, targetPath)
            }

            console.log(`[NovaClient] Cached session to ${cacheDir}`)
        } catch (err) {
            console.error('[NovaClient] Failed to cache session:', err)
        }
    }

    async loadCachedSession () {
        try {
            const cacheDir = path.resolve(__dirname, '..', 'cache', this.sessionId)
            const transcriptPath = path.join(cacheDir, 'transcript.txt')
            const audioPath = path.join(cacheDir, 'full_conversation.mp4')

            if (!fs.existsSync(transcriptPath)) {
                throw new Error('Transcript not found for retry')
            }

            const text = fs.readFileSync(transcriptPath, 'utf-8')
            this.transcript = text.split('\n').map(line => {
                const [role, ...rest] = line.split(': ')
                return { role, content: rest.join(': ') }
            })

            console.log(`[NovaClient] Restored transcript with ${this.transcript.length} turns.`)

            return { audioPath }
        } catch (err) {
            console.error('[NovaClient] Failed to load cached session:', err)
            throw err
        }
    }

    async _saveAudio (role) {
        if (!this.recordingsDir) {
            console.warn(`[_saveAudio] No recordingsDir set, skipping audio save for ${role}`)
            return
        }

        if (role === 'ASSISTANT') {
            saveModelAudio(this.modelAudioChunks, this.sequenceNumber++, this.recordingsDir)
            this.modelAudioChunks = []
        } else if (role === 'USER') {
            saveUserAudio(this.userAudioChunks, this.sequenceNumber++, this.recordingsDir)
            this.userAudioChunks = []
        }
    }

    async _mergeAllAudioFiles (shouldUpload = false) {
        try {
            if (!this.recordingsDir || !fs.existsSync(this.recordingsDir)) {
                console.warn('[NovaClient._mergeAllAudioFiles] Skipped: recordingsDir not set or does not exist')
                return null
            }

            const mergedFilePath = path.join(this.recordingsDir, 'full_conversation.mp4')

            await mergeSequentialAudioFiles(this.recordingsDir, mergedFilePath, {
                codec: 'aac',
                bitrate: '128k',
                outputSampleRate: 24000
            })

            this.userAudioChunks = []
            this.modelAudioChunks = []

            if (shouldUpload) {
                await uploadToS3(mergedFilePath, {
                    mediaType: 'audio/mp4',
                    sessionId: this.sessionId,
                    filename: 'record.mp4',
                    userId: this.userId,
                    timestamp: this.sessionTimestamp
                })
            }

            const archiveDir = this._getFinalDir()
            archiveFinalRecording(this.recordingsDir, archiveDir)
            fs.rmSync(this.recordingsDir, { recursive: true, force: true })

            console.log(`Merged all audio files to ${mergedFilePath}`)
            return mergedFilePath
        } catch (error) {
            console.error('Error merging audio files:', error)
            return null
        }
    }


    // ==============================================================================
    // send to model
    // ==============================================================================

    _sendText (contentStart, contentKey, content) {
        const contentName = randomUUID()

        this.events.add([
            {
                event: {
                    contentStart: {
                        promptName: this.promptName,
                        contentName,
                        type: "TEXT",
                        interactive: true,
                        textInputConfiguration: DefaultTextConfiguration,
                        ...contentStart
                    }
                }
            },
            {
                event: {
                    [contentKey]: {
                        promptName: this.promptName,
                        contentName,
                        content
                    }
                }
            },
            {
                event: {
                    contentEnd: {
                        promptName: this.promptName,
                        contentName
                    }
                }
            }
        ])
    }

    setPromptStart () {
        this.events.add({
            event: {
                promptStart: {
                    promptName: this.promptName,
                    textOutputConfiguration: {
                        mediaType: "text/plain",
                    },
                    audioOutputConfiguration: DefaultAudioOutputConfiguration,
                    toolConfiguration: ToolsDefinition
                }
            }
        })
    }

    setModelConfiguration () {
        this.events.add({
            event: {
                sessionStart: {
                    inferenceConfiguration: DefaultInferenceConfiguration
                }
            }
        })
    }

    setSystemPrompt (overridePrompt = null) {
        const resumeSuffix = overridePrompt ? `
        \n\n# Resume Context
        ${overridePrompt}

        Please resume the structured interview from the point it was paused.

        You are still Kay, the grief support interviewer. Your role and behaviour remain unchanged.

        If the user provide an answer directly, assume that he is answering the question that was last asked before the pause.

        You MUST:
        - Continue directly from the next unasked question
        - Do NOT re-ask any question that is listed as "completed" or "skipped"
        - All skipped questions are considered permanently handled and must NOT be revisited
        - After the participant responds, continue smoothly to the next required question
        - Always end your turn with a brief follow-up or progression check
        - If question 9 has already been completed, proceed with the conclusion message

        Begin from the appropriate point now.
        ` : ""
        const systemPrompt = `${DefaultSystemPrompt}${resumeSuffix}`


        this._sendText(
            {
                interactive: false,
                role: "SYSTEM",
            },
            'textInput',
            systemPrompt
        )
    }

    startSession () {
        this._initialize()
        this._startStreaming()
    }

    setStartAudio () {
        this.events.add({
            event: {
                contentStart: {
                    promptName: this.promptName,
                    contentName: this.audioContentId,
                    interactive: true,
                    type: "AUDIO",
                    role: "USER",
                    audioInputConfiguration: DefaultAudioInputConfiguration,
                },
            }
        })
    }

    streamAudio (audioData) {
        if (this.audioBufferQueue.length >= MAX_QUEUE_SIZE) {
            this.audioBufferQueue.shift()
        }

        this.lastUserTextTimestamp = Date.now()
        this.silencePromptTriggered = false
        if (this.silenceTextTimeout) {
            clearTimeout(this.silenceTextTimeout)
        }
        this.userAudioChunks.push(audioData.toString('base64'))
        this.audioBufferQueue.push(audioData)
        this._processAudioQueue()
    }


    _processAudioQueue () {
        if (this.isProcessingAudio) {
            return
        }

        this.isProcessingAudio = true
        try {
            let proceedChunks = 0
            while (this.audioBufferQueue.length && proceedChunks < MAX_CHUNKS_PER_BATCH) {
                const audioData = this.audioBufferQueue.shift()
                this._streamAudioChunk(audioData)
                proceedChunks++
            }
        } finally {
            this.isProcessingAudio = false
            if (this.audioBufferQueue.length) {
                setTimeout(() => {
                    this._processAudioQueue()
                }, 0)
            }
        }
    }

    _checkAndHandleSilence () {
        const now = Date.now()
        const silenceDuration = now - this.lastUserTextTimestamp
        const modelSpeakingRecently = now - this.lastModelAudioTimestamp < 2000

        console.log(`[Silence Check] Silence Duration: ${silenceDuration} ms`)
        console.log(`[Silence Check] Time since last model audio: ${now - this.lastModelAudioTimestamp} ms`)
        console.log(`[Silence Check] isModelSpeaking: ${this.isModelSpeaking}, modelSpeakingRecently: ${modelSpeakingRecently}`)

        if (silenceDuration >= 8000 && !this.silencePromptTriggered) {
            if (!this.isModelSpeaking && !modelSpeakingRecently) {
                console.log("💤 Silence detected (no user transcript). Sending reminder.")
                this.silencePromptTriggered = true
                this._sendText(
                    { role: 'USER' },
                    'textInput',
                    "The user has not responded for 8 seconds. Please say a short, supportive reminder aloud."
                )
            } else {
                console.log("⏸ Silence detected, but model is speaking or spoke very recently. Skipping injection.")
            }
        }
    }

    handlePlaybackFinished () {
        this.isModelSpeaking = false
        this.lastModelAudioTimestamp = Date.now()
        if (this.silenceTextTimeout) clearTimeout(this.silenceTextTimeout)
        this.silenceTextTimeout = setTimeout(() => {
            this._checkAndHandleSilence()
        }, 8000)
    }

    _streamAudioChunk (audioData) {
        if (!audioData) return

        const base64Data = audioData.toString('base64')

        this.events.add({
            event: {
                audioInput: {
                    promptName: this.promptName,
                    contentName: this.audioContentId,
                    content: base64Data,
                },
            }
        })
    }

    textInput ({ role, content }) {
        this._sendText({ role }, 'textInput', content)
    }

    setUserId (userId) {
        this.userId = userId
        this._updateRecordingsDir()
        this._ensureDirectoriesExist()
        console.log(`[NovaClient] Set userId: ${userId}, recordingsDir: ${this.recordingsDir}`)
    }

    _updateRecordingsDir () {
        if (this.userId) {
            this.recordingsDir = path.join(process.cwd(), 'recordings', this.userId, this.sessionId)
        }
    }

    _getFinalDir () {
        const baseDir = this.userId
            ? path.join(process.cwd(), 'recordings', this.userId)
            : path.join(process.cwd(), 'recordings')
        return path.join(baseDir, 'final')
    }

    _getFinalTxtDir () {
        const baseDir = this.userId
            ? path.join(process.cwd(), 'recordings', this.userId)
            : path.join(process.cwd(), 'recordings')
        return path.join(baseDir, 'final_txt')
    }

    _generateReadableTimestamp () {
        const now = new Date()
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const hours = String(now.getHours()).padStart(2, '0')
        const minutes = String(now.getMinutes()).padStart(2, '0')
        const seconds = String(now.getSeconds()).padStart(2, '0')
        return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`
    }



    // async sendEnd () {
    //     if (this._sessionEnded) {
    //         console.log('[NovaClient.sendEnd] Skipped duplicate call')
    //         return
    //     }
    //     this._sessionEnded = true
    //     if (this.silenceTextTimeout) clearTimeout(this.silenceTextTimeout)
    //     if (this.events.completed) return
    //     await this._outputStreamFinished?.promise.catch(() => { })

    //     await this._saveAudio('USER')

    //     this.events.add([
    //         {
    //             event: {
    //                 contentEnd: {
    //                     promptName: this.promptName,
    //                     contentName: this.audioContentId,
    //                 }
    //             }
    //         },
    //         {
    //             event: {
    //                 promptEnd: {
    //                     promptName: this.promptName,
    //                 }
    //             }
    //         },
    //         {
    //             event: {
    //                 sessionEnd: {}
    //             }
    //         }
    //     ])
    //     await new Promise(s => setTimeout(s, 300))
    //     this.events.complete()

    //     await this._mergeAllAudioFiles()

    //     if (this.transcript.length) {
    //         const transcriptText = await generateTranscriptFile(this.transcript)
    //         const uploadResult = await uploadToS3(transcriptText, {
    //             mediaType: 'text/plain',
    //             sessionId: this.sessionId,
    //             filename: 'transcript.txt'
    //         })

    //         this.transcriptMeta = {
    //             base64: Buffer.from(transcriptText, 'utf-8').toString('base64'),
    //             filename: 'transcript.txt',
    //             mime: 'text/plain',
    //             s3url: uploadResult?.location || null
    //         }
    //     }

    //     this.eventHandler('interviewEnd')
    // }
    async _tryUploadTranscriptFallback () {
        const rawTranscriptPath = path.join(this._getFinalTxtDir(), 'all_compiled_messages.txt')
        if (!fs.existsSync(rawTranscriptPath)) {
            console.warn(`[sendEnd fallback] No raw transcript found at ${rawTranscriptPath}`)
            return
        }

        try {
            // Process the complete transcript from final_txt
            recordingTxtClean(rawTranscriptPath, this._getFinalTxtDir())
            const combinedTranscriptPath = path.join(this._getFinalTxtDir(), 'combined_transcript.txt')
            const rawText = fs.readFileSync(combinedTranscriptPath, 'utf-8')
            const parsed = parseTranscriptTextFile(rawText)
            const finalTranscript = await generateTranscriptFile(parsed)

            const uploadResult = await uploadToS3(finalTranscript, {
                mediaType: 'text/plain',
                sessionId: this.sessionId,
                filename: 'transcript.txt',
                userId: this.userId,
                timestamp: this.sessionTimestamp
            })

            this.transcriptMeta = {
                base64: Buffer.from(finalTranscript, 'utf-8').toString('base64'),
                filename: 'transcript.txt',
                mime: 'text/plain',
                s3url: uploadResult?.location || null
            }

            console.log(`[sendEnd fallback] Complete transcript uploaded via fallback: ${finalTranscript.length} chars`)
        } catch (e) {
            console.error('[sendEnd fallback] Failed to upload transcript:', e)
        }
    }

    async _cleanupSessionArtifacts () {
        try {
            const finalDir = this._getFinalDir()
            const sessionDir = this.recordingsDir

            // Clean up orphaned directories at root level (but keep final_txt for transcript integration)
            const rootRecordingsDir = path.join(process.cwd(), 'recordings')
            const rootSessionDir = path.join(rootRecordingsDir, this.sessionId)

            const dirsToClean = [finalDir, sessionDir, rootSessionDir]

            for (const dir of dirsToClean) {
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true })
                    console.log(`[cleanup] Removed: ${dir}`)
                }
            }

            // Only clean final_txt after transcript is processed and uploaded
            const finalTxtDir = this._getFinalTxtDir()
            const rawTranscriptPath = path.join(finalTxtDir, 'all_compiled_messages.txt')
            const combinedTranscriptPath = path.join(finalTxtDir, 'combined_transcript.txt')

            if (fs.existsSync(rawTranscriptPath)) fs.unlinkSync(rawTranscriptPath)
            if (fs.existsSync(combinedTranscriptPath)) fs.unlinkSync(combinedTranscriptPath)

            // Remove final_txt dir if empty
            if (fs.existsSync(finalTxtDir) && fs.readdirSync(finalTxtDir).length === 0) {
                fs.rmSync(finalTxtDir, { recursive: true, force: true })
                console.log(`[cleanup] Removed empty final_txt dir: ${finalTxtDir}`)
            }

            this.transcript = []
            this.userAudioChunks = []
            this.modelAudioChunks = []
            console.log(`[cleanup] Completed cleanup for session ${this.sessionId}`)
        } catch (e) {
            console.error('[cleanup] Failed to clean up session artifacts:', e)
        }
    }
    async sendEnd ({ manual = false } = {}) {
        if (this._sessionEnded) {
            console.log('[NovaClient.sendEnd] Skipped duplicate call')
            return
        }
        this._sessionEnded = true
        if (this.silenceTextTimeout) clearTimeout(this.silenceTextTimeout)
        if (this.events.completed) return

        try {
            await Promise.race([
                this._outputStreamFinished?.promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('[sendEnd] Output stream timeout')), 5000)
                )
            ])
        } catch (e) {
            console.warn(e.message)
        }

        console.log("saving audio")
        await this._saveAudio('USER')
        console.log("saving audio success")

        this.events.add([
            { event: { contentEnd: { promptName: this.promptName, contentName: this.audioContentId } } },
            { event: { promptEnd: { promptName: this.promptName } } },
            { event: { sessionEnd: {} } }
        ])
        await new Promise(s => setTimeout(s, 300))
        this.events.complete()

        const mergedPath = await this._mergeAllAudioFiles(manual)
        console.log(`manual ${manual}`)
        console.log(`[NovaClient.sendEnd] mergedPath:`, mergedPath)

        if (mergedPath && manual) {
            const finalDir = this._getFinalDir()
            const finalOutputPath = path.join(finalDir, 'final_combined.mp4')

            const finalMerged = await mergeFinalRecordings(finalDir, finalOutputPath)
            if (finalMerged && fs.existsSync(finalMerged)) {
                await uploadToS3(finalMerged, {
                    mediaType: 'audio/mp4',
                    sessionId: this.sessionId,
                    filename: 'final_combined.mp4',
                    userId: this.userId,
                    timestamp: this.sessionTimestamp
                })
            }

            fs.rmSync(finalDir, { recursive: true, force: true })
            console.log(`[NovaClient.sendEnd] Manual session finalized and cleaned up.`)
        }

        if (manual) {
            const rawTranscriptPath = path.join(this._getFinalTxtDir(), "all_compiled_messages.txt")
            if (fs.existsSync(rawTranscriptPath)) {
                // Use the complete transcript from final_txt (includes resume sessions)
                recordingTxtClean(rawTranscriptPath, this._getFinalTxtDir())
                const newTranscriptPath = path.join(this._getFinalTxtDir(), "combined_transcript.txt")
                const rawText = fs.readFileSync(newTranscriptPath, "utf-8")
                const parsedTranscript = parseTranscriptTextFile(rawText)
                const finalTranscript = await generateTranscriptFile(parsedTranscript)
                const uploadResult = await uploadToS3(finalTranscript, {
                    mediaType: 'text/plain',
                    sessionId: this.sessionId,
                    filename: 'transcript.txt',
                    userId: this.userId,
                    timestamp: this.sessionTimestamp
                })

                this.transcriptMeta = {
                    base64: Buffer.from(finalTranscript, 'utf-8').toString('base64'),
                    filename: 'transcript.txt',
                    mime: 'text/plain',
                    s3url: uploadResult?.location || null
                }
                console.log(`[sendEnd] Complete transcript uploaded: ${finalTranscript.length} chars`)
            } else if (this.transcript.length) {
                // Fallback to current session transcript if no final_txt found
                const finalTranscript = await generateTranscriptFile(this.transcript)
                const uploadResult = await uploadToS3(finalTranscript, {
                    mediaType: 'text/plain',
                    sessionId: this.sessionId,
                    filename: 'transcript.txt',
                    userId: this.userId,
                    timestamp: this.sessionTimestamp
                })

                this.transcriptMeta = {
                    base64: Buffer.from(finalTranscript, 'utf-8').toString('base64'),
                    filename: 'transcript.txt',
                    mime: 'text/plain',
                    s3url: uploadResult?.location || null
                }
                console.log(`[sendEnd] Session transcript uploaded: ${finalTranscript.length} chars`)
            } else {
                console.warn(`[sendEnd] No transcript found for session ${this.sessionId}`)
            }
        }

        if (manual) {
            if (!this.transcript.length || !this.transcriptMeta?.s3url) {
                await this._tryUploadTranscriptFallback()
            }
            await this._cleanupSessionArtifacts()
        }

        console.log("reached end")
        this.eventHandler('interviewEnd')
    }

}

module.exports = NovaClient