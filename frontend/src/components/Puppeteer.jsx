import { useState, useEffect } from "react";
import { robotColors } from "../utils/robotColors";  // Import the global colours
import PreDefinedScripts from "../PreDefinedScripts";
import ScrollControllers from "../ScrollControllers";
import MoveController from "./MoveController";
import PagedShortCuts from "./PagedShortCuts";

// ...existing code...
export default function Puppeteer() {
    const [activeButton, setActiveButton] = useState("Bandit");

    useEffect(() => {
        window.g_active_robot = activeButton;
        console.log("Updated active robot:", activeButton);
    }, [activeButton]);

    const handleButtonClick = (button) => {
        setActiveButton(button);
    };

    useEffect(() => {
        const root = document.documentElement;
        // Load colours from robotColors mapping based on the active robot:
        const colors = robotColors[activeButton] || {
            primary: "dodgerblue",
            hover: "rgb(14,105,196)",
            active: "rgb(10,80,150)",
            light: "#e4f6f8"
        };
        root.style.setProperty('--primary-color', colors.primary);
        root.style.setProperty('--hover-color', colors.hover);
        root.style.setProperty('--active-color', colors.active);
        root.style.setProperty('--primary-color-light', colors.light);
    }, [activeButton]);

    // ...existing code...
}
