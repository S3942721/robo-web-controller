import PreDefinedScripts from "../PreDefinedScripts"
import SelectProfile from "../SelectProfile"
import TriggerBehaviour from "../TriggerBehaviour"
import ManualDefinedScript from "../ManualDefinedScript"
import ShortCuts from "../ShortCuts"

export default function Controller() {
    return (
        <div>
            <SelectProfile />
            <ShortCuts />
            <PreDefinedScripts />
            <ManualDefinedScript />
            <TriggerBehaviour />
        </div>
    )
}