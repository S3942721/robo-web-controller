import { useEffect } from "react";
import { useState } from "react";

const elements = [];
let history = [
    // { role: 'USER', content: 'hello, how are you doing today?' },
    // { role: 'ASSISTANT', content: 'Hi, thanks for asking! I\'m doing good today, I\'m Kay...' }
];

function updateAll() {
    history = [...history];
    elements.forEach(element => {
        element(history);
    })
}

export function addOrUpdateMessage(role, content) {
    let lastMessage = null;
    if (history.length) {
        lastMessage = history[history.length - 1];
    }

    if (lastMessage && lastMessage.role === role) {
        lastMessage.content += " " + content;
        history.splice(history.length - 1, 1, lastMessage);
    } else {
        history.push({ role, content });
    }

    updateAll();
}

export function resetHistory() {
    history.length = 0;
    updateAll();
}

export default function useHistory() {
    const [state, setState] = useState(history);

    useEffect(() => {
        elements.push(setState);
        return () => {
            elements.splice(elements.indexOf(setState), 1);
        }
    }, [setState])

    return state;
}