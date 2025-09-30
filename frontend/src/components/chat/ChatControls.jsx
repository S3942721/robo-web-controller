import { useChat } from './useChat';

export default function ChatControls() {
    const {
        sessionId,
        sttStatus,
        llmStatus,
        overallStatus,
        networkConfig,
        autoStart,
        setAutoStart,
        connect,
        disconnect,
        connectServices,
        startTranscription,
        stopTranscription,
        sendManualMessage,
        clearConversation,
        getStatusColor
    } = useChat();

    return (
        <div style={{ 
            padding: '15px', 
            backgroundColor: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: '8px',
            marginBottom: '15px'
        }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Chat Controls</h4>
            
            {/* Configuration */}
            {networkConfig ? (
                <div style={{ marginBottom: '15px', fontSize: '12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div>
                            <strong>STT:</strong> {networkConfig.stt.enabled ? 
                                `✅ ${networkConfig.stt.host}:${networkConfig.stt.port}` : 
                                '❌ Disabled'
                            }
                        </div>
                        <div>
                            <strong>LLM:</strong> {networkConfig.llm.enabled ? 
                                `✅ ${networkConfig.llm.host}` : 
                                '❌ Disabled'
                            }
                        </div>
                    </div>
                </div>
            ) : (
                <p style={{ fontSize: '12px', color: '#6c757d' }}>Loading configuration...</p>
            )}
            
            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                    <input
                        type="checkbox"
                        checked={autoStart}
                        onChange={(e) => setAutoStart(e.target.checked)}
                    />
                    <span>Auto-connect and start services when session connects</span>
                </label>
            </div>
            
            {/* Service Status */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>STT Service</div>
                    <div style={{ color: getStatusColor(sttStatus), fontWeight: 'bold', fontSize: '10px' }}>
                        {sttStatus.toUpperCase()}
                    </div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>LLM Gateway</div>
                    <div style={{ color: getStatusColor(llmStatus), fontWeight: 'bold', fontSize: '10px' }}>
                        {llmStatus.toUpperCase()}
                    </div>
                </div>
                <div style={{ textAlign: 'center', padding: '8px', backgroundColor: '#e9ecef', borderRadius: '4px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '12px' }}>Session ID</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '8px', wordBreak: 'break-all' }}>
                        {sessionId || 'Not connected'}
                    </div>
                </div>
            </div>

            {/* Control Buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '15px' }}>
                <button 
                    onClick={sessionId ? disconnect : connect}
                    style={{
                        padding: '8px 12px',
                        backgroundColor: sessionId ? '#dc3545' : '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold'
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
                                padding: '8px 12px',
                                backgroundColor: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}
                            disabled={sttStatus === 'connected' && llmStatus === 'connected'}
                        >
                            🔗 Connect Services
                        </button>
                        
                        <button 
                            onClick={startTranscription}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#28a745',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}
                            disabled={sttStatus !== 'connected'}
                        >
                            🎤 Start
                        </button>
                        
                        <button 
                            onClick={stopTranscription}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#fd7e14',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}
                            disabled={sttStatus !== 'connected'}
                        >
                            ⏹️ Stop
                        </button>
                        
                        <button 
                            onClick={sendManualMessage}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#6f42c1',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}
                            disabled={llmStatus !== 'connected'}
                        >
                            ✍️ Manual Message
                        </button>
                        
                        <button 
                            onClick={clearConversation}
                            style={{
                                padding: '8px 12px',
                                backgroundColor: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}
                        >
                            🗑️ Clear
                        </button>
                    </>
                )}
            </div>
            
            <div style={{ 
                padding: '8px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px',
                fontStyle: 'italic',
                fontSize: '12px',
                color: '#6c757d'
            }}>
                Status: {overallStatus}
            </div>
        </div>
    );
}