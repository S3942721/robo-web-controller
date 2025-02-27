import PreDefinedScripts from "../PreDefinedScripts";
import ScrollControllers from "../ScrollControllers";
import MoveController from "./MoveController";
import PagedShortCuts from "./PagedShortCuts";


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
                <div className={'grid-item'}>
                    <ScrollControllers foldable={false} compact={true}/>
                </div>
                <div className={'grid-item'}>
                    <PagedShortCuts foldable={false} compact={true}/>
                </div>
            </div>
        </div>
    )
}