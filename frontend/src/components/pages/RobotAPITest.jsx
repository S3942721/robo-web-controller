import { useState, useEffect } from 'react';
import robotAPI from '../../utils/robotAPI';

export default function RobotAPITest() {
    const [status, setStatus] = useState(null);
    const [history, setHistory] = useState({});
    const [selectedRobot, setSelectedRobot] = useState('');
    const [message, setMessage] = useState('');
    const [messageType, setMessageType] = useState('script');
    const [sendResult, setSendResult] = useState(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    // Load initial data
    useEffect(() => {
        loadStatus();
        loadHistory();
    }, []);

    // Auto-refresh
    useEffect(() => {
        if (!autoRefresh) return;
        
        const interval = setInterval(() => {
            loadStatus();
            loadHistory();
        }, 5000);
        
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const loadStatus = async () => {
        try {
            const statusData = await robotAPI.getStatus();
            setStatus(statusData);
        } catch (error) {
            console.error('Failed to load status:', error);
        }
    };

    const loadHistory = async () => {
        try {
            const historyData = await robotAPI.getHistory();
            setHistory(historyData);
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    };

    const sendMessage = async () => {
        if (!message.trim()) return;
        
        try {
            let result;
            switch (messageType) {
                case 'script':
                    result = await robotAPI.executeScript(message, selectedRobot || null);
                    break;
                case 'shortcut':
                    result = await robotAPI.executeShortcut(message, selectedRobot || null);
                    break;
                case 'trigger':
                    try {
                        const triggerData = JSON.parse(message);
                        result = await robotAPI.sendTrigger(triggerData, selectedRobot || null);
                    } catch (e) {
                        result = { success: false, error: 'Invalid JSON for trigger data' };
                    }
                    break;
                default:
                    result = await robotAPI.sendMessage(message, selectedRobot || null, messageType);
            }
            
            setSendResult(result);
            setMessage('');
            
            // Refresh data after sending
            setTimeout(() => {
                loadStatus();
                loadHistory();
            }, 500);
            
        } catch (error) {
            setSendResult({ success: false, error: error.message });
        }
    };

    const availableRobots = status?.connections
        .map(c => c.robot)
        .filter(Boolean)
        .filter((robot, index, self) => self.indexOf(robot) === index) || [];

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
            <h2>🤖 Robot API Test Interface</h2>
            
            {/* Controls */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                    <button onClick={loadStatus} style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}>
                        🔄 Refresh Status
                    </button>
                    <button onClick={loadHistory} style={{ padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}>
                        📋 Refresh History
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <input 
                            type="checkbox" 
                            checked={autoRefresh} 
                            onChange={(e) => setAutoRefresh(e.target.checked)} 
                        />
                        Auto-refresh (5s)
                    </label>
                </div>
            </div>

            {/* Status Display */}
            {status && (
                <div style={{ 
                    marginBottom: '20px', 
                    padding: '15px', 
                    backgroundColor: '#e7f3ff',
                    border: '1px solid #b3d9ff',
                    borderRadius: '8px'
                }}>
                    <h4>📊 Robot API Status</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px' }}>
                        <div>
                            <strong>Active Connections:</strong> {status.connections.length}<br/>
                            <strong>Messages Sent:</strong> {status.stats.messagesSent}<br/>
                            <strong>Messages Received:</strong> {status.stats.messagesReceived}
                        </div>
                        <div>
                            <strong>Total Connections:</strong> {status.stats.connectionsTotal}<br/>
                            <strong>Queued Messages:</strong> {status.queuedMessages}<br/>
                            <strong>Uptime:</strong> {Math.floor(status.uptime / 1000)}s
                        </div>
                    </div>
                    
                    <h5>🔗 Active Connections:</h5>
                    {status.connections.length > 0 ? (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8f9fa' }}>
                                        <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>Socket ID</th>
                                        <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>Robot</th>
                                        <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>Last Activity</th>
                                        <th style={{ padding: '8px', border: '1px solid #dee2e6' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {status.connections.map((conn, idx) => (
                                        <tr key={idx}>
                                            <td style={{ padding: '8px', border: '1px solid #dee2e6', fontFamily: 'monospace' }}>
                                                {conn.socketId.substring(0, 20)}...
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #dee2e6' }}>
                                                {conn.robot || 'Unknown'}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #dee2e6' }}>
                                                {new Date(conn.lastActivity).toLocaleTimeString()}
                                            </td>
                                            <td style={{ padding: '8px', border: '1px solid #dee2e6' }}>
                                                <span style={{ color: conn.active ? '#28a745' : '#dc3545' }}>
                                                    {conn.active ? '🟢 Active' : '🔴 Inactive'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p style={{ color: '#666', fontStyle: 'italic' }}>No active connections</p>
                    )}
                </div>
            )}

            {/* Message Sender */}
            <div style={{ 
                marginBottom: '20px', 
                padding: '15px', 
                backgroundColor: '#fff3cd',
                border: '1px solid #ffeaa7',
                borderRadius: '8px'
            }}>
                <h4>📤 Send Message to Robot</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                    <div>
                        <label><strong>Target Robot:</strong></label>
                        <select 
                            value={selectedRobot} 
                            onChange={(e) => setSelectedRobot(e.target.value)}
                            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                        >
                            <option value="">All Robots</option>
                            {availableRobots.map(robot => (
                                <option key={robot} value={robot}>{robot}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label><strong>Message Type:</strong></label>
                        <select 
                            value={messageType} 
                            onChange={(e) => setMessageType(e.target.value)}
                            style={{ width: '100%', padding: '8px', marginTop: '5px' }}
                        >
                            <option value="script">Script</option>
                            <option value="shortcut">Shortcut</option>
                            <option value="trigger">Trigger (JSON)</option>
                            <option value="announcement">Announcement</option>
                            <option value="custom">Custom</option>
                        </select>
                    </div>
                    <div>
                        <label><strong>Action:</strong></label>
                        <button 
                            onClick={sendMessage}
                            disabled={!message.trim()}
                            style={{ 
                                width: '100%', 
                                padding: '8px', 
                                marginTop: '5px',
                                backgroundColor: '#28a745', 
                                color: 'white', 
                                border: 'none', 
                                borderRadius: '4px',
                                opacity: message.trim() ? 1 : 0.5
                            }}
                        >
                            📤 Send Message
                        </button>
                    </div>
                </div>
                
                <div>
                    <label><strong>Message Content:</strong></label>
                    <textarea 
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={
                            messageType === 'trigger' 
                                ? '{"Signal": "ControlMovement", "Value": true}'
                                : messageType === 'script'
                                ? 'Hello, this is a test message'
                                : 'Enter your message here...'
                        }
                        style={{ 
                            width: '100%', 
                            height: '80px', 
                            padding: '8px', 
                            marginTop: '5px',
                            fontFamily: messageType === 'trigger' ? 'monospace' : 'inherit'
                        }}
                    />
                </div>
                
                {sendResult && (
                    <div style={{ 
                        marginTop: '10px', 
                        padding: '10px', 
                        backgroundColor: sendResult.success ? '#d4edda' : '#f8d7da',
                        border: `1px solid ${sendResult.success ? '#c3e6cb' : '#f5c6cb'}`,
                        borderRadius: '4px'
                    }}>
                        <strong>Send Result:</strong> {sendResult.success ? '✅ Success' : '❌ Failed'}
                        {sendResult.error && <div>Error: {sendResult.error}</div>}
                        {sendResult.message && <div>Message: {sendResult.message}</div>}
                    </div>
                )}
            </div>

            {/* Message History */}
            <div style={{ 
                padding: '15px', 
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '8px'
            }}>
                <h4>📋 Message History</h4>
                {Object.keys(history).length > 0 ? (
                    Object.entries(history).map(([robot, messages]) => (
                        <div key={robot} style={{ marginBottom: '20px' }}>
                            <h5>🤖 {robot}</h5>
                            <div style={{ 
                                maxHeight: '300px', 
                                overflowY: 'auto', 
                                border: '1px solid #dee2e6', 
                                borderRadius: '4px',
                                backgroundColor: 'white'
                            }}>
                                {messages.length > 0 ? (
                                    messages.slice(-20).reverse().map((entry, idx) => (
                                        <div 
                                            key={idx}
                                            style={{ 
                                                padding: '8px', 
                                                borderBottom: '1px solid #e9ecef',
                                                backgroundColor: entry.direction === 'outgoing' ? '#fff3cd' : '#d1ecf1'
                                            }}
                                        >
                                            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                                                {entry.direction === 'outgoing' ? '📤 Sent' : '📥 Received'} 
                                                {' '}at {new Date(entry.timestamp).toLocaleTimeString()}
                                            </div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                                                {JSON.stringify(entry.message, null, 2)}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                                        No messages yet
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                ) : (
                    <p style={{ color: '#666', fontStyle: 'italic' }}>No message history available</p>
                )}
            </div>
        </div>
    );
}
