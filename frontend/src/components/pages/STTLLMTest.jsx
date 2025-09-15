import { useState, useEffect, useRef } from 'react';
import robotAPI from '../../utils/robotAPI';

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

    // Add client-side delay tracking
    const [pendingRequests, setPendingRequests] = useState(new Map());
    const sttCompleteTimeRef = useRef(null);

    // Add state for LLM chunk processor
    const [sendToRobot, setSendToRobot] = useState(true);
    const [targetRobot, setTargetRobot] = useState('Haku');
    const [chunkConfig, setChunkConfig] = useState(null);

    // Add state for buffer management
    const [bufferStatus, setBufferStatus] = useState(null);
    const [currentLLMSession, setCurrentLLMSession] = useState(null);

    // Add session ID tracking
    const sessionIdRef = useRef(null);
    const isFirstChunkRef = useRef(new Set()); // Track which sessions are expecting their first chunk

    // Add turn-taking state tracking
    const [turnTakingViolations, setTurnTakingViolations] = useState([]);
    const [robotSpeaking, setRobotSpeaking] = useState(false);
    const [llmActive, setLLMActive] = useState(false);

    // Add comprehensive robot status tracking
    const [robotStatus, setRobotStatus] = useState({
        connected: false,
        speaking: false,
        listening: false,
        moving: false,
        battery_level: null,
        current_behavior: 'idle',
        connection_quality: null,
        face_detected: false,
        stt_buffer_state: 'ready',
        last_heartbeat: null,
        error_count: 0
    });
    
    // Add STT detailed status tracking
    const [sttDetailedStatus, setSTTDetailedStatus] = useState({
        status: 'disconnected',
        transcribing: false,
        lastTranscription: null,
        errorCount: 0,
        sessionsActive: 0
    });

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

        // Set up WebSocket connection for robot status updates
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.host;
        const statusWs = new WebSocket(`${wsProtocol}//${wsHost}/websocket`);
        
        statusWs.onopen = () => {
            console.log('📡 Connected to status WebSocket');
        };
        
        statusWs.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Handle robot status updates
                if (data.type === 'robot-status-update') {
                    if (data.robot === targetRobot) {
                        console.log(`🔄 Robot ${data.robot} ${data.field}: ${data.value}`);
                        
                        // Update specific robot status field
                        setRobotStatus(prevStatus => ({
                            ...prevStatus,
                            [data.field]: data.value,
                            connected: true,
                            last_heartbeat: new Date().toISOString()
                        }));
                        
                        // Legacy speaking state for backward compatibility
                        if (data.field === 'speaking') {
                            setRobotSpeaking(data.value);
                        }
                    }
                }
                
                // Handle turn-taking violations
                if (data.type === 'turn-taking-violation') {
                    console.error('🚨 Turn-taking violation received:', data);
                    setTurnTakingViolations(prev => [...prev, {
                        type: data.violationType,
                        robot: data.robot,
                        sessionId: data.sessionId,
                        message: data.message,
                        timestamp: data.timestamp
                    }]);
                    
                    // Update status to show violation
                    setOverallStatus(`🚨 Turn-taking violation: ${data.violationType}`);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };
        
        statusWs.onclose = () => {
            console.log('📡 Status WebSocket disconnected');
        };

        // Generate session ID when component mounts or when starting new conversation
        sessionIdRef.current = `stt-llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('Generated session ID:', sessionIdRef.current);
        
        // Mark this session as expecting its first chunk
        isFirstChunkRef.current.add(sessionIdRef.current);

        return () => {
            disconnect();
            statusWs.close();
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
                setSTTDetailedStatus(prev => ({
                    ...prev,
                    status: 'connected',
                    errorCount: 0
                }));
                setOverallStatus('✅ STT connected - Ready to start transcription');
                
                // Send resume command immediately after connection
                console.log('📤 Sending resume command to STT server...');
                sttWsRef.current.send(JSON.stringify({
                    type: 'control',
                    action: 'resume',
                    timestamp: Date.now()
                }));
                
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
                setSTTDetailedStatus(prev => ({
                    ...prev,
                    status: 'disconnected',
                    transcribing: false
                }));
                
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
        sessionIdRef.current = newSessionId;
        
        // Mark this session as expecting its first chunk
        isFirstChunkRef.current.add(newSessionId);
        
        // Connect to STT first
        await connectSTT();
    };

    const handleSTTMessage = (data) => {
        console.log('🎤 Processing STT data:', data.type, data);
        
        switch(data.type) {
            case 'partial':
                // Check turn-taking rules before processing
                if (robotSpeaking) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT partial while robot is speaking!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: 'stt_partial_while_robot_speaking',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return; // Ignore the message
                }
                
                if (llmActive) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT partial while LLM is active!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: 'stt_partial_while_llm_active',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return; // Ignore the message
                }
                
                setCurrentTranscription(data.text || '');
                setSTTDetailedStatus(prev => ({
                    ...prev,
                    transcribing: true,
                    lastTranscription: data.text
                }));
                setOverallStatus('🎤 Listening... (partial result)');
                break;
                
            case 'complete':
                // Check turn-taking rules before processing
                if (robotSpeaking) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT complete while robot is speaking!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: 'stt_complete_while_robot_speaking',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return; // Ignore the message
                }
                
                if (llmActive) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT complete while LLM is active!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: 'stt_complete_while_llm_active',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return; // Ignore the message
                }
                
                if (data.text && data.text.trim()) {
                    console.log('✅ Complete transcription:', data.text);
                    setSTTDetailedStatus(prev => ({
                        ...prev,
                        transcribing: false,
                        lastTranscription: data.text
                    }));
                    
                    // Record STT complete time for delay measurement
                    sttCompleteTimeRef.current = Date.now();
                    
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
                    sendToLLM(data.text);
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

    const updateDelayStats = (delay) => {
        setLastDelay(delay);
        setDelayStats(prevStats => {
            const newTotalRequests = prevStats.totalRequests + 1;
            const newAverageDelay = ((prevStats.averageDelay * prevStats.totalRequests) + delay) / newTotalRequests;
            const newMinDelay = prevStats.minDelay === 0 ? delay : Math.min(prevStats.minDelay, delay);
            const newMaxDelay = Math.max(prevStats.maxDelay, delay);
            const newRecentDelays = [...prevStats.recentDelays, delay].slice(-10);

            return {
                totalRequests: newTotalRequests,
                averageDelay: newAverageDelay,
                minDelay: newMinDelay,
                maxDelay: newMaxDelay,
                recentDelays: newRecentDelays
            };
        });
    };

    const handleDelayMeasurement = (data) => {
        console.log('Received delay measurement from server:', data);
        if (data.delay) {
            updateDelayStats(data.delay);
        }
    };

    // Track LLM session ID from responses
    const handleLLMMessage = (data) => {
        console.log('🤖 Processing LLM data:', data);
        
        if (data.action === 'completion') {
            // Check if this is the first response chunk with content
            if (data.content && sttCompleteTimeRef.current) {
                const responseTime = Date.now();
                const delay = responseTime - sttCompleteTimeRef.current;
                
                console.log(`⏱️ STT→LLM delay: ${delay}ms`);
                
                // Update delay statistics
                updateDelayStats(delay);
                
                // Clear the STT complete time since we've measured the delay
                sttCompleteTimeRef.current = null;
            }
            
            if (data.content) {
                console.log('✅ LLM response received:', data.content);
                const timestamp = new Date().toLocaleTimeString();
                
                // Track LLM state
                if (!data.isFinished) {
                    setLLMActive(true);
                }
                
                // Check if this is the first chunk for this session
                const sessionId = data.sessionId || sessionIdRef.current;
                const isFirstChunk = isFirstChunkRef.current.has(sessionId);
                
                // Send to robot if enabled - use Robot API directly with session ID
                if (sendToRobot && data.content) {
                    sendLLMResponseToRobot(data.content, data.isFinished, sessionId, isFirstChunk, data.chunkNumber);
                    
                    // Remove from first chunk tracking after sending
                    if (isFirstChunk) {
                        isFirstChunkRef.current.delete(sessionId);
                    }
                }
                
                setConversationHistory(prev => {
                    // Check if the last item is an accumulating assistant message
                    const lastItem = prev[prev.length - 1];
                    
                    if (lastItem && lastItem.type === 'assistant' && lastItem.accumulating) {
                        // Update the existing accumulating message
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                            ...lastItem,
                            text: lastItem.text + data.content,
                            accumulating: !data.isFinished
                        };
                        return updated;
                    } else {
                        // Create a new assistant message entry
                        return [...prev, {
                            text: data.content,
                            timestamp: timestamp,
                            type: 'assistant',
                            accumulating: !data.isFinished
                        }];
                    }
                });
                
                if (data.isFinished) {
                    setLLMActive(false);
                    setOverallStatus('🤖 AI responded - Ready for your next input');
                    // Send final chunk marker with session ID
                    if (sendToRobot) {
                        sendLLMResponseToRobot('', true, data.sessionId || sessionIdRef.current, false, null);
                        // Flush any remaining buffer content
                        flushBuffer(data.sessionId || sessionIdRef.current);
                    }
                } else {
                    setOverallStatus('🤖 AI is responding...');
                }
            }
        } else if (data.content) {
            // Handle other response formats - create new entry for each response
            const timestamp = new Date().toLocaleTimeString();
            
            // Track LLM state
            setLLMActive(true);
            
            // Send to robot if enabled with session ID
            if (sendToRobot && data.content) {
                sendLLMResponseToRobot(data.content, true, sessionIdRef.current, false, null); // Assume single chunk responses are finished
                setLLMActive(false);
            }
            
            setConversationHistory(prev => [...prev, {
                text: data.content,
                timestamp: timestamp,
                type: 'assistant',
                accumulating: false
            }]);
            setLLMResponse(prev => prev + (data.content || ''));
            setOverallStatus('🤖 AI responded - Ready for your next input');
        } else if (data.error) {
            console.error('❌ LLM Error:', data.error);
            setOverallStatus('❌ LLM Error: ' + data.error);
            setLLMActive(false);
        } else {
            console.log('🤖 Other LLM message:', data);
        }
    };

    // Updated function to include session ID and turn-taking
    const sendLLMResponseToRobot = async (content, isFinished = false, sessionId = null, isFirstChunk = false, chunkNumber = null) => {
        if (!sendToRobot || !targetRobot) {
            console.log('🤖 Robot integration disabled or no target robot selected');
            return;
        }

        try {
            const effectiveSessionId = sessionId || sessionIdRef.current;
            console.log(`🤖 Sending LLM response to robot ${targetRobot} via Robot API (session: ${effectiveSessionId}):`, content);
            console.log(`🤖 Response chunk finished: ${isFinished}, isFirstChunk: ${isFirstChunk}, chunkNumber: ${chunkNumber}`);
            
            // Use Robot API conversation endpoint with turn-taking support
            const result = await robotAPI.sendConversationResponse(content, targetRobot, effectiveSessionId, isFinished, isFirstChunk, chunkNumber);
            
            if (result.success) {
                console.log(`✅ LLM response sent to robot ${targetRobot} successfully`);
                setOverallStatus(prev => prev + ' (sent to robot)');
            } else {
                console.warn(`⚠️ LLM response queued for robot ${targetRobot}:`, result.message);
                setOverallStatus(prev => prev + ' (queued for robot)');
            }
            
            // Log turn-taking state
            if (result.llmActive !== undefined) {
                console.log(`🔄 LLM session active: ${result.llmActive}`);
            }
        } catch (error) {
            console.error(`❌ Failed to send LLM response to robot ${targetRobot}:`, error);
            setOverallStatus(prev => prev + ' (robot send failed)');
        }
    };

    const sendToLLM = (message) => {
        if (llmWsRef.current && llmWsRef.current.readyState === WebSocket.OPEN) {
            console.log('✍️ Sending message to LLM:', message);
            
            // Record send time if this is from STT
            if (!sttCompleteTimeRef.current) {
                sttCompleteTimeRef.current = Date.now();
            }
            
            // Use the format expected by AWS API Gateway
            const llmPayload = {
                action: 'completion',
                history: [
                    // Map conversation history to the correct format
                    ...conversationHistory.slice(-8).map(item => ({
                        role: item.type === 'user' ? 'user' : 'assistant',
                        content: item.text
                    })),
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
            
            // Clear STT complete time for manual messages
            sttCompleteTimeRef.current = Date.now();
            
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
        // Reset delay stats
        setDelayStats({
            totalRequests: 0,
            averageDelay: 0,
            minDelay: 0,
            maxDelay: 0,
            recentDelays: []
        });
        setLastDelay(null);
        sttCompleteTimeRef.current = null;
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

    // Buffer management functions
    const flushBuffer = async (sessionId) => {
        const a_sessionId = sessionId || currentLLMSession;
        if (!a_sessionId) {
            console.warn('Cannot flush buffer, no session ID available');
            return;
        }

        try {
            console.log(`Flushing remaining buffer for session: ${a_sessionId}`);
            const response = await fetch(`/api/robot-buffer/flush-remaining/${a_sessionId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetRobot: targetRobot })
            });
            const result = await response.json();
            if (result.success) {
                console.log('Buffer flushed successfully:', result);
                setOverallStatus(prev => prev + ' (buffer flushed)');
            } else {
                console.warn('Failed to flush buffer:', result);
                setOverallStatus(prev => prev + ' (buffer flush failed)');
            }
        } catch (error) {
            console.error('Error flushing buffer:', error);
            setOverallStatus(prev => prev + ' (buffer flush error)');
        }
    };

    const clearBuffer = async () => {
        if (!currentLLMSession) {
            setOverallStatus('❌ No active LLM session to clear');
            return;
        }

        try {
            console.log('🗑️ Clearing buffer for session:', currentLLMSession);
            const result = await robotAPI.clearBuffer(currentLLMSession);
            
            if (result.success) {
                setOverallStatus(`✅ Buffer cleared: ${result.message}`);
                updateBufferStatus();
            } else {
                setOverallStatus(`❌ Clear failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Failed to clear buffer:', error);
            setOverallStatus('❌ Failed to clear buffer');
        }
    };

    const forceProcessBuffer = async () => {
        if (!currentLLMSession) {
            setOverallStatus('❌ No active LLM session to process');
            return;
        }

        try {
            console.log('⚡ Force processing buffer for session:', currentLLMSession);
            const result = await robotAPI.forceProcessBuffer(currentLLMSession, targetRobot);
            
            if (result.success) {
                setOverallStatus(`✅ Force processed: ${result.message}`);
                updateBufferStatus();
            } else {
                setOverallStatus(`❌ Force process failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Failed to force process buffer:', error);
            setOverallStatus('❌ Failed to force process buffer');
        }
    };

    const updateBufferStatus = async () => {
        if (!currentLLMSession) return;

        try {
            const status = await robotAPI.getBufferStatus(currentLLMSession);
            setBufferStatus(status);
        } catch (error) {
            console.error('Failed to get buffer status:', error);
        }
    };

    // Update buffer status periodically when session is active
    useEffect(() => {
        if (currentLLMSession) {
            const interval = setInterval(updateBufferStatus, 2000);
            return () => clearInterval(interval);
        }
    }, [currentLLMSession]);

    const getBooleanStatusColor = (value) => {
        return value ? '#28a745' : '#6c757d';
    };

    const formatStatusValue = (value, field) => {
        if (value === null || value === undefined) return 'Unknown';
        
        switch(field) {
            case 'battery_level':
            case 'cpu_usage':
            case 'memory_usage':
            case 'connection_quality':
                return `${value}%`;
            case 'temperature':
                return `${value}°C`;
            case 'last_heartbeat': {
                if (!value) return 'None';
                const timeDiff = new Date() - new Date(value);
                return timeDiff < 5000 ? 'Live' : `${Math.round(timeDiff/1000)}s ago`;
            }
            default:
                return value.toString();
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
            <h2>Haku Conversation</h2>
            
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

            {/* Live Status Indicators */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa', 
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4 style={{ marginBottom: '15px', color: '#495057' }}>🔴 Live Status</h4>
                
                {/* Robot Status */}
                <div style={{ marginBottom: '15px' }}>
                    <h5 style={{ marginBottom: '10px', color: '#495057' }}>🤖 Robot: {targetRobot}</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Connection</div>
                            <div style={{ 
                                color: getBooleanStatusColor(robotStatus.connected), 
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {robotStatus.connected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Speaking</div>
                            <div style={{ 
                                color: getBooleanStatusColor(robotStatus.speaking), 
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {robotStatus.speaking ? '🔊 SPEAKING' : '🔇 SILENT'}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Listening</div>
                            <div style={{ 
                                color: getBooleanStatusColor(robotStatus.listening), 
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {robotStatus.listening ? '👂 LISTENING' : '🚫 NOT LISTENING'}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Behavior</div>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#495057' }}>
                                {robotStatus.current_behavior?.toUpperCase() || 'UNKNOWN'}
                            </div>
                        </div>
                        
                        {robotStatus.battery_level !== null && (
                            <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                                <div style={{ fontSize: '12px', color: '#6c757d' }}>Battery</div>
                                <div style={{ 
                                    color: robotStatus.battery_level > 30 ? '#28a745' : robotStatus.battery_level > 20 ? '#ffc107' : '#dc3545',
                                    fontWeight: 'bold', 
                                    fontSize: '14px' 
                                }}>
                                    🔋 {formatStatusValue(robotStatus.battery_level, 'battery_level')}
                                </div>
                            </div>
                        )}
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>STT Buffer</div>
                            <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#495057' }}>
                                {robotStatus.stt_buffer_state?.toUpperCase() || 'UNKNOWN'}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Heartbeat</div>
                            <div style={{ 
                                color: robotStatus.last_heartbeat && (new Date() - new Date(robotStatus.last_heartbeat)) < 10000 ? '#28a745' : '#dc3545',
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {formatStatusValue(robotStatus.last_heartbeat, 'last_heartbeat')}
                            </div>
                        </div>
                        
                        {robotStatus.face_detected !== null && (
                            <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                                <div style={{ fontSize: '12px', color: '#6c757d' }}>Face Detection</div>
                                <div style={{ 
                                    color: getBooleanStatusColor(robotStatus.face_detected), 
                                    fontWeight: 'bold', 
                                    fontSize: '14px' 
                                }}>
                                    {robotStatus.face_detected ? '👤 DETECTED' : '👻 NONE'}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                
                {/* STT Status */}
                <div>
                    <h5 style={{ marginBottom: '10px', color: '#495057' }}>🎤 STT Service</h5>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Connection</div>
                            <div style={{ 
                                color: getStatusColor(sttDetailedStatus.status), 
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {sttDetailedStatus.status.toUpperCase()}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Transcribing</div>
                            <div style={{ 
                                color: getBooleanStatusColor(sttDetailedStatus.transcribing), 
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {sttDetailedStatus.transcribing ? '📝 ACTIVE' : '⏸️ IDLE'}
                            </div>
                        </div>
                        
                        <div style={{ padding: '8px', backgroundColor: 'white', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            <div style={{ fontSize: '12px', color: '#6c757d' }}>Errors</div>
                            <div style={{ 
                                color: sttDetailedStatus.errorCount > 0 ? '#dc3545' : '#28a745',
                                fontWeight: 'bold', 
                                fontSize: '14px' 
                            }}>
                                {sttDetailedStatus.errorCount > 0 ? `❌ ${sttDetailedStatus.errorCount}` : '✅ 0'}
                            </div>
                        </div>
                        
                        {sttDetailedStatus.lastTranscription && (
                            <div style={{ 
                                padding: '8px', 
                                backgroundColor: 'white', 
                                borderRadius: '4px', 
                                border: '1px solid #dee2e6',
                                gridColumn: 'span 2'
                            }}>
                                <div style={{ fontSize: '12px', color: '#6c757d' }}>Last Transcription</div>
                                <div style={{ 
                                    fontSize: '14px', 
                                    color: '#495057',
                                    fontStyle: 'italic',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    &quot;{sttDetailedStatus.lastTranscription}&quot;
                                </div>
                            </div>
                        )}
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
                                        borderRadius: '4px',
                                        opacity: item.accumulating ? 0.8 : 1.0 // Slightly fade accumulating messages
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
                                        {item.accumulating && <span style={{ color: '#999', fontSize: '12px' }}> (streaming...)</span>}
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
                            {delayStats.minDelay && delayStats.minDelay !== Infinity ? `${delayStats.minDelay}ms` : '--'}
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
            </div>

            {/* Buffer Management Section */}
            {currentLLMSession && (
                <div style={{ 
                    marginBottom: '20px', 
                    padding: '15px', 
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px'
                }}>
                    <h4>🔧 Buffer Management</h4>
                    <p><strong>Session ID:</strong> {currentLLMSession}</p>
                    
                    {bufferStatus && bufferStatus.exists && (
                        <div style={{ marginBottom: '15px' }}>
                            <p><strong>Buffer Length:</strong> {bufferStatus.bufferLength} characters</p>
                            <p><strong>Chunk Mode:</strong> {bufferStatus.chunkMode}</p>
                            <p><strong>Target Robot:</strong> {bufferStatus.targetRobot}</p>
                            <p><strong>Is Empty:</strong> {bufferStatus.isEmpty ? 'Yes' : 'No'}</p>
                            {bufferStatus.bufferContent && (
                                <div style={{ 
                                    marginTop: '10px',
                                    padding: '10px',
                                    backgroundColor: '#e9ecef',
                                    borderRadius: '4px',
                                    fontFamily: 'monospace',
                                    fontSize: '12px'
                                }}>
                                    <strong>Buffer Content:</strong><br />
                                    "{bufferStatus.bufferContent}"
                                </div>
                            )}
                        </div>
                    )}
                    
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <button 
                            onClick={flushBuffer}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🚿 Flush Buffer
                        </button>
                        
                        <button 
                            onClick={clearBuffer}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🗑️ Clear Buffer
                        </button>
                        
                        <button 
                            onClick={forceProcessBuffer}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#fd7e14',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            ⚡ Force Process
                        </button>
                        
                        <button 
                            onClick={updateBufferStatus}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            🔄 Refresh Status
                        </button>
                    </div>
                </div>
            )}

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