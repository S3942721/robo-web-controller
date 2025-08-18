import { useState, useEffect, useRef } from 'react';
import { requestWS } from '../../utils/useWebSocket';

export default function AudioStreamTest() {
    const [isStreaming, setIsStreaming] = useState(false);
    const [volume, setVolume] = useState(0);
    const [packetsReceived, setPacketsReceived] = useState(0);
    const [status, setStatus] = useState('Ready to start audio stream test');
    const [connectionInfo, setConnectionInfo] = useState('');
    const [lastPacketTime, setLastPacketTime] = useState(null);
    const [networkInfo, setNetworkInfo] = useState('');
    const [diagnostics, setDiagnostics] = useState({
        udpPacketsReceived: 0,
        lastPacketTime: null,
        serverStatus: 'Unknown'
    });
    
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const volumeHistoryRef = useRef([]);
    const reconnectTimeoutRef = useRef(null);

    useEffect(() => {
        // Get connection info
        const host = window.location.hostname;
        const port = window.location.port || '3000';
        setConnectionInfo(`Server: ${host}:${port} | UDP: ${host}:9999`);
        
        // Get network information
        fetch('/api/network-info')
            .then(res => res.json())
            .then(data => {
                setNetworkInfo(data);
            })
            .catch(err => {
                console.error('Failed to get network info:', err);
                setNetworkInfo({ error: 'Failed to get network info' });
            });
        
        return () => {
            stopStream();
        };
    }, []);

    const initAudioContext = async () => {
        try {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive',
                sampleRate: 16000
            });
            
            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }
            
            console.log('Audio context initialized');
            return true;
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
            setStatus('❌ Failed to initialize audio system');
            return false;
        }
    };

    const playAudioChunk = async (audioData, volumeLevel) => {
        if (!audioContextRef.current || audioContextRef.current.state !== 'running') {
            console.warn('Audio context not ready');
            return;
        }

        try {
            // Convert base64 to ArrayBuffer
            const binaryString = atob(audioData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Convert to Int16Array (16-bit audio data)
            const int16Array = new Int16Array(bytes.buffer);
            
            if (int16Array.length === 0) {
                console.warn('Empty audio data received');
                return;
            }
            
            // Create AudioBuffer
            const audioBuffer = audioContextRef.current.createBuffer(1, int16Array.length, 16000);
            const channelData = audioBuffer.getChannelData(0);
            
            // Convert Int16 to Float32
            for (let i = 0; i < int16Array.length; i++) {
                channelData[i] = int16Array[i] / 32768;
            }
            
            // Schedule playback
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.start(audioContextRef.current.currentTime);
            
            // Update volume display
            setVolume(volumeLevel);
            setLastPacketTime(new Date().toLocaleTimeString());
            volumeHistoryRef.current.push(volumeLevel);
            if (volumeHistoryRef.current.length > 50) {
                volumeHistoryRef.current.shift();
            }
            
        } catch (error) {
            console.error('Audio playback error:', error);
        }
    };

    const connectWebSocket = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            try {
                const wsUrl = `ws://${window.location.hostname}:${window.location.port || '3000'}/api/audio-stream-test`;
                console.log('Connecting to:', wsUrl);
                wsRef.current = new WebSocket(wsUrl);
                
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 10000);
                
                wsRef.current.onopen = () => {
                    clearTimeout(timeout);
                    console.log('WebSocket connected successfully');
                    setStatus('🔗 Connected - ready to start streaming');
                    resolve();
                };
                
                wsRef.current.onmessage = (event) => {
                    try {
                        console.log('Raw WebSocket message received:', event.data);
                        const data = JSON.parse(event.data);
                        console.log('Parsed WebSocket message:', data);
                        
                        if (data.action === 'audioData') {
                            console.log('Processing audio data, volume:', data.volume, 'sequence:', data.sequence);
                            playAudioChunk(data.audio, data.volume);
                            setPacketsReceived(prev => prev + 1);
                            setStatus('🎵 Receiving and playing audio...');
                            
                            // Update diagnostics
                            setDiagnostics(prev => ({
                                ...prev,
                                udpPacketsReceived: prev.udpPacketsReceived + 1,
                                lastPacketTime: new Date().toLocaleTimeString()
                            }));
                        } else if (data.status) {
                            console.log('Status update from server:', data.status);
                            setStatus(data.status);
                        }
                    } catch (error) {
                        console.error('Message parsing error:', error, 'Raw data:', event.data);
                    }
                };
                
                wsRef.current.onerror = (error) => {
                    clearTimeout(timeout);
                    console.error('WebSocket error:', error);
                    setStatus('❌ Connection error: ' + error.message);
                    reject(error);
                };
                
                wsRef.current.onclose = (event) => {
                    console.log('WebSocket closed:', event.code, event.reason);
                    if (event.code === 1006) {
                        setStatus('❌ Connection failed - server may have crashed');
                        console.error('WebSocket closed abnormally (1006) - possible server error');
                    } else {
                        setStatus('🔌 Connection closed');
                    }
                    setIsStreaming(false);
                };
                
            } catch (error) {
                reject(error);
            }
        });
    };

    const startStream = async () => {
        try {
            setStatus('🔗 Connecting...');
            setPacketsReceived(0);
            setVolume(0);
            volumeHistoryRef.current = [];
            
            // Clear any existing reconnect timeout
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            
            // Initialize audio context
            if (!await initAudioContext()) {
                return;
            }
            
            // Connect WebSocket and wait for it to be ready
            await connectWebSocket();
            
            // Wait longer to ensure the connection is fully established
            console.log('WebSocket connection established, waiting for stability...');
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Check if WebSocket is still open before sending
            if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket connection lost');
            }
            
            // Send command to start jitter buffer first
            console.log('Starting jitter buffer on server...');
            wsRef.current.send(JSON.stringify({ action: 'start' }));
            
            // Wait a moment for jitter buffer to start
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Send trigger message to start audio streaming
            console.log('Sending trigger to start UDP audio streaming...');
            requestWS('req-execute', {
                type: 'trigger',
                message: {
                    name: 'Audio Stream',
                    Signal: 'ControlUDPAudioStreaming',
                    Value: true
                },
                robot: 'Haku'
            });
            
            setIsStreaming(true);
            setStatus('🎤 Audio streaming enabled - jitter buffer active');
            
        } catch (error) {
            console.error('Failed to start stream:', error);
            setStatus('❌ Failed to start: ' + error.message);
            setIsStreaming(false);
        }
    };

    const stopStream = () => {
        console.log('Stopping stream...');
        setIsStreaming(false);
        
        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        
        // Send command to stop jitter buffer first
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            console.log('Stopping jitter buffer on server...');
            wsRef.current.send(JSON.stringify({ action: 'stop' }));
        }
        
        // Send trigger message to stop audio streaming
        console.log('Sending trigger to stop UDP audio streaming...');
        requestWS('req-execute', {
            type: 'trigger',
            message: {
                name: 'Audio Stream',
                Signal: 'ControlUDPAudioStreaming',
                Value: false
            },
            robot: 'Haku'
        });
        
        // Close WebSocket after a brief delay to allow stop command to be sent
        setTimeout(() => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        }, 100);
        
        // Close audio context
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        
        setStatus('⏹️ Stopped - Audio streaming disabled');
        setVolume(0);
        volumeHistoryRef.current = [];
    };

    const getVolumeBar = () => {
        const maxVolume = 32768; // Max 16-bit value
        const normalizedVolume = Math.min(volume / maxVolume, 1);
        const barLength = Math.floor(normalizedVolume * 30);
        return '#'.repeat(barLength) + '·'.repeat(30 - barLength);
    };

    const getVolumeColor = () => {
        const normalizedVolume = volume / 32768;
        if (normalizedVolume > 0.7) return '#ff4444';
        if (normalizedVolume > 0.4) return '#ffaa00';
        return '#44ff44';
    };

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            <h2>🎵 External Audio Stream Test</h2>
            
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4>Network Configuration:</h4>
                {networkInfo && !networkInfo.error ? (
                    <div>
                        <p><strong>Server IP Addresses:</strong></p>
                        {networkInfo.interfaces && networkInfo.interfaces.map((iface, idx) => (
                            <p key={idx} style={{ marginLeft: '20px', fontFamily: 'monospace' }}>
                                {iface.name}: {iface.address}
                            </p>
                        ))}
                        <p><strong>UDP Port:</strong> 9999</p>
                        <p><strong>Robot should send to:</strong> [One of the above IPs]:9999</p>
                    </div>
                ) : (
                    <p>Loading network information...</p>
                )}
                
                <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px' }}>
                    <strong>Network Diagnostics:</strong>
                    <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                        <li>UDP Packets Expected: From robot to this server</li>
                        <li>WebSocket Status: {wsRef.current?.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}</li>
                        <li>Server Status: {diagnostics.serverStatus}</li>
                        {diagnostics.lastPacketTime && (
                            <li>Last UDP Packet: {diagnostics.lastPacketTime}</li>
                        )}
                    </ul>
                </div>
            </div>

            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4>Connection Information:</h4>
                <p><strong>Web App:</strong> {connectionInfo}</p>
                <p><strong>Python Command:</strong></p>
                <code style={{ 
                    display: 'block', 
                    padding: '10px', 
                    backgroundColor: '#e9ecef',
                    borderRadius: '4px',
                    marginTop: '5px'
                }}>
                    python3 externalAudioStreamTest.py {window.location.hostname}
                </code>
            </div>

            <div style={{ marginBottom: '20px' }}>
                <button 
                    onClick={isStreaming ? stopStream : startStream}
                    style={{
                        padding: '15px 30px',
                        backgroundColor: isStreaming ? '#dc3545' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        marginRight: '10px'
                    }}
                    disabled={isStreaming && status.includes('Connecting')}
                >
                    {isStreaming ? '🛑 Stop Stream' : '▶️ Start Stream'}
                </button>
                
                <span style={{ 
                    padding: '10px', 
                    fontStyle: 'italic',
                    color: '#666'
                }}>
                    Status: {status}
                </span>
            </div>

            <div style={{ 
                padding: '20px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px',
                marginBottom: '20px'
            }}>
                <h4>Live Audio Monitoring</h4>
                
                <div style={{ marginBottom: '15px' }}>
                    <strong>Packets Received:</strong> {packetsReceived}
                    {lastPacketTime && (
                        <span style={{ marginLeft: '20px', color: '#666' }}>
                            Last packet: {lastPacketTime}
                        </span>
                    )}
                </div>
                
                <div style={{ marginBottom: '15px' }}>
                    <strong>Current Volume:</strong> {volume}
                </div>
                
                <div style={{ marginBottom: '15px' }}>
                    <strong>Volume Indicator:</strong>
                    <div style={{
                        fontFamily: 'monospace',
                        fontSize: '14px',
                        backgroundColor: '#000',
                        color: getVolumeColor(),
                        padding: '10px',
                        borderRadius: '4px',
                        marginTop: '5px'
                    }}>
                        [{getVolumeBar()}]
                    </div>
                </div>
                
                {volumeHistoryRef.current.length > 0 && (
                    <div>
                        <strong>Average Volume (last 50 packets):</strong> {' '}
                        {Math.floor(volumeHistoryRef.current.reduce((a, b) => a + b, 0) / volumeHistoryRef.current.length)}
                    </div>
                )}
            </div>

            <div style={{ 
                padding: '15px', 
                backgroundColor: '#e7f3ff',
                border: '1px solid #b3d9ff',
                borderRadius: '8px'
            }}>
                <h4>📋 Instructions:</h4>
                <ol>
                    <li>Click "Start Stream" to begin listening for audio</li>
                    <li>Run the Python script on another machine: <code>python3 externalAudioStreamTest.py {window.location.hostname}</code></li>
                    <li>Speak into the microphone on the machine running the Python script</li>
                    <li>You should see volume indicators and hear the audio playback here</li>
                    <li>The page will auto-reconnect if the connection is lost</li>
                </ol>
                
                <p><strong>Note:</strong> Make sure port 9999 (UDP) is open for incoming connections.</p>
                
                <div style={{ 
                    marginTop: '15px',
                    padding: '10px',
                    backgroundColor: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    borderRadius: '4px'
                }}>
                    <strong>Troubleshooting:</strong>
                    <ul>
                        <li>This uses the robot trigger system (Haku → Audio Stream trigger)</li>
                        <li>If you see packets in server logs but no audio here, check browser console for errors</li>
                        <li>Try refreshing the page if WebSocket connection fails</li>
                        <li>Ensure Python script is running and can reach this server</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
