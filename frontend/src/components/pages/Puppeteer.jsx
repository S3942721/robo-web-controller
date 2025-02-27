import PreDefinedScripts from "../PreDefinedScripts";
import ScrollControllers from "../ScrollControllers";
import MoveController from "./MoveController";
import ShortCuts from "./ShortCuts";


export default function Puppeteer() {

    return (
        // <div style={{width: '1280px', height: '800px', position: 'absolute', top: 0, left: 0, backgroundColor: 'green'}}></div>
        <div className={'full-screen-unscrollable'}>
            <div className={'grid-container'}>
                <div className={'grid-item'}>
                    <MoveController foldable={false} compact={true}/>
                </div>
                <div className={'grid-item'}>
                    <PreDefinedScripts foldable={false} compact={true}/>
                </div>
                <div style={{backgroundColor: "yellow"}}></div>
                <div style={{backgroundColor: "pink"}}></div>
            </div>
        </div>
            /*{ <ShortCuts />
            <PreDefinedScripts />
            <ScrollControllers /> }*/
    )
}