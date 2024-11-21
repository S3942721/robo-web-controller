import { requestWS } from "../utils/useWebSocket";
import ScrollBar from "./sub-components/ScrollBar";

export default function ScrollControllers() {
    return (
        <section>
            <h1>Numerical Triggers</h1>
            <ScrollBar name='Adjust Volume' initial={50} callback={vol=>{
                requestWS('req-execute', { type: 'trigger', message: {Signal: 'Volume', Value: vol} })
            }} />
            <ScrollBar name='Greet Face Lost Timeout' initial={3} max={5} min={0.5} step={0.5} callback={timeout=>{
                requestWS('req-execute', { type: 'trigger', message: {Signal: 'ChangeGreetFaceLostTimeout', Value: timeout} })
            }} />
            <ScrollBar name='Greet Timeout' initial={1} max={10} min={1} step={0.5} callback={timeout=>{
                requestWS('req-execute', { type: 'trigger', message: {Signal: 'ChangeGreetTimeout', Value: timeout} })
            }} />
        </section>
    )
}