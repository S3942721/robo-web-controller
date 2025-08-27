import { useState, useEffect, useRef } from 'react';

export default function STTLLMTest() {
    const [sessionId, setSessionId] = useState('');
    const [sttStatus, setSTTStatus] = useState('disconnected');
    const [llmStatus, setLLMStatus] = useState('disconnected');
    const [conversationHistory, setConversationHistory] = useState([]);
    const [currentTranscription, setCurrentTranscription] = useState('');
    const [llmResponse, setLLMResponse] = useState('');
    const [overallStatus, setOverallStatus] = useState('Ready to start conversation');
    
    // Configuration - will be loaded from server
    const [networkConfig, setNetworkConfig] = useState(null);
    const [autoStart, setAutoStart] = useState(true);
    
    const wsRef = useRef(null);
    const conversationRef = useRef(null);

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
                setOverallStatus('❌ Failed to load configuration');
            });

        return () => {
            disconnect();
        };
    }, []);

    // Auto-scroll conversation history
    useEffect(() => {
        if (conversationRef.current) {
            conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
        }
    }, [conversationHistory, currentTranscription]);

    const connect = async () => {
        if (!networkConfig) {
            setOverallStatus('❌ Network configuration not loaded');
            return;
        }

        try {
            setOverallStatus('🔗 Connecting to conversation service...');
            
            // Use the current hostname and port, but with the correct WebSocket path
            const wsUrl = `ws://${window.location.hostname}:${window.location.port || '3000'}/api/stt-llm-conversation`;
            console.log('Connecting to:', wsUrl);
            
            wsRef.current = new WebSocket(wsUrl);
            
            wsRef.current.onopen = () => {
                console.log('Connected to STT-LLM conversation service');
                setOverallStatus('✅ Connected to conversation service');
                
                // Send initial session info with config URLs
                const sessionData = {
                    action: 'session_start',
                    sttServerUrl: networkConfig.stt.defaultUrl,
                    llmGatewayUrl: networkConfig.llm.defaultUrl,
                    autoStart: autoStart
                };
                wsRef.current.send(JSON.stringify(sessionData));
            };
            
            wsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (error) {
                    console.error('Message parsing error:', error, 'Raw data:', event.data);
                }
            };
            
            wsRef.current.onclose = (event) => {
                console.log('STT-LLM WebSocket closed:', event.code, event.reason);
                setOverallStatus('🔌 Disconnected');
                setSessionId('');
                setSTTStatus('disconnected');
                setLLMStatus('disconnected');
            };
            
            wsRef.current.onerror = (error) => {
                console.error('STT-LLM WebSocket error:', error);
                setOverallStatus('❌ Connection error');
            };
            
        } catch (error) {
            console.error('Failed to connect:', error);
            setOverallStatus('❌ Failed to connect: ' + error.message);
        }
    };

    const handleMessage = (data) => {
        console.log('Received message:', data.type, data);
        
        switch(data.type) {
            case 'session_created':
                setSessionId(data.sessionId);
                setOverallStatus('✅ Session created - Ready to connect services');
                break;
                
            case 'stt_status':
                setSTTStatus(data.status);
                if (data.status === 'connected') {
                    setOverallStatus('🎤 STT connected - Ready for LLM');
                } else if (data.status === 'error') {
                    setOverallStatus('❌ STT error: ' + (data.error || 'Unknown error'));
                }
                break;
                
            case 'llm_status':
                setLLMStatus(data.status);
                if (data.status === 'connected') {
                    setOverallStatus('🤖 LLM connected - Ready to start conversation');
                } else if (data.status === 'error') {
                    setOverallStatus('❌ LLM error: ' + (data.error || 'Unknown error'));
                }
                break;
                
            case 'stt_message':
                handleSTTMessage(data.data);
                break;
                
            case 'llm_message':
                handleLLMMessage(data.data);
                break;
                
            case 'error':
                console.error('Server error:', data.error);
                setOverallStatus('❌ Server error: ' + data.error);
                break;
                
            default:
                console.warn('Unknown message type:', data.type);
        }
    };

    const handleSTTMessage = (sttData) => {
        switch(sttData.type) {
            case 'partial':
                setCurrentTranscription(sttData.text || '');
                setOverallStatus('🎤 Listening...');
                break;
                
            case 'complete':
                if (sttData.text && sttData.text.trim()) {
                    const timestamp = sttData.timestamp ? 
                        new Date(sttData.timestamp * 1000).toLocaleTimeString() : 
                        new Date().toLocaleTimeString();
                    
                    setConversationHistory(prev => [...prev, {
                        type: 'user',
                        text: sttData.text,
                        timestamp: timestamp,
                        confidence: sttData.confidence
                    }]);
                    setCurrentTranscription('');
                    setOverallStatus('🤖 Processing with AI...');
                }
                break;
                
            case 'status':
                console.log('STT status:', sttData.status);
                break;
                
            case 'error':
                console.error('STT error:', sttData.error);
                setOverallStatus('❌ STT error: ' + sttData.error);
                break;
        }
    };

    const handleLLMMessage = (llmData) => {
        if (llmData.type === 'response' || llmData.content) {
            const responseText = llmData.content || llmData.text || llmData.response;
            
            if (responseText && responseText.trim()) {
                setLLMResponse(prev => prev + responseText);
                setOverallStatus('🤖 AI responding...');
            }
        } else if (llmData.type === 'partial' || llmData.partial) {
            const partialText = llmData.content || llmData.text || llmData.partial;
            if (partialText) {
                setLLMResponse(prev => prev + partialText);
            }
        } else if (llmData.type === 'complete') {
            // LLM response complete
            if (llmResponse.trim()) {
                setConversationHistory(prev => [...prev, {
                    type: 'assistant',
                    text: llmResponse,
                    timestamp: new Date().toLocaleTimeString()
                }]);
                setLLMResponse('');
                setOverallStatus('✅ Ready for your next message');
            }
        }
    };

    const connectServices = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // Connect to STT server
            wsRef.current.send(JSON.stringify({
                action: 'connect_stt',
                sttServerUrl: networkConfig.stt.defaultUrl
            }));
            
            // Connect to LLM gateway
            wsRef.current.send(JSON.stringify({
                action: 'connect_llm',
                llmGatewayUrl: networkConfig.llm.defaultUrl
            }));
            
            setOverallStatus('🔗 Connecting to STT and LLM services...');
        }
    };

    const startTranscription = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'start_transcription' }));
            setOverallStatus('🎤 Started listening - speak now');
        }
    };

    const stopTranscription = () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'stop_transcription' }));
            setOverallStatus('⏹️ Stopped listening');
        }
    };

    const sendManualMessage = () => {
        const message = prompt('Enter message to send to LLM:');
        if (message && message.trim()) {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                    action: 'send_to_llm',
                    message: message.trim()
                }));
                
                // Add to conversation history
                setConversationHistory(prev => [...prev, {
                    type: 'user',
                    text: message.trim(),
                    timestamp: new Date().toLocaleTimeString(),
                    manual: true
                }]);
                
                setOverallStatus('🤖 Processing manual message...');
            }
        }
    };

    const disconnect = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setSessionId('');
        setSTTStatus('disconnected');
        setLLMStatus('disconnected');
        setOverallStatus('Disconnected');
    };

    const clearConversation = () => {
        setConversationHistory([]);
        setCurrentTranscription('');
        setLLMResponse('');
    };

    const getStatusColor = (status) => {
        switch(status) {
            case 'connected':
                return '#28a745';
            case 'connecting':
                return '#ffc107';
            case 'error':
                return '#dc3545';
            default:
                return '#6c757d';
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
            <h2>🎙️ STT Conversation Test</h2>
            
            {/* Connection Configuration */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4>Connection Configuration:</h4>
                {networkConfig ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                STT Server URL:
                            </label>
                            <div style={{
                                padding: '8px',
                                backgroundColor: '#e9ecef',
                                border: '1px solid #ced4da',
                                borderRadius: '4px',
                                fontFamily: 'monospace'
                            }}>
                                {networkConfig.stt.defaultUrl}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                                LLM Gateway URL:
                            </label>
                            <div style={{
                                padding: '8px',
                                backgroundColor: '#e9ecef',
                                border: '1px solid #ced4da',
                                borderRadius: '4px',
                                fontFamily: 'monospace'
                            }}>
                                {networkConfig.llm.defaultUrl}
                            </div>
                        </div>
                    </div>
                ) : (
                    <p>Loading configuration...</p>
                )}
                
                <div style={{ marginBottom: '15px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="checkbox"
                            checked={autoStart}
                            onChange={(e) => setAutoStart(e.target.checked)}
                        />
                        <span>Auto-start transcription when STT service connects</span>
                    </label>
                </div>
                
                {/* Service Status */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>STT Service</div>
                        <div style={{ color: getStatusColor(sttStatus), fontWeight: 'bold' }}>
                            {sttStatus.toUpperCase()}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>LLM Gateway</div>
                        <div style={{ color: getStatusColor(llmStatus), fontWeight: 'bold' }}>
                            {llmStatus.toUpperCase()}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>Session ID</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {sessionId || 'Not connected'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Control Buttons */}
            <div style={{ marginBottom: '20px' }}>
                <button 
                    onClick={sessionId ? disconnect : connect}
                    style={{
                        padding: '12px 25px',
                        backgroundColor: sessionId ? '#dc3545' : '#28a745',
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
                    {sessionId ? '🔌 Disconnect' : '🔗 Connect'}
                </button>
                
                {sessionId && (
                    <>
                        <button 
                            onClick={connectServices}
                            style={{
                                padding: '12px 25px',
                                backgroundColor: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                marginRight: '10px'
                            }}
                            disabled={sttStatus === 'connected' && llmStatus === 'connected'}
                        >
                            🔗 Connect Services
                        </button>
                        
                        <button 
                            onClick={startTranscription}
                            style={{
                                padding: '12px 25px',
                                backgroundColor: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                marginRight: '10px'
                            }}
                            disabled={sttStatus !== 'connected'}
                        >
                            🎤 Start
                        </button>
                        
                        <button 
                            onClick={stopTranscription}
                            style={{
                                padding: '12px 25px',
                                backgroundColor: '#fd7e14',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                marginRight: '10px'
                            }}
                            disabled={sttStatus !== 'connected'}
                        >
                            ⏹️ Stop
                        </button>
                        
                        <button 
                            onClick={sendManualMessage}
                            style={{
                                padding: '12px 25px',
                                backgroundColor: '#6f42c1',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                marginRight: '10px'
                            }}
                            disabled={sttStatus !== 'connected'}
                        >
                            ✍️ Manual Message
                        </button>
                        
                        <button 
                            onClick={clearConversation}
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
                            🗑️ Clear
                        </button>
                    </>
                )}
                
                <div style={{ 
                    marginTop: '15px', 
                    padding: '10px', 
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    fontStyle: 'italic'
                }}>
                    Status: {overallStatus}
                </div>
            </div>

            {/* Conversation Display */}
            <div style={{ 
                padding: '20px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px',
                marginBottom: '20px'
            }}>
                <h4>Live Conversation</h4>
                
                {/* Current Transcription */}
                {currentTranscription && (
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
                            "{currentTranscription}"
                        </div>
                    </div>
                )}

                {/* Conversation History */}
                <div>
                    <strong>Conversation History:</strong>
                    <div 
                        ref={conversationRef}
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
                        {conversationHistory.length === 0 ? (
                            <div style={{ color: '#6c757d', fontStyle: 'italic' }}>
                                No conversation yet. Connect and start talking to begin.
                            </div>
                        ) : (
                            conversationHistory.map((item, index) => (
                                <div 
                                    key={index}
                                    style={{
                                        padding: '12px',
                                        borderBottom: '1px solid #e9ecef',
                                        marginBottom: '8px',
                                        backgroundColor: item.type === 'assistant' ? '#f8f9ff' : '#fff8f0',
                                        borderLeft: `4px solid ${item.type === 'assistant' ? '#007bff' : '#ffc107'}`,
                                        borderRadius: '4px'
                                    }}
                                >
                                    <div style={{ 
                                        fontSize: '14px', 
                                        fontWeight: 'bold',
                                        color: item.type === 'assistant' ? '#007bff' : '#856404',
                                        marginBottom: '4px'
                                    }}>
                                        {item.type === 'assistant' ? '🤖 AI Assistant' : '👤 You'}
                                        {item.manual && <span style={{ color: '#6c757d' }}> (manual)</span>}
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

            {/* Instructions */}
            <div style={{ 
                padding: '15px', 
                backgroundColor: '#e7f3ff',
                border: '1px solid #b3d9ff',
                borderRadius: '8px'
            }}>
                <h4>📋 Instructions:</h4>
                <ol>
                    <li>Make sure your STT server is running: <code>node stt-server.js</code></li>
                    <li>Make sure your LLM gateway is running and accessible</li>
                    <li>Click "Connect" to establish the conversation session</li>
                    <li>Click "Connect Services" to connect to both STT and LLM</li>
                    <li>Click "Start" to begin voice transcription</li>
                    <li>Speak naturally - your speech will be transcribed and automatically sent to the LLM</li>
                    <li>See the AI responses in real-time</li>
                    <li>Use "Manual Message" to send text directly to the LLM</li>
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
                        <li><strong>STT Integration:</strong> Configured speech-to-text server connection</li>
                        <li><strong>LLM Gateway:</strong> Configured language model gateway connection</li>
                        <li><strong>Auto-reconnect:</strong> STT service will attempt to reconnect if connection is lost</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}