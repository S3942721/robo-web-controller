import { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import ScrollBar from "./sub-components/ScrollBar";

export default function ScrollControllers( { foldable, compact=false } ) {

    function updateCallback(Signal) {
        return function(Value) {
            requestWS('req-execute', { type: 'trigger', message: {Signal, Value} })
        }
    }

    return (
        <FoldableSection title={"Numerical Triggers"} foldable={foldable} compact={compact}>
            <ScrollBar compact={compact} name='Adjust Volume' initial={80} callback={updateCallback("Volume")} />
            <ScrollBar compact={compact} name='Response Speed' initial={90} max={120} min={40} callback={updateCallback("ChangeResponseSpeed")} />
            <ScrollBar compact={compact} name='Sentence Pause (x200ms)' initial={4} max={10} min={1} callback={updateCallback("ChangeSentencePause")} />
            <ScrollBar compact={compact} name='Greet Face Lost Timeout' initial={1} max={5} min={0.5} step={0.5} callback={updateCallback("ChangeGreetFaceLostTimeout")} />
            <ScrollBar compact={compact} name='Greet Timeout' initial={3} max={10} min={1} step={0.5} callback={updateCallback("ChangeGreetTimeout")} />
        </FoldableSection>
    )
}