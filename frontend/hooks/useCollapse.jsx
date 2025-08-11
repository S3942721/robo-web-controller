import { useEffect } from "react";
import { useState } from "react"

const components = {}
const states = {}

function updateAll(componentName) {
    components[componentName]?.forEach((setState) => {
        setState(() => states[componentName]);
    })
}

export function collapse(componentName) {
    states[componentName] = true;
    updateAll(componentName);
}

export function expand(componentName) {
    states[componentName] = false;
    updateAll(componentName);
}

export function toggleCollapse(componentName) {
    states[componentName] = !states[componentName];
    updateAll(componentName);
}

export default function useCollapse(componentName) {
    const [ state, setState ] = useState(states[componentName] || false);

    useEffect(()=>{
        states[componentName] ??= false;
        components[componentName] ??= [];
        components[componentName].push(setState);
        return () => {
            components[componentName].splice(components[componentName].indexOf(setState), 1);
        }
    }, [componentName])

    return state;
}