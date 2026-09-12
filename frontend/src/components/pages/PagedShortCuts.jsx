import useWebSocket, { requestWS } from "../../utils/useWebSocket";
import FoldableSection from "../FoldableSection";
import { useState, useEffect, useRef } from "react";
import { FaCaretSquareLeft, FaCaretSquareRight } from "react-icons/fa";
import { usePersistentState } from "../../utils/persistentState";

const SHORTCUT_PAGE_KEY = 'web-controller.paged-shortcuts.selected-pages'

export default function PagedShortCuts({ full_screen = false, foldable = true, compact = false, activeRobot }) {
    const { paged_shortcuts } = useWebSocket();
    const [robotSelectedPage, setRobotSelectedPage] = usePersistentState(SHORTCUT_PAGE_KEY, {});
    const [selectedPage, setSelectedPage] = useState("");
    const prevPageButtonRef = useRef(null);
    const nextPageButtonRef = useRef(null);
    const activeKeys = useRef({});
    const debounceTimeouts = useRef({});

    // On change of robot or config, load per-robot page
    useEffect(() => {
        console.log("PagedShortCuts: Received paged_shortcuts:", paged_shortcuts);
        console.log("PagedShortCuts: activeRobot:", activeRobot);
        if (!paged_shortcuts) return;
        const configForRobot = paged_shortcuts[activeRobot] || paged_shortcuts["Default"];
        if (!configForRobot?.pages) return;
        const stored = robotSelectedPage[activeRobot];
        if (stored) {
            setSelectedPage(stored);
        } else {
            const firstPage = Object.keys(configForRobot.pages)[0] || "";
            setSelectedPage(firstPage);
            setRobotSelectedPage(prev => ({ ...prev, [activeRobot]: firstPage }));
        }
    }, [activeRobot, paged_shortcuts]);

    function sendShortCut(name, items) {
        let command_to_pick;
        if(Array.isArray(items)) {
            command_to_pick = items[Math.floor(Math.random() * items.length)];
        } else {
            command_to_pick = items;
        }
        requestWS('req-execute', {type:'shortcut', message: command_to_pick});
    }

    function switchPage(direction) {
        const configForRobot = paged_shortcuts[activeRobot] || paged_shortcuts["Default"];
        const pages = Object.keys(configForRobot.pages);
        let idx = pages.indexOf(selectedPage);
        if (direction === 'next') idx = (idx + 1) % pages.length;
        else if (direction === 'prev') idx = (idx - 1 + pages.length) % pages.length;
        const newPage = pages[idx];
        setSelectedPage(newPage);
        setRobotSelectedPage(prev => ({ ...prev, [activeRobot]: newPage }));
    }

    // Debounce function to handle key updates
    function debounceKeyUpdate(key, holding, callback, debounceTime = 250) {
        if (debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key]);
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            callback();
        }, debounceTime);
    }

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (activeKeys.current[event.key]) return;
            activeKeys.current[event.key] = true;

            const button = document.getElementById(`main-item-${event.key - 1}`);
            if (button) {
                console.log(`Button found for key ${event.key}: ${button.id}`);
                button.classList.add('active');
                button.click();
            } else {
                // console.log(`No button found for key ${event.key}`);
            }
        };

        const handleKeyUp = (event) => {
            activeKeys.current[event.key] = false;

            const button = document.getElementById(`main-item-${event.key - 1}`);
            if (button) {
                setTimeout(() => {
                    if (!activeKeys.current[event.key]) {
                        console.log(`Removing active class from button ${button.id}`);
                        button.classList.remove('active');
                    }
                }, 200); // Ensure the animation runs for at least 0.2 seconds
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            const controller = navigator.getGamepads()[0];
            if (controller) {
                const dpadLeft = controller.buttons[14].pressed;
                const dpadRight = controller.buttons[15].pressed;
                if (dpadLeft) {
                    debounceKeyUpdate('dpadLeft', true, () => {
                        prevPageButtonRef.current.click();
                    }, 125);
                } else if (dpadRight) {
                    debounceKeyUpdate('dpadRight', true, () => {
                        nextPageButtonRef.current.click();
                    }, 125);
                }
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

    if (!paged_shortcuts || !(paged_shortcuts[activeRobot] || paged_shortcuts["Default"])) {
        return <div>Loading...</div>;
    }

    const robotConfig = paged_shortcuts[activeRobot] || paged_shortcuts["Default"];
    const mainItems = robotConfig.pages[selectedPage]?.main_items || {};
    const bodyItems = robotConfig.pages[selectedPage]?.body_items || {};

    return (
        <FoldableSection className={full_screen ? 'full-screen' : ''} title={'Shortcuts'} foldable={foldable} compact={compact}>
            <div className="paged-shortcuts-container">
                {/* Left column */}
                <div className="paged-shortcuts-column">
                    {Object.keys(mainItems).map((name, index) => {
                        if (index === 0) {
                            return (
                                <div 
                                    key={`main-item-${index}`} 
                                    id="main-item-0"
                                    className="paged-shortcuts-item shortcut main-item" 
                                    onClick={() => sendShortCut(name, mainItems[name])}
                                >
                                    {name}
                                </div>
                            );
                        }
                        return null;
                    })}
                    <div 
                        className="paged-shortcuts-item btn"  
                        onClick={() => switchPage('prev')}
                        ref={prevPageButtonRef}
                    >
                        <FaCaretSquareLeft style={{ display: 'block', margin: 'auto' }} />
                    </div>
                    {Object.keys(mainItems).map((name, index) => {
                        if (index === 1) {
                            return (
                                <div 
                                    key={`main-item-${index}`} 
                                    id="main-item-1"
                                    className="paged-shortcuts-item shortcut main-item" 
                                    onClick={() => sendShortCut(name, mainItems[name])}
                                >
                                    {name}
                                </div>
                            );
                        }
                        return null;
                    })}
                </div>
                {/* Middle column */}
                <div className="paged-shortcuts-item main-item">
                    <div className="page-title">{selectedPage}</div>
                    <div className="grid-shortcuts">
                        {Object.keys(bodyItems).map((name, index) => (
                            <div 
                                key={`body-item-${index}`} 
                                className="shortcut"
                                onClick={() => sendShortCut(name, bodyItems[name])}
                            >
                                {name}
                            </div>
                        ))}
                    </div>
                </div>
                {/* Right column */}
                <div className="paged-shortcuts-column">
                    {Object.keys(mainItems).map((name, index) => {
                        if (index === 2) {
                            return (
                                <div 
                                    key={`main-item-${index}`} 
                                    id="main-item-2"
                                    className="paged-shortcuts-item shortcut main-item" 
                                    onClick={() => sendShortCut(name, mainItems[name])}
                                >
                                    {name}
                                </div>
                            );
                        }
                        return null;
                    })}
                    <div 
                        className="paged-shortcuts-item btn"
                        onClick={() => switchPage('next')}
                        ref={nextPageButtonRef}
                    >
                        <FaCaretSquareRight style={{ display: 'block', margin: 'auto' }} />
                    </div>
                    {Object.keys(mainItems).map((name, index) => {
                        if (index === 3) {
                            return (
                                <div 
                                    key={`main-item-${index}`} 
                                    id="main-item-3"
                                    className="paged-shortcuts-item shortcut main-item" 
                                    onClick={() => sendShortCut(name, mainItems[name])}
                                >
                                    {name}
                                </div>
                            );
                        }
                        return null;
                    })}
                </div>
            </div>
        </FoldableSection>
    )
}