import { useState } from "react";
import { scripts } from "../utils/types";

export default function PreDefinedScripts({ send }) {

    const [s, setScript] = useState(Object.keys(scripts)[0]);

    function executeSelectedScript() {
        send('script', scripts[s]);
    }

    return (
        <section>
            <h1>Pre-Defined Scripts</h1>
            { Object.keys(scripts).map((script_name, i)=>{
                const script_value = scripts[script_name];
                return (
                    <div 
                        key={`script-${i}`} 
                        className={`script clickable${s === script_name ? ' selected' : ""}`} 
                        onClick={()=>setScript(script_name)}
                    >
                        <div className="script-name">{script_name}</div>
                        <div className="script-value">{script_value}</div>
                    </div>
                )
            }) }
            <div className="btn" onClick={executeSelectedScript}>Execute Selected Script</div>
        </section>
    )
}