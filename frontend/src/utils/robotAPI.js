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
     * Send a message to a robot via the API
     */
    async sendMessage(message, robot = null, type = 'api') {
        try {
            const response = await fetch(`${this.baseUrl}/api/robot-send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message,
                    robot,
                    type
                })
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
}

// Export singleton instance
export const robotAPI = new RobotAPIClient();
export default robotAPI;
