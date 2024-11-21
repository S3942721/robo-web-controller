import { requestWS } from "../utils/useWebSocket";
import ScrollBar from "./sub-components/ScrollBar";

export default function ScrollControllers() {
    return (
        <section>
            <h1>Numerical Triggers</h1>
            <ScrollBar name='Adjust Volume' initial={50} callback={vol=>{
                requestWS('req-execute', { type: 'trigger', message: {Signal: 'Volume', Value: vol} })
            }} />
        </section>
    )
}