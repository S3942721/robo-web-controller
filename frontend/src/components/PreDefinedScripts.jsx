import { useEffect, useState } from "react";
import { getScript } from "../utils/types";

export default function PreDefinedScripts({ profile, send }) {
    
    const [scripts, setAllScripts] = useState({});
    const [s, setScript] = useState("");

    function executeSelectedScript() {
        send('script', scripts[s]);
    }

    useEffect(()=>{
        const all_scripts = getScript(profile)
        setAllScripts(all_scripts);
        setScript(Object.keys(all_scripts)[0] ?? "")
    }, [profile])

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