import { useEffect, useState, useCallback, useRef } from "react";
import { requestWS } from "../utils/useWebSocket";
import { Arrow90degLeft, Arrow90degRight, CaretDown, CaretLeft, CaretRight, CaretUp } from "react-bootstrap-icons";
import ScrollControllers from "./ScrollControllers";

export default function MoveController() {

    const [keys, setKeys] = useState({
        W: false,
        A: false,
        S: false,
        D: false,
        E: false,
        Q: false,
    });

    const debounceTimeouts = useRef({});

    function debounceKeyUpdate(key, holding) {
        if(debounceTimeouts.current[key]) {
            clearTimeout(debounceTimeouts.current[key])
        }

        debounceTimeouts.current[key] = setTimeout(() => {
            requestWS("req-execute", { type: "Move", message: { key, holding } })
        }, 10);
    }

    const setKey = useCallback((key, holding) => {
        setKeys((prevKeys) => {
            if (prevKeys[key] === holding) return prevKeys;
            debounceKeyUpdate(key, holding);
            return { ...prevKeys, [key]: holding };
        });
    }, []);

    const handleKeyDown = (event) => {
        const key = event.key.toUpperCase();
        if (keys.hasOwnProperty(key)) {
            setKey(key, true);
        }
    };

    const handleKeyUp = (event) => {
        const key = event.key.toUpperCase();
        if (keys.hasOwnProperty(key)) {
            setKey(key, false);
        }
    };

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("keyup", handleKeyUp);
        };
    }, []);

    return (
        <>
        <div className="movement-controller">
            <div className={`direction W ${keys.W?"holding":""}`}><CaretUp /></div>
            <div className={`direction A ${keys.A?"holding":""}`}><CaretLeft /></div>
            <div className={`direction S ${keys.S?"holding":""}`}><CaretDown /></div>
            <div className={`direction D ${keys.D?"holding":""}`}><CaretRight /></div>
            <div className={`rotation  E ${keys.E?"holding":""}`}><Arrow90degRight /></div>
            <div className={`rotation  Q ${keys.Q?"holding":""}`}><Arrow90degLeft /></div>
        </div>
        <ScrollControllers to_right={true} />
        </>
    );
}
