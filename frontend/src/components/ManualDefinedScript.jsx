import { useState } from "react"
import { requestWS } from "../utils/useWebSocket";

export default function ManualDefinedScript() {

    const [script, setScript] = useState('')

    function executeScript() {
        if(!script) return;
        setScript('');
        requestWS('req-execute', {type: "script", message: script })
    }

    return (
        <section>
            <form onSubmit={evt=>{
                evt.preventDefault();
                executeScript();
            }}>
                <input 
                    type="text"
                    className="manual-script" 
                    value={script} 
                    onInput={event=>setScript(event.target.value)}
                    placeholder="Please input script to trigger."
                />
                <div className="btn" onClick={executeScript}>Execute Current Script</div>
            </form>
        </section>
    )
}