import { useState } from "react";
import { scripts } from "../utils/types";

export default function PreDefinedScripts({ send }) {

    const [s, setScript] = useState(scripts[0]);

    function executeSelectedScript() {
        send('script', s);
    }

    return (
        <section>
            <h1>Pre-Defined Scripts</h1>
            { scripts.map((script, i)=>{
                return (
                    <div 
                        key={`script-${i}`} 
                        className={`script clickable${s === script ? ' selected' : ""}`} 
                        onClick={()=>setScript(script)}
                    >{script}</div>
                )
            }) }
            <div className="btn" onClick={executeSelectedScript}>Execute Selected Script</div>
        </section>
    )
}