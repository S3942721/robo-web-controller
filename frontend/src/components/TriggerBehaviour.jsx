import { useState } from "react"
import { triggers } from "../utils/types"
import Trigger from "./sub-components/Trigger"

export default function TriggerBehaviour({send}) {

    const [t, setTriggers] = useState(triggers)

    function sendTriggerUpdate(name, status) {
        send('trigger', { name, status })
    }

    return (
        <section>
            { Object.keys(t).map((trigger, index)=>{
                const status = t[trigger]
                return (
                    <Trigger 
                        key={`trigger-${index}` } 
                        title={trigger} status={status} 
                        setStatus={(s)=>setTriggers({...t, [trigger]: s})} 
                        sendTriggerUpdate={sendTriggerUpdate}
                    />
                )
            }) }
        </section>
    )
}