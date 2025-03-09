import { useEffect, useState } from "react";

const ws_url = (import.meta.env.PROD ? '' : 'ws://10.234.7.248:3000')+'/api/sync'

let g_profiles = [], g_current_profile = {}, g_scripts = {}, g_triggers = {}, g_shortcuts = {},  g_paged_shortcuts = {}, g_announcements = {}, g_active_robot = "";

const subscribers = {
    profiles: [],
    shortcuts: [],
    paged_shortcuts: [],
    current_profile: [],
    scripts: [],
    triggers: [],
    announcements: [],
}

/**
 * @typedef {"all"|"profiles"|"current-profile"|"scripts"|"triggers"|"shortcuts"|"paged_shortcuts"|"announcements"} UpdateValueTypes
 */

/**
 * sync to all subscribers
 * @param {UpdateValueTypes} value_type 
 */
function update(value_type = 'all') {
    /^(all|profiles)$/.test(value_type) && subscribers.profiles.forEach(e=>e(g_profiles));
    /^(all|shortcuts)$/.test(value_type) && subscribers.shortcuts.forEach(e=>e(g_shortcuts));
    /^(all|paged_shortcuts)$/.test(value_type) && subscribers.paged_shortcuts.forEach(e=>e(g_paged_shortcuts));
    /^(all|current-profile)$/.test(value_type) && subscribers.current_profile.forEach(e=>e(g_current_profile));
    /^(all|scripts)$/.test(value_type) && subscribers.scripts.forEach(e=>e(g_scripts));
    /^(all|triggers)$/.test(value_type) && subscribers.triggers.forEach(e=>e(g_triggers));
    /^(all|announcements)$/.test(value_type) && subscribers.announcements.forEach(e=>e(g_announcements));
}

const socket = new WebSocket(ws_url);

socket.onmessage = message =>{
    const { cmd, value } = JSON.parse(message.data);
    switch(cmd) {
        case "res-sync":
            g_profiles = value.profiles;
            g_current_profile = value.current_profile;
            g_scripts = value.scripts;
            g_triggers = value.triggers;
            g_shortcuts = value.shortcuts;
            g_paged_shortcuts = value.paged_shortcuts;
            g_announcements = value.announcements;

            update()
            break;
        case "res-update-profile":
            g_current_profile = value;
            update('current-profile')
            break;
        case 'res-update-scripts':
            g_scripts = value;
            update('scripts')
            break;
    }
}

socket.onopen = () => {
    socket.send(JSON.stringify({cmd: "req-sync"}))
}

/**
 * Sends a message via websocket.
 * Expects a payload object containing type and message.
 * The final payload sends { cmd, type, message, robot } at the top level.
 * If payload.robot is undefined or null, it is set to window.g_active_robot, or g_current_profile.name, or "".
 * @param {string} cmd 
 * @param {*} payload 
 */
export function requestWS(cmd, payload) {
    if (payload.robot === undefined || payload.robot === null) {
        payload.robot = window.g_active_robot || "";
    }
    const finalPayload = {
        cmd,
        type: payload.type,
        message: payload.message,
        robot: payload.robot,
    };
    console.log("Sending WS request:", finalPayload);
    socket.send(JSON.stringify(finalPayload));
}

export default function useWebSocket() {
    const [profiles, setProfiles] = useState(g_profiles);
    const [shortcuts, setShortcuts] = useState(g_shortcuts);
    const [paged_shortcuts, setPagedShortcuts] = useState(g_paged_shortcuts);
    const [current_profile, setCurrentProfile] = useState(g_current_profile);
    const [scripts, setScripts] = useState(g_scripts);
    const [triggers, setTriggers] = useState(g_triggers);
    const [announcements, setAnnouncements] = useState(g_announcements);

    useEffect(()=>{
        subscribers.profiles.push(setProfiles);
        subscribers.shortcuts.push(setShortcuts);
        subscribers.paged_shortcuts.push(setPagedShortcuts);
        subscribers.current_profile.push(setCurrentProfile);
        subscribers.scripts.push(setScripts);
        subscribers.triggers.push(setTriggers);
        subscribers.announcements.push(setAnnouncements);
        
        return ()=>{
            subscribers.profiles = subscribers.profiles.filter(e=>e!==setProfiles)
            subscribers.shortcuts = subscribers.shortcuts.filter(e=>e!==setShortcuts)
            subscribers.paged_shortcuts = subscribers.paged_shortcuts.filter(e=>e!==setPagedShortcuts)
            subscribers.current_profile = subscribers.current_profile.filter(e=>e!==setCurrentProfile)
            subscribers.scripts = subscribers.scripts.filter(e=>e!==setScripts)
            subscribers.triggers = subscribers.triggers.filter(e=>e!==setTriggers)
            subscribers.announcements = subscribers.announcements.filter(e=>e!==setAnnouncements)
        }
    }, [])

    return {
        profiles, setProfiles,
        shortcuts, setShortcuts,
        paged_shortcuts, setPagedShortcuts,
        current_profile, setCurrentProfile,
        scripts, setScripts,
        triggers, setTriggers,
        announcements, setAnnouncements
    }
}