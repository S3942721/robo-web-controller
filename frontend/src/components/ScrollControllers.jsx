import { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import ScrollBar from "./sub-components/ScrollBar";

export default function ScrollControllers() {

    function updateCallback(Signal) {
        return function(Value) {
            requestWS('req-execute', { type: 'trigger', message: {Signal, Value} })
        }
    }

    return (
        <FoldableSection title={"Numerical Triggers"}>
            <ScrollBar name='Adjust Volume' initial={80} callback={updateCallback("Volume")} />
            <ScrollBar name='Response Speed' initial={90} max={120} min={40} callback={updateCallback("ChangeResponseSpeed")} />
            <ScrollBar name='Sentence Pause (x200ms)' initial={4} max={10} min={1} callback={updateCallback("ChangeSentencePause")} />
            <ScrollBar name='Greet Face Lost Timeout' initial={1} max={5} min={0.5} step={0.5} callback={updateCallback("ChangeGreetFaceLostTimeout")} />
            <ScrollBar name='Greet Timeout' initial={3} max={10} min={1} step={0.5} callback={updateCallback("ChangeGreetTimeout")} />
        </FoldableSection>
    )
}