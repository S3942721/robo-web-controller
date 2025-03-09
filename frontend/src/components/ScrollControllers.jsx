import { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import ScrollBar from "./sub-components/ScrollBar";
import TriggerBehaviour from "./TriggerBehaviour";

export default function ScrollControllers({ foldable, compact = false, triggers = false }) {

    function updateCallback(Signal) {
        return function(Value) {
            requestWS('req-execute', { type: 'trigger', message: { Signal, Value } });
        };
    }

    return (
        <FoldableSection title={"Numerical Triggers"} foldable={foldable} compact={compact}>
            <div className="scroll-controllers-grid">
                <div className="scroll-controllers-numerical">
                    <ScrollBar compact={compact} name='Adjust Volume' initial={80} callback={updateCallback("Volume")} />
                </div>
                {triggers && (
                    <div className="scroll-controllers-triggers">
                        <TriggerBehaviour foldable={false} compact={true} />
                    </div>
                )}
            </div>
        </FoldableSection>
    );
}