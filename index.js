// Load environment variables
require('dotenv').config();

// EXPRESS SERVER
const express = require("express");
const {join} = require("path")
const {readdirSync, readFileSync, writeFileSync} = require('fs')
const dgram = require('dgram');

const app = express();

app.use(require("body-parser").json())
app.use(require("cors")())
require('express-ws')(app)

// variables
let sendSockets = [];
let sendWebSockets = [];

let current_profile = {};
let all_scripts = {}, scripts = {}
let triggers = {};

// read json files from settings
const dir = readdirSync(join(__dirname, 'settings'))
const script_files = dir.filter(e=>/^.*Script\.json$/.test(e));
script_files.forEach(e=>{
	const profile_name = e.split('_').slice(0, -1).join(' ');
	all_scripts[profile_name] = JSON.parse(readFileSync(join(__dirname, 'settings', e), { encoding: 'utf-8' }))
})
scripts = all_scripts[Object.keys(all_scripts)[0]]

const profiles = JSON.parse(readFileSync(join(__dirname, 'settings', 'profiles.json'), { encoding: 'utf-8' }))
current_profile = profiles[0];

triggers = JSON.parse(readFileSync(join(__dirname, 'settings', 'triggers.json'), { encoding: 'utf-8' }))

let shortcuts = JSON.parse(readFileSync(join(__dirname, 'settings', 'shortcuts.json'), { encoding: 'utf-8' }))

let announcements = JSON.parse(readFileSync(join(__dirname, 'settings', 'announcements.json'), { encoding: 'utf-8' }))

const all_possible_files = JSON.parse(readFileSync(join(__dirname, 'settings', 'all_possible_files.json'), { encoding: 'utf-8' }))

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
		scripts, triggers, shortcuts,
		announcements
	}
}

// Jitter Buffer for consistent audio playback
class JitterBuffer {
    constructor(targetDelay = 50) {
        this.buffer = new Map();
        this.targetDelay = targetDelay;
        this.nextSequence = 0;
        this.startTime = null;
        this.playbackInterval = null;
        this.onAudioReady = null;
        this.isActive = false;
    }
    
    start() {
        if (this.isActive) return;
        this.isActive = true;
        this.nextSequence = 0;
        this.buffer.clear();
        this.startTime = Date.now();
        this.schedulePlayback();
        console.log('Jitter buffer started');
    }
    
    addPacket(sequence, timestamp, volume, audio) {
        if (!this.isActive) return;
        
        this.buffer.set(sequence, { timestamp, volume, audio, received: Date.now() });
        
        if (!this.startTime && !this.playbackInterval) {
            this.startTime = Date.now();
            this.schedulePlayback();
        }
    }
    
    schedulePlayback() {
        if (this.playbackInterval) return;
        
        this.playbackInterval = setInterval(() => {
            if (!this.isActive) return;
            
            const packet = this.buffer.get(this.nextSequence);
            if (packet) {
                if (this.onAudioReady) {
                    this.onAudioReady({
                        audio: packet.audio,
                        volume: packet.volume,
                        sequence: this.nextSequence
                    });
                }
                this.buffer.delete(this.nextSequence);
                this.nextSequence++;
            } else {
                // Packet lost - skip for now
                this.nextSequence++;
            }
        }, 16); // 16ms intervals (matches 256 samples at 16kHz)
    }
    
    stop() {
        this.isActive = false;
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        this.buffer.clear();
        this.nextSequence = 0;
        this.startTime = null;
        console.log('Jitter buffer stopped');
    }
}

// UDP Audio Stream Server
const udpServer = dgram.createSocket('udp4');
const jitterBuffer = new JitterBuffer(50);
let audioStreamClients = [];

// MOVE WEBSOCKET HANDLERS BEFORE ROUTER SETUP
// WebSocket for audio stream testing
app.ws('/api/audio-stream-test', (ws, req) => {
    console.log('=== NEW AUDIO STREAM CLIENT CONNECTED ===');
    console.log('Client IP:', req.ip || req.connection.remoteAddress);
    console.log('WebSocket protocol:', ws.protocol);
    console.log('WebSocket extensions:', ws.extensions);
    console.log('Clients before adding:', audioStreamClients.length);
    
    audioStreamClients.push(ws);
    console.log('Clients after adding:', audioStreamClients.length);
    console.log('WebSocket readyState:', ws.readyState);
    console.log('WebSocket constants - CONNECTING:', ws.CONNECTING, 'OPEN:', ws.OPEN);
    
    // Send immediate welcome message to test the connection
    try {
        const welcomeMessage = JSON.stringify({ status: 'Connected to audio stream server' });
        console.log('Sending welcome message:', welcomeMessage);
        ws.send(welcomeMessage);
        console.log('Welcome message sent successfully');
    } catch (error) {
        console.error('Failed to send welcome message:', error);
    }
    
    ws.on('message', (msg) => {
        try {
            console.log('=== RECEIVED WEBSOCKET MESSAGE ===');
            console.log('Message type:', typeof msg);
            console.log('Message constructor:', msg.constructor.name);
            console.log('Message length:', msg.length);
            console.log('Raw message:', msg);
            console.log('Raw message toString():', msg.toString());
            console.log('Current clients count:', audioStreamClients.length);
            
            const messageString = msg.toString();
            console.log('Message as string:', messageString);
            
            const command = JSON.parse(messageString);
            console.log('Parsed command:', JSON.stringify(command, null, 2));
            console.log('Command action:', command.action);
            
            if (command.action === 'start') {
                console.log('=== STARTING AUDIO STREAM TEST ===');
                console.log('Clients available for streaming:', audioStreamClients.length);
                console.log('Jitter buffer active before start:', jitterBuffer.isActive);
                
                jitterBuffer.start();
                
                console.log('Jitter buffer active after start:', jitterBuffer.isActive);
                const confirmationMessage = JSON.stringify({ 
                    status: 'Audio stream test started - listening for UDP packets on port 9999' 
                });
                console.log('Sending confirmation message:', confirmationMessage);
                ws.send(confirmationMessage);
                console.log('Sent start confirmation');
                
            } else if (command.action === 'stop') {
                console.log('=== STOPPING AUDIO STREAM TEST ===');
                jitterBuffer.stop();
                const stopMessage = JSON.stringify({ status: 'Audio stream test stopped' });
                ws.send(stopMessage);
                console.log('Sent stop confirmation');
            } else {
                console.log('Unknown command action:', command.action);
            }
        } catch (error) {
            console.error('=== WEBSOCKET MESSAGE ERROR ===');
            console.error('Error details:', error);
            console.error('Error stack:', error.stack);
            console.error('Raw message that failed:', msg);
            console.error('Raw message type:', typeof msg);
            console.error('Raw message string representation:', String(msg));
        }
    });
    
    ws.on('close', (code, reason) => {
        console.log('=== AUDIO STREAM CLIENT DISCONNECTED ===');
        console.log('Close code:', code, 'Reason:', reason?.toString());
        console.log('Clients before removal:', audioStreamClients.length);
        
        audioStreamClients = audioStreamClients.filter(client => client !== ws);
        
        console.log('Clients after removal:', audioStreamClients.length);
        
        // Stop jitter buffer if no clients
        if (audioStreamClients.length === 0) {
            console.log('No more clients, stopping jitter buffer');
            jitterBuffer.stop();
        }
    });
    
    ws.on('error', (error) => {
        console.error('=== AUDIO STREAM WEBSOCKET ERROR ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        
        audioStreamClients = audioStreamClients.filter(client => client !== ws);
        console.log('Clients after error removal:', audioStreamClients.length);
        
        // Stop jitter buffer if no clients
        if (audioStreamClients.length === 0) {
            console.log('No more clients after error, stopping jitter buffer');
            jitterBuffer.stop();
        }
    });
    
    // Test that the WebSocket is working by sending a ping after a short delay
    setTimeout(() => {
        try {
            console.log('Sending ping test message...');
            ws.send(JSON.stringify({ status: 'Ping test - server is ready' }));
            console.log('Ping test message sent');
        } catch (error) {
            console.error('Failed to send ping test:', error);
        }
    }, 1000);
});

// websocket setup
app.ws('/api/sync', (ws, req)=>{
	
	sendWebSockets.push(ws);

	// execute different commands
	ws.on('message', msg=>{
		const { cmd, value } = JSON.parse(msg);
		switch(cmd) {
			case 'req-sync':
				syncWSWithOne(ws, 'res-sync', getFullSyncItem())
				break;
			case 'req-update-profile':
				current_profile = value;
				scripts = all_scripts[current_profile.name] || {}
				syncWSWithAll('res-update-profile', current_profile)
				syncWSWithAll('res-update-scripts', scripts)
				break;
			case 'req-execute':
				sendSockets.forEach(s=>{
					s(JSON.stringify(value))
				});
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
				ws.send(JSON.stringify({ action: 'textOutput', ...data }));
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

// Handle audio packets from jitter buffer
jitterBuffer.onAudioReady = (audioPacket) => {
    const activeClients = audioStreamClients.filter(client => client.readyState === 1);
    
    if (activeClients.length === 0) {
        console.log('No active clients for audio packet, stopping jitter buffer');
        jitterBuffer.stop();
        return;
    }
    
    console.log(`Sending audio packet ${audioPacket.sequence} to ${activeClients.length} clients, volume: ${audioPacket.volume}`);
    
    activeClients.forEach(client => {
        try {
            const message = JSON.stringify({
                action: 'audioData',
                audio: audioPacket.audio.toString('base64'),
                volume: audioPacket.volume,
                sequence: audioPacket.sequence
            });
            client.send(message);
        } catch (error) {
            console.error('Error sending audio data to client:', error);
        }
    });
};

// UDP server for receiving audio from Python script
udpServer.on('message', (msg, rinfo) => {
    try {
        if (msg.length < 12) {
            console.warn('Received invalid packet, too short:', msg.length);
            return;
        }
        
        const sequence = msg.readUInt32BE(0);
        const timestamp = msg.readUInt32BE(4);
        const volume = msg.readUInt32BE(8);
        const audio = msg.slice(12);
        
        const activeClients = audioStreamClients.filter(client => client.readyState === 1);
        
        // More detailed logging for debugging
        if (sequence % 50 === 0) { // Log every 50th packet to reduce spam
            console.log(`=== UDP PACKET RECEIVED ===`);
            console.log(`Sequence: ${sequence}, Volume: ${volume}`);
            console.log(`Total clients: ${audioStreamClients.length}`);
            console.log(`Active clients: ${activeClients.length}`);
            console.log(`Buffer active: ${jitterBuffer.isActive}`);
            console.log(`Will process: ${activeClients.length > 0 && jitterBuffer.isActive}`);
        }
        
        // Only process if we have active audio stream test clients
        if (activeClients.length > 0 && jitterBuffer.isActive) {
            jitterBuffer.addPacket(sequence, timestamp, volume, audio);
        } else {
            // Only log when conditions change to avoid spam
            if (sequence % 100 === 0) {
                console.log(`Ignoring packet ${sequence} - active clients: ${activeClients.length}, buffer active: ${jitterBuffer.isActive}`);
            }
        }
        
    } catch (error) {
        console.error('UDP packet parsing error:', error);
    }
});

udpServer.on('error', (err) => {
    console.error('UDP server error:', err);
});

udpServer.on('listening', () => {
    const address = udpServer.address();
    console.log(`UDP audio server listening on ${address.address}:${address.port}`);
});

// Start UDP server on port 9999
udpServer.bind(9999, '0.0.0.0');

// ROUTER SETUP AFTER WEBSOCKETS
app.use(express.static(join(__dirname, 'dist')));

const router = express.Router();

// for file upload
router.get("/api/get-possible-files", (req, res)=>{
	res.status(200).send(all_possible_files)
})

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
			default:
				all_scripts[name] = json;
				if(current_profile.name === name) { scripts = json; }
				write_file_name = name.replaceAll(" ", "_")+'_Script';
				break;
		}
		writeToJSON(write_file_name, json);
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

// normal setup
router.get("*", (req, res)=>{
    res.sendFile(join(__dirname, 'dist', 'index.html'));
})

app.use('/', router);

app.listen(3000, '0.0.0.0', () => {
    console.log("Express server is listening on port 3000!")
})

// SOCKET
const net = require('net');

const server = net.createServer((socket) => {
	console.log('Client connected');

	function sendSocket(message) {
		socket.write(message);
	}

	sendSockets.push(sendSocket)

	socket.on('data', (data) => {
		const data_str = data.toString();
		console.log('Received:', data_str);
		if(data_str === 'SHUTDOWN') socket.write('SHUTDOWN_PONG')
	});

	socket.on('end', () => {
		sendSockets = sendSockets.filter(e=>e!==sendSocket)
		console.log('Client disconnected');
	});

	socket.on('error', (err) => {
		sendSockets = sendSockets.filter(e=>e!==sendSocket)
		console.error('Socket error:', err);
	});
});


server.listen(3456, '0.0.0.0', () => {
  	console.log(`Socket server is listening on port 3456`);
});
