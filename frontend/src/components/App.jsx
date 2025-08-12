// import PreDefinedScripts from "./PreDefinedScripts"
// import SelectProfile from "./SelectProfile"
// import TriggerBehaviour from "./TriggerBehaviour"
// import ManualDefinedScript from "./ManualDefinedScript"
import Controller from "./pages"
import {
    createBrowserRouter, RouterProvider
} from 'react-router-dom'
import RunScriptPage from "./pages/RunScriptPage"
import ShortCuts from "./ShortCuts"
import UploadSettings from "./pages/UploadSettings"
import { requestWS } from "../utils/useWebSocket"
import { useEffect } from "react"
import MoveController from "./MoveController"
import NovaSonicForT from "./pages/NovaSonicForT"
import AudioStreamTest from "./pages/AudioStreamTest"

export default function App() {
    function globalBackspaceListener(event) {
        if( event.shiftKey && event.key === 'Backspace' ) {
            requestWS('req-execute', {type:'shortcut', message: '$StopAction=None'});
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
                path: '/test',
                element: <NovaSonicForT />
            },
            {
                path: '/audio-stream-test',
                element: <AudioStreamTest />
            }
        ])} />
    )
}