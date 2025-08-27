import { useState, useEffect, useRef } from 'react';

export default function STTTest() {
    const [isConnected, setIsConnected] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [partialText, setPartialText] = useState('');
    const [completeTexts, setCompleteTexts] = useState([]);
    const [status, setStatus] = useState('Ready to connect');
    const [serverDetails, setServerDetails] = useState(null);
    const [networkConfig, setNetworkConfig] = useState(null);

    const wsRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);
    const transcriptionHistoryRef = useRef(null);

    useEffect(() => {
        // Load network configuration from server
        fetch('/api/network-config')
            .then(res => res.json())
            .then(config => {
                console.log('Loaded network config:', config);
                setNetworkConfig(config);
            })
            .catch(err => {
                console.error('Failed to load network config:', err);
                setStatus('❌ Failed to load configuration');
            });
        
        return () => {
            disconnectFromSTT();
        };
    }, []);

    // Auto-scroll transcription history to bottom
    useEffect(() => {
        if (transcriptionHistoryRef.current) {
            transcriptionHistoryRef.current.scrollTop = transcriptionHistoryRef.current.scrollHeight;
        }
    }, [completeTexts, partialText]);

    const connectToSTT = async () => {
        if (!networkConfig) {
            setStatus('❌ Network configuration not loaded');
            return;
        }

        try {
            setStatus('🔗 Connecting...');
            
            // Clear any existing reconnect timeout
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            
            // Close existing connection if any
            if (wsRef.current) {
                wsRef.current.close();
            }
            
            const wsUrl = networkConfig.stt.defaultUrl;
            console.log('Connecting to STT server at:', wsUrl);
            wsRef.current = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
                    wsRef.current.close();
                    setStatus('❌ Connection timeout');
                }
            }, 10000);
            
            wsRef.current.onopen = () => {
                clearTimeout(timeout);
                console.log('STT WebSocket connected successfully');
                setIsConnected(true);
                setStatus('✅ Connected to STT server');
            };
            
            wsRef.current.onmessage = (event) => {
                try {
                    console.log('STT message received:', event.data);
                    const data = JSON.parse(event.data);
                    handleSTTMessage(data);
                } catch (error) {
                    console.error('Failed to parse STT message:', error, 'Raw data:', event.data);
                }
            };
            
            wsRef.current.onerror = (error) => {
                clearTimeout(timeout);
                console.error('STT WebSocket error:', error);
                setStatus('❌ Connection error');
                setIsConnected(false);
            };
            
            wsRef.current.onclose = (event) => {
                clearTimeout(timeout);
                console.log('STT WebSocket closed:', event.code, event.reason);
                setIsConnected(false);
                setIsTranscribing(false);
                
                if (event.code === 1006) {
                    setStatus('❌ Connection lost - server may be down');
                } else if (event.wasClean) {
                    setStatus('🔌 Disconnected');
                } else {
                    setStatus('❌ Connection interrupted');
                }
            };
            
        } catch (error) {
            console.error('Failed to connect to STT:', error);
            setStatus('❌ Failed to connect: ' + error.message);
            setIsConnected(false);
        }
    };

    const disconnectFromSTT = () => {
        console.log('Disconnecting from STT...');
        setIsTranscribing(false);
        
        // Clear reconnect timeout
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        
        // Close WebSocket
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        
        setIsConnected(false);
        setStatus('⏹️ Disconnected');
        setPartialText('');
    };

    const startTranscription = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            setStatus('❌ Not connected to STT server');
            return;
        }
        
        try {
            console.log('Starting transcription...');
            wsRef.current.send(JSON.stringify({ action: 'start' }));
            setIsTranscribing(true);
            setStatus('🎤 Transcribing... speak now');
            setPartialText('');
        } catch (error) {
            console.error('Failed to start transcription:', error);
            setStatus('❌ Failed to start transcription');
        }
    };

    const stopTranscription = () => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
        }
        
        try {
            console.log('Stopping transcription...');
            wsRef.current.send(JSON.stringify({ action: 'stop' }));
            setIsTranscribing(false);
            setStatus('⏹️ Transcription stopped');
            setPartialText('');
        } catch (error) {
            console.error('Failed to stop transcription:', error);
            setStatus('❌ Failed to stop transcription');
        }
    };

    const handleSTTMessage = (data) => {
        console.log('Processing STT message:', data);
        
        switch(data.type) {
            case 'partial':
                setPartialText(data.text || '');
                if (!isTranscribing) {
                    setIsTranscribing(true);
                }
                setStatus('🎤 Listening... (partial result)');
                break;
                
            case 'complete':
                if (data.text && data.text.trim()) {
                    const timestamp = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
                    setCompleteTexts(prev => [...prev, {
                        text: data.text,
                        timestamp: timestamp,
                        confidence: data.confidence,
                        type: 'user'
                    }]);
                }
                setPartialText('');
                setStatus('✅ Utterance complete - ready for next');
                break;
                
            case 'status':
                console.log('STT Status update:', data.status, data.details);
                if (data.details) {
                    setServerDetails(data.details);
                }
                switch(data.status) {
                    case 'started':
                        setIsTranscribing(true);
                        setStatus('🎤 STT started - listening for speech');
                        break;
                    case 'stopped':
                        setIsTranscribing(false);
                        setStatus('⏹️ STT stopped');
                        break;
                    case 'connected':
                        setStatus('✅ Connected to STT server');
                        break;
                    default:
                        setStatus(`📡 Status: ${data.status}`);
                }
                break;

            case 'error':
                console.error('STT Error:', data.error);
                setStatus('❌ STT Error: ' + data.error);
                break;
                
            default:
                console.warn('Unknown STT message type:', data.type, data);
        }
    };

    const clearHistory = () => {
        setCompleteTexts([]);
        setPartialText('');
    };

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            <h2>🎙️ Speech-to-Text Test</h2>
            
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4>Connection Configuration:</h4>
                {networkConfig ? (
                    <div>
                        <p><strong>STT Server URL:</strong> <code>{networkConfig.stt.defaultUrl}</code></p>
                        <p><strong>STT Host:</strong> {networkConfig.stt.host}</p>
                        <p><strong>STT Port:</strong> {networkConfig.stt.port}</p>
                        <p><strong>STT Enabled:</strong> {networkConfig.stt.enabled ? '✅ Yes' : '❌ No'}</p>
                    </div>
                ) : (
                    <p>Loading configuration...</p>
                )}
                
                {serverDetails && (
                    <div style={{ 
                        marginTop: '10px',
                        padding: '10px',
                        backgroundColor: '#e7f3ff',
                        borderRadius: '4px'
                    }}>
                        <strong>Server Details:</strong>
                        <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                            {serverDetails.chunk_size_ms && (
                                <li>Chunk size: {serverDetails.chunk_size_ms}ms</li>
                            )}
                            {serverDetails.device_id !== undefined && (
                                <li>Audio device: {serverDetails.device_id}</li>
                            )}
                            {Object.entries(serverDetails).map(([key, value]) => {
                                if (key !== 'chunk_size_ms' && key !== 'device_id') {
                                    return <li key={key}>{key}: {JSON.stringify(value)}</li>;
                                }
                                return null;
                            })}
                        </ul>
                    </div>
                )}
            </div>

            <div style={{ marginBottom: '20px' }}>
                <button 
                    onClick={isConnected ? disconnectFromSTT : connectToSTT}
                    style={{
                        padding: '12px 25px',
                        backgroundColor: isConnected ? '#dc3545' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        marginRight: '10px'
                    }}
                    disabled={!networkConfig}
                >
                    {isConnected ? '🔌 Disconnect' : '🔗 Connect'}
                </button>
                
                <button 
                    onClick={isTranscribing ? stopTranscription : startTranscription}
                    style={{
                        padding: '12px 25px',
                        backgroundColor: isTranscribing ? '#fd7e14' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold',
                        marginRight: '10px'
                    }}
                    disabled={!isConnected}
                >
                    {isTranscribing ? '⏹️ Stop' : '🎤 Start Transcription'}
                </button>
                
                <button 
                    onClick={clearHistory}
                    style={{
                        padding: '12px 25px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold'
                    }}
                >
                    🗑️ Clear History
                </button>
                
                <div style={{ 
                    marginTop: '15px', 
                    padding: '10px', 
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    fontStyle: 'italic'
                }}>
                    Status: {status}
                </div>
            </div>

            <div style={{ 
                padding: '20px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px',
                marginBottom: '20px'
            }}>
                <h4>Live Transcription</h4>
                
                {/* Current Transcription */}
                {partialText && (
                    <div style={{ 
                        marginBottom: '15px',
                        padding: '15px',
                        backgroundColor: '#fff3cd',
                        border: '1px solid #ffeaa7',
                        borderRadius: '4px'
                    }}>
                        <strong>🎤 You (speaking):</strong>
                        <div style={{ 
                            fontStyle: 'italic', 
                            color: '#856404',
                            marginTop: '5px',
                            fontSize: '16px'
                        }}>
                            "{partialText}"
                        </div>
                    </div>
                )}
                
                {/* Transcription History */}
                <div>
                    <strong>Transcription History:</strong>
                    <div 
                        ref={transcriptionHistoryRef}
                        style={{
                            maxHeight: '400px',
                            overflowY: 'auto',
                            border: '1px solid #dee2e6',
                            borderRadius: '4px',
                            padding: '10px',
                            backgroundColor: 'white',
                            marginTop: '10px'
                        }}
                    >
                        {completeTexts.length === 0 ? (
                            <div style={{ color: '#6c757d', fontStyle: 'italic' }}>
                                No transcriptions yet. Start talking to begin.
                            </div>
                        ) : (
                            completeTexts.map((item, index) => (
                                <div 
                                    key={index}
                                    style={{
                                        padding: '12px',
                                        borderBottom: '1px solid #e9ecef',
                                        marginBottom: '8px',
                                        backgroundColor: '#fff8f0',
                                        borderLeft: '4px solid #ffc107',
                                        borderRadius: '4px'
                                    }}
                                >
                                    <div style={{ 
                                        fontSize: '14px', 
                                        fontWeight: 'bold',
                                        color: '#856404',
                                        marginBottom: '4px'
                                    }}>
                                        👤 You
                                    </div>
                                    <div style={{ fontSize: '16px', marginBottom: '4px' }}>
                                        "{item.text}"
                                    </div>
                                    <div style={{ 
                                        fontSize: '12px', 
                                        color: '#6c757d' 
                                    }}>
                                        {item.timestamp}
                                        {item.confidence !== null && item.confidence !== undefined && (
                                            <span> • Confidence: {item.confidence}</span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div style={{ 
                padding: '15px', 
                backgroundColor: '#e7f3ff',
                border: '1px solid #b3d9ff',
                borderRadius: '8px'
            }}>
                <h4>📋 Instructions:</h4>
                <ol>
                    <li>Make sure the STT backend server is running (node stt-server.js)</li>
                    <li>Click "Connect" to establish connection to the configured STT server</li>
                    <li>Click "Start Transcription" to begin speech recognition</li>
                    <li>Speak clearly into your microphone</li>
                    <li>See partial results while speaking and complete conversation with AI responses</li>
                    <li>The AI will respond to your complete utterances automatically</li>
                </ol>
                
                <div style={{ 
                    marginTop: '15px',
                    padding: '10px',
                    backgroundColor: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    borderRadius: '4px'
                }}>
                    <strong>Configuration:</strong>
                    <ul>
                        <li><strong>Server Configuration:</strong> URLs and settings loaded from environment variables</li>
                        <li><strong>STT Integration:</strong> Direct connection to configured speech-to-text server</li>
                        <li><strong>Real-time Processing:</strong> Live transcription with immediate feedback</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}