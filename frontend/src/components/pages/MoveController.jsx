import { useEffect, useState, useCallback, useRef } from "react";
import { requestWS } from "../../utils/useWebSocket";
import { Arrow90degLeft, Arrow90degRight, CaretDown, CaretLeft, CaretRight, CaretUp } from "./../icons";
import ScrollBar from "./../sub-components/ScrollBar";
import FoldableSection from "./../FoldableSection";
import SelectProfile from "../SelectProfile";
import { usePersistentState } from "../../utils/persistentState";

const MOVE_SLIDERS_KEY = 'web-controller.move-controller.robot-sliders'

// New slider config and persistence code:
export default function MoveController({ foldable, compact = false, profile_switcher = false, activeRobot, reloadTabletWebView, reloadingTablet }) {
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
    const [hx, setheadX] = useState(0);
    const [hy, setheadY] = useState(0);

    const debounceTimeouts = useRef({});
    const zeroCounter = useRef(0);

    const [sliderConfig, setSliderConfig] = useState({});
    const [sliderValues, setSliderValues] = useState({});
    const [robotSliders, setRobotSliders] = usePersistentState(MOVE_SLIDERS_KEY, {});

    // Fetch config once on mount
    useEffect(() => {
        fetch('/api/move-config')
          .then(res => res.json())
          .then(data => {
                console.log("Fetched move config:", data);
                setSliderConfig(data);
          })
          .catch(err => console.error("Error loading move config:", err));
    }, []);

    // Add a ref to always have the current activeRobot
    const activeRobotRef = useRef(activeRobot);
    useEffect(() => {
        activeRobotRef.current = activeRobot;
    }, [activeRobot]);

    // When activeRobot or sliderConfig changes, load slider values.
    useEffect(() => {
        if (Object.keys(sliderConfig).length > 0) {
            const configForRobot = sliderConfig[activeRobotRef.current] || sliderConfig["Default"];
            if (robotSliders[activeRobotRef.current]) {
                console.log(`Loading stored slider values for ${activeRobotRef.current}:`, robotSliders[activeRobotRef.current]);
                setSliderValues(robotSliders[activeRobotRef.current]);
            } else {
                const initialValues = {
                    MovementSpeed: Number(configForRobot.MovementSpeed.initial),
                    TurnSpeed: Number(configForRobot.TurnSpeed.initial),
                    MoveTimeout: Number(configForRobot.MoveTimeout.initial)
                };
                console.log(`Initializing slider values for ${activeRobotRef.current} from config:`, initialValues);
                setSliderValues(initialValues);
                setRobotSliders(prev => ({ ...prev, [activeRobotRef.current]: initialValues }));
            }
        }
    }, [activeRobotRef, sliderConfig]);

    // Update sliderValues and persist when a slider changes.
    const handleSliderChange = (key, value) => {
        setSliderValues(prev => {
            const updated = { ...prev, [key]: Number(value) };
            setRobotSliders(rs => ({ ...rs, [activeRobotRef.current]: updated }));
            console.log(`Updated ${activeRobotRef.current} slider ${key}:`, updated);
            const signal = sliderConfig[activeRobotRef.current]?.[key]?.signal || sliderConfig["Default"]?.[key]?.signal;
            if (signal) {
                requestWS("req-execute", {
                    type: "trigger",
                    message: { Signal: signal, Value: Number(value) },
                    robot: activeRobotRef.current
                });
            }
            return updated;
        });
    };

    // Debounce function to handle key updates
    function debounceKeyUpdate(key, holding, callback, debounceTime = 10) {
        if (debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key]);
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            callback();
        }, debounceTime);
    }

    const setKey = useCallback((key, holding) => {
        setKeys((prevKeys) => {
            if (prevKeys[key] === holding) return prevKeys;
            debounceKeyUpdate(key, holding, () => {
                requestWS("req-execute", {
                    type: "Move",
                    message: { key, holding },
                    robot: activeRobotRef.current
                });
            });
            return { ...prevKeys, [key]: holding };
        });
    }, [activeRobotRef]);

    const handleKeyDown = (event) => {
        const key = event.key.toUpperCase();
        if (Object.hasOwn(keys, key)) {
            setKey(key, true);
            updateDisplayValues(key, true);
        }
    };

    const handleKeyUp = (event) => {
        const key = event.key.toUpperCase();
        if (Object.hasOwn(keys, key)) {
            setKey(key, false);
            updateDisplayValues(key, false);
        }
    };

    function updateDisplayValues(key, holding) {
        const delta = holding ? 1 : -1;
        switch (key) {
            case 'W':
                setY(prevY => Math.max(-1, prevY - delta));
                break;
            case 'A':
                setX(prevX => Math.max(-1, prevX - delta));
                break;
            case 'S':
                setY(prevY => Math.min(1, prevY + delta));
                break;
            case 'D':
                setX(prevX => Math.min(1, prevX + delta));
                break;
            case 'ARROWUP':
                setheadY(prevHy => Math.max(-1, prevHy - delta));
                break;
            case 'ARROWDOWN':
                setheadY(prevHy => Math.min(1, prevHy + delta));
                break;
            case 'ARROWLEFT':
                setheadX(prevHx => Math.max(-1, prevHx - delta));
                break;
            case 'ARROWRIGHT':
                setheadX(prevHx => Math.min(1, prevHx + delta));
                break;
            default:
                break;
        }
    }

    function lostFocus() {
        for (const i in keys) {
            setKey(i, false);
            updateDisplayValues(i, false);
        }
    }

    function visibilityChange() {
        if (document.visibilityState === 'hidden') {
            lostFocus();
        }
    }

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        window.addEventListener('blur', lostFocus);
        document.addEventListener('visibilitychange', visibilityChange);

        let wasZero = false;
        const interval = setInterval(() => {
            const controller = navigator.getGamepads()[0];
            if (controller) {
                const newX = Math.abs(controller.axes[0]) < 0.1 ? 0.00 : controller.axes[0].toFixed(2);
                const newY = Math.abs(controller.axes[1]) < 0.1 ? 0.00 : controller.axes[1].toFixed(2);
                const headX = Math.abs(controller.axes[2]) < 0.1 ? 0.00 : controller.axes[2].toFixed(2);
                const headY = Math.abs(controller.axes[3]) < 0.1 ? 0.00 : controller.axes[3].toFixed(2);
                setX(newX);
                setY(newY);
                setheadX(headX);
                setheadY(headY);

                const allZero = newX == 0 && newY == 0 && headX == 0 && headY == 0;

                if (activeRobotRef.current === "Haku") {
                    // Send WASD and arrow keys for Haku
                    if (newY < -0.5) setKey('W', true); else setKey('W', false);
                    if (newY > 0.5) setKey('S', true); else setKey('S', false);
                    if (newX < -0.5) setKey('A', true); else setKey('A', false);
                    if (newX > 0.5) setKey('D', true); else setKey('D', false);
                    if (headY < -0.5) setKey('ARROWUP', true); else setKey('ARROWUP', false);
                    if (headY > 0.5) setKey('ARROWDOWN', true); else setKey('ARROWDOWN', false);
                    if (headX < -0.5) setKey('ARROWLEFT', true); else setKey('ARROWLEFT', false);
                    if (headX > 0.5) setKey('ARROWRIGHT', true); else setKey('ARROWRIGHT', false);
                } else {
                    // Send joystick input for Bandit
                    if (!allZero || (allZero && zeroCounter.current < 5)) {
                        requestWS("req-execute", {
                            type: "ConMove",
                            message: { x: newX, y: newY, hx: headX, hy: headY },
                            robot: activeRobotRef.current
                        });
                        if (allZero) {
                            zeroCounter.current += 1;
                        } else {
                            zeroCounter.current = 0;
                        }
                        wasZero = allZero;
                    }

                    if (!allZero) {
                        try {
                            controller.vibrationActuator.playEffect("dual-rumble", {
                                startDelay: 0,
                                duration: 200,
                                weakMagnitude: 1.0,
                                strongMagnitude: 1.0,
                            });
                        } catch (error) {
                            console.error("Vibration effect failed:", error);
                        }
                    }

                    // Debounce for A, X, B buttons and D-pad inputs
                    const buttons = controller.buttons;
                    if (buttons[0].pressed) debounceKeyUpdate('A', true, () => { /* A button action */ }, 125);
                    if (buttons[1].pressed) debounceKeyUpdate('B', true, () => { /* B button action */ }, 125);
                    if (buttons[2].pressed) debounceKeyUpdate('X', true, () => { /* X button action */ }, 125);
                    if (buttons[12].pressed) debounceKeyUpdate('DPAD_UP', true, () => { /* D-pad up action */ }, 125);
                    if (buttons[13].pressed) debounceKeyUpdate('DPAD_DOWN', true, () => { /* D-pad down action */ }, 125);
                    if (buttons[14].pressed) debounceKeyUpdate('DPAD_LEFT', true, () => { /* D-pad left action */ }, 125);
                    if (buttons[15].pressed) debounceKeyUpdate('DPAD_RIGHT', true, () => { /* D-pad right action */ }, 125);
                }
            }
        }, 10);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener('blur', lostFocus);
            document.removeEventListener('visibilitychange', visibilityChange);
            clearInterval(interval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function updateCallback(Signal) {
        return function (Value) {
            requestWS('req-execute', { type: 'trigger', message: { Signal, Value } })
        }
    }

    if (compact) {
        // Return compact version of the component
        return (
            <FoldableSection title={"Movement Controller"} foldable={foldable} compact={true}>
                <div className="joystick-container" style={{ marginBottom: '10px' }}>
                    <div className={`rotation compact ${keys.Q ? "holding" : ""}`}>
                        <Arrow90degLeft />
                    </div>
                    <div className="joystick-box">
                        <div
                            className="joystick-point"
                            style={{
                                left: `${(x * 50) + 50}%`,
                                top: `${(y * 50) + 50}%`
                            }}
                        />
                    </div>
                    <div className="joystick-box">
                        <div
                            className="joystick-point"
                            style={{
                                left: `${(hx * 50) + 50}%`,
                                top: `${(hy * 50) + 50}%`
                            }}
                        />
                    </div>
                    <div className={`rotation compact ${keys.E ? "holding" : ""}`}>
                        <Arrow90degRight />
                    </div>
                </div>
                <ScrollBar 
                    name='Movement speed (m/s)' 
                    value={sliderValues.MovementSpeed} 
                    max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.max}
                    min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.min}
                    step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.step}
                    onChange={(val) => handleSliderChange("MovementSpeed", val)}
                    compact={true}
                />
                <ScrollBar 
                    name='Turn speed (rad/s)' 
                    value={sliderValues.TurnSpeed}
                    max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.max}
                    min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.min}
                    step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.step}
                    onChange={(val) => handleSliderChange("TurnSpeed", val)}
                    compact={true}
                />
                <ScrollBar 
                    name='Move Timeout (s)' 
                    value={sliderValues.MoveTimeout}
                    max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.max}
                    min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.min}
                    step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.step}
                    onChange={(val) => handleSliderChange("MoveTimeout", val)}
                    compact={true}
                />
                {profile_switcher && (
                    <div className="scroll-controllers-triggers">
                        <SelectProfile 
                            foldable={false} 
                            compact={true} 
                            reloadTabletWebView={reloadTabletWebView}
                            reloadingTablet={reloadingTablet}
                            activeButton={activeRobotRef.current}
                        />
                    </div>
                )}
            </FoldableSection>
        );
    }
    return (

        <FoldableSection title={"Movement Controller"} foldable={foldable}>
            <div>X {x}</div>
            <div>Y {y}</div>
            <div>Hx {hx}</div>
            <div>Hy {hy}</div>
            <div className="movement-controller">
                <div className={`direction W     ${keys.W ? "holding" : ""}`}><CaretUp /></div>
                <div className={`direction A     ${keys.A ? "holding" : ""}`}><CaretLeft /></div>
                <div className={`direction S     ${keys.S ? "holding" : ""}`}><CaretDown /></div>
                <div className={`direction D     ${keys.D ? "holding" : ""}`}><CaretRight /></div>
                <div className={`rotation  E     ${keys.E ? "holding" : ""}`}><Arrow90degRight /></div>
                <div className={`rotation  Q     ${keys.Q ? "holding" : ""}`}><Arrow90degLeft /></div>
                <div className={`head-pos  UP    ${keys.ARROWUP ? "holding" : ""}`}><CaretUp /></div>
                <div className={`head-pos  DOWN  ${keys.ARROWDOWN ? "holding" : ""}`}><CaretDown /></div>
                <div className={`head-pos  LEFT  ${keys.ARROWLEFT ? "holding" : ""}`}><CaretLeft /></div>
                <div className={`head-pos  RIGHT ${keys.ARROWRIGHT ? "holding" : ""}`}><CaretRight /></div>
            </div>
            <ScrollBar 
                name='Movement speed (m/s)' 
                value={sliderValues.MovementSpeed} 
                max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.max}
                min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.min}
                step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MovementSpeed.step}
                onChange={(val) => handleSliderChange("MovementSpeed", val)}
            />
            <ScrollBar 
                name='Turn speed (rad/s)' 
                value={sliderValues.TurnSpeed}
                max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.max}
                min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.min}
                step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.TurnSpeed.step}
                onChange={(val) => handleSliderChange("TurnSpeed", val)}
            />
            <ScrollBar 
                name='Move Timeout (s)' 
                value={sliderValues.MoveTimeout}
                max={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.max}
                min={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.min}
                step={(sliderConfig[activeRobotRef.current] || sliderConfig["Default"])?.MoveTimeout.step}
                onChange={(val) => handleSliderChange("MoveTimeout", val)}
            />
        </FoldableSection>
    );
}
