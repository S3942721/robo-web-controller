import { useState } from "react";
import useWebSocket, { requestWS } from "../utils/useWebSocket";
import FoldableSection from "./FoldableSection";
import { FaCaretLeft, FaCaretRight } from "react-icons/fa";

export default function SelectProfile({ foldable = true, compact = false }) {
    const { profiles, current_profile, setCurrentProfile } = useWebSocket();
    const [profileIndex, setProfileIndex] = useState(profiles.findIndex(profile => profile.name === current_profile.name));

    function sendUpdateProfile() {
        requestWS("req-update-profile", current_profile);
        requestWS("req-execute", { type: "profile", message: current_profile });
    }

    function switchProfile(direction) {
        let newIndex = profileIndex;
        if (direction === 'next') {
            newIndex = (profileIndex + 1) % profiles.length;
        } else if (direction === 'prev') {
            newIndex = (profileIndex - 1 + profiles.length) % profiles.length;
        }
        setProfileIndex(newIndex);
        setCurrentProfile(profiles[newIndex]);
    }

    if (compact) {
        return (
            <div className="select-profile">
                <div className="profile-switcher">
                    <div className="profile-button left" onClick={() => switchProfile('prev')}>
                        <FaCaretLeft />
                    </div>
                    <div className="profile-name">
                        {profiles[profileIndex]?.name || "No Profile Selected"}
                    </div>
                    <div className="profile-button right" onClick={() => switchProfile('next')}>
                        <FaCaretRight />
                    </div>
                </div>
                <div className="btn" onClick={sendUpdateProfile}>Update Profile</div>
            </div>
        )
    }

    return (
        <FoldableSection className="select-profile" title={'Profiles'} foldable={foldable}>
            <div className="profile-switcher">
                <div className="profile-button left" onClick={() => switchProfile('prev')}>
                    <FaCaretLeft />
                </div>
                <div className="profile-name">
                    {profiles[profileIndex]?.name || "No Profile Selected"}
                </div>
                <div className="profile-button right" onClick={() => switchProfile('next')}>
                    <FaCaretRight />
                </div>
            </div>
            <div className="btn" onClick={sendUpdateProfile}>Update Profile</div>
        </FoldableSection>
    );
}