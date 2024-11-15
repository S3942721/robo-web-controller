import { useState } from "react";
import { profiles } from "../utils/types";

export default function SelectProfile({ send }) {

    const [p, setProfile] = useState(profiles[0])
    
    function sendUpdateProfile() {
        send('profile', p)
    }

    return (
        <section className="select-profile">
            <h1>Profiles</h1>
            { profiles.map((profile, index)=>{
                const { name, html, flags } = profile;
                return (
                    <div
                        key={`profile-${index}`}
                        className={`profile clickable ${name === p.name ? ' selected' : ''}`}
                        onClick={()=>setProfile(profile)}
                    >
                        <div className="name">{name}</div>
                        <div className="html">HTML File: {html}</div>
                        <div className="flags">
                            <div className="title">Flags:</div>
                            {
                                Object.keys(flags).map((flag)=>{
                                    return (
                                        <div key={`profile-${index}-flag-${flag}`}><strong>{flag}:</strong> {`${flags[flag]}`}</div>
                                    )
                                })
                            }
                        </div>
                    </div>
                )
            }) }
            <div className="btn" onClick={sendUpdateProfile}>Update Profile</div>
        </section>
    )
}