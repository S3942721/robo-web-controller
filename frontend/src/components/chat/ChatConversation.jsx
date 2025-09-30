import { useChat } from './useChat';

export default function ChatConversation() {
    const { conversationHistory, currentTranscription, conversationRef } = useChat();

    return (
        <div style={{ 
            padding: '15px', 
            backgroundColor: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: '8px',
            height: '300px',
            display: 'flex',
            flexDirection: 'column'
        }}>
            <h4 style={{ margin: '0 0 15px 0', fontSize: '16px' }}>Live Conversation</h4>
            
            {/* Current Transcription */}
            {currentTranscription && (
                <div style={{ 
                    marginBottom: '15px',
                    padding: '12px',
                    backgroundColor: '#fff3cd',
                    border: '1px solid #ffeaa7',
                    borderRadius: '4px'
                }}>
                    <strong>🎤 You (speaking):</strong>
                    <div style={{ 
                        fontStyle: 'italic', 
                        color: '#856404',
                        marginTop: '5px',
                        fontSize: '14px'
                    }}>
                        &ldquo;{currentTranscription}&rdquo;
                    </div>
                </div>
            )}

            {/* Conversation History */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div 
                    ref={conversationRef}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        border: '1px solid #dee2e6',
                        borderRadius: '4px',
                        padding: '10px',
                        backgroundColor: 'white'
                    }}
                >
                    {conversationHistory.length === 0 ? (
                        <div style={{ color: '#6c757d', fontStyle: 'italic', fontSize: '14px' }}>
                            No conversation yet. Connect and start talking to begin.
                        </div>
                    ) : (
                        conversationHistory.map((item, index) => (
                            <div 
                                key={index}
                                style={{
                                    padding: '10px',
                                    borderBottom: '1px solid #e9ecef',
                                    marginBottom: '6px',
                                    backgroundColor: item.type === 'assistant' ? '#f8f9ff' : '#fff8f0',
                                    borderLeft: `3px solid ${item.type === 'assistant' ? '#007bff' : '#ffc107'}`,
                                    borderRadius: '4px',
                                    opacity: item.accumulating ? 0.8 : 1.0
                                }}
                            >
                                <div style={{ 
                                    fontSize: '12px', 
                                    fontWeight: 'bold',
                                    color: item.type === 'assistant' ? '#007bff' : '#856404',
                                    marginBottom: '4px'
                                }}>
                                    {item.type === 'assistant' ? '🤖 AI Assistant' : '👤 You'}
                                    {item.manual && <span style={{ color: '#6c757d' }}> (manual)</span>}
                                    {item.accumulating && <span style={{ color: '#999', fontSize: '10px' }}> (streaming...)</span>}
                                </div>
                                <div style={{ fontSize: '14px', marginBottom: '4px' }}>
                                    &ldquo;{item.text}&rdquo;
                                </div>
                                <div style={{ 
                                    fontSize: '10px', 
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
    );
}