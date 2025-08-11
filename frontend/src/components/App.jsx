// import PreDefinedScripts from "./PreDefinedScripts"
// import SelectProfile from "./SelectProfile"
// import TriggerBehaviour from "./TriggerBehaviour"
// import ManualDefinedScript from "./ManualDefinedScript"
import Controller from "./pages/index"
import {
    createBrowserRouter, RouterProvider
} from 'react-router-dom'
import RunScriptPage from "./pages/RunScriptPage"
import ShortCuts from "./pages/ShortCuts"
import UploadSettings from "./pages/UploadSettings"
import { requestWS } from "../utils/useWebSocket"
import { useEffect } from "react"
import MoveController from "./pages/MoveController"
import Puppeteer from "./pages/Puppeteer"
import Tom from "./pages/Tom"
import NovaSonicForT from "./pages/NovaSonicForT"

export default function App() {
    function globalBackspaceListener(event) {
        if ((event.shiftKey && event.key === 'Backspace') || event.key === 'B') {
            requestWS('req-execute', {
                type: 'shortcut',
                message: '$StopAction=None',
                robot: "" // empty string to stop both robots.
            });
        }
    }

    useEffect(()=>{
        document.addEventListener("keydown", globalBackspaceListener)
        return ()=>{
            document.removeEventListener("keydown", globalBackspaceListener);
        }
    })

    return (
        <RouterProvider router={createBrowserRouter([
            {
                path: '/',
                element: <Controller />
            },
            {
                path: '/scripts',
                element: <RunScriptPage />
            },
            {
                path: '/shortcuts',
                element: <ShortCuts full_screen={true} />
            },
            {
                path: '/upload-json',
                element: <UploadSettings />
            },
            {
                path: '/move-control',
                element: <MoveController />
            },
            {
                path: '/puppeteer',
                element: <Puppeteer />
            },
            {
                path: '/tom',
                element: <Tom />
                },
            {
                path: '/test',
                element: <NovaSonicForT />
            }
        ])} />
    )
}