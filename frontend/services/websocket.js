import { setStatus } from "../hooks/useStatusManager"
import { handleWsActions } from "./events-handler"
import { getUserId } from "../utils/userManager"

const MAX_RETRY = 3
const RETRY_INTERVAL = 1000
const WS_ROUTE = import.meta.env.VITE_WS_ROUTE

let wsClient
let retryCount = 0


export function sendMessage (action, data = {}) {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) return

    if (!data) {
        data = {}
    } else if (typeof data !== 'object') {
        data = { data }
    }

    wsClient.send(JSON.stringify({
        action,
        ...data
    }))
}

export function closeWsClient () {
    if (!wsClient || wsClient.readyState === WebSocket.CONNECTING) return
    wsClient.close()
    wsClient = null
    window.ws = null
    setStatus('websocket-connected', false)
}

export function initClient () {
    if (!wsClient) {
        wsClient = new WebSocket(WS_ROUTE)
        window.ws = wsClient
    } else {
        return
    }


    wsClient.onopen = () => {
        console.log('ws opened')
        setStatus('websocket-connected', true)
        setStatus('websocket-error', false)
        retryCount = 0
        
        // Send userID immediately after connection
        sendMessage('setUserId', { userId: getUserId() })
    }

    wsClient.onmessage = (event) => {
        const { action, ...data } = JSON.parse(event.data)
        handleWsActions(action, data)
    }

    wsClient.onclose = () => {
        console.log('ws closed')
        closeWsClient()
        if (MAX_RETRY === -1 || ++retryCount <= MAX_RETRY) {
            setTimeout(initClient, RETRY_INTERVAL)
        }
    }

    wsClient.onerror = (error) => {
        console.log('ws error', error)
        setStatus('websocket-error', true)
        closeWsClient()
        if (MAX_RETRY === -1 || ++retryCount <= MAX_RETRY) {
            setTimeout(initClient, RETRY_INTERVAL)
        }
    }
}