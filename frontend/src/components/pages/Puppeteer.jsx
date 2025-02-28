import PreDefinedScripts from "../PreDefinedScripts";
import ScrollControllers from "../ScrollControllers";
import MoveController from "./MoveController";
import PagedShortCuts from "./PagedShortCuts";

export default function Puppeteer() {
    return (
        <div className={'full-screen-unscrollable'}>
            <div className={'grid-container'}>
                <div className={'grid-item'}>
                    <MoveController foldable={false} compact={true} profile_switcher={true}/>
                </div>
                <div className={'grid-item'}>
                    <PreDefinedScripts foldable={false} compact={true} />
                </div>
                <div className={'grid-item'}>
                    <ScrollControllers foldable={false} compact={true} triggers={true} />
                </div>
                <div className={'grid-item'}>
                    <PagedShortCuts foldable={false} compact={true} />
                </div>
            </div>
        </div>
    );
}