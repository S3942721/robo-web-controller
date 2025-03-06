import { useEffect, useState, useRef } from "react";
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import { TbXboxAFilled } from "react-icons/tb";
import { FaCaretSquareDown, FaCaretSquareUp } from "react-icons/fa";

export default function PreDefinedScripts({ controller, resetController, foldable, compact, activeRobot }) {
    
    const { scripts } = useWebSocket();
    const [arrScripts, setArrScripts] = useState([]);
    const [s, setScript] = useState("");
    const [executed, setExecuted] = useState(false);
    const scriptContainerRef = useRef(null);
    const lastButtonRef = useRef(null);
    const nextButtonRef = useRef(null);
    const executeButtonRef = useRef(null);

    function executeSelectedScript() {
        const script = scripts[s];
        let robot, text;
        if (typeof script === 'string') {
            robot = activeRobot;
            text = script;
        } else {
            robot = script.robot || activeRobot;
            text = script.text;
        }
        requestWS("req-execute", { type: "script", message: { robot, text } });
        setExecuted(true);
        setTimeout(() => setExecuted(false), 2000);
    }

    useEffect(()=>{
        const script_keys = Object.keys(scripts);
        setScript(script_keys[0] ?? "")
        setArrScripts(script_keys)
    }, [scripts])

    function switchSelect(way) {
        let idx = arrScripts.indexOf(s);
        if (executed) {
            setExecuted(false);
        }
        if(way === 'next') {
            if(++idx >= arrScripts.length) {
                idx = 0;
            }
        } else if(way === 'last') {
            if(--idx < 0) {
                idx = arrScripts.length - 1;
            }
        }
        setScript(arrScripts[idx]);
    }

    useEffect(()=>{
        if(controller) {
            switch(controller) {
                case 'Enter':
                    executeSelectedScript(); break;
                case 'ArrowUp':
                case 'DPAD_UP':
                    lastButtonRef.current.click(); break;
                case 'ArrowDown':
                case 'DPAD_DOWN':
                    nextButtonRef.current.click(); break;
                case 'X':
                case 'A':
                    executeButtonRef.current.click(); break;
            }
            resetController();
        }
    // eslint-disable-next-line
    }, [controller])

    useEffect(() => {
        if (compact && scriptContainerRef.current) {
            const selectedScript = scriptContainerRef.current.querySelector('.selected');
            if (selectedScript) {
                const containerHeight = scriptContainerRef.current.clientHeight;
                const scriptHeight = selectedScript.clientHeight;
                const scrollTop = selectedScript.offsetTop - (containerHeight / 2) + (scriptHeight / 2);
                scriptContainerRef.current.scrollTo({ top: scrollTop, behavior: 'smooth' });
            }
        }
    }, [s, compact]);

    useEffect(() => {
        const interval = setInterval(() => {
            const controller = navigator.getGamepads()[0];
            if (controller) {
                const dpadUp = controller.buttons[12].pressed;
                const dpadDown = controller.buttons[13].pressed;
                const execute = controller.buttons[0].pressed; // A button on Xbox controller
                if (dpadUp) {
                    lastButtonRef.current.click();
                } else if (dpadDown) {
                    nextButtonRef.current.click();
                } else if (execute) {
                    executeButtonRef.current.click();
                }
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

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
                    <div className="btn" ref={lastButtonRef} onClick={()=>switchSelect('last')}>
                        <FaCaretSquareUp style={{ display: 'block', margin: 'auto' }} /> Prev Line
                    </div>
                    <div className="btn" ref={executeButtonRef} onClick={executeSelectedScript}>
                        <TbXboxAFilled style={{ fontSize: '1.0em', display: 'block', margin: 'auto' }} /> Execute Line
                    </div>
                    <div className="btn" ref={nextButtonRef} onClick={()=>switchSelect('next')}>
                        <FaCaretSquareDown style={{ display: 'block', margin: 'auto' }} /> Next Line
                    </div>
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