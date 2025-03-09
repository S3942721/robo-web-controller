import { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import ScrollBar from "./sub-components/ScrollBar";
import TriggerBehaviour from "./TriggerBehaviour";
import { useEffect, useState } from "react";

export default function ScrollControllers({ foldable, compact = false, triggers = false, activeRobot }) {
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
            // If config is null or undefined, return
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
            requestWS("req-execute", { type: "config", message: { key, value: Number(value) }, robot: activeRobot });
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
                        return (
                            <ScrollBar
                                key={sliderKey}
                                name={sliderKey}
                                value={scrollValues[sliderKey]}
                                min={conf.min}
                                max={conf.max}
                                step={conf.step}
                                onChange={(val) => handleScrollChange(sliderKey, val)}
                                compact={compact}
                            />
                        );
                    })}
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