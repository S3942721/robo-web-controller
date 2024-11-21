import Trigger from "./sub-components/Trigger"
import useWebSocket, { requestWS } from "../utils/useWebSocket";

export default function TriggerBehaviour() {

    const { triggers, setTriggers } = useWebSocket();

    function sendTriggerUpdate(name, status) {
        requestWS('req-update-trigger', { name, status });
        requestWS("req-execute", {type: "trigger", message: { name, status }})
    }

    function sendAllUpdates() {
        requestWS("req-execute", {
            type: "trigger-all", message: Object.keys(triggers).map(e=>{
                return { name: e, status: triggers[e] }
            })
        })
    }

    return (
        <section>
            { Object.keys(triggers).map((trigger, index)=>{
                const status = triggers[trigger]
                return (
                    <Trigger 
                        key={`trigger-${index}` } 
                        title={trigger} status={status} 
                        setStatus={(s)=>setTriggers({...triggers, [trigger]: s})} 
                        sendTriggerUpdate={sendTriggerUpdate}
                    />
                )
            }) }
            <div className="btn" onClick={sendAllUpdates}>Update All Triggers</div>
        </section>
    )
}