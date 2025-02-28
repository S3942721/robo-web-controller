import useWebSocket, { requestWS } from "../../utils/useWebSocket";
import FoldableSection from "../FoldableSection";
import { useState, useEffect, useRef } from "react";
import { FaCaretSquareLeft, FaCaretSquareRight } from "react-icons/fa";

export default function PagedShortCuts({ full_screen = false, foldable = true , compact = false}) {
    const { paged_shortcuts } = useWebSocket();
    const [selectedPage, setSelectedPage] = useState("Day to Day");
    const prevPageButtonRef = useRef(null);
    const nextPageButtonRef = useRef(null);
    const activeKeys = useRef({});

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
        const pages = Object.keys(paged_shortcuts.pages);
        let currentIndex = pages.indexOf(selectedPage);
        if (direction === 'next') {
            currentIndex = (currentIndex + 1) % pages.length;
        } else if (direction === 'prev') {
            currentIndex = (currentIndex - 1 + pages.length) % pages.length;
        }
        setSelectedPage(pages[currentIndex]);
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
                console.log(`No button found for key ${event.key}`);
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
                    prevPageButtonRef.current.click();
                } else if (dpadRight) {
                    nextPageButtonRef.current.click();
                }
            }
        }, 100);

        return () => clearInterval(interval);
    }, []);

    if (!paged_shortcuts || !paged_shortcuts.pages) {
        return <div>Loading...</div>;
    }

    const mainItems = paged_shortcuts.pages[selectedPage].main_items;
    const bodyItems = paged_shortcuts.pages[selectedPage].body_items;

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