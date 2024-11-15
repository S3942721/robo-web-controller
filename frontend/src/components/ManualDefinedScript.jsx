import { useState } from "react"

export default function ManualDefinedScript({ send }) {

    const [script, setScript] = useState('')

    function executeScript() {
        console.log(script)
        if(!script) return;
        setScript('');
        send('script', script);
    }

    return (
        <section>
            <textarea 
                className="manual-script" 
                value={script} 
                onInput={event=>setScript(event.target.value)}
                placeholder="Please input script to trigger."
            ></textarea>
            <div className="btn" onClick={executeScript}>Execute Current Script</div>
        </section>
    )
}