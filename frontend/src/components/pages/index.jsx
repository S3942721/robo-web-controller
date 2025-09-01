import PreDefinedScripts from "../PreDefinedScripts"
import SelectProfile from "../SelectProfile"
import TriggerBehaviour from "../TriggerBehaviour"
import ManualDefinedScript from "../ManualDefinedScript"
import ShortCuts from "./ShortCuts"
import ScrollControllers from "../ScrollControllers"
import SelectAnnouncements from "../SelectAnnouncements"
import MoveController from "./MoveController"
import RobotStatusMonitor from "../RobotStatusMonitor"

export default function Controller() {
    return (
        <div>
            <div style={{ padding: '10px', backgroundColor: '#f8f9fa', marginBottom: '10px' }}>
                <a href="/test" style={{ marginRight: '15px', color: '#007bff' }}>🧪 Nova Sonic Test</a>
                <a href="/stt-test" style={{ marginRight: '15px', color: '#007bff' }}>🎙️ STT Test</a>
                <a href="/stt-llm-test" style={{ marginRight: '15px', color: '#007bff' }}>🎙️💬 STT+LLM Test</a>
                <a href="/puppeteer" style={{ marginRight: '15px', color: '#007bff' }}>🖥️ Puppeteer</a>
                <a href="/scripts" style={{ marginRight: '15px', color: '#007bff' }}>📜 Scripts</a>
                <a href="/shortcuts" style={{ marginRight: '15px', color: '#007bff' }}>⌨️ Shortcuts</a>
                <a href="/move-control" style={{ marginRight: '15px', color: '#007bff' }}>🎮 Move Control</a>
                <a href="/robot-api-test" style={{ marginRight: '15px', color: '#007bff' }}>🤖 Robot API Test</a>
                <a href="/upload-json" style={{ color: '#007bff' }}>📤 Upload Settings</a>
            </div>
            <MoveController />
            <ManualDefinedScript />
            <SelectProfile />
            <ShortCuts />
            <PreDefinedScripts />
            <ScrollControllers />
            <RobotStatusMonitor />
        </div>
    )
}