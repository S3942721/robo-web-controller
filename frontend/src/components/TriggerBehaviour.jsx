import Trigger from "./sub-components/Trigger"
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import { useEffect, useState } from "react";
import { usePersistentState } from "../utils/persistentState";

const TRIGGERS_STATE_KEY = 'web-controller.trigger-behaviour.robot-values'

export default function TriggerBehaviour({ foldable=true, compact=false, activeRobot }) {

    const [triggersConfig, setTriggersConfig] = useState({});
    const [robotTriggers, setRobotTriggers] = usePersistentState(TRIGGERS_STATE_KEY, {});
    const [triggerValues, setTriggerValues] = useState({});

    // Fetch triggers config once
    useEffect(() => {
        fetch("/api/triggers-config")
            .then(r => r.json())
            .then(data => {
                console.log("Fetched triggers config:", data);
                setTriggersConfig(data);
            })
            .catch(e => console.error("Error loading triggers config:", e));
    }, []);

    // Whenever activeRobot or triggersConfig changes, load or init triggers
    useEffect(() => {
        if (Object.keys(triggersConfig).length > 0) {
            const configForRobot = triggersConfig[activeRobot] || triggersConfig["Default"];
            if (!configForRobot) return;
            if (robotTriggers[activeRobot]) {
                console.log(`Loading stored triggers for ${activeRobot}:`, robotTriggers[activeRobot]);
                setTriggerValues(robotTriggers[activeRobot]);
            } else {
                const initial = {};
                for (const key in configForRobot) {
                    initial[key] = { ...configForRobot[key] };
                }
                console.log(`Initializing triggers for ${activeRobot}:`, initial);
                setTriggerValues(initial);
                setRobotTriggers(prev => ({ ...prev, [activeRobot]: initial }));
            }
        }
    }, [activeRobot, triggersConfig]);

    function handleTriggerUpdate(name) {
        setTriggerValues(prev => {
            const updated = { ...prev, [name]: { ...prev[name], Value: !prev[name]?.Value } };
            setRobotTriggers(rs => ({ ...rs, [activeRobot]: updated }));
            requestWS("req-execute", {
                type: "trigger",
                message: { name, Signal: updated[name].Signal, Value: updated[name].Value },
                robot: activeRobot
            });
            return updated;
        });
    }

    function sendAllUpdates() {
        const arr = Object.keys(triggerValues).map(k => ({
            name: k,
            Signal: triggerValues[k].Signal,
            Value: triggerValues[k].Value
        }));
        requestWS("req-execute", {
            type: "trigger-all",
            message: { updates: arr },
            robot: activeRobot
        });
    }

    return (
        <FoldableSection title={'Triggers'} foldable={foldable} compact={compact}>
            <div className="trigger-buttons-grid">
                { Object.keys(triggerValues).map((triggerName, index) => {
                    const { Value } = triggerValues[triggerName];
                    return (
                        <div
                            key={`trigger-${index}`}
                            className={`trigger-button ${Value ? 'active' : ''}`}
                            onClick={() => handleTriggerUpdate(triggerName)}
                        >
                            {triggerName}
                        </div>
                    );
                })}
            </div>
            <div className="btn" onClick={sendAllUpdates}>Update All Triggers</div>
        </FoldableSection>
    );
}