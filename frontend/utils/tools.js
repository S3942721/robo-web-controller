export function arrayBufferToBase64 (buffer) {
    const binary = []
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.byteLength; i++) {
        binary.push(String.fromCharCode(bytes[i]))
    }
    return btoa(binary.join(''))
}

export function base64ToFloat32Array (base64String) {
    try {
        const binaryString = window.atob(base64String)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }

        const int16Array = new Int16Array(bytes.buffer)
        const float32Array = new Float32Array(int16Array.length)
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0
        }

        return float32Array
    } catch (error) {
        console.error('Error in base64ToFloat32Array:', error)
        throw error
    }
}

export function downloadBase64TextFile (base64, filename = 'transcript.txt') {
    try {
        const decoded = atob(base64) // base64 → string
        const blob = new Blob([decoded], { type: 'text/plain' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = filename
        link.click()
        URL.revokeObjectURL(link.href)
    } catch (error) {
        console.error('Error downloading transcript file:', error)
    }
}

