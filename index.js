// Load environment variables
require('dotenv').config();

// EXPRESS SERVER
const express = require("express");
const {join} = require("path")
const {readdirSync, readFileSync, writeFileSync} = require('fs')

const app = express();

app.use(require("body-parser").json())
app.use(require("cors")())
require('express-ws')(app)

// Import the Robot API
const robotAPI = require('./utils/robot-api');

// variables
let sendSockets = []; // Keep for backward compatibility
let sendWebSockets = [];

let current_profile = {};
let all_scripts = {}, scripts = {}
let triggers = {};

let profiles = [];
let shortcuts = [];
let paged_shortcuts = [];
let announcements = [];
let all_possible_files = [];

// Network configuration from environment
const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0';
const SERVER_PORT = process.env.SERVER_PORT || 3000;
const SOCKET_PORT = process.env.SOCKET_PORT || 3456;

const STT_SERVER_HOST = process.env.STT_SERVER_HOST || 'localhost';
const STT_SERVER_PORT = process.env.STT_SERVER_PORT || 8765;
const STT_LLM_ENABLED = process.env.STT_LLM_ENABLED === 'true';

const LLM_GATEWAY_HOST = process.env.LLM_GATEWAY_HOST || 'localhost';

const WS_RECONNECT_ATTEMPTS = parseInt(process.env.WS_RECONNECT_ATTEMPTS) || 5;
const WS_RECONNECT_DELAY = parseInt(process.env.WS_RECONNECT_DELAY) || 2000;

// Function to parse script object
function parseScriptObject(obj) {
    const newObj = {};
    for (const key in obj) {
        const val = obj[key];
        // Ensure each script is an object with both "robot" and "text" defined
        if (typeof val === 'string') {
            newObj[key] = { robot: "", text: val };
        } else {
            newObj[key] = { 
                robot: (typeof val.robot === 'string' ? val.robot : ""), 
                text: (typeof val.text === 'string' ? val.text : "")
            };
        }
    }
    return newObj;
}

// Function to parse triggers object
function parseTriggers(obj) {
    const result = {};
    // Each top-level property is a robot, including "Default".
    for (const robot in obj) {
        result[robot] = { ...obj[robot] };
    }
    return result;
}

// Function to parse paged shortcuts object
function parsePagedShortcuts(obj) {
    const result = {};
    for (const robot in obj) {
        result[robot] = { ...obj[robot] };
    }
    return result;
}

// Function to read settings files
function readSettings() {
	const dir = readdirSync(join(__dirname, 'settings'));
	const script_files = dir.filter(e => /^.*Script\.json$/.test(e));
	script_files.forEach(e => {
		const profile_name = e.split('_').slice(0, -1).join(' ');
		const file_path = join(__dirname, 'settings', e);
		all_scripts[profile_name] = parseScriptObject(
            JSON.parse(readFileSync(file_path, { encoding: 'utf-8' }))
        );
		// console.log(`Loaded script file: ${file_path}`);
		// console.log('For profile:', profile_name);
	});
	scripts = all_scripts[Object.keys(all_scripts)[0]];

	const profiles_path = join(__dirname, 'settings', 'profiles.json');
	profiles = JSON.parse(readFileSync(profiles_path, { encoding: 'utf-8' }));
	// console.log(`Loaded profiles file: ${profiles_path}`);
	current_profile = profiles[0];
	// console.log('Current profile:', current_profile);

	const triggers_path = join(__dirname, 'settings', 'triggers.json');
	triggers = parseTriggers(JSON.parse(readFileSync(triggers_path, { encoding: 'utf-8' })));
	// console.log(`Loaded triggers file: ${triggers_path}`);

	const shortcuts_path = join(__dirname, 'settings', 'shortcuts.json');
	shortcuts = JSON.parse(readFileSync(shortcuts_path, { encoding: 'utf-8' }));
	// console.log(`Loaded shortcuts file: ${shortcuts_path}`);

	const paged_shortcuts_path = join(__dirname, 'settings', 'paged_shortcuts.json');
	paged_shortcuts = parsePagedShortcuts(JSON.parse(readFileSync(paged_shortcuts_path, { encoding: 'utf-8' })));
	// console.log(`Loaded paged shortcuts file: ${paged_shortcuts_path}`);

	const announcements_path = join(__dirname, 'settings', 'announcements.json');
	announcements = JSON.parse(readFileSync(announcements_path, { encoding: 'utf-8' }));
	// console.log(`Loaded announcements file: ${announcements_path}`);

	const all_possible_files_path = join(__dirname, 'settings', 'all_possible_files.json');
	all_possible_files = JSON.parse(readFileSync(all_possible_files_path, { encoding: 'utf-8' }));
	// console.log(`Loaded all possible files: ${all_possible_files_path}`);
}

// Initial read of settings files
readSettings();

const moveConfigPath = join(__dirname, 'settings', 'move_config.json');
let move_config = {};
// console.log(`Loading move config: ${moveConfigPath}`);
try {
    move_config = JSON.parse(readFileSync(moveConfigPath, { encoding: 'utf-8' }));
    // console.log(`Loaded move config: ${moveConfigPath}`);
} catch(err) {
    console.error("Error loading move_config.json:", err);
}

const scrollControllersConfigPath = join(__dirname, 'settings', 'scroll_controllers_config.json');
let scroll_controllers_config = {};
try {
    scroll_controllers_config = JSON.parse(readFileSync(scrollControllersConfigPath, { encoding: 'utf-8' }));
    // console.log(`Loaded scroll controllers config: ${scrollControllersConfigPath}`);
} catch(err) {
    console.error("Error loading scroll_controllers_config.json:", err);
}

const nova_sonic_config = JSON.parse(readFileSync(join(__dirname, 'settings', 'nova-sonic-config.json'), { encoding: 'utf-8' }))

const NovaClient = require('./utils/nova-client');
const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');

let bedrockClient = null;
let novaClient = null;

if (nova_sonic_config.enabled) {
	bedrockClient = new BedrockRuntimeClient({
		region: process.env.BEDROCK_MODEL_REGION || nova_sonic_config.region,
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
			sessionToken: process.env.AWS_SESSION_TOKEN
		}
	});
}

function writeToJSON(filename, json) {
	const file_path = join(__dirname, 'settings', filename+'.json');
	json = JSON.stringify(json, null, 4);
	writeFileSync(file_path, json, { encoding: 'utf-8' });
}

// handle with websockets with frontend
function syncWSWithOne(client,cmd,  value) {
	client.send(JSON.stringify({cmd, value}));
}

function syncWSWithAll(cmd, value) {
	msg = JSON.stringify({cmd, value})
	sendWebSockets.forEach(e=>e.send(msg));
}

function getFullSyncItem() {
	return {
		profiles, current_profile, 
		scripts, triggers, shortcuts, paged_shortcuts,
		announcements
	}
}

// websocket setup
app.ws('/api/sync', (ws, req)=>{
	
	sendWebSockets.push(ws);

	// execute different commands
	ws.on('message', msg=>{
		const { cmd, message, robot, type } = JSON.parse(msg);
		switch(cmd) {
			case 'req-sync':
				readSettings(); // Read settings files before syncing
				syncWSWithOne(ws, 'res-sync', getFullSyncItem())
				break;
			case 'req-update-profile':
				current_profile = message;
				// If profile name is not null
				if (current_profile && current_profile.name) {
					scripts = all_scripts[current_profile.name] || {};
					syncWSWithAll('res-update-scripts', scripts);
					syncWSWithAll('res-update-profile', current_profile)
					console.log("Update profile:", current_profile);
					console.log("Profile name:", current_profile.name);
				}
				break;
			case 'req-execute':
				// Use Robot API instead of direct socket calls
				robotAPI.sendMessage({ cmd, type, message, robot }, robot);
				break;
		}
	})

	ws.on("close", ()=>{
		sendWebSockets = sendWebSockets.filter(e=>e!==ws);
	})
	ws.on("error", ()=>{
		sendWebSockets = sendWebSockets.filter(e=>e!==ws);
	})

})

// Nova Sonic real-time conversation WebSocket
app.ws('/api/nova-sonic-stream', (ws, req) => {
	console.log('Nova Sonic conversation started');
	
	if (!nova_sonic_config.enabled || !bedrockClient) {
		ws.send(JSON.stringify({ error: 'Nova Sonic is disabled' }));
		ws.close();
		return;
	}
	
	// Create event handler for Nova client
	const eventHandler = (eventType, data) => {
		switch(eventType) {
			case 'contentStart':
				ws.send(JSON.stringify({ action: 'contentStart', ...data }));
				break;
			case 'textOutput':
				// Send text to frontend
				ws.send(JSON.stringify({ action: 'textOutput', ...data }));
				
				// Only send AI assistant responses to Haku robot for speech, not user input
				// Check the role field to determine if this is from the assistant or user
				// Also check if the message contains an "interrupted" flag
				if (data.content && data.content.trim() && data.role === 'ASSISTANT') {
					// Check if the content contains an interrupted flag
					let shouldSendToRobot = true;
					try {
						// Look for JSON-like content with interrupted flag
						if (data.content.includes('"interrupted"') && data.content.includes('true')) {
							console.log('🚫 Message contains interrupted flag, not sending to robot:', data.content);
							shouldSendToRobot = false;
						}
					} catch (error) {
						// If there's an error parsing, default to sending (safer option)
						console.warn('Error checking for interrupted flag:', error);
					}
					
					if (shouldSendToRobot) {
						console.log('🗣️ Sending Nova AI response to Haku for speech:', data.content);
						
						// Send to robot via socket connection (same as script execution)
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
							.replace(/[^\x00-\x7F]/g, "");
							
							s(speechCommand);
							console.log("Sent Nova AI response to Haku socket:", speechCommand);
						});
					}
				} else if (data.role === 'USER') {
					console.log('👤 User input detected, not sending to robot:', data.content);
				} else {
					console.log('🔍 Unknown role in textOutput:', data.role, 'Content:', data.content);
				}
				break;
			case 'audioOutput':
				if (data.audioData && data.audioData.content) {
					console.log('🔊 Audio output');
					ws.send(JSON.stringify({ action: 'audioOutput', audioData: data.audioData }));
				}
				break;
			case 'contentEnd':
				ws.send(JSON.stringify({ action: 'contentEnd', ...data }));
				break;
			case 'interviewEnd':
				ws.send(JSON.stringify({ action: 'interviewEnd' }));
				break;
		}
	};
	
	// Create Nova client instance
	novaClient = new NovaClient(bedrockClient, eventHandler);
	
	// Start the streaming session
	novaClient._startStreaming().then(() => {
		console.log('Nova streaming started successfully');
		ws.send(JSON.stringify({ status: 'Connected to Nova Sonic - Ready to chat!' }));
	}).catch(error => {
		console.error('Failed to start Nova streaming:', error);
		ws.send(JSON.stringify({ error: error.message }));
	});
	
	ws.on('message', async (message) => {
		try {
			if (!novaClient) {
				ws.send(JSON.stringify({ error: 'Nova client not initialized' }));
				return;
			}
			
			// Check if it's a JSON command
			if (typeof message === 'string' && message.startsWith('{')) {
				try {
					const command = JSON.parse(message);
					console.log('Received command:', command);
					
					switch(command.action) {
						case 'startSession':
							console.log('Starting Nova session...');
							ws.send(JSON.stringify({ status: 'Session started, ready for audio' }));
							return;
						case 'audioInput':
							if (command.base64Data) {
								console.log('🎤 Audio received');
								const processedBuffer = Buffer.from(command.base64Data, 'base64');
								novaClient.streamAudio(processedBuffer);
							}
							return;
						case 'setUserId':
							if (command.userId) {
								novaClient.setUserId(command.userId);
								console.log('Set userId:', command.userId);
							}
							return;
						case 'playback-finished':
							console.log('🔊 Audio playback finished');
							if (novaClient && novaClient.handlePlaybackFinished) {
								novaClient.handlePlaybackFinished();
							}
							return;
						case 'endSession':
							novaClient.sendEnd({ manual: true });
							return;
					}
				} catch (e) {
					// Not JSON, treat as audio data
				}
			}
			
			console.log('Received audio message, type:', typeof message, 'length:', message.length);
			
			// Handle base64 string from frontend
			if (typeof message === 'string') {
				// Message is already base64 encoded
				const processedBuffer = Buffer.from(message, 'base64');
				console.log('Processed audio buffer size:', processedBuffer.length, 'bytes');
				novaClient.streamAudio(processedBuffer);
			} else {
				// Handle binary data (fallback)
				const audioBase64 = Buffer.from(message).toString('base64');
				const processedBuffer = Buffer.from(audioBase64, 'base64');
				console.log('Processed binary audio buffer size:', processedBuffer.length, 'bytes');
				novaClient.streamAudio(processedBuffer);
			}
			
		} catch (error) {
			console.error('Nova Sonic stream error:', error);
			ws.send(JSON.stringify({ error: error.message }));
		}
	});
	
	ws.on('close', () => {
		console.log('Nova Sonic conversation ended');
		if (novaClient) {
			novaClient.events.complete();
		}
	});
	
	ws.on('error', (error) => {
		console.error('Nova Sonic WebSocket error:', error);
	});
});

// ROUTER SETUP
app.use(express.static(join(__dirname, 'dist')));

const router = express.Router();

// for file upload
router.get("/api/get-possible-files", (req, res)=>{
	res.status(200).send(all_possible_files)
})

router.get("/api/move-config", (req, res) => {
    res.status(200).json(move_config);
});

router.get("/api/scrollcontrollers-config", (req, res) => {
    res.status(200).json(scroll_controllers_config);
});

router.get("/api/triggers-config", (req, res) => {
    res.status(200).json(triggers);
});

router.get("/api/paged-shortcuts-config", (req, res)=>{
    res.status(200).json(paged_shortcuts);
});

router.post("/api/file-upload", (req, res)=>{
	try {
		const json = req.body;
		const { name } = req.query;
		let write_file_name = name;
		switch(name) {
			case 'triggers': 
				triggers = json; break;
			case 'shortcuts':
				shortcuts = json; break;
			case 'announcements':
				announcements = json; break;
			case 'paged_shortcuts':
				paged_shortcuts = json; break;
			default:
				all_scripts[name] = json;
				if(current_profile.name === name) { scripts = json; }
				write_file_name = name.replaceAll(" ", "_")+'_Script';
				break;
		}
		writeToJSON(write_file_name, json);
		readSettings(); // Read settings files after upload
		syncWSWithAll('res-sync', getFullSyncItem())
		res.status(200).send("done")
	} catch(error) {
		console.error(error)
		res.status(501).send("Internal Server Error")
	}
})

// Get Nova Sonic config
router.get("/api/nova-sonic-config", (req, res)=>{
	// Don't expose sensitive config, only status
	res.status(200).json({
		enabled: nova_sonic_config.enabled,
		model: nova_sonic_config.model,
		region: nova_sonic_config.region
	});
})

// Add network info endpoint
router.get("/api/network-info", (req, res) => {
    try {
        const interfaces = getLocalIPAddresses();
        res.status(200).json({
            interfaces: interfaces,
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        console.error('Network info error:', error);
        res.status(500).json({ error: 'Failed to get network info' });
    }
});

// Add configuration endpoint
router.get("/api/network-config", (req, res) => {
    res.status(200).json({
        server: {
            host: SERVER_HOST,
            port: SERVER_PORT
        },
        stt: {
            host: STT_SERVER_HOST,
            port: STT_SERVER_PORT,
            enabled: STT_LLM_ENABLED,
            defaultUrl: `ws://${STT_SERVER_HOST}:${STT_SERVER_PORT}`
        },
        llm: {
            host: LLM_GATEWAY_HOST,
            enabled: true,
            defaultUrl: LLM_GATEWAY_HOST // Use the full URL from environment
        },
        websocket: {
            reconnectAttempts: WS_RECONNECT_ATTEMPTS,
            reconnectDelay: WS_RECONNECT_DELAY
        }
    });
});

// normal setup
router.get("*", (req, res)=>{
    res.sendFile(join(__dirname, 'dist', 'index.html'));
})

app.use('/', router);

app.listen(SERVER_PORT, SERVER_HOST, () => {
    console.log(`Express server is listening on ${SERVER_HOST}:${SERVER_PORT}!`)
})

// SOCKET
const net = require('net');

const server = net.createServer((socket) => {
	console.log('Client connected');

	function sendSocket(message) {
		socket.write(message);
	}

	// Register with Robot API
	const socketId = robotAPI.registerConnection(sendSocket);
	
	// Keep in legacy array for compatibility
	sendSockets.push(sendSocket);

	socket.on('data', (data) => {
		// Handle with Robot API
		robotAPI.handleIncomingData(socketId, data);
	});

	socket.on('end', () => {
		robotAPI.unregisterConnection(socketId);
		sendSockets = sendSockets.filter(e => e !== sendSocket);
		console.log('Client disconnected');
	});

	socket.on('error', (err) => {
		robotAPI.unregisterConnection(socketId);
		sendSockets = sendSockets.filter(e => e !== sendSocket);
		console.error('Socket error:', err);
	});
});


server.listen(SOCKET_PORT, SERVER_HOST, () => {
  	console.log(`Socket server is listening on ${SERVER_HOST}:${SOCKET_PORT}`);
});

// Add WebSocket client for STT server connection
const WebSocket = require('ws');

// STT and LLM connection management
let sttConnections = new Map(); // sessionId -> sttClient
let llmConnections = new Map(); // sessionId -> llmClient

// Add network interface detection
const os = require('os');
function getLocalIPAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-IPv4 and internal addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({ name, address: iface.address });
            }
        }
    }
    return addresses;
}

// STT WebSocket client class
class STTClient {
    constructor(sessionId, frontendWs) {
        this.sessionId = sessionId;
        this.frontendWs = frontendWs;
        this.sttWs = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = WS_RECONNECT_ATTEMPTS;
        this.reconnectDelay = WS_RECONNECT_DELAY;
    }

    async connect(sttServerUrl = `ws://${STT_SERVER_HOST}:${STT_SERVER_PORT}`) {
        try {
            console.log(`[STT-${this.sessionId}] Connecting to STT server: ${sttServerUrl}`);
            this.sendToFrontend({ type: 'stt_status', status: 'connecting' });
            
            this.sttWs = new WebSocket(sttServerUrl);
            
            this.sttWs.on('open', () => {
                console.log(`[STT-${this.sessionId}] Connected to STT server`);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.sendToFrontend({ type: 'stt_status', status: 'connected' });
            });

            this.sttWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    console.log(`[STT-${this.sessionId}] Received from STT:`, message.type);
                    
                    // Forward STT messages to frontend
                    this.sendToFrontend({
                        type: 'stt_message',
                        data: message
                    });
                } catch (error) {
                    console.error(`[STT-${this.sessionId}] Error parsing STT message:`, error);
                }
            });

            this.sttWs.on('close', (code, reason) => {
                console.log(`[STT-${this.sessionId}] STT connection closed:`, code, reason?.toString());
                this.isConnected = false;
                this.sendToFrontend({ type: 'stt_status', status: 'disconnected' });
                
                // Auto-reconnect logic
                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    console.log(`[STT-${this.sessionId}] Scheduling reconnect attempt ${this.reconnectAttempts} in ${this.reconnectDelay * this.reconnectAttempts}ms`);
                    setTimeout(() => {
                        console.log(`[STT-${this.sessionId}] Reconnecting attempt ${this.reconnectAttempts}...`);
                        this.connect(sttServerUrl);
                    }, this.reconnectDelay * this.reconnectAttempts);
                } else {
                    console.log(`[STT-${this.sessionId}] Max reconnect attempts reached`);
                    this.sendToFrontend({ type: 'stt_status', status: 'error', error: 'Max reconnect attempts reached' });
                }
            });

            this.sttWs.on('error', (error) => {
                console.error(`[STT-${this.sessionId}] STT connection error:`, error);
                this.isConnected = false;
                this.sendToFrontend({ type: 'stt_status', status: 'error', error: error.message });
            });

        } catch (error) {
            console.error(`[STT-${this.sessionId}] Failed to connect to STT:`, error);
            this.sendToFrontend({ type: 'stt_status', status: 'error', error: error.message });
        }
    }

    sendToSTT(message) {
        if (this.sttWs && this.sttWs.readyState === WebSocket.OPEN) {
            this.sttWs.send(JSON.stringify(message));
            console.log(`[STT-${this.sessionId}] Sent to STT:`, message.action);
        } else {
            console.warn(`[STT-${this.sessionId}] Cannot send to STT - not connected`);
            this.sendToFrontend({ type: 'stt_status', status: 'error', error: 'STT not connected' });
        }
    }

    sendToFrontend(message) {
        if (this.frontendWs && this.frontendWs.readyState === 1) {
            this.frontendWs.send(JSON.stringify(message));
        }
    }

    disconnect() {
        console.log(`[STT-${this.sessionId}] Disconnecting STT client`);
        this.reconnectAttempts = this.maxReconnectAttempts; // Stop auto-reconnect
        if (this.sttWs) {
            this.sttWs.close();
            this.sttWs = null;
        }
        this.isConnected = false;
    }
}

// LLM WebSocket client class
class LLMClient {
    constructor(sessionId, frontendWs) {
        this.sessionId = sessionId;
        this.frontendWs = frontendWs;
        this.llmWs = null;
        this.isConnected = false;
        this.conversationHistory = [];
        this.pendingRequests = new Map();
        this.delayStats = {
            totalRequests: 0,
            totalDelay: 0,
            minDelay: Infinity,
            maxDelay: 0,
            averageDelay: 0,
            recentDelays: []
        };
        this.serverTimestamps = new Map();
        this.firstResponseReceived = new Map();
        
        // Add chunk buffering for robot speech
        this.speechBuffer = '';
        this.pendingRobotChunks = [];
    }

    async connect(llmGatewayUrl) {
        try {
            const finalUrl = llmGatewayUrl || LLM_GATEWAY_HOST;
            console.log(`[LLM-${this.sessionId}] Connecting to LLM gateway: ${finalUrl}`);
            this.sendToFrontend({ type: 'llm_status', status: 'connecting' });
            
            this.llmWs = new WebSocket(finalUrl);
            
            this.llmWs.on('open', () => {
                console.log(`[LLM-${this.sessionId}] Connected to LLM gateway`);
                this.isConnected = true;
                this.sendToFrontend({ type: 'llm_status', status: 'connected' });
            });

            this.llmWs.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const serverReceiveTime = Date.now();
                    console.log(`[LLM-${this.sessionId}] Received from LLM at server time ${serverReceiveTime}:`, message.type || 'response');
                    
                    // Calculate server-side delay for first response
                    if (message.content || message.response) {
                        let matchedRequestId = null;
                        let serverSendTime = null;
                        
                        // Try to match by requestId if provided in response
                        if (message.requestId && this.serverTimestamps.has(message.requestId)) {
                            matchedRequestId = message.requestId;
                            serverSendTime = this.serverTimestamps.get(matchedRequestId);
                        } else {
                            // Fall back to finding the oldest pending request
                            for (const [requestId, timestamp] of this.serverTimestamps.entries()) {
                                if (!this.firstResponseReceived.get(requestId)) {
                                    matchedRequestId = requestId;
                                    serverSendTime = timestamp;
                                    break;
                                }
                            }
                        }
                        
                        // Calculate delay if we found a matching request
                        if (matchedRequestId && serverSendTime && !this.firstResponseReceived.get(matchedRequestId)) {
                            const serverDelay = serverReceiveTime - serverSendTime;
                            this.firstResponseReceived.set(matchedRequestId, true);
                            this.updateDelayStats(serverDelay);
                            
                            console.log(`[LLM-${this.sessionId}] ⏱️  Server-side STT→LLM delay: ${serverDelay}ms`);
                            
                            // Send server-side timing info to frontend
                            this.sendToFrontend({
                                type: 'server_delay_measurement',
                                delay: serverDelay,
                                serverSendTime: serverSendTime,
                                serverReceiveTime: serverReceiveTime,
                                requestId: matchedRequestId,
                                stats: { ...this.delayStats }
                            });
                            
                            // Clean up old timestamps
                            this.serverTimestamps.delete(matchedRequestId);
                            this.firstResponseReceived.delete(matchedRequestId);
                            this.pendingRequests.delete(matchedRequestId);
                        }
                        
                        // Process content for robot speech with detailed logging
                        const content = message.content || message.response;
                        if (content && content.trim()) {
                            console.log(`[LLM-${this.sessionId}] 📝 Processing LLM content chunk (${content.length} chars): "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
                            console.log(`[LLM-${this.sessionId}] 🤖 isFinished flag: ${message.isFinished || false}`);
                            console.log(`[LLM-${this.sessionId}] 📊 Current speech buffer size: ${this.speechBuffer.length} chars`);
                            
                            this.processSpeechForRobot(content, message.isFinished || false);
                        }
                        
                        // Handle end of response
                        if (message.isFinished) {
                            console.log(`[LLM-${this.sessionId}] ✅ LLM response finished - processing final chunks`);
                            this.processSpeechForRobot('', true); // Send any remaining buffered content
                        }
                    }
                    
                    // Add assistant response to history
                    if (message.content || message.response) {
                        this.conversationHistory.push({ 
                            role: 'assistant', 
                            content: message.content || message.response 
                        });
                    }
                    
                    // Forward LLM messages to frontend
                    this.sendToFrontend({
                        type: 'llm_message',
                        data: message
                    });
                } catch (error) {
                    console.error(`[LLM-${this.sessionId}] Error parsing LLM message:`, error);
                }
            });

            this.llmWs.on('close', (code, reason) => {
                console.log(`[LLM-${this.sessionId}] LLM connection closed:`, code, reason?.toString());
                this.isConnected = false;
                this.sendToFrontend({ type: 'llm_status', status: 'disconnected' });
            });

            this.llmWs.on('error', (error) => {
                console.error(`[LLM-${this.sessionId}] LLM connection error:`, error);
                this.isConnected = false;
                this.sendToFrontend({ type: 'llm_status', status: 'error', error: error.message });
            });

        } catch (error) {
            console.error(`[LLM-${this.sessionId}] Failed to connect to LLM:`, error);
            this.sendToFrontend({ type: 'llm_status', status: 'error', error: error.message });
        }
    }

    sendMessage(userMessage, sourceInfo = {}) {
        if (this.llmWs && this.isConnected && this.llmWs.readyState === WebSocket.OPEN) {
            const serverSendTime = Date.now();
            const requestId = `${this.sessionId}-${serverSendTime}`;
            
            // Clear speech buffer for new conversation turn
            this.speechBuffer = '';
            this.pendingRobotChunks = [];
            
            // Store server-side timestamps
            this.pendingRequests.set(requestId, serverSendTime);
            this.serverTimestamps.set(requestId, serverSendTime);
            this.firstResponseReceived.set(requestId, false);
            
            // Add to conversation history
            this.conversationHistory.push({ role: 'user', content: userMessage });
            
            const llmPayload = {
                action: 'completion',
                history: this.conversationHistory.slice(-10),
                requestId: requestId,
                serverSendTime: serverSendTime
            };
            
            console.log(`[LLM-${this.sessionId}] 📤 Sending to LLM at server time ${serverSendTime}: "${userMessage}" (source: ${sourceInfo.source || 'manual'})`);
            
            this.llmWs.send(JSON.stringify(llmPayload));
        } else {
            console.warn(`[LLM-${this.sessionId}] Cannot send to LLM - not connected (state: ${this.llmWs?.readyState})`);
            this.sendToFrontend({ 
                type: 'llm_message', 
                data: { type: 'error', error: 'LLM not connected' }
            });
        }
    }

    // Process and potentially send buffered speech to robot
    processSpeechForRobot(newContent, isFinished = false) {
        console.log(`[LLM-${this.sessionId}] 🔄 processSpeechForRobot called - newContent: ${newContent ? newContent.length : 0} chars, isFinished: ${isFinished}`);
        
        if (!newContent && !isFinished) {
            console.log(`[LLM-${this.sessionId}] ⚠️ No new content and not finished - skipping processing`);
            return;
        }
        
        // Add new content to buffer
        if (newContent) {
            this.speechBuffer += newContent;
            console.log(`[LLM-${this.sessionId}] 📝 Added ${newContent.length} chars to speech buffer. Total buffer size: ${this.speechBuffer.length} chars`);
            console.log(`[LLM-${this.sessionId}] 📄 Current buffer content: "${this.speechBuffer.substring(0, 200)}${this.speechBuffer.length > 200 ? '...' : ''}"`);
        }
        
        if (isFinished) {
            // If this is the final chunk, send everything remaining
            if (this.speechBuffer.trim()) {
                console.log(`[LLM-${this.sessionId}] 🏁 Final chunk - sending remaining buffer (${this.speechBuffer.length} chars)`);
                console.log(`[LLM-${this.sessionId}] 🗣️ Final speech content: "${this.speechBuffer}"`);
                this.sendSpeechToRobot(this.speechBuffer.trim());
                this.speechBuffer = '';
            } else {
                console.log(`[LLM-${this.sessionId}] 🏁 Final chunk - but buffer is empty`);
            }
            return;
        }
        
        console.log(`[LLM-${this.sessionId}] 🔍 Analyzing buffer for safe extraction points...`);
        
        // Try to extract complete chunks that can be safely sent
        let remainingBuffer = this.speechBuffer;
        let extractedChunks = [];
        
        // Look for complete sentences or safe breakpoints
        const sentences = remainingBuffer.split(/([.!?]\s+)/);
        let currentChunk = '';
        
        console.log(`[LLM-${this.sessionId}] 📊 Split into ${sentences.length} sentence fragments`);
        
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const testChunk = currentChunk + sentence;
            
            console.log(`[LLM-${this.sessionId}] 🧪 Testing chunk ${i}: "${testChunk}" (${testChunk.length} chars)`);
            
            // Check if this chunk is safe to send
            if (this.canSendChunkToRobot(testChunk)) {
                currentChunk = testChunk;
                console.log(`[LLM-${this.sessionId}] ✅ Chunk ${i} is safe to include`);
                
                // If we hit a sentence boundary and have meaningful content, extract it
                if (sentence.match(/[.!?]\s+/) && currentChunk.trim().length > 10) {
                    console.log(`[LLM-${this.sessionId}] 🎯 Found complete sentence boundary - extracting chunk: "${currentChunk.trim()}"`);
                    extractedChunks.push(currentChunk.trim());
                    currentChunk = '';
                }
            } else {
                console.log(`[LLM-${this.sessionId}] ⚠️ Chunk ${i} would break patterns - waiting for more content`);
                // This chunk would break patterns, so we need to wait for more content
                break;
            }
        }
        
        console.log(`[LLM-${this.sessionId}] 📤 Extracted ${extractedChunks.length} safe chunks for robot speech`);
        
        // Send any complete chunks we found
        for (const chunk of extractedChunks) {
            if (chunk.trim()) {
                console.log(`[LLM-${this.sessionId}] 🗣️ Sending speech chunk to robot (${chunk.length} chars): "${chunk}"`);
                this.sendSpeechToRobot(chunk);
                
                // Remove sent content from buffer
                const chunkIndex = this.speechBuffer.indexOf(chunk);
                if (chunkIndex !== -1) {
                    const beforeRemoval = this.speechBuffer.length;
                    this.speechBuffer = this.speechBuffer.substring(chunkIndex + chunk.length).trim();
                    console.log(`[LLM-${this.sessionId}] 🧹 Removed sent chunk from buffer. Buffer size: ${beforeRemoval} → ${this.speechBuffer.length} chars`);
                } else {
                    console.log(`[LLM-${this.sessionId}] ⚠️ Could not find sent chunk in buffer for removal`);
                }
            }
        }
        
        console.log(`[LLM-${this.sessionId}] 📊 Processing complete. Remaining buffer: ${this.speechBuffer.length} chars`);
        if (this.speechBuffer.length > 0) {
            console.log(`[LLM-${this.sessionId}] 📄 Remaining buffer content: "${this.speechBuffer.substring(0, 100)}${this.speechBuffer.length > 100 ? '...' : ''}"`);
        }
    }

    // Check if a chunk can be safely send to robot (doesn't split important patterns)
    canSendChunkToRobot(chunk) {
        // Count occurrences of special characters
        const openBraces = (chunk.match(/{/g) || []).length;
        const closeBraces = (chunk.match(/}/g) || []).length;
        const carets = (chunk.match(/\^/g) || []).length;
        const closeParens = (chunk.match(/\)/g) || []).length;
        
        // Check if braces are balanced
        const bracesBalanced = openBraces === closeBraces;
        
        // Check if caret patterns are complete
        // This is a simplified check - assumes each ^ should have a corresponding )
        const caretPatternsComplete = carets === closeParens;
        
        console.log(`[LLM-${this.sessionId}] 🔍 Pattern analysis for chunk: braces {${openBraces}/${closeBraces}} balanced=${bracesBalanced}, carets ^${carets}/)${closeParens} complete=${caretPatternsComplete}`);
        
        const isSafe = bracesBalanced && caretPatternsComplete;
        console.log(`[LLM-${this.sessionId}] ${isSafe ? '✅' : '❌'} Chunk safety check: ${isSafe ? 'SAFE' : 'UNSAFE'}`);
        
        return isSafe;
    }

    // Send speech chunk to robot via socket connection
    sendSpeechToRobot(text) {
        if (!text || !text.trim()) {
            console.log(`[LLM-${this.sessionId}] ⚠️ Attempted to send empty text to robot - skipping`);
            return;
        }
        
        console.log(`[LLM-${this.sessionId}] 🤖 Preparing to send speech to robot: "${text}"`);
        console.log(`[LLM-${this.sessionId}] 📊 Speech details - length: ${text.length} chars, trimmed length: ${text.trim().length} chars`);
        
        try {
            // Send to robot via socket connection (same as script execution)
            sendSockets.forEach((s, index) => {
                const speechCommand = JSON.stringify({ 
                    cmd: 'req-execute',
                    type: 'SayChunk', 
                    message: text.trim(), 
                    robot: 'Haku' // Default to Haku, could be configurable
                })
                .normalize('NFKC')
                .replace(/[""]/g, '"')
                .replace(/['']/g, "'")
                .replace(/…/g, '...')
                .replace(/[^\x00-\x7F]/g, "");
                
                console.log(`[LLM-${this.sessionId}] 📡 Sending to socket ${index}: ${speechCommand}`);
                s(speechCommand);
            });
            
            console.log(`[LLM-${this.sessionId}] ✅ Speech sent to ${sendSockets.length} socket(s) successfully`);
            
        } catch (error) {
            console.error(`[LLM-${this.sessionId}] ❌ Error sending speech to robot:`, error);
        }
    }

    updateDelayStats(delay) {
        this.delayStats.totalRequests++;
        this.delayStats.totalDelay += delay;
        this.delayStats.minDelay = Math.min(this.delayStats.minDelay, delay);
        this.delayStats.maxDelay = Math.max(this.delayStats.maxDelay, delay);
        this.delayStats.averageDelay = this.delayStats.totalDelay / this.delayStats.totalRequests;
        
        this.delayStats.recentDelays.push(delay);
        if (this.delayStats.recentDelays.length > 10) {
            this.delayStats.recentDelays.shift();
        }
    }

    getDelayStats() {
        return { ...this.delayStats };
    }

    disconnect() {
        console.log(`[LLM-${this.sessionId}] Disconnecting LLM client`);
        if (this.llmWs) {
            this.llmWs.close();
            this.llmWs = null;
        }
        this.isConnected = false;
        this.pendingRequests.clear();
        this.serverTimestamps.clear();
        this.firstResponseReceived.clear();
        
        // Clear speech buffers
        this.speechBuffer = '';
        this.pendingRobotChunks = [];
    }
}

// STT + LLM Integration WebSocket
app.ws('/api/stt-llm-conversation', (ws, req) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`[Session-${sessionId}] 🚀 New STT+LLM conversation started`);
    
    // Create STT and LLM clients
    const sttClient = new STTClient(sessionId, ws);
    const llmClient = new LLMClient(sessionId, ws);
    
    // Store connections
    sttConnections.set(sessionId, sttClient);
    llmConnections.set(sessionId, llmClient);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[Session-${sessionId}] 📨 Received command:`, data.action, data);
            
            switch(data.action) {
                case 'connect_stt':
                    const sttUrl = data.sttServerUrl || `ws://${STT_SERVER_HOST}:${STT_SERVER_PORT}`;
                    console.log(`[Session-${sessionId}] Connecting to STT: ${sttUrl}`);
                    await sttClient.connect(sttUrl);
                    break;
                    
                case 'connect_llm':
                    const llmUrl = data.llmGatewayUrl || LLM_GATEWAY_HOST;
                    console.log(`[Session-${sessionId}] Connecting to LLM: ${llmUrl}`);
                    await llmClient.connect(llmUrl);
                    break;
                    
                case 'start_transcription':
                    console.log(`[Session-${sessionId}] Starting transcription`);
                    sttClient.sendToSTT({ action: 'start' });
                    break;
                    
                case 'stop_transcription':
                    console.log(`[Session-${sessionId}] Stopping transcription`);
                    sttClient.sendToSTT({ action: 'stop' });
                    break;
                    
                case 'configure_stt':
                    console.log(`[Session-${sessionId}] Configuring STT:`, data.config);
                    sttClient.sendToSTT({ action: 'configure', config: data.config });
                    break;
                    
                case 'send_to_llm':
                    if (data.message) {
                        console.log(`[Session-${sessionId}] Sending manual message to LLM:`, data.message);
                        llmClient.sendMessage(data.message, { source: 'manual' });
                    }
                    break;

                case 'get_delay_stats':
                    // Send current delay statistics
                    ws.send(JSON.stringify({
                        type: 'delay_stats',
                        stats: llmClient.getDelayStats()
                    }));
                    break;
                    
                case 'audio_data':
                    // Forward audio data to STT server
                    sttClient.sendToSTT({ action: 'audio_data', data: data.data });
                    break;
                    
                default:
                    console.warn(`[Session-${sessionId}] Unknown action:`, data.action);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        error: 'Unknown action: ' + data.action
                    }));
            }
            
        } catch (error) {
            console.error(`[Session-${sessionId}] Message processing error:`, error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                error: 'Failed to process message: ' + error.message 
            }));
        }
    });
    
    // Handle conversation flow - when STT produces complete text, send to LLM
    const originalSTTSendToFrontend = sttClient.sendToFrontend.bind(sttClient);
    sttClient.sendToFrontend = (message) => {
        // Call original method
        originalSTTSendToFrontend(message);
        
        // Check if this is a complete transcription
        if (message.type === 'stt_message' && 
            message.data.type === 'complete' && 
            message.data.text && 
            message.data.text.trim()) {
            
            const sttCompleteTime = Date.now();
            console.log(`[Session-${sessionId}] 🎤 Complete transcription received at server time ${sttCompleteTime}, sending to LLM:`, message.data.text);
            
            // Automatically send complete transcription to LLM with server timing info
            llmClient.sendMessage(message.data.text.trim(), { 
                source: 'stt',
                sttCompleteTime: sttCompleteTime,
                serverTimestamp: sttCompleteTime
            });
        }
    };
    
    ws.on('close', () => {
        console.log(`[Session-${sessionId}] Conversation ended`);
        
        // Clean up connections
        sttClient.disconnect();
        llmClient.disconnect();
        sttConnections.delete(sessionId);
        llmConnections.delete(sessionId);
    });
    
    ws.on('error', (error) => {
        console.error(`[Session-${sessionId}] WebSocket error:`, error);
        
        // Clean up on error
        sttClient.disconnect();
        llmClient.disconnect();
        sttConnections.delete(sessionId);
        llmConnections.delete(sessionId);
    });
    
    // Send initial status
    ws.send(JSON.stringify({ 
        type: 'session_created', 
        sessionId: sessionId,
        status: 'Ready to connect STT and LLM services'
    }));
});

// STT-only WebSocket (for testing STT independently)
app.ws('/api/stt-only', (ws, req) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`[STT-Only-${sessionId}] New STT-only session started`);
    
    const sttClient = new STTClient(sessionId, ws);
    sttConnections.set(sessionId, sttClient);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[STT-Only-${sessionId}] Received command:`, data.action);
            
            switch(data.action) {
                case 'connect':
                    const sttUrl = data.sttServerUrl || 'ws://localhost:8765';
                    await sttClient.connect(sttUrl);
                    break;
                case 'start':
                    sttClient.sendToSTT({ action: 'start' });
                    break;
                case 'stop':
                    sttClient.sendToSTT({ action: 'stop' });
                    break;
                case 'configure':
                    sttClient.sendToSTT({ action: 'configure', config: data.config });
                    break;
                case 'audio_data':
                    sttClient.sendToSTT({ action: 'audio_data', data: data.data });
                    break;
            }
        } catch (error) {
            console.error(`[STT-Only-${sessionId}] Error:`, error);
            ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
    });
    
    ws.on('close', () => {
        console.log(`[STT-Only-${sessionId}] Session ended`);
        sttClient.disconnect();
        sttConnections.delete(sessionId);
    });
    
    ws.send(JSON.stringify({ 
        type: 'session_created', 
        sessionId: sessionId,
        status: 'STT-only session ready'
    }));
});

// LLM-only WebSocket (for testing LLM independently)
app.ws('/api/llm-only', (ws, req) => {
    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log(`[LLM-Only-${sessionId}] New LLM-only session started`);
    
    const llmClient = new LLMClient(sessionId, ws);
    llmConnections.set(sessionId, llmClient);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`[LLM-Only-${sessionId}] Received command:`, data.action);
            
            switch(data.action) {
                case 'connect':
                    const llmUrl = data.llmGatewayUrl || 'ws://localhost:8080/chat';
                    await llmClient.connect(llmUrl);
                    break;
                case 'send_message':
                    if (data.message) {
                        llmClient.sendMessage(data.message);
                    }
                    break;
            }
        } catch (error) {
            console.error(`[LLM-Only-${sessionId}] Error:`, error);
            ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
    });
    
    ws.on('close', () => {
        console.log(`[LLM-Only-${sessionId}] Session ended`);
        llmClient.disconnect();
        llmConnections.delete(sessionId);
    });
    
    ws.send(JSON.stringify({ 
        type: 'session_created', 
        sessionId: sessionId,
        status: 'LLM-only session ready'
    }));
});

// Add REST API endpoints for STT and LLM
router.get("/api/stt-status", (req, res) => {
    const activeConnections = Array.from(sttConnections.entries()).map(([sessionId, client]) => ({
        sessionId,
        isConnected: client.isConnected,
        reconnectAttempts: client.reconnectAttempts
    }));
    
    res.status(200).json({
        totalSessions: sttConnections.size,
        activeConnections
    });
});

router.get("/api/llm-status", (req, res) => {
    const activeConnections = Array.from(llmConnections.entries()).map(([sessionId, client]) => ({
        sessionId,
        isConnected: client.isConnected,
        historyLength: client.conversationHistory.length,
        delayStats: client.getDelayStats()
    }));
    
    res.status(200).json({
        totalSessions: llmConnections.size,
        activeConnections
    });
});

// Add Robot API status endpoint
router.get("/api/robot-status", (req, res) => {
    res.status(200).json(robotAPI.getStatus());
});

// Add Robot API message history endpoint
router.get("/api/robot-history/:robot?", (req, res) => {
    const robot = req.params.robot || req.query.robot;
    const limit = parseInt(req.query.limit) || 100;
    
    if (robot) {
        const history = robotAPI.getMessageHistory(robot, limit);
        res.status(200).json({ robot, history });
    } else {
        // Get all robot histories
        const allHistories = {};
        const status = robotAPI.getStatus();
        
        for (const robotName of new Set(status.connections.map(c => c.robot).filter(Boolean))) {
            allHistories[robotName] = robotAPI.getMessageHistory(robotName, limit);
        }
        
        res.status(200).json(allHistories);
    }
});

// Add Robot API message sending endpoint
router.post("/api/robot-send", (req, res) => {
    const { message, robot, type = 'api' } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }
    
    const messageData = {
        cmd: 'api-execute',
        type: type,
        message: message,
        robot: robot || '',
        timestamp: Date.now(),
        source: 'api'
    };
    
    const sent = robotAPI.sendMessage(messageData, robot);
    
    res.status(200).json({
        success: sent,
        message: sent ? 'Message sent successfully' : 'Message queued (no active connections)',
        messageData
    });
});