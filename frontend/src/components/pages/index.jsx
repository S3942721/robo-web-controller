import PreDefinedScripts from "../PreDefinedScripts"
import SelectProfile from "../SelectProfile"
import TriggerBehaviour from "../TriggerBehaviour"
import ManualDefinedScript from "../ManualDefinedScript"
import ShortCuts from "./ShortCuts"
import ScrollControllers from "../ScrollControllers"
import SelectAnnouncements from "../SelectAnnouncements"
import MoveController from "./MoveController"

export default function Controller() {
    return (
        <div>
            <MoveController />
            <ManualDefinedScript />
            <SelectProfile />
            <ShortCuts />
            <PreDefinedScripts />
            <ScrollControllers />
        </div>
    )
}