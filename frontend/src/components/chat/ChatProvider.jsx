import { useState, useEffect, useRef } from 'react';
import robotAPI from '../../utils/robotAPI';
import { ChatContext } from './ChatContext';

export const ChatProvider = ({ children, targetRobot = 'Haku' }) => {
    // Core state
    const [sessionId, setSessionId] = useState('');
    const [sttStatus, setSTTStatus] = useState('disconnected');
    const [llmStatus, setLLMStatus] = useState('disconnected');
    const [conversationHistory, setConversationHistory] = useState([]);
    const [currentTranscription, setCurrentTranscription] = useState('');
    const [overallStatus, setOverallStatus] = useState('Ready to start conversation');
    
    // Configuration
    const [networkConfig, setNetworkConfig] = useState(null);
    const [autoStart, setAutoStart] = useState(true);
    const [sendToRobot, setSendToRobot] = useState(true);
    
    // Refs for WebSocket connections
    const sttWsRef = useRef(null);
    const llmWsRef = useRef(null);
    const conversationRef = useRef(null);
    const conversationHistoryRef = useRef([]);
    
    // Session tracking
    const sessionIdRef = useRef(null);
    const isFirstChunkRef = useRef(new Set());
    const pendingLLMRequestsRef = useRef(new Map());
    const LLM_DUPLICATE_WINDOW_MS = 5000;
    
    // Delay tracking
    const [delayStats, setDelayStats] = useState({
        totalRequests: 0,
        averageDelay: 0,
        minDelay: 0,
        maxDelay: 0,
        recentDelays: []
    });
    const [lastDelay, setLastDelay] = useState(null);
    const sttCompleteTimeRef = useRef(null);
    
    // Status tracking
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
    
    const [sttDetailedStatus, setSTTDetailedStatus] = useState({
        status: 'disconnected',
        transcribing: false,
        lastTranscription: null,
        errorCount: 0,
        sessionsActive: 0
    });
    
    // Turn-taking state
    const [turnTakingViolations, setTurnTakingViolations] = useState([]);
    const [robotSpeaking, setRobotSpeaking] = useState(false);
    const [llmActive, setLLMActive] = useState(false);
    
    // Buffer management
    const [bufferStatus] = useState(null);
    const [currentLLMSession, setCurrentLLMSession] = useState(null);
    
    // Debug information
    const [debugInfo, setDebugInfo] = useState({
        lastRequest: null,
        requestTimestamp: null,
        lastResponse: null,
        responseTimestamp: null
    });

    // Load configuration and setup WebSocket connection
    useEffect(() => {
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
                
                if (data.type === 'robot-status-update') {
                    if (data.robot === targetRobot) {
                        console.log(`🔄 Robot ${data.robot} ${data.field}: ${data.value}`);
                        
                        setRobotStatus(prevStatus => ({
                            ...prevStatus,
                            [data.field]: data.value,
                            connected: true,
                            last_heartbeat: new Date().toISOString()
                        }));
                        
                        if (data.field === 'speaking') {
                            setRobotSpeaking(data.value);
                        }
                    }
                }
                
                if (data.type === 'turn-taking-violation') {
                    console.error('🚨 Turn-taking violation received:', data);
                    setTurnTakingViolations(prev => [...prev, {
                        type: data.violationType,
                        robot: data.robot,
                        sessionId: data.sessionId,
                        message: data.message,
                        timestamp: data.timestamp
                    }]);
                    
                    setOverallStatus(`🚨 Turn-taking violation: ${data.violationType}`);
                }
            } catch (error) {
                console.error('Failed to parse WebSocket message:', error);
            }
        };
        
        statusWs.onclose = () => {
            console.log('📡 Status WebSocket disconnected');
        };

        // Generate session ID
        sessionIdRef.current = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.log('Generated session ID:', sessionIdRef.current);
        isFirstChunkRef.current.add(sessionIdRef.current);

        return () => {
            disconnect();
            statusWs.close();
        };
    }, [targetRobot]);

    // Keep ref synchronized with state
    useEffect(() => {
        conversationHistoryRef.current = conversationHistory;
    }, [conversationHistory]);

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

    const handleSTTMessage = (data) => {
        console.log('🎤 Processing STT data:', data.type, data);
        
        switch(data.type) {
            case 'partial':
                if (robotSpeaking || llmActive) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT while robot/LLM active!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: robotSpeaking ? 'stt_partial_while_robot_speaking' : 'stt_partial_while_llm_active',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return;
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
                if (robotSpeaking || llmActive) {
                    console.warn('⚠️ TURN-TAKING VIOLATION: Received STT complete while robot/LLM active!');
                    setTurnTakingViolations(prev => [...prev, {
                        type: robotSpeaking ? 'stt_complete_while_robot_speaking' : 'stt_complete_while_llm_active',
                        message: data.text?.substring(0, 50),
                        timestamp: Date.now()
                    }]);
                    return;
                }
                
                if (data.text && data.text.trim()) {
                    console.log('✅ Complete transcription:', data.text);
                    setSTTDetailedStatus(prev => ({
                        ...prev,
                        transcribing: false,
                        lastTranscription: data.text
                    }));
                    
                    sttCompleteTimeRef.current = Date.now();
                    
                    const timestamp = data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
                    
                    setConversationHistory(prev => {
                        const trimmed = (data.text || '').trim();
                        const last = prev[prev.length - 1];
                        if (last && last.type === 'user' && typeof last.text === 'string' && last.text.trim() === trimmed) {
                            console.log('🟡 Skipping duplicate user utterance in history');
                            return prev;
                        }
                        return [...prev, {
                            text: data.text,
                            timestamp: timestamp,
                            confidence: data.confidence,
                            type: 'user'
                        }];
                    });
                    
                    setCurrentTranscription('');
                    setOverallStatus('✅ Transcription complete - sending to AI');
                    
                    if (sendToRobot && targetRobot) {
                        sendUserInputToRobot(data.text, sessionIdRef.current);
                    }
                    
                    const historySnapshot = [
                        ...conversationHistoryRef.current,
                        { text: data.text, type: 'user', timestamp, confidence: data.confidence }
                    ];
                    sendToLLM(data.text, historySnapshot);
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
        }
    };

    const handleLLMMessage = (data) => {
        console.log('🤖 Processing LLM data:', data);
        
        setDebugInfo(prev => ({
            ...prev,
            lastResponse: data,
            responseTimestamp: new Date().toISOString()
        }));
        
        if (data.action === 'completion') {
            if (data.content && sttCompleteTimeRef.current) {
                const responseTime = Date.now();
                const delay = responseTime - sttCompleteTimeRef.current;
                
                console.log(`⏱️ STT→LLM delay: ${delay}ms`);
                updateDelayStats(delay);
                sttCompleteTimeRef.current = null;
            }
            
            if (data.content) {
                console.log('✅ LLM response received:', data.content);
                const timestamp = new Date().toLocaleTimeString();
                
                if (!data.isFinished) {
                    setLLMActive(true);
                }
                
                const sessionId = data.sessionId || sessionIdRef.current;
                const isFirstChunk = isFirstChunkRef.current.has(sessionId);
                
                if (sendToRobot && data.content) {
                    sendLLMResponseToRobot(data.content, data.isFinished, sessionId, isFirstChunk, data.chunkNumber);
                    
                    if (isFirstChunk) {
                        isFirstChunkRef.current.delete(sessionId);
                    }
                }
                
                setConversationHistory(prev => {
                    const lastItem = prev[prev.length - 1];
                    
                    if (lastItem && lastItem.type === 'assistant' && lastItem.accumulating) {
                        const updated = [...prev];
                        updated[updated.length - 1] = {
                            ...lastItem,
                            text: lastItem.text + data.content,
                            accumulating: !data.isFinished
                        };
                        return updated;
                    } else {
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
                    
                    if (sendToRobot) {
                        sendLLMResponseToRobot('', true, data.sessionId || sessionIdRef.current, false, null);
                        flushBuffer(data.sessionId || sessionIdRef.current);
                    }
                    
                    const sessionId = data.sessionId || sessionIdRef.current;
                    if (sessionId) {
                        for (const [hash, request] of pendingLLMRequestsRef.current.entries()) {
                            if (request.sessionId === sessionId) {
                                pendingLLMRequestsRef.current.delete(hash);
                                break;
                            }
                        }
                    }
                } else {
                    setOverallStatus('🤖 AI is responding...');
                }
            }
        } else if (data.content) {
            const timestamp = new Date().toLocaleTimeString();
            
            setLLMActive(true);
            
            if (sendToRobot && data.content) {
                sendLLMResponseToRobot(data.content, true, sessionIdRef.current, false, null);
                setLLMActive(false);
            }
            
            setConversationHistory(prev => [...prev, {
                text: data.content,
                timestamp: timestamp,
                type: 'assistant',
                accumulating: false
            }]);
            
            setOverallStatus('🤖 AI responded - Ready for your next input');
        } else if (data.error) {
            console.error('❌ LLM Error:', data.error);
            setOverallStatus('❌ LLM Error: ' + data.error);
            setLLMActive(false);
        }
    };

    const sendUserInputToRobot = async (content, sessionId = null) => {
        if (!sendToRobot || !targetRobot) {
            return;
        }

        try {
            const effectiveSessionId = sessionId || sessionIdRef.current;
            console.log(`👤 Sending user input to robot ${targetRobot}: "${content}"`);
            
            const broadcastMessage = JSON.stringify({
                type: 'llm-user-input',
                content: content,
                robot: targetRobot,
                sessionId: effectiveSessionId,
                timestamp: Date.now()
            });
            
            await robotAPI.sendMessage(broadcastMessage, targetRobot, 'broadcast', effectiveSessionId);
        } catch (error) {
            console.error(`Failed to send user input to robot ${targetRobot}:`, error);
        }
    };

    const sendLLMResponseToRobot = async (content, isFinished = false, sessionId = null, isFirstChunk = false, chunkNumber = null) => {
        if (!sendToRobot || !targetRobot) {
            return;
        }

        try {
            const effectiveSessionId = sessionId || sessionIdRef.current;
            console.log(`🤖 Sending LLM response to robot ${targetRobot}: finished=${isFinished}, firstChunk=${isFirstChunk}, chunk=${chunkNumber}`);
            
            await robotAPI.sendConversationResponse(
                content, 
                targetRobot, 
                effectiveSessionId, 
                isFinished, 
                isFirstChunk, 
                chunkNumber
            );
        } catch (error) {
            console.error(`Failed to send LLM response to robot ${targetRobot}:`, error);
        }
    };

    const sendToLLM = (message, historyOverride = null) => {
        if (!llmWsRef.current || llmWsRef.current.readyState !== WebSocket.OPEN) {
            console.error('LLM WebSocket not connected');
            setOverallStatus('❌ LLM not connected - cannot send message');
            return;
        }

        const messageHash = message.trim().toLowerCase();
        const now = Date.now();
        
        if (pendingLLMRequestsRef.current.has(messageHash)) {
            const existing = pendingLLMRequestsRef.current.get(messageHash);
            if (now - existing.timestamp < LLM_DUPLICATE_WINDOW_MS) {
                console.log('🟡 Skipping duplicate LLM request within window:', message);
                return;
            }
        }

        const effectiveSessionId = sessionIdRef.current;
        pendingLLMRequestsRef.current.set(messageHash, {
            timestamp: now,
            sessionId: effectiveSessionId
        });

        const historyToUse = historyOverride || conversationHistoryRef.current;
        
        const llmHistory = historyToUse.filter(item => 
            item.text && item.text.trim() && !item.accumulating
        ).map(item => ({
            role: item.type === 'assistant' ? 'assistant' : 'user',
            content: item.text.trim()
        }));

        const llmPayload = {
            action: 'completion',
            history: llmHistory.slice(-10),
            sessionId: effectiveSessionId,
            timestamp: now
        };

        setDebugInfo(prev => ({
            ...prev,
            lastRequest: llmPayload,
            requestTimestamp: new Date().toISOString()
        }));

        console.log('📤 Sending to LLM:', llmPayload);
        setCurrentLLMSession(effectiveSessionId);

        try {
            llmWsRef.current.send(JSON.stringify(llmPayload));
            setOverallStatus('📤 Message sent to AI - waiting for response');
        } catch (error) {
            console.error('Failed to send message to LLM:', error);
            setOverallStatus('❌ Failed to send message to LLM');
        }
    };

    const connectSTT = async () => {
        if (!networkConfig) {
            setOverallStatus('❌ Network configuration not loaded');
            return;
        }

        try {
            setOverallStatus('🔗 Connecting to STT server...');
            
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
                
                console.log('📤 Sending reset command to STT server...');
                sttWsRef.current.send(JSON.stringify({
                    type: 'control',
                    action: 'reset',
                    timestamp: Date.now()
                }));
                
                setTimeout(() => {
                    console.log('📤 Sending resume command to STT server...');
                    sttWsRef.current.send(JSON.stringify({
                        type: 'control',
                        action: 'resume',
                        timestamp: Date.now()
                    }));
                }, 100);
                
                if (autoStart) {
                    console.log('Auto-connecting to LLM services...');
                    setTimeout(() => {
                        connectLLM();
                    }, 500);
                }
            };
            
            sttWsRef.current.onmessage = (event) => {
                try {
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
                
                if (sttStatus === 'connected' && autoStart) {
                    setTimeout(() => {
                        console.log('Auto-starting transcription...');
                        startTranscription();
                    }, 500);
                }
            };
            
            llmWsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'llm_message') {
                        handleLLMMessage(data.data);
                    } else if (data.type === 'delay_measurement') {
                        if (data.delay) {
                            updateDelayStats(data.delay);
                        }
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
        const newSessionId = Math.random().toString(36).substr(2, 9);
        setSessionId(newSessionId);
        sessionIdRef.current = newSessionId;
        isFirstChunkRef.current.add(newSessionId);
        
        await connectSTT();
    };

    const connectServices = () => {
        if (sttStatus !== 'connected') {
            connectSTT();
        }
        if (llmStatus !== 'connected') {
            connectLLM();
        }
    };

    const startTranscription = () => {
        if (sttWsRef.current && sttWsRef.current.readyState === WebSocket.OPEN) {
            console.log('📤 Starting STT transcription...');
            sttWsRef.current.send(JSON.stringify({
                type: 'control',
                action: 'start',
                timestamp: Date.now()
            }));
            setOverallStatus('🎤 Transcription started - speak now');
        } else {
            setOverallStatus('❌ STT not connected - cannot start transcription');
        }
    };

    const stopTranscription = () => {
        if (sttWsRef.current && sttWsRef.current.readyState === WebSocket.OPEN) {
            console.log('📤 Stopping STT transcription...');
            sttWsRef.current.send(JSON.stringify({
                type: 'control',
                action: 'stop',
                timestamp: Date.now()
            }));
            setOverallStatus('⏹️ Transcription stopped');
        }
    };

    const sendManualMessage = () => {
        const message = prompt('Enter your message:');
        if (message && message.trim()) {
            const timestamp = new Date().toLocaleTimeString();
            
            setConversationHistory(prev => [...prev, {
                text: message,
                timestamp: timestamp,
                type: 'user',
                manual: true
            }]);
            
            if (sendToRobot && targetRobot) {
                sendUserInputToRobot(message, sessionIdRef.current);
            }
            
            sendToLLM(message);
        }
    };

    const clearConversation = () => {
        setConversationHistory([]);
        setCurrentTranscription('');
        setOverallStatus('🗑️ Conversation cleared');
        
        setDelayStats({
            totalRequests: 0,
            averageDelay: 0,
            minDelay: 0,
            maxDelay: 0,
            recentDelays: []
        });
        setLastDelay(null);
        
        setTurnTakingViolations([]);
        
        pendingLLMRequestsRef.current.clear();
        isFirstChunkRef.current.clear();
        
        if (sessionIdRef.current) {
            isFirstChunkRef.current.add(sessionIdRef.current);
        }
    };

    const disconnect = () => {
        if (sttWsRef.current) {
            sttWsRef.current.close();
            sttWsRef.current = null;
        }
        
        if (llmWsRef.current) {
            llmWsRef.current.close();
            llmWsRef.current = null;
        }
        
        setSTTStatus('disconnected');
        setLLMStatus('disconnected');
        setSessionId('');
        setOverallStatus('🔌 Disconnected');
        
        pendingLLMRequestsRef.current.clear();
        isFirstChunkRef.current.clear();
        sessionIdRef.current = null;
    };

    const flushBuffer = async (sessionId) => {
        try {
            const response = await fetch(`/api/robot-buffer/flush/${sessionId || sessionIdRef.current}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetRobot: targetRobot })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to flush buffer:', error);
            return { success: false, error: error.message };
        }
    };

    const getStatusColor = (status) => {
        switch(status) {
            case 'connected': return '#28a745';
            case 'connecting': return '#ffc107';
            case 'disconnected': return '#6c757d';
            case 'error': return '#dc3545';
            default: return '#6c757d';
        }
    };

    const contextValue = {
        // State
        sessionId,
        sttStatus,
        llmStatus,
        conversationHistory,
        currentTranscription,
        overallStatus,
        networkConfig,
        autoStart,
        sendToRobot,
        delayStats,
        lastDelay,
        robotStatus,
        sttDetailedStatus,
        turnTakingViolations,
        robotSpeaking,
        llmActive,
        bufferStatus,
        currentLLMSession,
        debugInfo,
        targetRobot,
        
        // Setters
        setAutoStart,
        setSendToRobot,
        
        // Actions
        connect,
        disconnect,
        connectServices,
        startTranscription,
        stopTranscription,
        sendManualMessage,
        clearConversation,
        flushBuffer,
        
        // Utilities
        getStatusColor,
        conversationRef
    };

    return (
        <ChatContext.Provider value={contextValue}>
            {children}
        </ChatContext.Provider>
    );
};