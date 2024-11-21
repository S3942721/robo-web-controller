import PreDefinedScripts from "../PreDefinedScripts"
import SelectProfile from "../SelectProfile"
import TriggerBehaviour from "../TriggerBehaviour"
import ManualDefinedScript from "../ManualDefinedScript"
import ShortCuts from "../ShortCuts"
import ScrollControllers from "../ScrollControllers"

export default function Controller() {
    return (
        <div>
            <SelectProfile />
            <ShortCuts />
            <PreDefinedScripts />
            <ManualDefinedScript />
            <TriggerBehaviour />
            <ScrollControllers />
        </div>
    )
}