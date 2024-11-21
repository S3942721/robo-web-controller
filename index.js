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

const all_possible_files = JSON.parse(readFileSync(join(__dirname, 'settings', 'all_possible_files.json'), { encoding: 'utf-8' }))

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

// websocket setup
app.ws('/api/sync', (ws, req)=>{
	
	sendWebSockets.push(ws);

	// execute different commands
	ws.on('message', msg=>{
		const { cmd, value } = JSON.parse(msg);
		switch(cmd) {
			case 'req-sync':
				syncWSWithOne(ws, 'res-sync', {
					profiles, current_profile, 
					scripts, triggers, shortcuts
				})
				break;
			case 'req-update-profile':
				current_profile = value;
				scripts = all_scripts[current_profile.name] || {}
				syncWSWithAll('res-update-profile', current_profile)
				syncWSWithAll('res-update-scripts', scripts)
				break;
			case 'req-update-trigger':
				triggers = {...triggers, [value.name]: value.status};
				syncWSWithAll('req-update-trigger', triggers)
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
		if(name === 'triggers') {
			triggers = json;
			writeToJSON('triggers', json);
		} else if(name === 'shortcuts') {
			shortcuts = json;
			writeToJSON('shortcuts', json);
		} else {
			all_scripts[name] = json;
			if(current_profile.name === name) {
				scripts = json;
			}
			const script_file_name = name.replaceAll(" ", "_")+'_Script';
			writeToJSON(script_file_name, json);
		}
		syncWSWithAll('res-sync', {
			profiles, current_profile, 
			scripts, triggers, shortcuts
		})
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
