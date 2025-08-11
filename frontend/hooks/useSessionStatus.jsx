import { useEffect, useState } from "react";

let sessionStatus = {
    streaming: false
}
const components = new Set();

function updateAll() {
    sessionStatus = { ...sessionStatus }
    components.forEach(e => e(sessionStatus));
}

export function updateStatus(key, value) {
    sessionStatus[key] = value;
    updateAll();
}

export default function useSessionStatus() {
    const [state, setState] = useState(sessionStatus);

    useEffect(()=>{
        components.add(setState);
        return () => {
            components.delete(setState);
        }
    }, [setState]);

    return state;
}