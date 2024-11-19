import { useEffect, useState } from "react";
import { getScript } from "../utils/types";

export default function PreDefinedScripts({ profile, send }) {
    
    const [scripts, setAllScripts] = useState({});
    const [arrScripts, setArrScripts] = useState([]);
    const [s, setScript] = useState("");

    function executeSelectedScript() {
        send('script', scripts[s]);
    }



    useEffect(()=>{
        const all_scripts = getScript(profile)
        setAllScripts(all_scripts);
        const script_keys = Object.keys(all_scripts);
        setScript(script_keys[0] ?? "")
        setArrScripts(script_keys)
    }, [profile])

    function switchSelect(way) {
        let idx = arrScripts.indexOf(s)
        if(way === 'next') {
            if(++idx >= arrScripts.length) {
                idx = 0;
            }
        } else if(way === 'last') {
            if(--idx < 0) {
                idx = arrScripts.length - 1;
            }
        }
        setScript(arrScripts[idx])
    }

    return (
        <section>
            <h1>Pre-Defined Scripts</h1>
            { arrScripts.map((script_name, i)=>{
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
            <div className="inline-btns">
                <div className="btn" onClick={()=>switchSelect('last')}>Switch to Last Script</div>
                <div className="btn" onClick={executeSelectedScript}>Execute Selected Script</div>
                <div className="btn" onClick={()=>switchSelect('next')}>Switch to Next Script</div>
            </div>
        </section>
    )
}