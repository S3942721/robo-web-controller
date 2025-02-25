import { useEffect, useState, useCallback, useRef } from "react";
import { requestWS } from "../utils/useWebSocket";
import { Arrow90degLeft, Arrow90degRight, CaretDown, CaretLeft, CaretRight, CaretUp } from "./icons";
import ScrollBar from "./sub-components/ScrollBar";
import FoldableSection from "./FoldableSection";

export default function MoveController() {

    const [keys, setKeys] = useState({
        W: false,
        A: false,
        S: false,
        D: false,
        E: false,
        Q: false,
        ARROWUP: false,
        ARROWDOWN: false,
        ARROWLEFT: false,
        ARROWRIGHT: false,
    });

    const [x, setX] = useState(0);
    const [y, setY] = useState(0);

    const debounceTimeouts = useRef({});

    function debounceKeyUpdate(key, holding) {
        if(debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key])
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            requestWS("req-execute", { type: "Move", message: { key, holding } })
        }, 10);
    }

    const setKey = useCallback((key, holding) => {
        setKeys((prevKeys) => {
            if (prevKeys[key] === holding) return prevKeys;
            debounceKeyUpdate(key, holding);
            return { ...prevKeys, [key]: holding };
        });
    }, []);

    const handleKeyDown = (event) => {
        const key = event.key.toUpperCase();
        if (Object.hasOwn(keys, key)) {
            setKey(key, true);
        }
    };

    const handleKeyUp = (event) => {
        const key = event.key.toUpperCase();
        if (Object.hasOwn(keys, key)) {
            setKey(key, false);
        }
    };

    function lostFocus() {
        for(const i in keys) {
            setKey(i, false);
        }
    }

    function visibilityChange() {
        if(document.visibilityState === 'hidden') {
            lostFocus();
        }
    }

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        window.addEventListener('blur', lostFocus);
        document.addEventListener('visibilitychange', visibilityChange);

        const interval = setInterval(() => {
            const controller = navigator.getGamepads()[0];
            if (controller) {
                const newX = Math.abs(controller.axes[0]) < 0.06 ? 0.00 : controller.axes[0].toFixed(2);
                const newY = Math.abs(controller.axes[1]) < 0.06 ? 0.00 : controller.axes[1].toFixed(2);
                const newZ = Math.abs(controller.axes[1]) < 0.06 ? 0.00 : controller.axes[3].toFixed(2)
                setX(newX);
                setY(newY);
                setZ(newZ);
                if (newX !== 0 || newY !== 0 || newZ !== 0){
                    controller.vibrationActuator.playEffect("dual-rumble", {
                        startDelay: 0,
                        duration: 200,
                        weakMagnitude: 1.0,
                        strongMagnitude: 1.0,
                    });
                    requestWS("req-execute", { type: "ConMove", message: { x: newX, y: newY, z: newZ} });
                }
            }
        }, 10);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener('blur', lostFocus);
            document.removeEventListener('visibilitychange', visibilityChange);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function updateCallback(Signal) {
        return function(Value) {
            requestWS('req-execute', { type: 'trigger', message: {Signal, Value} })
        }
    }

    return (
        <FoldableSection title={"Movement Controller"}>
            <div>X {x}</div>
            <div>Y {y}</div>
            <div className="movement-controller">
                <div className={`direction W     ${keys.W?"holding":""}`}><CaretUp /></div>
                <div className={`direction A     ${keys.A?"holding":""}`}><CaretLeft /></div>
                <div className={`direction S     ${keys.S?"holding":""}`}><CaretDown /></div>
                <div className={`direction D     ${keys.D?"holding":""}`}><CaretRight /></div>
                <div className={`rotation  E     ${keys.E?"holding":""}`}><Arrow90degRight /></div>
                <div className={`rotation  Q     ${keys.Q?"holding":""}`}><Arrow90degLeft /></div>
                <div className={`head-pos  UP    ${keys.ARROWUP?"holding":""}`}><CaretUp /></div>
                <div className={`head-pos  DOWN  ${keys.ARROWDOWN?"holding":""}`}><CaretDown /></div>
                <div className={`head-pos  LEFT  ${keys.ARROWLEFT?"holding":""}`}><CaretLeft /></div>
                <div className={`head-pos  RIGHT ${keys.ARROWRIGHT?"holding":""}`}><CaretRight /></div>
            </div>
            <ScrollBar name='Movement speed (m/s)' initial={0.3} max={0.55} min={0.1} step={0.05} callback={updateCallback("ControlMovementSpeed")} />
            <ScrollBar  name='Turn speed (rad/s)' initial={0.6} max={2} min={0.2} step={0.05} callback={updateCallback("ControlTurnSpeed")} />
            <ScrollBar name='Move Timeout (s)' initial={4} max={20} min={0.5} step={0.5} callback={updateCallback("ControlMovementTimeout")} />
        </FoldableSection>
    );
}
