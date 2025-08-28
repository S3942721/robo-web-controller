const EventEmitter = require('events');

/**
 * Robot API - Centralized robot communication interface
 * Handles both sending and receiving data to/from robot socket connections
 */
class RobotAPI extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map(); // socketId -> { socket, robot, lastActivity }
        this.messageQueue = new Map(); // robotName -> messages[]
        this.messageHistory = new Map(); // robotName -> messages[]
        this.robotStatus = new Map(); // robotName -> status info
        this.messageHandlers = new Map(); // messageType -> handler function
        this.middleware = []; // Array of middleware functions
        
        // Statistics
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            connectionsTotal: 0,
            startTime: Date.now()
        };
        
        this.setupDefaultHandlers();
    }

    /**
     * Register a socket connection for a robot
     */
    registerConnection(socketFunction, robot = null) {
        const socketId = this.generateSocketId();
        const connectionInfo = {
            socket: socketFunction,
            robot: robot,
            lastActivity: Date.now(),
            socketId: socketId
        };
        
        this.connections.set(socketId, connectionInfo);
        this.stats.connectionsTotal++;
        
        console.log(`[RobotAPI] Registered connection ${socketId} for robot: ${robot || 'unknown'}`);
        
        // Emit connection event
        this.emit('connection', { socketId, robot, connectionInfo });
        
        return socketId;
    }

    /**
     * Remove a socket connection
     */
    unregisterConnection(socketId) {
        const connection = this.connections.get(socketId);
        if (connection) {
            console.log(`[RobotAPI] Unregistered connection ${socketId} for robot: ${connection.robot || 'unknown'}`);
            this.connections.delete(socketId);
            this.emit('disconnection', { socketId, robot: connection.robot });
        }
    }

    /**
     * Send a message to a specific robot or all robots
     */
    sendMessage(messageData, targetRobot = null) {
        const { cmd, type, message, robot } = messageData;
        
        // Apply middleware before sending
        let processedMessage = this.applyMiddleware('outgoing', messageData);
        if (!processedMessage) {
            console.warn('[RobotAPI] Message blocked by middleware:', messageData);
            return false;
        }

        // Normalize the message format (preserve existing logic)
        const normalizedMessage = JSON.stringify(processedMessage)
            .normalize('NFKC')
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'")
            .replace(/…/g, '...')
            .replace(/[^\x00-\x7F]/g, "");

        const finalRobot = targetRobot || robot || '';
        
        // Store in message history
        this.addToHistory(finalRobot, 'outgoing', processedMessage);
        
        // Queue message if no connections available
        if (this.connections.size === 0) {
            this.queueMessage(finalRobot, processedMessage);
            console.warn(`[RobotAPI] No connections available, queued message for robot: ${finalRobot}`);
            return false;
        }

        let sent = false;
        
        // Send to specific robot or all robots
        for (const [socketId, connection] of this.connections) {
            const shouldSend = !finalRobot || 
                              finalRobot === '' || 
                              connection.robot === finalRobot ||
                              connection.robot === null;
            
            if (shouldSend) {
                try {
                    connection.socket(normalizedMessage);
                    connection.lastActivity = Date.now();
                    sent = true;
                    
                    console.log(`[RobotAPI] Sent to ${connection.robot || 'unknown'} (${socketId}):`, normalizedMessage);
                    
                    // Update robot status
                    this.updateRobotStatus(connection.robot || finalRobot, 'message_sent', processedMessage);
                    
                } catch (error) {
                    console.error(`[RobotAPI] Failed to send to ${socketId}:`, error);
                    this.emit('sendError', { socketId, error, message: processedMessage });
                }
            }
        }

        if (sent) {
            this.stats.messagesSent++;
            this.emit('messageSent', { message: processedMessage, robot: finalRobot });
        } else {
            this.queueMessage(finalRobot, processedMessage);
            console.warn(`[RobotAPI] No matching connections for robot: ${finalRobot}`);
        }

        return sent;
    }

    /**
     * Handle incoming data from robot sockets
     */
    handleIncomingData(socketId, data, robot = null) {
        const dataStr = data.toString();
        console.log(`[RobotAPI] Received from ${robot || 'unknown'} (${socketId}):`, dataStr);
        
        // Update connection activity
        const connection = this.connections.get(socketId);
        if (connection) {
            connection.lastActivity = Date.now();
            if (!connection.robot && robot) {
                connection.robot = robot;
            }
        }

        // Parse and process the message
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(dataStr);
        } catch (error) {
            // Handle non-JSON messages
            parsedMessage = { type: 'raw', data: dataStr, timestamp: Date.now() };
        }

        // Apply middleware for incoming messages
        const processedMessage = this.applyMiddleware('incoming', {
            ...parsedMessage,
            socketId,
            robot,
            originalData: dataStr
        });

        if (processedMessage) {
            this.stats.messagesReceived++;
            this.addToHistory(robot || 'unknown', 'incoming', processedMessage);
            this.updateRobotStatus(robot || 'unknown', 'message_received', processedMessage);
            
            // Handle special commands
            if (dataStr === 'SHUTDOWN') {
                this.handleShutdownCommand(socketId);
                return;
            }

            // Emit the received message
            this.emit('messageReceived', {
                socketId,
                robot: robot || connection?.robot,
                message: processedMessage,
                rawData: dataStr
            });

            // Call registered message handlers
            this.callMessageHandlers(processedMessage, socketId, robot);
        }
    }

    /**
     * Add middleware for processing messages
     */
    addMiddleware(middlewareFunction) {
        this.middleware.push(middlewareFunction);
    }

    /**
     * Apply middleware to messages
     */
    applyMiddleware(direction, message) {
        let result = message;
        for (const middleware of this.middleware) {
            result = middleware(direction, result);
            if (!result) break; // Middleware can block messages by returning null/false
        }
        return result;
    }

    /**
     * Register a message handler for specific message types
     */
    onMessageType(messageType, handler) {
        if (!this.messageHandlers.has(messageType)) {
            this.messageHandlers.set(messageType, []);
        }
        this.messageHandlers.get(messageType).push(handler);
    }

    /**
     * Call registered message handlers
     */
    callMessageHandlers(message, socketId, robot) {
        const messageType = message.type || message.cmd || 'unknown';
        const handlers = this.messageHandlers.get(messageType) || [];
        
        for (const handler of handlers) {
            try {
                handler(message, socketId, robot);
            } catch (error) {
                console.error(`[RobotAPI] Message handler error for type ${messageType}:`, error);
            }
        }
    }

    /**
     * Get status information for all robots
     */
    getStatus() {
        const connections = Array.from(this.connections.entries()).map(([socketId, conn]) => ({
            socketId,
            robot: conn.robot,
            lastActivity: conn.lastActivity,
            active: Date.now() - conn.lastActivity < 30000 // Active within 30 seconds
        }));

        return {
            connections,
            stats: { ...this.stats },
            robotStatus: Object.fromEntries(this.robotStatus),
            queuedMessages: this.getQueuedMessagesCount(),
            uptime: Date.now() - this.stats.startTime
        };
    }

    /**
     * Get message history for a specific robot
     */
    getMessageHistory(robot, limit = 100) {
        const history = this.messageHistory.get(robot) || [];
        return history.slice(-limit);
    }

    /**
     * Clear message history for a robot
     */
    clearHistory(robot) {
        if (robot) {
            this.messageHistory.delete(robot);
        } else {
            this.messageHistory.clear();
        }
    }

    /**
     * Send queued messages when connections become available
     */
    processQueuedMessages(robot = null) {
        if (robot) {
            const queue = this.messageQueue.get(robot) || [];
            this.messageQueue.set(robot, []);
            
            for (const message of queue) {
                this.sendMessage(message, robot);
            }
        } else {
            // Process all queues
            for (const [robotName, queue] of this.messageQueue) {
                this.messageQueue.set(robotName, []);
                for (const message of queue) {
                    this.sendMessage(message, robotName);
                }
            }
        }
    }

    // Private helper methods
    generateSocketId() {
        return `socket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    queueMessage(robot, message) {
        if (!this.messageQueue.has(robot)) {
            this.messageQueue.set(robot, []);
        }
        this.messageQueue.get(robot).push({
            ...message,
            queuedAt: Date.now()
        });
    }

    addToHistory(robot, direction, message) {
        if (!this.messageHistory.has(robot)) {
            this.messageHistory.set(robot, []);
        }
        
        const history = this.messageHistory.get(robot);
        history.push({
            direction,
            message,
            timestamp: Date.now()
        });
        
        // Keep only last 1000 messages per robot
        if (history.length > 1000) {
            history.splice(0, history.length - 1000);
        }
    }

    updateRobotStatus(robot, event, data = null) {
        if (!this.robotStatus.has(robot)) {
            this.robotStatus.set(robot, {
                firstSeen: Date.now(),
                lastActivity: Date.now(),
                messagesSent: 0,
                messagesReceived: 0,
                status: 'active'
            });
        }
        
        const status = this.robotStatus.get(robot);
        status.lastActivity = Date.now();
        
        if (event === 'message_sent') {
            status.messagesSent++;
        } else if (event === 'message_received') {
            status.messagesReceived++;
        }
        
        this.robotStatus.set(robot, status);
    }

    getQueuedMessagesCount() {
        let total = 0;
        for (const queue of this.messageQueue.values()) {
            total += queue.length;
        }
        return total;
    }

    handleShutdownCommand(socketId) {
        const connection = this.connections.get(socketId);
        if (connection) {
            try {
                connection.socket('SHUTDOWN_PONG');
                console.log(`[RobotAPI] Sent SHUTDOWN_PONG to ${socketId}`);
            } catch (error) {
                console.error(`[RobotAPI] Failed to send SHUTDOWN_PONG to ${socketId}:`, error);
            }
        }
    }

    setupDefaultHandlers() {
        // Add default message handlers
        this.onMessageType('heartbeat', (message, socketId, robot) => {
            // Respond to heartbeat messages
            this.sendMessage({
                cmd: 'heartbeat_response',
                timestamp: Date.now()
            }, robot);
        });

        // Handle connection health monitoring
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 60000); // Check every minute
    }

    cleanupInactiveConnections() {
        const now = Date.now();
        const timeout = 5 * 60 * 1000; // 5 minutes

        for (const [socketId, connection] of this.connections) {
            if (now - connection.lastActivity > timeout) {
                console.log(`[RobotAPI] Cleaning up inactive connection ${socketId}`);
                this.unregisterConnection(socketId);
            }
        }
    }
}

// Export singleton instance
const robotAPI = new RobotAPI();
module.exports = robotAPI;
