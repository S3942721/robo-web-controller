import { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import ScrollBar from "./sub-components/ScrollBar";
import TriggerBehaviour from "./TriggerBehaviour";
import { useEffect, useState } from "react";

export default function ScrollControllers({ foldable, compact = false, triggers = false, activeRobot, mode = "Puppet" }) {
    const [scrollConfig, setScrollConfig] = useState({});
    const [scrollValues, setScrollValues] = useState({});
    const [robotScrolls, setRobotScrolls] = useState({});

    // Fetch the config file once
    useEffect(() => {
        fetch("/api/scrollcontrollers-config")
            .then(r => r.json())
            .then(data => {
                console.log("Fetched scroll controllers config:", data);
                setScrollConfig(data);
            })
            .catch(e => console.error("Error loading scrollControllersConfig:", e));
    }, []);

    // Whenever activeRobot or scrollConfig changes, load or initialize values
    useEffect(() => {
        if (Object.keys(scrollConfig).length > 0) {
            const configForRobot = scrollConfig[activeRobot] || scrollConfig["Default"];
            if (!configForRobot) return;
            if (robotScrolls[activeRobot]) {
                console.log(`Loading stored scroll values for ${activeRobot}:`, robotScrolls[activeRobot]);
                setScrollValues(robotScrolls[activeRobot]);
            } else {
                // Initialize from config
                const initialValues = {};
                for (const key in configForRobot) {
                    initialValues[key] = Number(configForRobot[key].initial);
                }
                console.log(`Initializing scroll values for ${activeRobot} from config:`, initialValues);
                setScrollValues(initialValues);
                setRobotScrolls(prev => ({ ...prev, [activeRobot]: initialValues }));
            }
        }
    }, [activeRobot, scrollConfig]);

    function handleScrollChange(key, value) {
        setScrollValues(prev => {
            const updated = { ...prev, [key]: Number(value) };
            setRobotScrolls(rs => ({ ...rs, [activeRobot]: updated }));
            // Persist the new value if needed:
            const signal = scrollConfig[activeRobot]?.[key]?.signal || scrollConfig["Default"]?.[key]?.signal;
            if (signal) {
                requestWS("req-execute", {
                    type: "trigger",
                    message: { Signal: signal, Value: Number(value) },
                    robot: activeRobot
                });
            }
            return updated;
        });
    }

    return (
        <FoldableSection title={"Numerical Triggers"} foldable={foldable} compact={compact}>
            <div className="scroll-controllers-grid">
                <div className="scroll-controllers-numerical">
                    {/* Dynamically render scroll bars based on scrollValues */}
                    {Object.keys(scrollValues).map((sliderKey) => {
                        const conf = scrollConfig[activeRobot]?.[sliderKey] 
                                     ?? scrollConfig["Default"]?.[sliderKey];
                        // Skip if no config found:
                        if (!conf) {
                            console.warn(`No config found for slider "${sliderKey}". Skipping.`);
                            return null;
                        }
                        const { signal, ...restConfig } = conf;
                        return (
                            <ScrollBar
                                key={sliderKey}
                                name={sliderKey}
                                signal={signal}
                                value={scrollValues[sliderKey]}
                                {...restConfig} // includes min, max, step, etc.
                                onChange={(val) => handleScrollChange(sliderKey, val)}
                                compact={compact}
                            />
                        );
                    })}
                    
                    {/* Add movement controls when in Chat mode */}
                    {mode === "Chat" && (
                        <div className="movement-controls-compact">
                            <div style={{ fontWeight: 'bold', marginBottom: '8px', color: 'var(--primary-color)' }}>
                                Movement Controls
                            </div>
                            {/* These would need to be hooked up to the movement system */}
                            <ScrollBar
                                name="Movement Speed"
                                value={0.3}
                                min={0}
                                max={1}
                                step={0.1}
                                onChange={(val) => console.log("Movement speed:", val)}
                                compact={compact}
                            />
                            <ScrollBar
                                name="Turn Speed"
                                value={0.5}
                                min={0}
                                max={2}
                                step={0.1}
                                onChange={(val) => console.log("Turn speed:", val)}
                                compact={compact}
                            />
                            <ScrollBar
                                name="Move Timeout"
                                value={3}
                                min={0}
                                max={10}
                                step={0.5}
                                onChange={(val) => console.log("Move timeout:", val)}
                                compact={compact}
                            />
                        </div>
                    )}
                </div>
                {triggers && (
                    <div className="scroll-controllers-triggers">
                        <TriggerBehaviour foldable={false} compact={true} activeRobot={activeRobot} />
                    </div>
                )}
            </div>
        </FoldableSection>
    );
}