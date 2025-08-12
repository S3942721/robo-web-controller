import { useState, useEffect, useRef } from 'react';
import request from '../../utils/request';

// Import the working audio system
import { initAudio, startStreaming, stopStreaming, playAudio } from '../../../services/audio';
import { initClient, sendMessage, closeWsClient } from '../../../services/websocket';
import { setStatus, status } from '../../../hooks/useStatusManager';
import { base64ToFloat32Array } from '../../../utils/tools';
import { handleWsActions } from '../../../services/events-handler';

export default function NovaSonicForT() {
    const [config, setConfig] = useState(null);
    const [isConversing, setIsConversing] = useState(false);
    const [conversationStatus, setConversationStatus] = useState('Ready to start conversation');
    const [response, setResponse] = useState('');
    const [isSessionActive, setIsSessionActive] = useState(false);
    const wsRef = useRef(null);
    const audioInitialized = useRef(false);

    console.log('NovaSonicForT component mounted');

    useEffect(() => {
        const loadConfig = async () => {
            const configData = await request('api/nova-sonic-config', { method: 'GET' });
            setConfig(configData);
        };
        loadConfig();
    }, []);

    // Enhanced event handler for Nova Sonic with multi-turn support
    useEffect(() => {
        const customEventHandler = (action, data) => {
            console.log('Nova event:', action, data);
            
            switch(action) {
                case 'textOutput':
                    if (data.content && data.role === 'ASSISTANT') {
                        setResponse(prev => prev + data.content);
                        setConversationStatus('🤖 AI responded - Ready for your reply');
                    }
                    break;
                case 'audioOutput':
                    if (data.audioData && data.audioData.content) {
                        try {
                            const audioSamples = base64ToFloat32Array(data.audioData.content);
                            playAudio(audioSamples);
                            setConversationStatus('🔊 AI is speaking...');
                        } catch (error) {
                            console.error('Audio playback error:', error);
                        }
                    }
                    break;
                case 'contentEnd':
                    if (data.type === 'AUDIO') {
                        setConversationStatus('🎤 Your turn - speak naturally');
                    }
                    break;
                case 'interviewEnd':
                    setConversationStatus('Session ended');
                    setIsConversing(false);
                    setIsSessionActive(false);
                    break;
                case 'status':
                    if (data.includes('Connected')) {
                        setIsSessionActive(true);
                        setConversationStatus('✅ Connected - Ready to chat');
                    }
                    break;
                default:
                    // Use the original handler for other events
                    handleWsActions(action, data);
            }
        };
        
        // Store the custom handler globally for WebSocket to use
        window.novaEventHandler = customEventHandler;
        
        return () => {
            delete window.novaEventHandler;
        };
    }, []);

    const startConversation = async () => {
        try {
            setConversationStatus('🔗 Connecting...');
            setResponse(''); // Clear previous response
            
            // Create new WebSocket connection for Nova Sonic
            if (wsRef.current) {
                wsRef.current.close();
            }
            
            const wsUrl = `ws://${window.location.hostname}:3000/api/nova-sonic-stream`;
            wsRef.current = new WebSocket(wsUrl);
            
            // Store WebSocket globally for audio service to use
            window.novaWebSocket = wsRef.current;
            
            wsRef.current.onopen = () => {
                console.log('Nova WebSocket connected');
                setConversationStatus('✅ Connected to Nova Sonic');
            };
            
            wsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (window.novaEventHandler) {
                        window.novaEventHandler(data.action, data);
                    }
                } catch (error) {
                    console.error('Error parsing Nova message:', error);
                }
            };
            
            wsRef.current.onerror = (error) => {
                console.error('Nova WebSocket error:', error);
                setConversationStatus('❌ Connection error');
            };
            
            wsRef.current.onclose = () => {
                console.log('Nova WebSocket closed');
                if (isConversing) {
                    setConversationStatus('🔌 Connection lost');
                    setIsConversing(false);
                    setIsSessionActive(false);
                }
            };
            
            // Wait for WebSocket connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                wsRef.current.onopen = () => {
                    clearTimeout(timeout);
                    resolve();
                };
            });
            
            setConversationStatus('🎤 Initializing audio...');
            
            // Initialize audio only once
            if (!audioInitialized.current) {
                await initAudio();
                audioInitialized.current = true;
            }
            
            setConversationStatus('🚀 Starting session...');
            
            // Send start session command
            wsRef.current.send(JSON.stringify({ action: 'startSession' }));
            
            // Set user ID
            wsRef.current.send(JSON.stringify({ 
                action: 'setUserId', 
                userId: `test-user-${Date.now()}` 
            }));
            
            // Start streaming audio
            startStreaming();
            
            setIsConversing(true);
            setConversationStatus('🎤 Listening... speak naturally');
            
        } catch (error) {
            console.error('Error starting conversation:', error);
            setConversationStatus('❌ Error: ' + error.message);
        }
    };

    const stopConversation = async () => {
        try {
            setConversationStatus('Stopping conversation...');
            
            // Send end session command
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ action: 'endSession' }));
            }
            
            // Stop streaming
            await stopStreaming();
            
            // Close WebSocket
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            
            // Clear global WebSocket reference
            window.novaWebSocket = null;
            
            setIsConversing(false);
            setIsSessionActive(false);
            setConversationStatus('Conversation ended');
            
        } catch (error) {
            console.error('Error stopping conversation:', error);
            setConversationStatus('❌ Error stopping: ' + error.message);
        }
    };
    
    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            window.novaWebSocket = null;
        };
    }, []);

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            <h2>Nova Sonic Real-time Conversation</h2>
            
            {config && (
                <div style={{ 
                    marginBottom: '20px', 
                    padding: '10px', 
                    backgroundColor: config.enabled ? '#d4edda' : '#f8d7da',
                    border: `1px solid ${config.enabled ? '#c3e6cb' : '#f5c6cb'}`,
                    borderRadius: '4px'
                }}>
                    <strong>Status:</strong> {config.enabled ? 'Enabled' : 'Disabled'} | 
                    <strong>Model:</strong> {config.model} | 
                    <strong>Region:</strong> {config.region}
                </div>
            )}
            
            <div style={{ marginBottom: '20px' }}>
                <button 
                    onClick={isConversing ? stopConversation : startConversation}
                    style={{
                        padding: '15px 30px',
                        backgroundColor: isConversing ? '#dc3545' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: 'bold'
                    }}
                >
                    {isConversing ? '🛑 End Conversation' : '💬 Start Real-time Conversation'}
                </button>
                
                <div style={{ 
                    marginTop: '15px', 
                    padding: '10px', 
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    fontStyle: 'italic'
                }}>
                    Status: {conversationStatus}
                </div>
            </div>

            {response && (
                <div style={{ 
                    marginTop: '20px', 
                    padding: '15px', 
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px'
                }}>
                    <h4>AI Response:</h4>
                    <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                        {response}
                    </pre>
                </div>
            )}
        </div>
    );
}