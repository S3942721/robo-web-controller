import useWebSocket, { requestWS } from "../../utils/useWebSocket";
import FoldableSection from "../FoldableSection";

export default function ShortCuts({ full_screen }) {
    const {
        shortcuts
    } = useWebSocket();

    function sendShortCut(name) {
        let command_to_pick;
        const val = shortcuts[name]
        if(Array.isArray(val)) {
            command_to_pick = val[Math.floor(Math.random() * val.length)]
        } else {
            command_to_pick = val;
        }
        requestWS('req-execute', {type:'shortcut', message: command_to_pick})
    }

    return (
        <FoldableSection className={full_screen ? 'full-screen' : ''} title={'Shortcuts'}>
            <div className="grid-shortcuts">
                {
                    Object.keys(shortcuts).map((name, index)=>{
                        return (
                            <div 
                                key={`shortcut-${index}`} 
                                className="shortcut"
                                onClick={()=>sendShortCut(name)}
                            >{name}</div>)
                    })
                }
            </div>
        </FoldableSection>
    )
}