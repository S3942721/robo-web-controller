import { useState } from "react";
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";

export default function SelectAnnouncements() {

    const { announcements } = useWebSocket();
    const [announce, setAnnounce] = useState('');

    function selectedAnnouncement(event) {
        const option = event.target.value;
        if(!option) return;
        setAnnounce(option);
        requestWS("req-execute", { type: 'announcement', message: option })
    }

    return (
        <FoldableSection title="Select Announcements" >
            <select className="select-announces clickable" onChange={selectedAnnouncement}>
                <option value='' selected={!announce}>Please select an announcement</option>
                { Object.keys(announcements).map((e, i)=>{
                    return <option key={`announcement-${i}`} value={e} >{e}</option>
                }) }
            </select>
            <div className="include-announces">
                <h4>Announcements:</h4>
                <div className="lines">
                    { announcements[announce] ? announcements[announce].map((e, i)=>{
                        return <p key={`showing-announce-${i}`}>{e}</p>
                    }) : <p>No announcement included in this group!</p>}
                </div>
            </div>
        </FoldableSection>
    )
}