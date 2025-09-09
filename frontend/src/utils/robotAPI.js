/**
 * Frontend Robot API Interface
 * Provides methods to interact with the Robot API from the frontend
 */
class RobotAPIClient {
    constructor() {
        this.baseUrl = `${window.location.protocol}//${window.location.host}`;
    }

    /**
     * Get robot status and connection information
     */
    async getStatus() {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-status`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get robot status:', error);
            throw error;
        }
    }

    /**
     * Get message history for a specific robot or all robots
     */
    async getHistory(robot = null, limit = 100) {
        try {
            const url = robot 
                ? `${this.baseUrl}/api/robot-history/${robot}?limit=${limit}`
                : `${this.baseUrl}/api/robot-history?limit=${limit}`;
            const response = await fetch(url);
            return await response.json();
        } catch (error) {
            console.error('Failed to get robot history:', error);
            throw error;
        }
    }

    /**
     *  Send a conversation response with session support
     */
    async sendConversationResponse(message, robot = null, sessionId = null, isFinished = false, isFirstChunk = false, chunkNumber = null) {
        try {
            const response = await fetch('/api/robot-conversation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message,
                    robot,
                    sessionId,
                    isFinished,
                    isFirstChunk,
                    chunkNumber
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error sending conversation response:', error);
            throw error;
        }
    }

    /**
     * Send a message to a robot via the API with session support
     */
    async sendMessage(message, robot = null, type = 'api', sessionId = null) {
        try {
            const requestBody = {
                message,
                robot,
                type,
                sessionId
            };
            
            const response = await fetch(`${this.baseUrl}/api/robot-send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to send robot message:', error);
            throw error;
        }
    }

    /**
     * Send a script command
     */
    async executeScript(script, robot = null) {
        return this.sendMessage(script, robot, 'script');
    }

    /**
     * Send a trigger command
     */
    async sendTrigger(triggerData, robot = null) {
        return this.sendMessage(triggerData, robot, 'trigger');
    }

    /**
     * Send a movement command
     */
    async sendMovement(movementData, robot = null) {
        return this.sendMessage(movementData, robot, 'Move');
    }

    /**
     * Send a continuous movement command
     */
    async sendContinuousMovement(movementData, robot = null) {
        return this.sendMessage(movementData, robot, 'ConMove');
    }

    /**
     * Send a shortcut command
     */
    async executeShortcut(shortcut, robot = null) {
        return this.sendMessage(shortcut, robot, 'shortcut');
    }

    /**
     * Send an announcement
     */
    async executeAnnouncement(announcement, robot = null) {
        return this.sendMessage(announcement, robot, 'announcement');
    }

    /**
     * Flush buffer for a specific session
     */
    async flushBuffer(sessionId, targetRobot = 'Haku') {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/flush/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetRobot })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to flush buffer:', error);
            throw error;
        }
    }

    /**
     * Clear buffer for a specific session
     */
    async clearBuffer(sessionId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/clear/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to clear buffer:', error);
            throw error;
        }
    }

    /**
     * Get buffer status for a specific session
     */
    async getBufferStatus(sessionId) {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/status/${sessionId}`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get buffer status:', error);
            throw error;
        }
    }

    /**
     * Get all buffer statuses
     */
    async getAllBufferStatuses() {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/status`);
            return await response.json();
        } catch (error) {
            console.error('Failed to get all buffer statuses:', error);
            throw error;
        }
    }

    /**
     * Force process buffer for a specific session
     */
    async forceProcessBuffer(sessionId, targetRobot = 'Haku') {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/force-process/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetRobot })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to force process buffer:', error);
            throw error;
        }
    }

    /**
     * Update chunk mode for a specific session
     */
    async updateSessionChunkMode(sessionId, chunkMode) {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-buffer/update-mode/${sessionId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ chunkMode })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to update chunk mode:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const robotAPI = new RobotAPIClient();
export default robotAPI;
