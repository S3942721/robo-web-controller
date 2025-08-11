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

// variables
let sendSockets = [];
let sendWebSockets = [];

let current_profile = {};
let all_scripts = {}, scripts = {}
let triggers = {};

let profiles = [];
let shortcuts = [];
let paged_shortcuts = [];
let announcements = [];
let all_possible_files = [];

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
		console.log(`Loaded script file: ${file_path}`);
		console.log('For profile:', profile_name);
	});
	scripts = all_scripts[Object.keys(all_scripts)[0]];

	const profiles_path = join(__dirname, 'settings', 'profiles.json');
	profiles = JSON.parse(readFileSync(profiles_path, { encoding: 'utf-8' }));
	console.log(`Loaded profiles file: ${profiles_path}`);
	current_profile = profiles[0];
	console.log('Current profile:', current_profile);

	const triggers_path = join(__dirname, 'settings', 'triggers.json');
	triggers = parseTriggers(JSON.parse(readFileSync(triggers_path, { encoding: 'utf-8' })));
	console.log(`Loaded triggers file: ${triggers_path}`);

	const shortcuts_path = join(__dirname, 'settings', 'shortcuts.json');
	shortcuts = JSON.parse(readFileSync(shortcuts_path, { encoding: 'utf-8' }));
	console.log(`Loaded shortcuts file: ${shortcuts_path}`);

	const paged_shortcuts_path = join(__dirname, 'settings', 'paged_shortcuts.json');
	paged_shortcuts = parsePagedShortcuts(JSON.parse(readFileSync(paged_shortcuts_path, { encoding: 'utf-8' })));
	console.log(`Loaded paged shortcuts file: ${paged_shortcuts_path}`);

	const announcements_path = join(__dirname, 'settings', 'announcements.json');
	announcements = JSON.parse(readFileSync(announcements_path, { encoding: 'utf-8' }));
	console.log(`Loaded announcements file: ${announcements_path}`);

	const all_possible_files_path = join(__dirname, 'settings', 'all_possible_files.json');
	all_possible_files = JSON.parse(readFileSync(all_possible_files_path, { encoding: 'utf-8' }));
	console.log(`Loaded all possible files: ${all_possible_files_path}`);
}

// Initial read of settings files
readSettings();

const moveConfigPath = join(__dirname, 'settings', 'move_config.json');
let move_config = {};
console.log(`Loading move config: ${moveConfigPath}`);
try {
    move_config = JSON.parse(readFileSync(moveConfigPath, { encoding: 'utf-8' }));
    console.log(`Loaded move config: ${moveConfigPath}`);
} catch(err) {
    console.error("Error loading move_config.json:", err);
}

const scrollControllersConfigPath = join(__dirname, 'settings', 'scroll_controllers_config.json');
let scroll_controllers_config = {};
try {
    scroll_controllers_config = JSON.parse(readFileSync(scrollControllersConfigPath, { encoding: 'utf-8' }));
    console.log(`Loaded scroll controllers config: ${scrollControllersConfigPath}`);
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
				sendSockets.forEach(s => {
					const replaced = JSON.stringify({ cmd, type, message, robot })
						.normalize('NFKC')
						.replace(/[“”]/g, '"')
						.replace(/[‘’]/g, "'")
						.replace(/…/g, '...')
						.replace(/[^\x00-\x7F]/g, "");
					s(replaced);
					console.log("Sent to socket:", replaced);
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
    // Make sure we're returning the parsed triggers object
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
