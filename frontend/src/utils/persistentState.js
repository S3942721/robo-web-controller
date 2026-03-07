import { useEffect, useState } from "react";

function hasStorage() {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readPersisted(key, fallbackValue) {
    if (!hasStorage()) return fallbackValue;

    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallbackValue;
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Failed to read persisted state for key "${key}":`, error);
        return fallbackValue;
    }
}

export function writePersisted(key, value) {
    if (!hasStorage()) return;

    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Failed to write persisted state for key "${key}":`, error);
    }
}

export function usePersistentState(key, fallbackValue) {
    const [state, setState] = useState(() => readPersisted(key, fallbackValue));

    useEffect(() => {
        writePersisted(key, state);
    }, [key, state]);

    return [state, setState];
}
