import request from "../utils/request"
import PreDefinedScripts from "./PreDefinedScripts"
import SelectProfile from "./SelectProfile"
import TriggerBehaviour from "./TriggerBehaviour"
import ManualDefinedScript from "./ManualDefinedScript"
import { useState } from "react"
import { profiles } from "../utils/types"

export default function App() {

    async function send(type, message) {
        await request('api/send-command', {
            body: {
                type, message
            }
        }, { returns_json: false })
    }

    const [profile, setProfile] = useState(profiles[0])

    return (
        <div>
            <SelectProfile current_profile={profile} setCurrentProfile={setProfile} send={send} />
            <PreDefinedScripts send={send} profile={profile.name} />
            <ManualDefinedScript send={send} />
            <TriggerBehaviour send={send} />
        </div>
    )
}