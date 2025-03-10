import { useEffect, useState, useCallback, useRef } from "react";
import { requestWS } from "../../utils/useWebSocket";
import { Arrow90degLeft, Arrow90degRight, CaretDown, CaretLeft, CaretRight, CaretUp } from "./../icons";
import ScrollBar from "./../sub-components/ScrollBar";
import FoldableSection from "./../FoldableSection";
import SelectProfile from "../SelectProfile";

// New slider config and persistence code:
export default function MoveController({ foldable, compact = false, profile_switcher = false, activeRobot }) {
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
    const [robotSliders, setRobotSliders] = useState({});

    // Add a ref to always have the current activeRobot
    const activeRobotRef = useRef(activeRobot);
    useEffect(() => {
        activeRobotRef.current = activeRobot;
    }, [activeRobot]);

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

    // When activeRobot or sliderConfig changes, load slider values.
    useEffect(() => {
        if (Object.keys(sliderConfig).length > 0) {
            const configForRobot = sliderConfig[activeRobot] || sliderConfig["Default"];
            if (robotSliders[activeRobot]) {
                console.log(`Loading stored slider values for ${activeRobot}:`, robotSliders[activeRobot]);
                setSliderValues(robotSliders[activeRobot]);
            } else {
                const initialValues = {
                    MovementSpeed: Number(configForRobot.MovementSpeed.initial),
                    TurnSpeed: Number(configForRobot.TurnSpeed.initial),
                    MoveTimeout: Number(configForRobot.MoveTimeout.initial)
                };
                console.log(`Initializing slider values for ${activeRobot} from config:`, initialValues);
                setSliderValues(initialValues);
                setRobotSliders(prev => ({ ...prev, [activeRobot]: initialValues }));
            }
        }
    }, [activeRobot, sliderConfig]);

    // Update sliderValues and persist when a slider changes.
    const handleSliderChange = (key, value) => {
        lostFocus();
        setSliderValues(prev => {
            const updated = { ...prev, [key]: Number(value) };
            setRobotSliders(rs => ({ ...rs, [activeRobot]: updated }));
            console.log(`Updated ${activeRobot} slider ${key}:`, updated);
            requestWS("req-execute", {
                type: "config",
                message: { key, value: Number(value) },
                robot: activeRobot
            });
            return updated;
        });
    };

    // Update debounceKeyUpdate to use activeRobotRef.current
    function debounceKeyUpdate(key, holding) {
        if (debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key])
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            requestWS("req-execute", {
                type: "Move",
                message: { key, holding },
                robot: activeRobotRef.current
            });
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
        requestWS("req-execute", {
            type: "ConMove",
            message: { x: 0, y: 0, hx: 0, hy: 0 },
            robot: ""
        });
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
                    if (newY < -0.1) setKey('W', true); else setKey('W', false);
                    if (newY > 0.1) setKey('S', true); else setKey('S', false);
                    if (newX < -0.1) setKey('A', true); else setKey('A', false);
                    if (newX > 0.1) setKey('D', true); else setKey('D', false);
                    if (headY < -0.1) setKey('ARROWUP', true); else setKey('ARROWUP', false);
                    if (headY > 0.1) setKey('ARROWDOWN', true); else setKey('ARROWDOWN', false);
                    if (headX < -0.1) setKey('ARROWLEFT', true); else setKey('ARROWLEFT', false);
                    if (headX > 0.1) setKey('ARROWRIGHT', true); else setKey('ARROWRIGHT', false);
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
    }, []);

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
                    max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.max}
                    min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.min}
                    step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.step}
                    onChange={(val) => handleSliderChange("MovementSpeed", val)}
                    compact={true}
                />
                <ScrollBar 
                    name='Turn speed (rad/s)' 
                    value={sliderValues.TurnSpeed}
                    max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.max}
                    min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.min}
                    step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.step}
                    onChange={(val) => handleSliderChange("TurnSpeed", val)}
                    compact={true}
                />
                <ScrollBar 
                    name='Move Timeout (s)' 
                    value={sliderValues.MoveTimeout}
                    max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.max}
                    min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.min}
                    step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.step}
                    onChange={(val) => handleSliderChange("MoveTimeout", val)}
                    compact={true}
                />
                {profile_switcher && (
                    <div className="scroll-controllers-triggers">
                        <SelectProfile foldable={false} compact={true} />
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
                max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.max}
                min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.min}
                step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MovementSpeed.step}
                onChange={(val) => handleSliderChange("MovementSpeed", val)}
            />
            <ScrollBar 
                name='Turn speed (rad/s)' 
                value={sliderValues.TurnSpeed}
                max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.max}
                min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.min}
                step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.TurnSpeed.step}
                onChange={(val) => handleSliderChange("TurnSpeed", val)}
            />
            <ScrollBar 
                name='Move Timeout (s)' 
                value={sliderValues.MoveTimeout}
                max={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.max}
                min={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.min}
                step={(sliderConfig[activeRobot] || sliderConfig["Default"])?.MoveTimeout.step}
                onChange={(val) => handleSliderChange("MoveTimeout", val)}
            />
        </FoldableSection>
    );
}
