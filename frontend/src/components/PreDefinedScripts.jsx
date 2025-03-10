import { useEffect, useState, useRef } from "react";
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import { robotColors } from "../utils/robotColors";
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
    const debounceTimeouts = useRef({});

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
        requestWS("req-execute", { type: "script", message: text, robot });
        setExecuted(true);
        setTimeout(() => setExecuted(false), 2000);
    }

    useEffect(()=>{
        const keys = Object.keys(scripts);
        if(keys.length > 0) {
            setScript(keys[0]);
            setArrScripts(keys);
        } else {
            setScript("");
            setArrScripts([]);
        }
    }, [scripts]);

    function switchSelect(way) {
        let idx = arrScripts.indexOf(s);
        if (executed) {
            setExecuted(false);
        }
        if(way === 'next') {
            if(++idx >= arrScripts.length) { idx = 0; }
        } else if(way === 'last') {
            if(--idx < 0) { idx = arrScripts.length - 1; }
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
    }, [controller]);

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

    // Debounce function to handle key updates
    function debounceKeyUpdate(key, holding, callback, debounceTime = 500) {
        if (debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key]);
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            callback();
        }, debounceTime);
    }

    useEffect(() => {
        const interval = setInterval(() => {
            const controller = navigator.getGamepads()[0];
            if (controller) {
                const dpadUp = controller.buttons[12].pressed;
                const dpadDown = controller.buttons[13].pressed;
                const execute = controller.buttons[0].pressed;
                if (dpadUp) {
                    debounceKeyUpdate('dpadUp', true, () => {
                        lastButtonRef.current.click();
                    }, 125);
                } else if (dpadDown) {
                    debounceKeyUpdate('dpadDown', true, () => {
                        nextButtonRef.current.click();
                    }, 125);
                } else if (execute) {
                    debounceKeyUpdate('execute', true, () => {
                        executeButtonRef.current.click();
                    }, 125);
                }
            }
        }, 100);
        return () => clearInterval(interval);
    }, []);

    const renderScriptItem = (script_name, i) => {
        const scriptObj = scripts[script_name];
        // If script obj undefined or null, set to empty string
        if (!scriptObj) { return null; }
        const assignedRobot = typeof scriptObj === "string" ? "" : (scriptObj.robot || "");
        const text = typeof scriptObj === "string" ? scriptObj : (scriptObj.text || "");
        const activeRobotOrDefault = activeRobot || "Default";
        const baseStyle = assignedRobot && robotColors[assignedRobot] 
            ? { backgroundColor: robotColors[assignedRobot].light } 
            : { backgroundColor: robotColors[activeRobotOrDefault].light };
        const selectedStyle = s === script_name && assignedRobot && robotColors[assignedRobot]
            ? { border: `5px dashed ${robotColors[assignedRobot].border}` }
            : s === script_name
            ? { border: `5px dashed ${robotColors[activeRobotOrDefault].border}` }
            : {};
        const combinedStyle = { ...baseStyle, ...selectedStyle };
        return (
            <div 
                key={`script-${i}`} 
                className={`script clickable${s === script_name ? ' selected' : ""}${executed && s === script_name ? ' executed' : ""}`} 
                onClick={() => setScript(script_name)}
                style={combinedStyle}
            >
                <div className="script-name">{script_name} {assignedRobot && <small>({assignedRobot})</small>}</div>
                <div className="script-value">{text}</div>
            </div>
        );
    };

    if (compact) {
        return (
            <FoldableSection title={"Pre-Defined Scripts"} foldable={foldable} compact={compact}>
                <div className="script-container" ref={scriptContainerRef}>
                    { arrScripts.map((script_name, i) => renderScriptItem(script_name, i)) }
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
        );
    }

    return (
        <FoldableSection title={"Pre-Defined Scripts"}>
            { arrScripts.map((script_name, i) => renderScriptItem(script_name, i)) }
            <div className="inline-btns">
                <div className="btn" onClick={()=>switchSelect('last')}>Switch to Last Script</div>
                <div className="btn" onClick={executeSelectedScript}>Execute Selected Script</div>
                <div className="btn" onClick={()=>switchSelect('next')}>Switch to Next Script</div>
            </div>
        </FoldableSection>
    );
}