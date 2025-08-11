import { useEffect } from 'react';
import { useState } from 'react';
export let status = {
    'websocket-connected': false,
    'websocket-error': false,
    'audio-initialized': false,
    'audio-playing': false,
    'session-streaming': false,
    'session-ended': false,
    'paused': false,
    'transcript-status': 'disabled',
    'session-start-triggered': false
}
const components = new Set();

function updateAll() {
    status = { ...status };
    components.forEach(e => e(status));
}

export function setStatus(key, value) {
    status[key] = value;
    updateAll();
}

export function toggleStatus(key) {
    status[key] = !status[key];
    updateAll();
}

export default function useStatusManager(statusKey = null) {
    const [state, setState] = useState(status);

    useEffect(() => {
        if (statusKey) status[statusKey] ??= false;
        
        components.add(setState);
        return () => {
            components.delete(setState);
        }
    }, [statusKey]);

    return state;
}