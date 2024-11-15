// EXPRESS SERVER
const express = require("express");
const {join} = require("path")

const app = express();

app.use(require("body-parser").json())
app.use(require("cors")())

let sendSockets = [];

app.use(express.static(join(__dirname, 'dist')));

const router = express.Router();

router.post('/api/send-command', (req, res)=>{
	const { type, message } = req.body;
	const send_msg = JSON.stringify({type, message})
	sendSockets.forEach(s=>{
		s(send_msg)
	})
	res.status(200).send('ok')
})

router.get("*", (req, res)=>{
    res.redirect(join(__dirname, 'dist', 'index.html'));
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
