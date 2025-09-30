import ChatControls from './ChatControls';
import ChatConversation from './ChatConversation';

export default function Chat() {
    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <ChatControls />
            <div style={{ flex: 1 }}>
                <ChatConversation />
            </div>
        </div>
    );
}