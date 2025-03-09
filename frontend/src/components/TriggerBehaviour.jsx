import Trigger from "./sub-components/Trigger"
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";

export default function TriggerBehaviour( { foldable=true, compact=false } ) {

    const { triggers, setTriggers } = useWebSocket();

    function sendTriggerUpdate(name, s) {
        requestWS("req-execute", {type: "trigger", message: { name, ...s }});
        setTriggers(prevTriggers => ({
            ...prevTriggers,
            [name]: { ...prevTriggers[name], Value: s.Value }
        }));
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
        <FoldableSection title={'Triggers'} foldable={foldable} compact={compact}>
            <div className="trigger-buttons-grid">
                { Object.keys(triggers).map((trigger, index)=>{
                    const { Signal, Value } = triggers[trigger]
                    return (
                        <div 
                            key={`trigger-${index}`} 
                            className={`trigger-button ${Value ? 'active' : ''}`} 
                            onClick={() => sendTriggerUpdate(trigger, { Signal, Value: !Value })}
                        >
                            {trigger}
                        </div>
                    )
                }) }
            </div>
        </FoldableSection>
    )
}