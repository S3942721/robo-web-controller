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

// Function to read settings files
function readSettings() {
	const dir = readdirSync(join(__dirname, 'settings'));
	const script_files = dir.filter(e => /^.*Script\.json$/.test(e));
	script_files.forEach(e => {
		const profile_name = e.split('_').slice(0, -1).join(' ');
		const file_path = join(__dirname, 'settings', e);
		all_scripts[profile_name] = JSON.parse(readFileSync(file_path, { encoding: 'utf-8' }));
		console.log(`Loaded script file: ${file_path}`);
	});
	scripts = all_scripts[Object.keys(all_scripts)[0]];

	const profiles_path = join(__dirname, 'settings', 'profiles.json');
	profiles = JSON.parse(readFileSync(profiles_path, { encoding: 'utf-8' }));
	console.log(`Loaded profiles file: ${profiles_path}`);
	current_profile = profiles[0];

	const triggers_path = join(__dirname, 'settings', 'triggers.json');
	triggers = JSON.parse(readFileSync(triggers_path, { encoding: 'utf-8' }));
	console.log(`Loaded triggers file: ${triggers_path}`);

	const shortcuts_path = join(__dirname, 'settings', 'shortcuts.json');
	shortcuts = JSON.parse(readFileSync(shortcuts_path, { encoding: 'utf-8' }));
	console.log(`Loaded shortcuts file: ${shortcuts_path}`);

	const paged_shortcuts_path = join(__dirname, 'settings', 'paged_shortcuts.json');
	paged_shortcuts = JSON.parse(readFileSync(paged_shortcuts_path, { encoding: 'utf-8' }));
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
		const { cmd, value } = JSON.parse(msg);
		switch(cmd) {
			case 'req-sync':
				readSettings(); // Read settings files before syncing
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
