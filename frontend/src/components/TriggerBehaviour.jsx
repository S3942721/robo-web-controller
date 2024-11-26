import Trigger from "./sub-components/Trigger"
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";

export default function TriggerBehaviour() {

    const { triggers, setTriggers } = useWebSocket();

    function sendTriggerUpdate(name, s) {
        requestWS("req-execute", {type: "trigger", message: { name, ...s }})
    }

    function sendAllUpdates() {
        requestWS("req-execute", {
            type: "trigger-all", message: Object.keys(triggers).map(name=>{
                const { Signal, Value } = triggers[name];
                return { name, Signal, Value };
            })
        })
    }

    return (
        <FoldableSection title={'Triggers'}>
            { Object.keys(triggers).map((trigger, index)=>{
                const { Signal, Value } = triggers[trigger]
                return (
                    <Trigger 
                        key={`trigger-${index}` } 
                        title={trigger} signal={Signal} value={Value}
                        setStatus={(s)=>setTriggers({...triggers, [trigger]: s})} 
                        sendTriggerUpdate={sendTriggerUpdate}
                    />
                )
            }) }
            <div className="btn" onClick={sendAllUpdates}>Update All Triggers</div>
        </FoldableSection>
    )
}