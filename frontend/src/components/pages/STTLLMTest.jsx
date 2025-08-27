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
    
    const sttWsRef = useRef(null);
    const llmWsRef = useRef(null);
    const conversationRef = useRef(null);

    // Delay statistics
    const [delayStats, setDelayStats] = useState({
        totalRequests: 0,
        averageDelay: 0,
        minDelay: 0,
        maxDelay: 0,
        recentDelays: []
    });
    const [lastDelay, setLastDelay] = useState(null);

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

    const connectSTT = async () => {
        if (!networkConfig) {
            setOverallStatus('❌ Network configuration not loaded');
            return;
        }

        try {
            setOverallStatus('🔗 Connecting to STT server...');
            
            // Close existing STT connection if any
            if (sttWsRef.current) {
                sttWsRef.current.close();
            }
            
            const sttUrl = networkConfig.stt.defaultUrl;
            console.log('Connecting to STT server at:', sttUrl);
            sttWsRef.current = new WebSocket(sttUrl);
            
            const timeout = setTimeout(() => {
                if (sttWsRef.current && sttWsRef.current.readyState === WebSocket.CONNECTING) {
                    sttWsRef.current.close();
                    setOverallStatus('❌ STT connection timeout');
                }
            }, 10000);
            
            sttWsRef.current.onopen = () => {
                clearTimeout(timeout);
                console.log('STT WebSocket connected successfully');
                setSTTStatus('connected');
                setOverallStatus('✅ STT connected - Ready to start transcription');
                
                // Auto-connect to LLM if enabled
                if (autoStart) {
                    console.log('Auto-connecting to LLM services...');
                    setTimeout(() => {
                        connectLLM();
                    }, 500);
                }
            };
            
            sttWsRef.current.onmessage = (event) => {
                try {
                    console.log('STT message received:', event.data);
                    const data = JSON.parse(event.data);
                    handleSTTMessage(data);
                } catch (error) {
                    console.error('Failed to parse STT message:', error, 'Raw data:', event.data);
                }
            };
            
            sttWsRef.current.onerror = (error) => {
                clearTimeout(timeout);
                console.error('STT WebSocket error:', error);
                setOverallStatus('❌ STT connection error');
                setSTTStatus('error');
            };
            
            sttWsRef.current.onclose = (event) => {
                clearTimeout(timeout);
                console.log('STT WebSocket closed:', event.code, event.reason);
                setSTTStatus('disconnected');
                
                if (event.code === 1006) {
                    setOverallStatus('❌ STT connection lost - server may be down');
                } else if (event.wasClean) {
                    setOverallStatus('🔌 STT disconnected');
                } else {
                    setOverallStatus('❌ STT connection interrupted');
                }
            };
            
        } catch (error) {
            console.error('Failed to connect to STT:', error);
            setOverallStatus('❌ Failed to connect to STT: ' + error.message);
            setSTTStatus('error');
        }
    };

    const connectLLM = async () => {
        if (!networkConfig) {
            setOverallStatus('❌ Network configuration not loaded');
            return;
        }

        try {
            setOverallStatus('🔗 Connecting to LLM gateway...');
            
            // Close existing LLM connection if any
            if (llmWsRef.current) {
                llmWsRef.current.close();
            }
            
            const llmUrl = networkConfig.llm.defaultUrl;
            console.log('Connecting to LLM gateway at:', llmUrl);
            llmWsRef.current = new WebSocket(llmUrl);
            
            const timeout = setTimeout(() => {
                if (llmWsRef.current && llmWsRef.current.readyState === WebSocket.CONNECTING) {
                    llmWsRef.current.close();
                    setOverallStatus('❌ LLM connection timeout');
                }
            }, 10000);
            
            llmWsRef.current.onopen = () => {
                clearTimeout(timeout);
                console.log('LLM WebSocket connected successfully');
                setLLMStatus('connected');
                setOverallStatus('🤖 LLM connected - Ready for conversation');
                
                // Auto-start transcription if both services are connected
                if (sttStatus === 'connected' && autoStart) {
                    setTimeout(() => {
                        console.log('Auto-starting transcription...');
                        startTranscription();
                    }, 500);
                }
            };
            
            llmWsRef.current.onmessage = (event) => {
                try {
                    console.log('LLM message received:', event.data);
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'llm_message') {
                        handleLLMMessage(data.data);
                    } else if (data.type === 'delay_measurement') {
                        handleDelayMeasurement(data);
                    } else if (data.type === 'delay_stats') {
                        setDelayStats(data.stats);
                    } else {
                        handleLLMMessage(data);
                    }
                } catch (error) {
                    console.error('Failed to parse LLM message:', error, 'Raw data:', event.data);
                }
            };
            
            llmWsRef.current.onerror = (error) => {
                clearTimeout(timeout);
                console.error('LLM WebSocket error:', error);
                setOverallStatus('❌ LLM connection error');
                setLLMStatus('error');
            };
            
            llmWsRef.current.onclose = (event) => {
                clearTimeout(timeout);
                console.log('LLM WebSocket closed:', event.code, event.reason);
                setLLMStatus('disconnected');
                
                if (event.code === 1006) {
                    setOverallStatus('❌ LLM connection lost - server may be down');
                } else if (event.wasClean) {
                    setOverallStatus('🔌 LLM disconnected');
                } else {
                    setOverallStatus('❌ LLM connection interrupted');
                }
            };
            
        } catch (error) {
            console.error('Failed to connect to LLM:', error);
            setOverallStatus('❌ Failed to connect to LLM: ' + error.message);
            setLLMStatus('error');
        }
    };

    const connect = async () => {
        // Generate a simple session ID for tracking
        const newSessionId = Math.random().toString(36).substr(2, 9);
        setSessionId(newSessionId);
        
        // Connect to STT first
        await connectSTT();
    };

    const handleSTTMessage = (data) => {
        console.log('🎤 Processing STT data:', data.type, data);
        
        switch(data.type) {
            case 'partial':
                setCurrentTranscription(data.text || '');
                setOverallStatus('🎤 Listening... (partial result)');
                break;
                
            case 'complete':
                if (data.text && data.text.trim()) {
                    console.log('✅ Complete transcription:', data.text);
                    const timestamp = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
                    setConversationHistory(prev => [...prev, {
                        text: data.text,
                        timestamp: timestamp,
                        confidence: data.confidence,
                        type: 'user'
                    }]);
                    setCurrentTranscription('');
                    setOverallStatus('✅ Transcription complete - sending to AI');
                    
                    // Automatically send to LLM
                    sendToLLM(data.text.trim());
                }
                break;
                
            case 'status':
                console.log('📡 STT Status update:', data.status, data.details);
                switch(data.status) {
                    case 'started':
                        setOverallStatus('🎤 STT started - listening for speech');
                        break;
                    case 'stopped':
                        setOverallStatus('⏹️ STT stopped');
                        break;
                    case 'connected':
                        setOverallStatus('✅ STT connected');
                        break;
                    default:
                        setOverallStatus(`📡 STT Status: ${data.status}`);
                }
                break;

            case 'error':
                console.error('❌ STT Error:', data.error);
                setOverallStatus('❌ STT Error: ' + data.error);
                break;
                
            default:
                console.warn('⚠️ Unknown STT message type:', data.type, data);
        }
    };

    const handleLLMMessage = (data) => {
        console.log('🤖 Processing LLM data:', data);
        
        if (data.action === 'completion') {
            if (data.content && data.content.trim()) {
                console.log('✅ LLM response received:', data.content);
                const timestamp = new Date().toLocaleTimeString();
                setConversationHistory(prev => [...prev, {
                    text: data.content,
                    timestamp: timestamp,
                    type: 'assistant'
                }]);
                setOverallStatus('🤖 AI responded - Ready for your next input');
            }
        } else if (data.content) {
            // Handle streaming or partial responses
            setLLMResponse(prev => prev + (data.content || ''));
            setOverallStatus('🤖 AI is responding...');
        } else if (data.error) {
            console.error('❌ LLM Error:', data.error);
            setOverallStatus('❌ LLM Error: ' + data.error);
        } else {
            console.log('🤖 Other LLM message:', data);
        }
    };

    const handleDelayMeasurement = (data) => {
        console.log('⏱️ Delay measurement:', data);
        setLastDelay(data.delay);
        setDelayStats(data.stats);
        
        // Update status with delay info
        setOverallStatus(`🤖 AI responded in ${data.delay}ms - Ready for your next input`);
    };

    const sendToLLM = (message) => {
        if (llmWsRef.current && llmWsRef.current.readyState === WebSocket.OPEN) {
            console.log('✍️ Sending message to LLM:', message);
            
            // Use the format expected by AWS API Gateway
            const llmPayload = {
                action: 'completion',
                history: [
                    ...conversationHistory.slice(-8), // Keep last 8 messages for context
                    { role: 'user', content: message }
                ]
            };
            
            llmWsRef.current.send(JSON.stringify(llmPayload));
            setOverallStatus('✍️ Message sent to AI - waiting for response');
        } else {
            console.error('❌ Cannot send to LLM - not connected');
            setOverallStatus('❌ Cannot send to LLM - not connected');
        }
    };

    const startTranscription = () => {
        if (!sttWsRef.current || sttWsRef.current.readyState !== WebSocket.OPEN) {
            setOverallStatus('❌ Not connected to STT server');
            return;
        }
        
        try {
            console.log('🎤 Starting transcription...');
            sttWsRef.current.send(JSON.stringify({ action: 'start' }));
            setOverallStatus('🎤 Started listening - speak now');
        } catch (error) {
            console.error('Failed to start transcription:', error);
            setOverallStatus('❌ Failed to start transcription');
        }
    };

    const stopTranscription = () => {
        if (!sttWsRef.current || sttWsRef.current.readyState !== WebSocket.OPEN) {
            return;
        }
        
        try {
            console.log('⏹️ Stopping transcription...');
            sttWsRef.current.send(JSON.stringify({ action: 'stop' }));
            setOverallStatus('⏹️ Stopped listening');
            setCurrentTranscription('');
        } catch (error) {
            console.error('Failed to stop transcription:', error);
            setOverallStatus('❌ Failed to stop transcription');
        }
    };

    const connectServices = () => {
        if (sttStatus !== 'connected') {
            connectSTT();
        }
        if (llmStatus !== 'connected') {
            connectLLM();
        }
        setOverallStatus('🔗 Connecting services...');
    };

    const sendManualMessage = () => {
        const message = prompt('Enter message to send to LLM:');
        if (message && message.trim()) {
            // Add to conversation history
            const timestamp = new Date().toLocaleTimeString();
            setConversationHistory(prev => [...prev, {
                text: message.trim(),
                timestamp: timestamp,
                type: 'user',
                manual: true
            }]);
            
            // Send to LLM
            sendToLLM(message.trim());
        }
    };

    const disconnect = () => {
        console.log('🔌 Disconnecting...');
        
        // Close STT connection
        if (sttWsRef.current) {
            sttWsRef.current.close();
            sttWsRef.current = null;
        }
        
        // Close LLM connection
        if (llmWsRef.current) {
            llmWsRef.current.close();
            llmWsRef.current = null;
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

    const requestDelayStats = () => {
        if (llmWsRef.current && llmWsRef.current.readyState === WebSocket.OPEN) {
            llmWsRef.current.send(JSON.stringify({ action: 'get_delay_stats' }));
        }
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
            <h2>🎙️💬 STT+LLM Conversation Test (Direct Connection)</h2>
            
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
                        <span>Auto-connect and start services when session connects</span>
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
                            disabled={llmStatus !== 'connected'}
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

            {/* Delay Statistics */}
            <div style={{ 
                marginTop: '15px', 
                padding: '15px', 
                backgroundColor: '#e7f3ff',
                border: '1px solid #b3d9ff',
                borderRadius: '8px'
            }}>
                <h4>⏱️ Response Time Metrics:</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                        <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#007bff' }}>
                            {lastDelay ? `${lastDelay}ms` : '--'}
                        </div>
                        <div style={{ fontSize: '0.9em', color: '#666' }}>Last Response</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                        <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#28a745' }}>
                            {delayStats.averageDelay ? `${Math.round(delayStats.averageDelay)}ms` : '--'}
                        </div>
                        <div style={{ fontSize: '0.9em', color: '#666' }}>Average</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                        <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#ffc107' }}>
                            {delayStats.minDelay !== Infinity ? `${delayStats.minDelay}ms` : '--'}
                        </div>
                        <div style={{ fontSize: '0.9em', color: '#666' }}>Min</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                        <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#dc3545' }}>
                            {delayStats.maxDelay ? `${delayStats.maxDelay}ms` : '--'}
                        </div>
                        <div style={{ fontSize: '0.9em', color: '#666' }}>Max</div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                        <div style={{ fontSize: '1.2em', fontWeight: 'bold', color: '#6f42c1' }}>
                            {delayStats.totalRequests || 0}
                        </div>
                        <div style={{ fontSize: '0.9em', color: '#666' }}>Total Requests</div>
                    </div>
                </div>
                
                {delayStats.recentDelays && delayStats.recentDelays.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        <strong>Recent Response Times:</strong>
                        <div style={{ 
                            marginTop: '5px', 
                            fontFamily: 'monospace', 
                            fontSize: '12px',
                            backgroundColor: '#f8f9fa',
                            padding: '5px',
                            borderRadius: '4px'
                        }}>
                            {delayStats.recentDelays.map((delay, idx) => (
                                <span key={idx} style={{ 
                                    marginRight: '8px',
                                    color: delay < 1000 ? '#28a745' : delay < 3000 ? '#ffc107' : '#dc3545'
                                }}>
                                    {delay}ms
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                
                <button 
                    onClick={requestDelayStats}
                    style={{
                        marginTop: '10px',
                        padding: '8px 16px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px'
                    }}
                    disabled={llmStatus !== 'connected'}
                >
                    🔄 Refresh Stats
                </button>
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