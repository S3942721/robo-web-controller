import request from "../utils/request"
import PreDefinedScripts from "./PreDefinedScripts"
import SelectProfile from "./SelectProfile"
import TriggerBehaviour from "./TriggerBehaviour"
import ManualDefinedScript from "./ManualDefinedScript"

export default function App() {

    async function send(type, message) {
        await request('api/send-command', {
            body: {
                type, message
            }
        })
    }

    return (
        <div>
            <SelectProfile send={send} />
            <PreDefinedScripts send={send} />
            <ManualDefinedScript send={send} />
            <TriggerBehaviour send={send} />
        </div>
    )
}