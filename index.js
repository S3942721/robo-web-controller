// Load environment variables
require('dotenv').config()

// EXPRESS SERVER
const express = require("express")
const { join } = require("path")
const { readdirSync, readFileSync, writeFileSync } = require('fs')

const app = express()

app.use(require("body-parser").json())
app.use(require("cors")())
const expressWs = require('express-ws')(app)

// Import the Robot API
const robotAPI = require('./utils/robot-api')
const { ollamaStream } = require('./utils/ollama-client')

// Set up LLM communication broadcast function for Robot API
robotAPI.broadcastLLMCommunication = broadcastLLMCommunication

// Set up robot status event listeners
robotAPI.on('robotFinishedSpeaking', ({ robot, sessionId, timestamp }) => {
    console.log(`[Server] 🎤 Robot ${robot} finished speaking, session ${sessionId} - notifying STT`)

    // Notify all STT WebSocket clients to flush buffer
    sendWebSockets.forEach(ws => {
        try {
            ws.send(JSON.stringify({
                cmd: 'stt-flush-buffer',
                sessionId: sessionId,
                robot: robot,
                timestamp: timestamp
            }))
        } catch (error) {
            console.error('[Server] Failed to notify STT client:', error)
        }
    })
})

// Set up STT message listener to forward user input to tablets
robotAPI.on('sttMessage', (message) => {
    // Check if video is playing - if so, block STT message processing
    if (isVideoPlaying) {
        console.log(`[Server] 🚫 Blocking STT message processing - video playing for robot ${videoPlayingRobot}`)
        return
    }

    // Forward STT messages to frontend WebSocket clients for debugging/monitoring
    if (message.type === 'complete' || message.type === 'partial') {
        sendWebSockets.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                try {
                    ws.send(JSON.stringify({
                        type: 'stt-message',
                        data: message,
                        timestamp: Date.now()
                    }))
                } catch (error) {
                    console.error('[Server] Failed to forward STT message:', error)
                }
            }
        })
    }
})

robotAPI.on('statusChanged', ({ robot, changedFields, currentStatus }) => {
    console.log(`[Server] 📊 Status changed for ${robot}:`, changedFields)

    // Broadcast status changes to frontend
    sendWebSockets.forEach(ws => {
        try {
            ws.send(JSON.stringify({
                cmd: 'robot-status-update',
                robot: robot,
                changedFields: changedFields,
                status: currentStatus
            }))
        } catch (error) {
            console.error('[Server] Failed to broadcast status update:', error)
        }
    })
})

robotAPI.on('criticalStatus', ({ robot, field, value, threshold }) => {
    console.error(`[Server] 🚨 CRITICAL STATUS: ${robot} ${field} = ${value} (threshold: ${threshold})`)

    // Broadcast critical alerts
    sendWebSockets.forEach(ws => {
        try {
            ws.send(JSON.stringify({
                cmd: 'robot-critical-alert',
                robot: robot,
                field: field,
                value: value,
                threshold: threshold,
                timestamp: Date.now()
            }))
        } catch (error) {
            console.error('[Server] Failed to broadcast critical alert:', error)
        }
    })
})

robotAPI.on('warningStatus', ({ robot, field, value, threshold }) => {
    console.warn(`[RobotAPI] ⚠️ WARNING: Robot ${robot} ${field} is ${value} (threshold: ${threshold})`)

    // Broadcast warning to frontend connections if needed
    sendWebSockets.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'robot-warning',
                robot: robot,
                field: field,
                value: value,
                threshold: threshold,
                timestamp: Date.now()
            }))
        }
    })
})

// Turn-taking violation event handler
robotAPI.on('turnTakingViolation', ({ type, robot, sessionId, message, timestamp }) => {
    console.error(`[TurnTaking] 🚨 VIOLATION: ${type}`)
    console.error(`[TurnTaking] Details: robot=${robot}, session=${sessionId}, message="${message}", time=${new Date(timestamp).toISOString()}`)

    // Broadcast turn-taking violation to frontend connections
    sendWebSockets.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
                type: 'turn-taking-violation',
                violationType: type,
                robot: robot,
                sessionId: sessionId,
                message: message,
                timestamp: timestamp
            }))
        }
    })
})

// Function to broadcast LLM communication to tablet displays
function broadcastLLMCommunication (type, content, robot) {
    // Check if video is playing for this robot - if so, block broadcast
    if (isVideoPlaying && videoPlayingRobot === robot) {
        console.log(`[LLM Broadcast] 🚫 Blocking ${type} broadcast - video playing for robot ${robot}`)
        return
    }

    const message = {
        type: type, // 'llm-user-input' or 'llm-ai-response'
        content: content,
        robot: robot,
        timestamp: Date.now()
    }

    const activeConnections = sendWebSockets.filter(ws => ws.readyState === ws.OPEN).length
    console.log(`[LLM Broadcast] Broadcasting ${type} to ${sendWebSockets.length} WebSocket clients (${activeConnections} active):`, content ? content.substring(0, 50) : 'empty')
    console.log(`[LLM Broadcast] Message details:`, JSON.stringify(message, null, 2))

    let sentCount = 0
    sendWebSockets.forEach((ws, index) => {
        if (ws.readyState === ws.OPEN) {
            try {
                ws.send(JSON.stringify(message))
                sentCount++
                console.log(`[LLM Broadcast] ✅ Sent to WebSocket ${index}`)
            } catch (error) {
                console.error(`[LLM Broadcast] ❌ Failed to send to WebSocket ${index}:`, error)
            }
        } else {
            console.log(`[LLM Broadcast] ⚠️ WebSocket ${index} not ready (state: ${ws.readyState})`)
        }
    })

    console.log(`[LLM Broadcast] Successfully sent to ${sentCount}/${sendWebSockets.length} connections`)
}

// STT messages are now handled directly by the STT server's LLM integration
// The STT server forwards LLM responses to robots via the robot API
// No additional handling needed here

// variables
let sendSockets = [] // Keep for backward compatibility
let sendWebSockets = []

// Global video playing state to disable STT/LLM processing
let isVideoPlaying = false
let videoPlayingRobot = null

let current_profile = {}
let all_scripts = {}, scripts = {}
let triggers = {}

let profiles = []
let shortcuts = []
let paged_shortcuts = []
let announcements = []
let all_possible_files = []

// Network configuration from environment
const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0'
const SERVER_PORT = process.env.SERVER_PORT || 3000
const SOCKET_PORT = process.env.SOCKET_PORT || 3456

const STT_SERVER_HOST = process.env.STT_SERVER_HOST || 'localhost'
const STT_SERVER_PORT = process.env.STT_SERVER_PORT || 8765
const STT_LLM_ENABLED = process.env.STT_LLM_ENABLED === 'true'

const LLM_GATEWAY_HOST = process.env.LLM_GATEWAY_HOST || 'localhost'

const WS_RECONNECT_ATTEMPTS = parseInt(process.env.WS_RECONNECT_ATTEMPTS) || 5
const WS_RECONNECT_DELAY = parseInt(process.env.WS_RECONNECT_DELAY) || 2000

// Tablet monitor configuration (all configurable via env)
const TABLET_AUTO_RELOAD = (process.env.TABLET_AUTO_RELOAD || 'true') !== 'false'
const TABLET_PING_INTERVAL_MS = parseInt(process.env.TABLET_PING_INTERVAL_MS) || 5000 // default 5s
const TABLET_PING_GRACE_MS = parseInt(process.env.TABLET_PING_GRACE_MS) || 3000 // time to wait for heartbeat after ping
const TABLET_RELOAD_COOLDOWN_MS = parseInt(process.env.TABLET_RELOAD_COOLDOWN_MS) || 30000 // min time between reloads
const TABLET_TARGET_ROBOT = process.env.TABLET_TARGET_ROBOT || process.env.DEFAULT_ROBOT_NAME || 'Haku'
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ''

// Function to parse script object
function parseScriptObject (obj) {
    const newObj = {}
    for (const key in obj) {
        const val = obj[key]
        // Ensure each script is an object with both "robot" and "text" defined
        if (typeof val === 'string') {
            newObj[key] = { robot: "", text: val }
        } else {
            newObj[key] = {
                robot: (typeof val.robot === 'string' ? val.robot : ""),
                text: (typeof val.text === 'string' ? val.text : "")
            }
        }
    }
    return newObj
}

// Function to parse triggers object
function parseTriggers (obj) {
    const result = {}
    // Each top-level property is a robot, including "Default".
    for (const robot in obj) {
        result[robot] = { ...obj[robot] }
    }
    return result
}

// Function to parse paged shortcuts object
function parsePagedShortcuts (obj) {
    const result = {}
    for (const robot in obj) {
        result[robot] = { ...obj[robot] }
    }
    return result
}

// Function to read settings files
function readSettings () {
    const dir = readdirSync(join(__dirname, 'settings'))
    const script_files = dir.filter(e => /^.*Script\.json$/.test(e))
    script_files.forEach(e => {
        const profile_name = e.split('_').slice(0, -1).join(' ')
        const file_path = join(__dirname, 'settings', e)
        all_scripts[profile_name] = parseScriptObject(
            JSON.parse(readFileSync(file_path, { encoding: 'utf-8' }))
        )
        // console.log(`Loaded script file: ${file_path}`);
        // console.log('For profile:', profile_name);
    })
    scripts = all_scripts[Object.keys(all_scripts)[0]]

    const profiles_path = join(__dirname, 'settings', 'profiles.json')
    profiles = JSON.parse(readFileSync(profiles_path, { encoding: 'utf-8' }))
    // console.log(`Loaded profiles file: ${profiles_path}`);
    current_profile = profiles[0]
    // console.log('Current profile:', current_profile);

    const triggers_path = join(__dirname, 'settings', 'triggers.json')
    triggers = parseTriggers(JSON.parse(readFileSync(triggers_path, { encoding: 'utf-8' })))
    // console.log(`Loaded triggers file: ${triggers_path}`);

    const shortcuts_path = join(__dirname, 'settings', 'shortcuts.json')
    shortcuts = JSON.parse(readFileSync(shortcuts_path, { encoding: 'utf-8' }))
    // console.log(`Loaded shortcuts file: ${shortcuts_path}`);

    const paged_shortcuts_path = join(__dirname, 'settings', 'paged_shortcuts.json')
    paged_shortcuts = parsePagedShortcuts(JSON.parse(readFileSync(paged_shortcuts_path, { encoding: 'utf-8' })))
    // console.log(`Loaded paged shortcuts file: ${paged_shortcuts_path}`);

    const announcements_path = join(__dirname, 'settings', 'announcements.json')
    announcements = JSON.parse(readFileSync(announcements_path, { encoding: 'utf-8' }))
    // console.log(`Loaded announcements file: ${announcements_path}`);

    const all_possible_files_path = join(__dirname, 'settings', 'all_possible_files.json')
    all_possible_files = JSON.parse(readFileSync(all_possible_files_path, { encoding: 'utf-8' }))
    // console.log(`Loaded all possible files: ${all_possible_files_path}`);
}

// Initial read of settings files
readSettings()

const moveConfigPath = join(__dirname, 'settings', 'move_config.json')
let move_config = {}
// console.log(`Loading move config: ${moveConfigPath}`);
try {
    move_config = JSON.parse(readFileSync(moveConfigPath, { encoding: 'utf-8' }))
    // console.log(`Loaded move config: ${moveConfigPath}`);
} catch (err) {
    console.error("Error loading move_config.json:", err)
}

const scrollControllersConfigPath = join(__dirname, 'settings', 'scroll_controllers_config.json')
let scroll_controllers_config = {}
try {
    scroll_controllers_config = JSON.parse(readFileSync(scrollControllersConfigPath, { encoding: 'utf-8' }))
    // console.log(`Loaded scroll controllers config: ${scrollControllersConfigPath}`);
} catch (err) {
    console.error("Error loading scroll_controllers_config.json:", err)
}

const nova_sonic_config = JSON.parse(readFileSync(join(__dirname, 'settings', 'nova-sonic-config.json'), { encoding: 'utf-8' }))

const NovaClient = require('./utils/nova-client')
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime')

let bedrockClient = null
let novaClient = null

if (nova_sonic_config.enabled) {
    bedrockClient = new BedrockRuntimeClient({
        region: process.env.BEDROCK_MODEL_REGION || nova_sonic_config.region,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN
        }
    })
}

function writeToJSON (filename, json) {
    const file_path = join(__dirname, 'settings', filename + '.json')
    json = JSON.stringify(json, null, 4)
    writeFileSync(file_path, json, { encoding: 'utf-8' })
}

// handle with websockets with frontend
function syncWSWithOne (client, cmd, value) {
    client.send(JSON.stringify({ cmd, value }))
}

function syncWSWithAll (cmd, value) {
    msg = JSON.stringify({ cmd, value })
    sendWebSockets.forEach(e => e.send(msg))
}

function getFullSyncItem () {
    return {
        profiles, current_profile,
        scripts, triggers, shortcuts, paged_shortcuts,
        announcements
    }
}

// websocket setup
app.ws('/api/sync', (ws, req) => {

    console.log(`[WebSocket] New connection from ${req.ip || req.connection.remoteAddress}`)
    sendWebSockets.push(ws)
    console.log(`[WebSocket] Total connections: ${sendWebSockets.length}`)

    // execute different commands
    ws.on('message', async (msg) => {
        try {
            const parsed = JSON.parse(msg)
            const { cmd, message, robot, type } = parsed
            console.log(`[WebSocket] Received message:`, parsed)

            switch (cmd) {
                case 'req-sync':
                    readSettings() // Read settings files before syncing
                    syncWSWithOne(ws, 'res-sync', getFullSyncItem())
                    break
                case 'req-update-profile':
                    current_profile = message
                    // If profile name is not null
                    if (current_profile && current_profile.name) {
                        scripts = all_scripts[current_profile.name] || {}
                        syncWSWithAll('res-update-scripts', scripts)
                        syncWSWithAll('res-update-profile', current_profile)
                        console.log("Update profile:", current_profile)
                        console.log("Profile name:", current_profile.name)
                    }
                    break
                case 'req-execute':
                    // Use Robot API instead of direct socket calls
                    robotAPI.sendMessage({ cmd, type, message, robot }, robot)
                    break

                case 'tablet-video-play':
                    // Set global video playing state
                    isVideoPlaying = true
                    videoPlayingRobot = robot
                    console.log(`[Video Control] 🎬 Video playing started for robot ${robot} - STT/LLM disabled`)

                    // Stop any ongoing robot speech/activities
                    try {
                        robotAPI.sendStopActionToRobot(robot)
                        console.log(`[Video Control] 🛑 Sent $StopAction to robot ${robot} to halt ongoing activities`)
                    } catch (error) {
                        console.error(`[Video Control] Failed to send commands to robot ${robot}:`, error)
                    }

                    // Broadcast tablet video play event with proper message format
                    const playMessage = JSON.stringify({
                        cmd: 'tablet-video-play',
                        robot: robot,
                        videoUrl: message.videoUrl || 'http://198.18.0.1/apps/rmit-race/TB_video.mp4',
                        timestamp: Date.now()
                    })
                    sendWebSockets.forEach(ws => {
                        if (ws.readyState === 1) {
                            ws.send(playMessage)
                        }
                    })
                    console.log(`[WebSocket] Broadcasting tablet video play to ${robot}`)
                    break
                case 'tablet-video-stop':
                    // Clear global video playing state
                    isVideoPlaying = false
                    videoPlayingRobot = null
                    console.log(`[Video Control] ⏹️ Video playing stopped for robot ${robot} - STT/LLM enabled`)

                    // Broadcast tablet video stop event with proper message format
                    const stopMessage = JSON.stringify({
                        cmd: 'tablet-video-stop',
                        robot: robot,
                        timestamp: Date.now()
                    })
                    sendWebSockets.forEach(ws => {
                        if (ws.readyState === 1) {
                            ws.send(stopMessage)
                        }
                    })
                    console.log(`[WebSocket] Broadcasting tablet video stop to ${robot}`)
                    break
                default:
                    console.log(`[WebSocket] Unknown command: ${cmd}`)
            }
        } catch (error) {
            console.error(`[WebSocket] Failed to parse message:`, error, 'Raw message:', msg)
        }
    })

    ws.on("close", () => {
        console.log(`[WebSocket] Connection closed`)
        sendWebSockets = sendWebSockets.filter(e => e !== ws)
        console.log(`[WebSocket] Remaining connections: ${sendWebSockets.length}`)
    })
    ws.on("error", (error) => {
        console.log(`[WebSocket] Connection error:`, error)
        sendWebSockets = sendWebSockets.filter(e => e !== ws)
        console.log(`[WebSocket] Remaining connections: ${sendWebSockets.length}`)
    })

})

// WebSocket endpoint for LLM streaming (backend proxy)  
app.ws('/api/llm/stream', (ws, req) => {
    const sessionId = `llm-stream-${Math.random().toString(36).substr(2, 9)}`
    console.log(`[LLM-Stream-${sessionId}] New session started`)
    
    // Session state
    const sessionState = {
        conversationHistory: [],
        ollamaContext: null, // For Ollama conversation continuity
        provider: process.env.LLM_PROVIDER || 'bedrock'
    }
    
    // Send immediate test message
    ws.send(JSON.stringify({
        type: 'test',
        message: 'Hello from server'
    }))
    
    // Send session created message
    setImmediate(() => {
        console.log(`[LLM-Stream-${sessionId}] Sending session_created message`)
        ws.send(JSON.stringify({
            type: 'session_created',
            sessionId: sessionId,
            provider: sessionState.provider,
            status: 'ready'
        }))
    })
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString())
            console.log(`[LLM-Stream-${sessionId}] Received action:`, data.action)
            
            if (data.action === 'send_message') {
                console.log(`[LLM-Stream-${sessionId}] ⚡ Entering send_message handler`)
                
                // Add user message to history
                const userMessage = {
                    role: 'user',
                    content: data.message,
                    timestamp: Date.now()
                }
                sessionState.conversationHistory.push(userMessage)
                
                // Build prompt with conversation history for context
                let prompt = data.message
                if (data.includeHistory && sessionState.conversationHistory.length > 1) {
                    // Build full conversation context
                    const conversationContext = sessionState.conversationHistory
                        .slice(0, -1) // Exclude current message
                        .map(msg => {
                            if (msg.role === 'user') {
                                return `User: ${msg.content}`
                            } else {
                                // Clean assistant response of robot commands for context
                                const cleanContent = msg.content
                                    .replace(/\^start\([^)]+\)\s*/g, '')
                                    .replace(/\^wait\([^)]+\)\s*/g, '')
                                    .replace(/\{[^}]+\}/g, '')
                                    .trim()
                                return `Assistant: ${cleanContent}`
                            }
                        })
                        .join('\n')
                    
                    prompt = `Previous conversation:\n${conversationContext}\n\nUser: ${data.message}\nAssistant:`
                    console.log(`[LLM-Stream-${sessionId}] Using conversation context with ${sessionState.conversationHistory.length - 1} previous messages`)
                }
                
                console.log(`[LLM-Stream-${sessionId}] Sending message to ${sessionState.provider}`)
                
                if (sessionState.provider === 'ollama') {
                    console.log(`[LLM-Stream-${sessionId}] 🎯 Starting Ollama stream`)
                    
                    // Stream from Ollama
                    try {
                        const ollamaConfig = {
                            prompt: prompt,
                            context: sessionState.ollamaContext, // Maintain conversation context
                            model: process.env.OLLAMA_MODEL || 'haku',
                            host: process.env.OLLAMA_HOST || 'localhost',
                            port: parseInt(process.env.OLLAMA_PORT) || 11434,
                            timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 120000
                        }
                        
                        console.log(`[LLM-Stream-${sessionId}] Ollama config:`, { ...ollamaConfig, context: ollamaConfig.context ? 'present' : 'none' })
                        
                        let chunkCount = 0
                        let fullResponse = ''
                        
                        // Stream chunks to frontend and robot
                        const generator = ollamaStream(ollamaConfig)
                        for await (const chunk of generator) {
                            chunkCount++
                            fullResponse += chunk.content
                            console.log(`[LLM-Stream-${sessionId}] 📦 Chunk ${chunkCount}: "${chunk.content}"`)
                            
                            // Send to frontend
                            ws.send(JSON.stringify({
                                type: 'llm_chunk',
                                content: chunk.content,
                                sessionId: sessionId,
                                timestamp: chunk.created_at
                            }))
                            
                            // Send to robot via RobotAPI for speech
                            if (data.robot) {
                                robotAPI.processLLMChunk(
                                    sessionId,
                                    chunk.content,
                                    chunk.done,
                                    data.robot
                                )
                            }
                        }
                        
                        // The generator returns the context when done - this is automatically
                        // returned when we finish iterating. We can't access it easily with
                        // for-await-of, so context continuity is managed by Ollama internally
                        // based on the conversation within a single session.
                        
                        // Add assistant response to history
                        sessionState.conversationHistory.push({
                            role: 'assistant',
                            content: fullResponse,
                            timestamp: Date.now()
                        })
                        
                        console.log(`[LLM-Stream-${sessionId}] ✅ Stream complete, sent ${chunkCount} chunks`)
                        
                        // Flush any remaining buffered content to robot
                        if (data.robot) {
                            robotAPI.processLLMChunk(
                                sessionId,
                                '', // No new content, just flush
                                true, // isFinished = true
                                data.robot
                            )
                        }
                        
                        // Send completion message
                        ws.send(JSON.stringify({
                            type: 'llm_complete',
                            sessionId: sessionId,
                            fullResponse: fullResponse
                        }))
                        
                        console.log(`[LLM-Stream-${sessionId}] Ollama streaming complete`)
                    } catch (error) {
                        console.error(`[LLM-Stream-${sessionId}] Ollama error:`, error)
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: `Ollama error: ${error.message}`
                        }))
                    }
                } else if (sessionState.provider === 'bedrock') {
                    console.log(`[LLM-Stream-${sessionId}] 🎯 Starting Bedrock stream`)
                    
                    // Stream from Bedrock via WebSocket gateway
                    try {
                        // Create WebSocket connection to Bedrock gateway
                        const bedrockWs = new WebSocket(LLM_GATEWAY_HOST)
                        
                        bedrockWs.on('open', () => {
                            console.log(`[LLM-Stream-${sessionId}] Connected to Bedrock gateway`)
                            
                            // Send message to Bedrock
                            const bedrockMessage = {
                                action: 'sendMessage',
                                message: prompt,
                                conversationHistory: data.includeHistory ? sessionState.conversationHistory.slice(0, -1) : []
                            }
                            
                            bedrockWs.send(JSON.stringify(bedrockMessage))
                        })
                        
                        let fullResponse = ''
                        let chunkCount = 0
                        
                        bedrockWs.on('message', (bedrockData) => {
                            try {
                                const bedrockMsg = JSON.parse(bedrockData.toString())
                                
                                if (bedrockMsg.content || bedrockMsg.response) {
                                    const content = bedrockMsg.content || bedrockMsg.response
                                    chunkCount++
                                    fullResponse += content
                                    
                                    console.log(`[LLM-Stream-${sessionId}] 📦 Bedrock chunk ${chunkCount}`)
                                    
                                    // Forward to frontend
                                    ws.send(JSON.stringify({
                                        type: 'llm_chunk',
                                        content: content,
                                        sessionId: sessionId,
                                        timestamp: Date.now()
                                    }))
                                    
                                    // Send to robot
                                    if (data.robot) {
                                        robotAPI.processLLMChunk(
                                            sessionId,
                                            content,
                                            bedrockMsg.isFinished || false,
                                            data.robot
                                        )
                                    }
                                    
                                    if (bedrockMsg.isFinished) {
                                        bedrockWs.close()
                                        
                                        // Add to history
                                        sessionState.conversationHistory.push({
                                            role: 'assistant',
                                            content: fullResponse,
                                            timestamp: Date.now()
                                        })
                                        
                                        // Send completion
                                        ws.send(JSON.stringify({
                                            type: 'llm_complete',
                                            sessionId: sessionId,
                                            fullResponse: fullResponse
                                        }))
                                        
                                        console.log(`[LLM-Stream-${sessionId}] Bedrock streaming complete, ${chunkCount} chunks`)
                                    }
                                }
                            } catch (error) {
                                console.error(`[LLM-Stream-${sessionId}] Bedrock message error:`, error)
                                bedrockWs.close()
                                ws.send(JSON.stringify({
                                    type: 'error',
                                    error: `Bedrock error: ${error.message}`
                                }))
                            }
                        })
                        
                        bedrockWs.on('error', (error) => {
                            console.error(`[LLM-Stream-${sessionId}] Bedrock WebSocket error:`, error)
                            ws.send(JSON.stringify({
                                type: 'error',
                                error: `Bedrock connection error: ${error.message}`
                            }))
                        })
                        
                        bedrockWs.on('close', () => {
                            console.log(`[LLM-Stream-${sessionId}] Bedrock WebSocket closed`)
                        })
                        
                    } catch (error) {
                        console.error(`[LLM-Stream-${sessionId}] Bedrock error:`, error)
                        ws.send(JSON.stringify({
                            type: 'error',
                            error: `Bedrock error: ${error.message}`
                        }))
                    }
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: `Unknown provider: ${sessionState.provider}`
                    }))
                }
            } else if (data.action === 'get_history') {
                // Return conversation history
                console.log(`[LLM-Stream-${sessionId}] Returning ${sessionState.conversationHistory.length} history items`)
                ws.send(JSON.stringify({
                    type: 'history',
                    sessionId: sessionId,
                    history: sessionState.conversationHistory
                }))
            } else if (data.action === 'clear_history') {
                // Clear conversation history
                sessionState.conversationHistory = []
                sessionState.ollamaContext = null
                ws.send(JSON.stringify({
                    type: 'history_cleared',
                    sessionId: sessionId
                }))
                console.log(`[LLM-Stream-${sessionId}] Conversation history cleared`)
            } else if (data.action === 'set_provider') {
                // Change provider (requires reconnection)
                const newProvider = data.provider
                if (['ollama', 'bedrock'].includes(newProvider)) {
                    sessionState.provider = newProvider
                    // Clear history when switching providers
                    sessionState.conversationHistory = []
                    sessionState.ollamaContext = null
                    ws.send(JSON.stringify({
                        type: 'provider_changed',
                        sessionId: sessionId,
                        provider: newProvider
                    }))
                    console.log(`[LLM-Stream-${sessionId}] Provider changed to ${newProvider}`)
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: `Invalid provider: ${newProvider}`
                    }))
                }
            } else {
                // Echo back other actions for testing
                ws.send(JSON.stringify({
                    type: 'action_received',
                    action: data.action,
                    sessionId: sessionId
                }))
            }
        } catch (error) {
            console.error(`[LLM-Stream-${sessionId}] Error:`, error)
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }))
        }
    })
    
    ws.on('close', () => {
        console.log(`[LLM-Stream-${sessionId}] Session closed`)
    })
    
    ws.on('error', (error) => {
        console.error(`[LLM-Stream-${sessionId}] WebSocket error:`, error)
    })
})

// Nova Sonic real-time conversation WebSocket
app.ws('/api/nova-sonic-stream', (ws, req) => {
    console.log('Nova Sonic conversation started')

    if (!nova_sonic_config.enabled || !bedrockClient) {
        ws.send(JSON.stringify({ error: 'Nova Sonic is disabled' }))
        ws.close()
        return
    }

    // Create event handler for Nova client
    const eventHandler = (eventType, data) => {
        switch (eventType) {
            case 'contentStart':
                ws.send(JSON.stringify({ action: 'contentStart', ...data }))
                break
            case 'textOutput':
                // Send text to frontend
                ws.send(JSON.stringify({ action: 'textOutput', ...data }))

                // Only send AI assistant responses to Haku robot for speech, not user input
                // Check the role field to determine if this is from the assistant or user
                // Also check if the message contains an "interrupted" flag
                if (data.content && data.content.trim() && data.role === 'ASSISTANT') {
                    // Check if the content contains an interrupted flag
                    let shouldSendToRobot = true
                    try {
                        if (data.content.includes('"interrupted"') && data.content.includes('true')) {
                            console.log('🚫 Message contains interrupted flag, not sending to robot:', data.content)
                            shouldSendToRobot = false
                        }
                    } catch (error) {
                        console.warn('Error checking for interrupted flag:', error)
                    }

                    if (shouldSendToRobot) {
                        console.log('🗣️ Sending Nova AI response to Haku via Robot API:', data.content)

                        // Use Robot API for Nova Sonic responses
                        const messageData = {
                            cmd: 'req-execute',
                            type: 'conversation-response',
                            message: data.content,
                            robot: 'Haku',
                            source: 'nova-sonic',
                            timestamp: Date.now()
                        }

                        const sent = robotAPI.sendMessage(messageData, 'Haku')

                        if (sent) {
                            console.log("✅ Nova AI response sent via Robot API successfully")
                        } else {
                            console.log("⚠️ Nova AI response queued (no active robot connections)")

                            // Fallback to legacy socket system for Nova Sonic
                            sendSockets.forEach(s => {
                                const speechCommand = JSON.stringify({
                                    cmd: 'req-execute',
                                    type: 'conversation-response',
                                    message: data.content.trim(),
                                    robot: 'Haku'
                                })
                                    .normalize('NFKC')
                                    .replace(/[""]/g, '"')
                                    .replace(/['']/g, "'")
                                    .replace(/…/g, '...')
                                    .replace(/[^\x00-\x7F]/g, "")

                                s(speechCommand)
                                console.log("Fallback - sent Nova AI response via legacy socket:", speechCommand)
                            })
                        }
                    }
                } else if (data.role === 'USER') {
                    console.log('👤 User input detected, not sending to robot:', data.content)
                } else {
                    console.log('🔍 Unknown role in textOutput:', data.role, 'Content:', data.content)
                }
                break
            case 'audioOutput':
                if (data.audioData && data.audioData.content) {
                    console.log('🔊 Audio output')
                    ws.send(JSON.stringify({ action: 'audioOutput', audioData: data.audioData }))
                }
                break
            case 'contentEnd':
                ws.send(JSON.stringify({ action: 'contentEnd', ...data }))
                break
            case 'interviewEnd':
                ws.send(JSON.stringify({ action: 'interviewEnd' }))
                break
        }
    }

    // Create Nova client instance
    novaClient = new NovaClient(bedrockClient, eventHandler)

    // Start the streaming session
    novaClient._startStreaming().then(() => {
        console.log('Nova streaming started successfully')
        ws.send(JSON.stringify({ status: 'Connected to Nova Sonic - Ready to chat!' }))
    }).catch(error => {
        console.error('Failed to start Nova streaming:', error)
        ws.send(JSON.stringify({ error: error.message }))
    })

    ws.on('message', async (message) => {
        try {
            if (!novaClient) {
                ws.send(JSON.stringify({ error: 'Nova client not initialized' }))
                return
            }

            // Check if it's a JSON command
            if (typeof message === 'string' && message.startsWith('{')) {
                try {
                    const command = JSON.parse(message)
                    console.log('Received command:', command)

                    switch (command.action) {
                        case 'startSession':
                            console.log('Starting Nova session...')
                            ws.send(JSON.stringify({ status: 'Session started, ready for audio' }))
                            return
                        case 'audioInput':
                            if (command.base64Data) {
                                console.log('🎤 Audio received')
                                const processedBuffer = Buffer.from(command.base64Data, 'base64')
                                novaClient.streamAudio(processedBuffer)
                            }
                            return
                        case 'setUserId':
                            if (command.userId) {
                                novaClient.setUserId(command.userId)
                                console.log('Set userId:', command.userId)
                            }
                            return
                        case 'playback-finished':
                            console.log('🔊 Audio playback finished')
                            if (novaClient && novaClient.handlePlaybackFinished) {
                                novaClient.handlePlaybackFinished()
                            }
                            return
                        case 'endSession':
                            novaClient.sendEnd({ manual: true })
                            return
                    }
                } catch (e) {
                    // Not JSON, treat as audio data
                }
            }

            console.log('Received audio message, type:', typeof message, 'length:', message.length)

            // Handle base64 string from frontend
            if (typeof message === 'string') {
                // Message is already base64 encoded
                const processedBuffer = Buffer.from(message, 'base64')
                console.log('Processed audio buffer size:', processedBuffer.length, 'bytes')
                novaClient.streamAudio(processedBuffer)
            } else {
                // Handle binary data (fallback)
                const audioBase64 = Buffer.from(message).toString('base64')
                const processedBuffer = Buffer.from(audioBase64, 'base64')
                console.log('Processed binary audio buffer size:', processedBuffer.length, 'bytes')
                novaClient.streamAudio(processedBuffer)
            }

        } catch (error) {
            console.error('Nova Sonic stream error:', error)
            ws.send(JSON.stringify({ error: error.message }))
        }
    })

    ws.on('close', () => {
        console.log('Nova Sonic conversation ended')
        if (novaClient) {
            novaClient.events.complete()
        }
    })

    ws.on('error', (error) => {
        console.error('Nova Sonic WebSocket error:', error)
    })
})

// ROUTER SETUP
app.use(express.static(join(__dirname, 'dist')))
app.use(express.static(join(__dirname, 'public')))

const router = express.Router()
// Mount router so routes below are active
app.use(router)

// for file upload
router.get("/api/get-possible-files", (req, res) => {
    res.status(200).send(all_possible_files)
})

router.get("/api/move-config", (req, res) => {
    res.status(200).json(move_config)
})

router.get("/api/scrollcontrollers-config", (req, res) => {
    res.status(200).json(scroll_controllers_config)
})

router.get("/api/triggers-config", (req, res) => {
    res.status(200).json(triggers)
})

router.get("/api/paged-shortcuts-config", (req, res) => {
    res.status(200).json(paged_shortcuts)
})

router.post("/api/file-upload", (req, res) => {
    try {
        const json = req.body
        const { name } = req.query
        let write_file_name = name
        switch (name) {
            case 'triggers':
                triggers = json; break
            case 'shortcuts':
                shortcuts = json; break
            case 'announcements':
                announcements = json; break
            case 'paged_shortcuts':
                paged_shortcuts = json; break
            default:
                all_scripts[name] = json
                if (current_profile.name === name) { scripts = json }
                write_file_name = name.replaceAll(" ", "_") + '_Script'
                break
        }
        writeToJSON(write_file_name, json)
        readSettings() // Read settings files after upload
        syncWSWithAll('res-sync', getFullSyncItem())
        res.status(200).send("done")
    } catch (error) {
        console.error(error)
        res.status(501).send("Internal Server Error")
    }
})

// Get Nova Sonic config
router.get("/api/nova-sonic-config", (req, res) => {
    // Don't expose sensitive config, only status
    res.status(200).json({
        enabled: nova_sonic_config.enabled,
        model: nova_sonic_config.model,
        region: nova_sonic_config.region
    })
})

// Add network info endpoint
router.get("/api/network-info", (req, res) => {
    try {
        const interfaces = getLocalIPAddresses()
        res.status(200).json({
            interfaces: interfaces,
            serverTime: new Date().toISOString()
        })
    } catch (error) {
        console.error('Network info error:', error)
        res.status(500).json({ error: 'Failed to get network info' })
    }
})

// Add configuration endpoint
router.get("/api/network-config", (req, res) => {
    const sttDisabled = process.env.STT_DISABLED === 'true' || STT_SERVER_HOST === 'disabled'
    
    // Determine LLM provider from environment
    const llmProvider = (process.env.LLM_PROVIDER || 'bedrock').toLowerCase()
    const availableProviders = ['bedrock', 'ollama']
    
    // Build backend WebSocket URL for LLM streaming (no direct gateway exposure)
    const protocol = req.secure ? 'wss' : 'ws'
    const host = req.hostname
    const port = SERVER_PORT === 443 || SERVER_PORT === 80 ? '' : `:${SERVER_PORT}`
    const streamUrl = `${protocol}://${host}${port}/api/llm/stream`

    res.status(200).json({
        server: {
            host: SERVER_HOST,
            port: SERVER_PORT
        },
        stt: {
            host: STT_SERVER_HOST,
            port: STT_SERVER_PORT,
            enabled: STT_LLM_ENABLED && !sttDisabled,
            disabled: sttDisabled,
            defaultUrl: sttDisabled ? null : `ws://${STT_SERVER_HOST}:${STT_SERVER_PORT}`
        },
        llm: {
            provider: llmProvider,
            availableProviders: availableProviders,
            streamUrl: streamUrl, // Backend WebSocket endpoint for LLM streaming
            enabled: true
            // Note: No AWS credentials or gateway URLs exposed
        },
        websocket: {
            reconnectAttempts: WS_RECONNECT_ATTEMPTS,
            reconnectDelay: WS_RECONNECT_DELAY
        }
    })
})

app.use('/', router)

app.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`Express server is listening on ${SERVER_HOST}:${SERVER_PORT}!`)
})

// SOCKET
const net = require('net')

const server = net.createServer((socket) => {
    console.log('Client connected from:', socket.remoteAddress, ':', socket.remotePort)

    function sendSocket (message) {
        socket.write(message)
    }

    // Register with Robot API, including socket info for identification
    const socketId = robotAPI.registerConnection(sendSocket, {
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort
    })

    // Keep in legacy array for compatibility
    sendSockets.push(sendSocket)

    socket.on('data', (data) => {
        // Handle with Robot API
        robotAPI.handleIncomingData(socketId, data)
    })

    socket.on('end', () => {
        robotAPI.unregisterConnection(socketId)
        sendSockets = sendSockets.filter(e => e !== sendSocket)
        console.log('Client disconnected')
    })

    socket.on('error', (err) => {
        robotAPI.unregisterConnection(socketId)
        sendSockets = sendSockets.filter(e => e !== sendSocket)
        console.error('Socket error:', err)
    })
})


server.listen(SOCKET_PORT, SERVER_HOST, () => {
    console.log(`Socket server is listening on ${SERVER_HOST}:${SOCKET_PORT}`)
})

// Add WebSocket client for STT server connection
const WebSocket = require('ws')

// STT and LLM connection management
let sttConnections = new Map() // sessionId -> sttClient
let llmConnections = new Map() // sessionId -> llmClient

// Add network interface detection
const os = require('os')
function getLocalIPAddresses () {
    const interfaces = os.networkInterfaces()
    const addresses = []

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-IPv4 and internal addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({ name, address: iface.address })
            }
        }
    }
    return addresses
}

// STT WebSocket client class
class STTClient {
    constructor(sessionId, frontendWs) {
        this.sessionId = sessionId
        this.frontendWs = frontendWs
        this.sttWs = null
        this.isConnected = false
        this.reconnectAttempts = 0
        this.maxReconnectAttempts = WS_RECONNECT_ATTEMPTS
        this.reconnectDelay = WS_RECONNECT_DELAY
    }

    async connect (sttServerUrl = `ws://${STT_SERVER_HOST}:${STT_SERVER_PORT}`) {
        try {
            console.log(`[STT-${this.sessionId}] Connecting to STT server: ${sttServerUrl}`)
            this.sendToFrontend({ type: 'stt_status', status: 'connecting' })

            this.sttWs = new WebSocket(sttServerUrl)

            this.sttWs.on('open', () => {
                console.log(`[STT-${this.sessionId}] Connected to STT server`)
                this.isConnected = true
                this.reconnectAttempts = 0
                this.sendToFrontend({ type: 'stt_status', status: 'connected' })
            })

            this.sttWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString())
                    console.log(`[STT-${this.sessionId}] Received from STT:`, message.type)

                    // Forward STT messages to frontend
                    this.sendToFrontend({
                        type: 'stt_message',
                        data: message
                    })
                } catch (error) {
                    console.error(`[STT-${this.sessionId}] Error parsing STT message:`, error)
                }
            })

            this.sttWs.on('close', (code, reason) => {
                console.log(`[STT-${this.sessionId}] STT connection closed:`, code, reason?.toString())
                this.isConnected = false
                this.sendToFrontend({ type: 'stt_status', status: 'disconnected' })

                // Auto-reconnect logic
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++
                    console.log(`[STT-${this.sessionId}] Scheduling reconnect attempt ${this.reconnectAttempts} in ${this.reconnectDelay * this.reconnectAttempts}ms`)
                    setTimeout(() => {
                        console.log(`[STT-${this.sessionId}] Reconnecting attempt ${this.reconnectAttempts}...`)
                        this.connect(sttServerUrl)
                    }, this.reconnectDelay * this.reconnectAttempts)
                } else {
                    console.log(`[STT-${this.sessionId}] Max reconnect attempts reached`)
                    this.sendToFrontend({ type: 'stt_status', status: 'error', error: 'Max reconnect attempts reached' })
                }
            })

            this.sttWs.on('error', (error) => {
                console.error(`[STT-${this.sessionId}] STT connection error:`, error)
                this.isConnected = false
                this.sendToFrontend({ type: 'stt_status', status: 'error', error: error.message })
            })

        } catch (error) {
            console.error(`[STT-${this.sessionId}] Failed to connect to STT:`, error)
            this.sendToFrontend({ type: 'stt_status', status: 'error', error: error.message })
        }
    }

    sendToSTT (message) {
        if (this.sttWs && this.sttWs.readyState === WebSocket.OPEN) {
            this.sttWs.send(JSON.stringify(message))
            console.log(`[STT-${this.sessionId}] Sent to STT:`, message.action)
        } else {
            console.warn(`[STT-${this.sessionId}] Cannot send to STT - not connected`)
            this.sendToFrontend({ type: 'stt_status', status: 'error', error: 'STT not connected' })
        }
    }

    sendToFrontend (message) {
        if (this.frontendWs && this.frontendWs.readyState === 1) {
            this.frontendWs.send(JSON.stringify(message))
        }
    }

    disconnect () {
        console.log(`[STT-${this.sessionId}] Disconnecting STT client`)
        this.reconnectAttempts = this.maxReconnectAttempts // Stop auto-reconnect
        if (this.sttWs) {
            this.sttWs.close()
            this.sttWs = null
        }
        this.isConnected = false
    }
}

// LLM WebSocket client class
class LLMClient {
    constructor(sessionId, frontendWs) {
        this.sessionId = sessionId
        this.frontendWs = frontendWs
        this.llmWs = null
        this.isConnected = false
        this.conversationHistory = []
        this.pendingRequests = new Map()
        this.delayStats = {
            totalRequests: 0,
            totalDelay: 0,
            minDelay: Infinity,
            maxDelay: 0,
            averageDelay: 0,
            recentDelays: []
        }
        this.serverTimestamps = new Map()
        this.firstResponseReceived = new Map()
    }

    async connect (llmGatewayUrl) {
        try {
            const finalUrl = llmGatewayUrl || LLM_GATEWAY_HOST
            console.log(`[LLM-${this.sessionId}] Connecting to LLM gateway: ${finalUrl}`)
            this.sendToFrontend({ type: 'llm_status', status: 'connecting' })

            this.llmWs = new WebSocket(finalUrl)

            this.llmWs.on('open', () => {
                console.log(`[LLM-${this.sessionId}] Connected to LLM gateway`)
                this.isConnected = true
                this.sendToFrontend({ type: 'llm_status', status: 'connected' })
            })

            this.llmWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString())
                    const serverReceiveTime = Date.now()
                    console.log(`[LLM-${this.sessionId}] Received from LLM at server time ${serverReceiveTime}:`, message.type || 'response')

                    // Handle delay calculation
                    if (message.content || message.response) {
                        let matchedRequestId = null
                        let serverSendTime = null

                        // Try to match by requestId if provided in response
                        if (message.requestId && this.serverTimestamps.has(message.requestId)) {
                            matchedRequestId = message.requestId
                            serverSendTime = this.serverTimestamps.get(matchedRequestId)
                        } else {
                            // Fall back to finding the oldest pending request
                            for (const [requestId, timestamp] of this.serverTimestamps.entries()) {
                                if (!this.firstResponseReceived.get(requestId)) {
                                    matchedRequestId = requestId
                                    serverSendTime = timestamp
                                    break
                                }
                            }
                        }

                        // Calculate delay if we found a matching request
                        if (matchedRequestId && serverSendTime && !this.firstResponseReceived.get(matchedRequestId)) {
                            const serverDelay = serverReceiveTime - serverSendTime
                            this.firstResponseReceived.set(matchedRequestId, true)
                            this.updateDelayStats(serverDelay)

                            console.log(`[LLM-${this.sessionId}] ⏱️  Server-side STT→LLM delay: ${serverDelay}ms`)

                            // Send server-side timing info to frontend
                            this.sendToFrontend({
                                type: 'server_delay_measurement',
                                delay: serverDelay,
                                serverSendTime: serverSendTime,
                                serverReceiveTime: serverReceiveTime,
                                requestId: matchedRequestId,
                                stats: { ...this.delayStats }
                            })

                            // Clean up old timestamps
                            this.serverTimestamps.delete(matchedRequestId)
                            this.firstResponseReceived.delete(matchedRequestId)
                            this.pendingRequests.delete(matchedRequestId)
                        }

                        // Check if video is playing - if so, block LLM processing completely
                        if (isVideoPlaying) {
                            console.log(`[LLM-${this.sessionId}] 🚫 Blocking LLM processing - video playing for robot ${videoPlayingRobot}`)
                            // Still forward to frontend for debugging but don't process for robot
                            this.sendToFrontend({
                                type: 'llm_message',
                                data: { ...message, blocked: true, reason: 'video_playing' }
                            })
                            return
                        }

                        // Process content for robot speech using Robot API
                        const content = message.content || message.response
                        if (content) {
                            console.log(`[LLM-${this.sessionId}] 📝 Processing LLM content via Robot API: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`)
                            robotAPI.processLLMChunk(this.sessionId, content, message.isFinished || false, 'Haku')
                        }

                        if (message.isFinished) {
                            console.log(`[LLM-${this.sessionId}] ✅ LLM response finished`)
                            robotAPI.processLLMChunk(this.sessionId, '', true, 'Haku')
                        }
                    }

                    // Add assistant response to history
                    if (message.content || message.response) {
                        this.conversationHistory.push({
                            role: 'assistant',
                            content: message.content || message.response
                        })
                    }

                    // Forward LLM messages to frontend
                    this.sendToFrontend({
                        type: 'llm_message',
                        data: message
                    })
                } catch (error) {
                    console.error(`[LLM-${this.sessionId}] Error parsing LLM message:`, error)
                }
            })

            this.llmWs.on('close', (code, reason) => {
                console.log(`[LLM-${this.sessionId}] LLM connection closed:`, code, reason?.toString())
                this.isConnected = false
                this.sendToFrontend({ type: 'llm_status', status: 'disconnected' })
            })

            this.llmWs.on('error', (error) => {
                console.error(`[LLM-${this.sessionId}] LLM connection error:`, error)
                this.isConnected = false
                this.sendToFrontend({ type: 'llm_status', status: 'error', error: error.message })
            })

        } catch (error) {
            console.error(`[LLM-${this.sessionId}] Failed to connect to LLM:`, error)
            this.sendToFrontend({ type: 'llm_status', status: 'error', error: error.message })
        }
    }

    sendMessage (userMessage, sourceInfo = {}) {
        // Check if video is playing - if so, block LLM requests
        if (isVideoPlaying) {
            console.log(`[LLM-${this.sessionId}] 🚫 Blocking LLM request - video playing for robot ${videoPlayingRobot}`)
            this.sendToFrontend({
                type: 'llm_message',
                data: { type: 'blocked', error: 'LLM blocked - video playing', reason: 'video_playing' }
            })
            return
        }

        if (this.llmWs && this.isConnected && this.llmWs.readyState === WebSocket.OPEN) {
            const serverSendTime = Date.now()
            const requestId = `${this.sessionId}-${serverSendTime}`

            // Store server-side timestamps
            this.pendingRequests.set(requestId, serverSendTime)
            this.serverTimestamps.set(requestId, serverSendTime)
            this.firstResponseReceived.set(requestId, false)

            // Add to conversation history
            this.conversationHistory.push({ role: 'user', content: userMessage })

            const llmPayload = {
                action: 'completion',
                history: this.conversationHistory.slice(-10),
                requestId: requestId,
                serverSendTime: serverSendTime
            }

            console.log(`[LLM-${this.sessionId}] 📤 Sending to LLM at server time ${serverSendTime}: "${userMessage}" (source: ${sourceInfo.source || 'manual'})`)

            this.llmWs.send(JSON.stringify(llmPayload))
        } else {
            console.warn(`[LLM-${this.sessionId}] Cannot send to LLM - not connected (state: ${this.llmWs?.readyState})`)
            this.sendToFrontend({
                type: 'llm_message',
                data: { type: 'error', error: 'LLM not connected' }
            })
        }
    }

    sendToFrontend (message) {
        if (this.frontendWs && this.frontendWs.readyState === 1) {
            this.frontendWs.send(JSON.stringify(message))
        }
    }

    disconnect () {
        console.log(`[LLM-${this.sessionId}] Disconnecting LLM client`)
        if (this.llmWs) {
            this.llmWs.close()
            this.llmWs = null
        }
        this.isConnected = false
        this.pendingRequests.clear()
        this.serverTimestamps.clear()
        this.firstResponseReceived.clear()
    }
}

// Add LLM Chunk Processing WebSocket endpoint
app.ws('/api/llm-chunk-processor', (ws, req) => {
    const sessionId = Math.random().toString(36).substr(2, 9)
    console.log(`[LLM-Processor-${sessionId}] New LLM chunk processing session started`)

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString())
            console.log(`[LLM-Processor-${sessionId}] Received command:`, data.action)

            switch (data.action) {
                case 'process_chunk':
                    const { content, isFinished, targetRobot } = data
                    console.log(`[LLM-Processor-${sessionId}] Processing chunk: content=${content?.length || 0} chars, finished=${isFinished}, robot=${targetRobot}`)

                    robotAPI.processLLMChunk(sessionId, content, isFinished, targetRobot || 'Haku')

                    // Send acknowledgment
                    ws.send(JSON.stringify({
                        type: 'chunk_processed',
                        sessionId: sessionId,
                        success: true
                    }))
                    break

                case 'get_config':
                    // Send current configuration
                    ws.send(JSON.stringify({
                        type: 'config',
                        config: {
                            chunkMode: LLM_CHUNK_MODE,
                            minChunkLength: LLM_MIN_CHUNK_LENGTH,
                            maxBufferSize: LLM_MAX_BUFFER_SIZE,
                            sentenceMarkers: LLM_SENTENCE_MARKERS
                        }
                    }))
                    break

                default:
                    console.warn(`[LLM-Processor-${sessionId}] Unknown action:`, data.action)
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Unknown action: ' + data.action
                    }))
            }

        } catch (error) {
            console.error(`[LLM-Processor-${sessionId}] Message processing error:`, error)
            ws.send(JSON.stringify({
                type: 'error',
                error: 'Failed to process message: ' + error.message
            }))
        }
    })

    ws.on('close', () => {
        console.log(`[LLM-Processor-${sessionId}] Session ended`)
        // Clean up any remaining session data in Robot API
        robotAPI.processLLMChunk(sessionId, '', true)
    })

    ws.send(JSON.stringify({
        type: 'session_created',
        sessionId: sessionId,
        status: 'LLM chunk processor ready'
    }))
})

// Add REST API endpoints for STT and LLM
router.get("/api/stt-status", (req, res) => {
    const activeConnections = Array.from(sttConnections.entries()).map(([sessionId, client]) => ({
        sessionId,
        isConnected: client.isConnected,
        reconnectAttempts: client.reconnectAttempts
    }))

    res.status(200).json({
        totalSessions: sttConnections.size,
        activeConnections
    })
})

router.get("/api/llm-status", (req, res) => {
    const activeConnections = Array.from(llmConnections.entries()).map(([sessionId, client]) => ({
        sessionId,
        isConnected: client.isConnected,
        historyLength: client.conversationHistory.length,
        delayStats: client.getDelayStats()
    }))

    res.status(200).json({
        totalSessions: llmConnections.size,
        activeConnections
    })
})

// Add Robot API status endpoint
router.get("/api/robot-status", (req, res) => {
    res.status(200).json(robotAPI.getStatus())
})

// Enhanced robot status endpoints
router.get("/api/robot-status/detailed", (req, res) => {
    const robot = req.query.robot
    if (robot) {
        res.status(200).json(robotAPI.getRobotStatus(robot))
    } else {
        res.status(200).json(robotAPI.getAllRobotStatus())
    }
})

router.get("/api/robot-status/config", (req, res) => {
    res.status(200).json({
        statusConfig: robotAPI.statusConfig,
        triggersConfig: robotAPI.triggersConfig,
        scrollConfig: robotAPI.scrollConfig
    })
})

router.post("/api/robot-status/update/:robot", (req, res) => {
    const robot = req.params.robot
    const updates = req.body

    if (!robot || !updates) {
        return res.status(400).json({ error: "Robot name and updates are required" })
    }

    try {
        const updatedStatus = robotAPI.updateDetailedRobotStatus(robot, updates)
        res.status(200).json({ success: true, status: updatedStatus })
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})

// Add Robot API message history endpoint
router.get("/api/robot-history/:robot?", (req, res) => {
    const robot = req.params.robot || req.query.robot
    const limit = parseInt(req.query.limit) || 100

    if (robot) {
        const history = robotAPI.getMessageHistory(robot, limit)
        res.status(200).json({ robot, history })
    } else {
        // Get all robot histories
        const allHistories = {}
        const status = robotAPI.getStatus()

        for (const robotName of new Set(status.connections.map(c => c.robot).filter(Boolean))) {
            allHistories[robotName] = robotAPI.getMessageHistory(robotName, limit)
        }

        res.status(200).json(allHistories)
    }
})

// Add WebSocket status endpoint
router.get("/api/websocket-status", (req, res) => {
    const activeConnections = sendWebSockets.filter(ws => ws.readyState === 1).length
    const totalConnections = sendWebSockets.length

    res.status(200).json({
        activeConnections,
        totalConnections,
        connections: sendWebSockets.map((ws, index) => ({
            index,
            readyState: ws.readyState,
            readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState]
        }))
    })
})

// Add Robot API message sending endpoint
router.post("/api/robot-send", (req, res) => {
    const { message, robot, type = 'api', sessionId } = req.body

    if (!message) {
        return res.status(400).json({ error: 'Message is required' })
    }

    // Handle broadcast type for LLM communication
    if (type === 'broadcast') {
        try {
            const broadcastData = JSON.parse(message)
            if (broadcastData.type === 'llm-user-input' || broadcastData.type === 'llm-ai-response') {
                console.log(`[Broadcast] Sending ${broadcastData.type} to ${sendWebSockets.length} WebSocket connections`)
                broadcastLLMCommunication(broadcastData.type, broadcastData.content, broadcastData.robot)
                return res.status(200).json({
                    success: true,
                    message: 'Broadcast sent successfully',
                    broadcastData,
                    connectionsCount: sendWebSockets.length
                })
            }
        } catch (error) {
            console.error('Failed to parse broadcast message:', error)
        }
    }

    const messageData = {
        cmd: 'api-execute',
        type: type,
        message: message,
        robot: robot || '',
        sessionId: sessionId,
        timestamp: Date.now(),
        source: 'api'
    }

    const sent = robotAPI.sendMessage(messageData, robot)

    res.status(200).json({
        success: sent,
        message: sent ? 'Message sent successfully' : 'Message queued (no active connections)',
        messageData
    })
})



// Robot API conversation response endpoint with proper chunking and turn-taking
router.post("/api/robot-conversation", (req, res) => {
    const { message, robot, sessionId, isFinished = false, isFirstChunk = false, chunkNumber } = req.body

    if (!message && !isFinished) {
        return res.status(400).json({ error: 'Message is required unless marking finished' })
    }

    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required for conversation responses' })
    }

    const targetRobot = robot || 'Haku'

    try {
        // Use the robot API's conversation response handler which includes proper chunking
        const result = robotAPI.handleConversationResponse(
            message,
            targetRobot,
            sessionId,
            isFinished,
            isFirstChunk,
            chunkNumber
        )

        if (result.success) {
            res.status(200).json({
                success: true,
                message: result.message,
                buffered: result.buffered,
                llmActive: result.llmActive,
                sessionId: sessionId,
                contentLength: result.contentLength,
                chunkNumber: chunkNumber,
                chunksWaiting: result.chunksWaiting || 0
            })
        } else {
            res.status(400).json({
                success: false,
                error: result.error,
                sessionId: sessionId,
                chunkNumber: chunkNumber
            })
        }

    } catch (error) {
        console.error('Error in conversation endpoint:', error)
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        })
    }
})





// Add Robot API buffer management endpoints
router.post("/api/robot-buffer/flush/:sessionId", (req, res) => {
    const { sessionId } = req.params
    const { targetRobot } = req.body

    const result = robotAPI.flushBuffer(sessionId, targetRobot)

    if (result.success) {
        res.status(200).json(result)
    } else {
        res.status(404).json(result)
    }
})

router.post("/api/robot-buffer/clear/:sessionId", (req, res) => {
    const { sessionId } = req.params

    const result = robotAPI.clearBuffer(sessionId)

    if (result.success) {
        res.status(200).json(result)
    } else {
        res.status(404).json(result)
    }
})

router.post("/api/robot-buffer/flush-remaining/:sessionId", (req, res) => {
    const { sessionId } = req.params
    const { targetRobot } = req.body
    const result = robotAPI.flushRemainingBuffer(sessionId, targetRobot)
    if (result.success) {
        res.status(200).json(result)
    } else {
        res.status(404).json(result)
    }
})

router.get("/api/robot-buffer/status/:sessionId", (req, res) => {
    const { sessionId } = req.params

    const status = robotAPI.getBufferStatus(sessionId)

    if (status.exists) {
        res.status(200).json(status)
    } else {
        res.status(404).json(status)
    }
})

router.get("/api/robot-buffer/status", (req, res) => {
    const statuses = robotAPI.getAllBufferStatuses()
    res.status(200).json(statuses)
})

router.post("/api/robot-buffer/force-process/:sessionId", (req, res) => {
    const { sessionId } = req.params
    const { targetRobot } = req.body

    const result = robotAPI.forceProcessBuffer(sessionId, targetRobot)

    if (result.success) {
        res.status(200).json(result)
    } else {
        res.status(404).json(result)
    }
})

router.post("/api/robot-buffer/update-mode/:sessionId", (req, res) => {
    const { sessionId } = req.params
    const { chunkMode } = req.body

    if (!chunkMode) {
        return res.status(400).json({ error: 'chunkMode is required' })
    }

    const result = robotAPI.updateSessionChunkMode(sessionId, chunkMode)

    if (result.success) {
        res.status(200).json(result)
    } else {
        res.status(400).json(result)
    }
})

// ============================
// Tablet heartbeat + reload API
// ============================

// In-memory heartbeat and cooldown tracking
const tabletHeartbeats = new Map() // robot -> timestamp of last heartbeat
const tabletLastReloadSent = new Map() // robot -> timestamp of last reload
const tabletLastPingSent = new Map() // robot -> timestamp of last ping

function buildTabletUrl (robot) {
    if (PUBLIC_BASE_URL) {
        return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/tablet?robot=${encodeURIComponent(robot || '')}`
    }
    return `/tablet?robot=${encodeURIComponent(robot || '')}`
}

function sendReloadTablet (robot) {
    if (!robot) return { success: false, message: 'Robot name required' }
    const url = buildTabletUrl(robot)
    const controlMessage = {
        type: 'control',
        action: 'reload_tablet',
        url,
        path: `/tablet?robot=${encodeURIComponent(robot)}`,
        timestamp: Date.now(),
        source: 'web_controller'
    }
    const sent = robotAPI.sendMessage(controlMessage, robot)
    if (sent) {
        tabletLastReloadSent.set(robot, Date.now())
        console.log(`[Tablet] 📲 Sent tablet reload to ${robot}: ${url}`)
    } else {
        console.warn(`[Tablet] ⚠️ Could not send tablet reload to ${robot} (not connected?)`)
    }
    return { success: sent, url }
}

// Send a ping request to tablet pages via WebSocket broadcast.
// Pages that listen to /api/sync should respond by POSTing heartbeat.
function sendTabletPingWS (robot) {
    const msg = JSON.stringify({ cmd: 'tablet_ping', robot, timestamp: Date.now() })
    sendWebSockets.forEach(ws => {
        try { ws.send(msg) } catch (e) { }
    })
    console.log(`[Tablet] 📡 Sent tablet WS ping for ${robot}`)
}

// Heartbeat endpoint (called by tablet web page)
router.post('/api/robot-tablet/heartbeat', (req, res) => {
    const robot = req.body?.robot || req.query.robot
    if (!robot) {
        return res.status(400).json({ error: 'robot is required' })
    }
    const now = Date.now()
    tabletHeartbeats.set(robot, now)
    // If we were waiting for a heartbeat after a ping, receiving one clears the pending ping state
    // but we keep lastPingSent timestamp so monitor logic can compare
    try {
        robotAPI.updateDetailedRobotStatus?.(robot, {
            tablet_last_seen: now,
            tablet_connected: true
        })
    } catch (e) { }
    res.status(200).json({ ok: true, robot, now })
})

// Manual reload endpoint
router.post('/api/robot-tablet/reload/:robot?', (req, res) => {
    const paramRobot = req.params.robot
    const bodyRobot = req.body?.robot
    const target = paramRobot || bodyRobot
    if (!target) {
        return res.status(400).json({ error: 'robot is required (path or body)' })
    }
    const result = sendReloadTablet(target)
    return res.status(result.success ? 200 : 503).json({ robot: target, ...result })
})

// Status endpoint for tablet connections
router.get('/api/robot-tablet/status', (req, res) => {
    const now = Date.now()
    const status = {}
    for (const [robot, ts] of tabletHeartbeats.entries()) {
        status[robot] = {
            lastSeen: ts,
            ageMs: now - ts,
            lastReloadSent: tabletLastReloadSent.get(robot) || null,
            lastPingSent: tabletLastPingSent.get(robot) || null
        }
    }
    res.status(200).json({
        configured: {
            TARGET_ROBOT: TABLET_TARGET_ROBOT,
            PING_INTERVAL_MS: TABLET_PING_INTERVAL_MS,
            PING_GRACE_MS: TABLET_PING_GRACE_MS,
            RELOAD_COOLDOWN_MS: TABLET_RELOAD_COOLDOWN_MS,
            AUTO_RELOAD: TABLET_AUTO_RELOAD
        },
        status
    })
})

// Auto-ping and reload monitor targeting the configured robot only
if (TABLET_AUTO_RELOAD) {
    setInterval(() => {
        try {
            const robot = TABLET_TARGET_ROBOT
            if (!robot) return
            // Only act if we've ever seen this robot's tablet page (i.e., sent at least one heartbeat)
            const lastSeen = tabletHeartbeats.get(robot)
            if (!lastSeen) return

            const now = Date.now()
            const lastPing = tabletLastPingSent.get(robot) || 0
            const lastReload = tabletLastReloadSent.get(robot) || 0

            // Send ping on schedule
            if (now - lastPing >= TABLET_PING_INTERVAL_MS) {
                sendTabletPingWS(robot)
                tabletLastPingSent.set(robot, now)
            }

            // If a ping was sent and no heartbeat has arrived since, and grace window elapsed, reload
            const effectiveLastPing = tabletLastPingSent.get(robot) || 0
            if (effectiveLastPing && lastSeen < effectiveLastPing) {
                if ((now - effectiveLastPing) >= TABLET_PING_GRACE_MS && (now - lastReload) >= TABLET_RELOAD_COOLDOWN_MS) {
                    console.warn(`[TabletMonitor] 🔄 No heartbeat after ping for ${robot} (${now - effectiveLastPing}ms since ping) — sending reload.`)
                    sendReloadTablet(robot)
                }
            } else if (effectiveLastPing && lastSeen >= effectiveLastPing) {
                // Healthy response after ping; nothing to do
            }
        } catch (e) {
            console.error('[TabletMonitor] Error:', e)
        }
    }, Math.max(1000, TABLET_PING_INTERVAL_MS))
}

// Robot State Management Endpoints (similar to STT state management)
router.post("/api/robot-state/start", (req, res) => {
    try {
        console.log('[API] Starting robot state management')
        robotAPI.startRobotStateManagement()

        // Also send $StopAction to all robots on start
        robotAPI.stopAllRobotActivities()

        res.status(200).json({
            success: true,
            message: 'Robot state management started and $StopAction sent to all robots'
        })
    } catch (error) {
        console.error('[API] Failed to start robot state management:', error)
        res.status(500).json({ error: error.message })
    }
})

router.post("/api/robot-state/stop", (req, res) => {
    try {
        console.log('[API] Stopping robot state management')

        // Send $StopAction to all robots and cleanup state management
        robotAPI.stopAllRobotActivities()
        robotAPI.cleanupRobotStateManagement()

        res.status(200).json({
            success: true,
            message: 'Robot state management stopped and $StopAction sent to all robots'
        })
    } catch (error) {
        console.error('[API] Failed to stop robot state management:', error)
        res.status(500).json({ error: error.message })
    }
})

router.get("/api/robot-state/status", (req, res) => {
    try {
        const status = {
            active: robotAPI.robotStateManager.active,
            connected_robots: Array.from(robotAPI.robotStateManager.connected),
            expected_states: Object.fromEntries(robotAPI.robotStateManager.expectedStates),
            intervals: {
                health_check: robotAPI.robotStateManager.healthCheckInterval !== null,
                state_sync: robotAPI.robotStateManager.stateSyncInterval !== null
            },
            config: {
                health_check_interval: process.env.ROBOT_HEALTH_CHECK_INTERVAL || 30000,
                state_sync_interval: process.env.ROBOT_STATE_SYNC_INTERVAL || 5000,
                health_check_timeout: process.env.ROBOT_HEALTH_CHECK_TIMEOUT || 5000
            }
        }
        res.status(200).json(status)
    } catch (error) {
        console.error('[API] Failed to get robot state status:', error)
        res.status(500).json({ error: error.message })
    }
})

router.post("/api/robot-state/sync/:robot", (req, res) => {
    try {
        const { robot } = req.params
        console.log(`[API] Manual state sync requested for robot: ${robot}`)

        robotAPI.syncRobotState(robot)

        res.status(200).json({
            success: true,
            message: `State sync requested for robot: ${robot}`
        })
    } catch (error) {
        console.error(`[API] Failed to sync state for robot ${req.params.robot}:`, error)
        res.status(500).json({ error: error.message })
    }
})

router.post("/api/robot-state/health-check/:robot", (req, res) => {
    try {
        const { robot } = req.params
        console.log(`[API] Manual health check requested for robot: ${robot}`)

        // Send health check to specific robot
        const message = {
            cmd: 'health_check',
            type: 'system',
            timestamp: Date.now(),
            source: 'web-controller'
        }

        const sent = robotAPI.sendMessage(message, robot)

        res.status(200).json({
            success: sent,
            message: sent ? `Health check sent to robot: ${robot}` : `Robot ${robot} not connected`
        })
    } catch (error) {
        console.error(`[API] Failed to send health check to robot ${req.params.robot}:`, error)
        res.status(500).json({ error: error.message })
    }
})

router.post("/api/robot-state/stop-action/:robot?", (req, res) => {
    try {
        const { robot } = req.params

        if (robot) {
            console.log(`[API] Sending $StopAction to robot: ${robot}`)
            robotAPI.sendStopActionToRobot(robot)
            res.status(200).json({
                success: true,
                message: `$StopAction sent to robot: ${robot}`
            })
        } else {
            console.log('[API] Sending $StopAction to all robots')
            robotAPI.stopAllRobotActivities()
            res.status(200).json({
                success: true,
                message: '$StopAction sent to all connected robots'
            })
        }
    } catch (error) {
        console.error('[API] Failed to send $StopAction:', error)
        res.status(500).json({ error: error.message })
    }
})

// Tablet controller route - serve the tablet interface
router.get("/tablet", (req, res) => {
    res.sendFile(join(__dirname, 'public', 'tablet.html'))
})

// Add polling endpoint for tablet fallback
router.get("/api/pull", (req, res) => {
    const robot = req.query.robot
    // For now, return empty array as WebSocket should be primary method
    // This endpoint exists as fallback for debugging
    res.status(200).json([])
})

// Test endpoint for LLM broadcast
router.post("/api/test-llm-broadcast", (req, res) => {
    const { type, content, robot } = req.body

    if (!type || !content) {
        return res.status(400).json({ error: 'type and content are required' })
    }

    const targetRobot = robot || 'Haku'

    console.log(`[Test] Broadcasting LLM message: ${type} - ${content}`)
    broadcastLLMCommunication(type, content, targetRobot)

    res.status(200).json({
        success: true,
        message: 'LLM broadcast sent',
        type: type,
        content: content,
        robot: targetRobot,
        connections: sendWebSockets.length
    })
})



// Tablet video control endpoints - use WebSocket commands for consistency
router.post("/api/tablet-video/play", async (req, res) => {
    const { robot, videoUrl } = req.body
    const targetRobot = robot || 'Haku'

    // Trigger the same logic as WebSocket command
    const message = {
        cmd: 'tablet-video-play',
        message: { videoUrl: videoUrl || 'http://198.18.0.1/apps/rmit-race/TB_video.mp4' },
        robot: targetRobot
    }

    // Simulate WebSocket message processing
    try {
        // Set global video playing state
        isVideoPlaying = true
        videoPlayingRobot = targetRobot
        console.log(`[Video Control] 🎬 Video playing started for robot ${targetRobot} - STT/LLM disabled`)

        // Stop any ongoing robot speech/activities
        robotAPI.sendStopActionToRobot(targetRobot)
        console.log(`[Video Control] 🛑 Sent $StopAction to robot ${targetRobot} to halt ongoing activities`)

        // Broadcast tablet video play event
        const playMessage = JSON.stringify({
            cmd: 'tablet-video-play',
            robot: targetRobot,
            videoUrl: message.message.videoUrl,
            timestamp: Date.now()
        })

        let sentCount = 0
        sendWebSockets.forEach(ws => {
            if (ws.readyState === 1) {
                ws.send(playMessage)
                sentCount++
            }
        })

        res.status(200).json({
            success: true,
            message: 'Tablet video play command sent',
            robot: targetRobot,
            videoUrl: message.message.videoUrl,
            connections: sendWebSockets.length,
            sentTo: sentCount
        })
    } catch (error) {
        console.error(`[Video Control] Failed to send commands to robot ${targetRobot}:`, error)
        res.status(500).json({ error: error.message })
    }
})

router.post("/api/tablet-video/stop", async (req, res) => {
    const { robot } = req.body
    const targetRobot = robot || 'Haku'

    try {
        // Clear global video playing state
        isVideoPlaying = false
        videoPlayingRobot = null
        console.log(`[Video Control] ⏹️ Video playing stopped for robot ${targetRobot} - STT/LLM enabled`)

        // Video stopped, STT/LLM will be re-enabled by state management

        // Broadcast tablet video stop event
        const stopMessage = JSON.stringify({
            cmd: 'tablet-video-stop',
            robot: targetRobot,
            timestamp: Date.now()
        })

        let sentCount = 0
        sendWebSockets.forEach(ws => {
            if (ws.readyState === 1) {
                ws.send(stopMessage)
                sentCount++
            }
        })

        res.status(200).json({
            success: true,
            message: 'Tablet video stop command sent',
            robot: targetRobot,
            connections: sendWebSockets.length,
            sentTo: sentCount
        })
    } catch (error) {
        console.error(`[Video Control] Failed to unmute robot ${targetRobot}:`, error)
        res.status(500).json({ error: error.message })
    }
})

// Video status endpoint
router.get("/api/tablet-video/status", (req, res) => {
    res.status(200).json({
        isVideoPlaying: isVideoPlaying,
        videoPlayingRobot: videoPlayingRobot,
        sttLlmDisabled: isVideoPlaying
    })
})





// Catch-all route for serving the frontend - MUST BE LAST
router.get("*", (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'))
})