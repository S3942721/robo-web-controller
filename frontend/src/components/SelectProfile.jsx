import { profiles } from "../utils/types";

export default function SelectProfile({ current_profile, setCurrentProfile, send }) {
    
    function sendUpdateProfile() {
        send('profile', current_profile)
    }

    return (
        <section className="select-profile">
            <h1>Profiles</h1>
            { profiles.map((profile, index)=>{
                const { name, html, flags } = profile;
                return (
                    <div
                        key={`profile-${index}`}
                        className={`profile clickable ${name === current_profile.name ? ' selected' : ''}`}
                        onClick={()=>setCurrentProfile(profile)}
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