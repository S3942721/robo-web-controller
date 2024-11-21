import { useEffect, useState } from "react";
import PreDefinedScripts from "../PreDefinedScripts";

export default function RunScriptPage() {

    const [signal, setSignal] = useState(null);

    useEffect(()=>{
        function keyDownEvents(event) {
            switch(event.key) {
                case "Enter":
                case "ArrowUp":
                case "ArrowDown":
                    setSignal(event.key); break;
                default: 
                    setSignal(null); break;
            }
        }
        document.addEventListener("keydown", keyDownEvents)
        return ()=>{
            document.removeEventListener("keydown", keyDownEvents)
        }
    }, [])

    return (
        <PreDefinedScripts controller={signal} resetController={()=>setSignal(null)} />
    )
}