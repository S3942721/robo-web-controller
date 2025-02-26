import PreDefinedScripts from "../PreDefinedScripts"
import ShortCuts from "./ShortCuts"
import ScrollControllers from "../ScrollControllers"
import MoveController from "./MoveController"
import FullScreenSection from "../FullScreenSection"
import ManualDefinedScript from "./../ManualDefinedScript"

export default function Puppeteer() {
        return (
            <div>
                <MoveController />
                <ManualDefinedScript />
                <ShortCuts />
                <PreDefinedScripts />
                <ScrollControllers />
            </div>
        )
    // return (
    //     <FullScreenSection className={full_screen ? 'full-screen-unscrollable' : ''} title={'Puppeteer'}>
    //         <div className="grid-item"><MoveController /></div>
    //         <div className="grid-item"><ShortCuts /></div>
    //         <div className="grid-item"><PreDefinedScripts /></div>
    //         <div className="grid-item"><ScrollControllers /></div>
    //     </FullScreenSection>
    // )
}