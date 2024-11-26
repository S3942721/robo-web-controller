import PreDefinedScripts from "../PreDefinedScripts"
import SelectProfile from "../SelectProfile"
import TriggerBehaviour from "../TriggerBehaviour"
import ManualDefinedScript from "../ManualDefinedScript"
import ShortCuts from "../ShortCuts"
import ScrollControllers from "../ScrollControllers"
import SelectAnnouncements from "../SelectAnnouncements"

export default function Controller() {
    return (
        <div>
            <SelectProfile />
            <ShortCuts />
            <PreDefinedScripts />
            <ManualDefinedScript />
            <SelectAnnouncements />
            <TriggerBehaviour />
            <ScrollControllers />
        </div>
    )
}