import { useState, useEffect } from "react";
import PreDefinedScripts from "../PreDefinedScripts";
import ScrollControllers from "../ScrollControllers";
import MoveController from "./MoveController";
import PagedShortCuts from "./PagedShortCuts";
import { usePersistentState } from "../../utils/persistentState";

const ACTIVE_ROBOT_KEY = 'web-controller.active-robot'

export default function Puppeteer() {
    const [activeButton, setActiveButton] = usePersistentState(ACTIVE_ROBOT_KEY, "Haku");
    const [reloadingTablet, setReloadingTablet] = useState(false); // Tablet reload state

    // Update global active robot variable whenever activeButton changes
    useEffect(() => {
        window.g_active_robot = activeButton;
        console.log("Updated active robot:", activeButton);
    }, [activeButton]);

    const handleButtonClick = (button) => {
        setActiveButton(button);
    };

    useEffect(() => {
        const root = document.documentElement;
        if (activeButton === "Haku") {
            root.style.setProperty('--primary-color', 'purple');
            root.style.setProperty('--hover-color', 'rgb(128, 0, 128)');
            root.style.setProperty('--active-color', 'rgb(75, 0, 130)');
            root.style.setProperty('--primary-color-light','rgb(241, 221, 255)');
        } else {
            root.style.setProperty('--primary-color', 'dodgerblue');
            root.style.setProperty('--hover-color', 'rgb(14, 105, 196)');
            root.style.setProperty('--active-color', 'rgb(10, 80, 150)');
            root.style.setProperty('--primary-color-light', '#e4f6f8');
        }
    }, [activeButton]);

    // Function to reload tablet web view on robot
    const reloadTabletWebView = async () => {
        setReloadingTablet(true);
        try {
            const response = await fetch(`/api/robot-tablet/reload/${activeButton}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ robot: activeButton })
            });
            
            const result = await response.json();
            
            if (result.success) {
                console.log(`✅ Tablet reload sent to ${activeButton}`);
                // You could add a toast notification here if you have one
            } else {
                console.error(`❌ Failed to reload tablet for ${activeButton}:`, result.message);
            }
        } catch (error) {
            console.error('Error reloading tablet:', error);
        } finally {
            setReloadingTablet(false);
        }
    };

    return (
        <div className={'full-screen-unscrollable'}>
            <div className={'grid-container'}>
                <div className={'grid-item'}>
                    <MoveController 
                        foldable={false} 
                        compact={true} 
                        profile_switcher={true} 
                        activeRobot={activeButton}
                        reloadTabletWebView={reloadTabletWebView}
                        reloadingTablet={reloadingTablet}
                    />
                </div>
                <div className={'grid-item'}>
                    <div className={'grid-container robot-target-scripts'}>
                        <div className={'grid-item'}>
                            <PreDefinedScripts foldable={false} compact={true} activeRobot={activeButton} />
                        </div>
                        <div className={'grid-item'}>
                            <div className={'button-container'}>
                                <button 
                                    className={`full-width ${activeButton === "Bandit" ? "active" : ""}`} 
                                    onClick={() => handleButtonClick("Bandit")}
                                    style={{ backgroundColor: activeButton === "Bandit" ? 'rgb(10, 80, 150)' : 'dodgerblue' }}
                                >
                                    Bandit
                                </button>
                                <button 
                                    className={`full-width ${activeButton === "Haku" ? "active" : ""}`} 
                                    onClick={() => handleButtonClick("Haku")}
                                    style={{ backgroundColor: activeButton === "Haku" ? 'rgb(75, 0, 130)' : 'purple' }}
                                >
                                    Haku
                                </button>

                            </div>
                        </div>
                    </div>
                </div>
                <div className={'grid-item'}>
                    <ScrollControllers
                        foldable={false}
                        compact={true}
                        triggers={true}
                        activeRobot={activeButton}
                    />
                </div>
                <div className={'grid-item'}>
                    <PagedShortCuts 
                        foldable={false} 
                        compact={true} 
                        activeRobot={activeButton} 
                    />
                </div>
            </div>
        </div>
    );
}