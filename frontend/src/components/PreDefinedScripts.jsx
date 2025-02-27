import { useEffect, useState, useRef } from "react";
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";

export default function PreDefinedScripts({ controller, resetController, foldable, compact }) {
    
    const { scripts } = useWebSocket();
    const [arrScripts, setArrScripts] = useState([]);
    const [s, setScript] = useState("");
    const [executed, setExecuted] = useState(false);
    const scriptContainerRef = useRef(null);

    function executeSelectedScript() {
        requestWS("req-execute", {type: "script", message:scripts[s]});
        setExecuted(true);
        setTimeout(() => setExecuted(false), 2000);
    }

    useEffect(()=>{
        const script_keys = Object.keys(scripts);
        setScript(script_keys[0] ?? "")
        setArrScripts(script_keys)
    }, [scripts])

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

    useEffect(()=>{
        if(controller) {
            switch(controller) {
                case 'Enter':
                    executeSelectedScript(); break;
                case 'ArrowUp':
                    switchSelect('last'); break;
                case 'ArrowDown':
                    switchSelect('next'); break;
            }
            resetController();
        }
    // eslint-disable-next-line
    }, [controller])

    useEffect(() => {
        if (compact && scriptContainerRef.current) {
            const selectedScript = scriptContainerRef.current.querySelector('.selected');
            if (selectedScript) {
                selectedScript.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [s, compact]);

    if (compact) {
        return (
            <FoldableSection title={"Pre-Defined Scripts"} foldable={foldable} compact={compact}>
                <div className="script-container" ref={scriptContainerRef}>
                    { arrScripts.map((script_name, i)=>{
                        const script_value = scripts[script_name];
                        return (
                            <div 
                                key={`script-${i}`} 
                                className={`script clickable${s === script_name ? ' selected' : ""}${executed && s === script_name ? ' executed' : ""}`} 
                                onClick={()=>setScript(script_name)}
                            >
                                <div className="script-name">{script_name}</div>
                                <div className="script-value">{script_value}</div>
                            </div>
                        )
                    }) }
                </div>
                <div className="inline-btns">
                    <div className="btn" onClick={()=>switchSelect('last')}>Switch to Last Script</div>
                    <div className="btn" onClick={executeSelectedScript}>Execute Selected Script</div>
                    <div className="btn" onClick={()=>switchSelect('next')}>Switch to Next Script</div>
                </div>
            </FoldableSection>
        )
    }

    return (
        <FoldableSection title={"Pre-Defined Scripts"}>
            { arrScripts.map((script_name, i)=>{
                const script_value = scripts[script_name];
                return (
                    <div 
                        key={`script-${i}`} 
                        className={`script clickable${s === script_name ? ' selected' : ""}${executed && s === script_name ? ' executed' : ""}`} 
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
        </FoldableSection>
    )
}