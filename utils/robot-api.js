const EventEmitter = require('events');

// Add LLM chunk processing configuration
const LLM_CHUNK_MODE = process.env.LLM_CHUNK_MODE || 'smart';
const LLM_MIN_CHUNK_LENGTH = parseInt(process.env.LLM_MIN_CHUNK_LENGTH) || 10;
const LLM_MAX_BUFFER_SIZE = parseInt(process.env.LLM_MAX_BUFFER_SIZE) || 500;
const LLM_SENTENCE_MARKERS = process.env.LLM_SENTENCE_MARKERS || '.!?';

/**
 * Robot API - Centralized robot communication interface
 * Handles both sending and receiving data to/from robot socket connections
 */
class RobotAPI extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map(); // socketId -> connectionInfo
        this.messageHistory = new Map(); // robot -> message history
        this.robotStatus = new Map(); // robot -> status info
        this.middleware = []; // Array of middleware functions
        this.messageQueue = new Map(); // robot -> queued messages
        this.messageHandlers = new Map(); // messageType -> handler function
        this.stats = {
            messagesSent: 0,
            messagesReceived: 0,
            connectionsTotal: 0
        };
        this.startTime = Date.now();
        
        // LLM chunk processing sessions
        this.llmSessions = new Map(); // sessionId -> { speechBuffer, chunkMode }
        
        // Robot identification configuration
        this.identificationMethod = process.env.ROBOT_IDENTIFICATION_METHOD || 'socket';
        this.robotIPs = {
            'Haku': process.env.HAKU_IP,
            'Bandit': process.env.BANDIT_IP
        };
        this.defaultRobotName = process.env.DEFAULT_ROBOT_NAME || 'unknown';
        
        console.log('[RobotAPI] Initialized with identification method:', this.identificationMethod);
        console.log('[RobotAPI] Robot IP mappings:', this.robotIPs);
        console.log('[RobotAPI] LLM chunk processing mode:', LLM_CHUNK_MODE);
        
        this.setupDefaultHandlers();
        this.setupCleanupInterval();
    }

    setupDefaultHandlers() {
        // Add middleware for LLM conversation responses
        this.addMiddleware((direction, message) => {
            if (direction === 'outgoing' && message.type === 'conversation-response') {
                console.log(`[RobotAPI] 🗣️ Processing LLM conversation response: "${message.message?.substring(0, 100)}${message.message?.length > 100 ? '...' : ''}"`);
                console.log(`[RobotAPI] 📊 Response details - robot: ${message.robot}, source: ${message.source || 'unknown'}, sessionId: ${message.sessionId || 'none'}`);
                
                // Validate the message content
                if (!message.message || !message.message.trim()) {
                    console.warn(`[RobotAPI] ⚠️ Empty conversation response message - blocking`);
                    return null; // Block empty messages
                }
                
                // Log chunk characteristics for debugging
                const text = message.message.trim();
                const hasCarets = text.includes('^');
                const hasBraces = text.includes('{') || text.includes('}');
                const hasSpecialPatterns = hasCarets || hasBraces;
                
                console.log(`[RobotAPI] 🔍 Message analysis - length: ${text.length}, hasCarets: ${hasCarets}, hasBraces: ${hasBraces}, hasSpecialPatterns: ${hasSpecialPatterns}`);
                
                if (hasSpecialPatterns) {
                    console.log(`[RobotAPI] 🎭 Message contains robot behavior patterns - content: "${text}"`);
                }
                
                // Update robot status
                this.updateRobotStatus(message.robot, 'speaking', {
                    messageLength: text.length,
                    hasSpecialPatterns: hasSpecialPatterns,
                    source: message.source,
                    timestamp: message.timestamp
                });
            }
            
            return message;
        });
        
        // Handler for conversation response message type
        this.onMessageType('conversation-response', (message, socketId, robot) => {
            console.log(`[RobotAPI] 🤖 Conversation response handler triggered for ${robot}: "${message.message?.substring(0, 50)}${message.message?.length > 50 ? '...' : ''}"`);
            
            // Update statistics
            this.stats.messagesReceived++;
            
            // Log successful delivery
            this.updateRobotStatus(robot, 'spoke', {
                messageDelivered: true,
                deliveryTime: Date.now(),
                socketId: socketId
            });
        });
        
        // Handler for shutdown commands
        this.onMessageType('SHUTDOWN', (message, socketId, robot) => {
            console.log(`[RobotAPI] 🔴 Shutdown command received from ${robot || 'unknown'} (${socketId})`);
            this.handleShutdownCommand(socketId);
        });
    }

    setupCleanupInterval() {
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveConnections();
        }, 30000); // Clean up every 30 seconds
    }

    generateSocketId() {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    /**
     * Register a socket connection for a robot
     */
    registerConnection(sendFunction, socketInfo = {}) {
        const socketId = this.generateSocketId();
        const remoteAddress = socketInfo.remoteAddress || 'unknown';
        const remotePort = socketInfo.remotePort || 'unknown';
        
        // Identify robot by IP address first
        let robotName = this.identifyRobotByIP(remoteAddress);
        
        // If IP identification failed and we allow socket identification, mark as pending
        if (robotName === this.defaultRobotName && (this.identificationMethod === 'socket' || this.identificationMethod === 'both')) {
            robotName = 'pending';
        }
        
        const connectionInfo = {
            socketId,
            socket: sendFunction,
            robot: robotName,
            remoteAddress,
            remotePort,
            connectedAt: new Date(),
            lastActivity: new Date(),
            active: true,
            identificationMethod: robotName === 'pending' ? 'awaiting_socket_data' : 'ip_address'
        };
        
        this.connections.set(socketId, connectionInfo);
        this.stats.connectionsTotal++;
        
        console.log(`[RobotAPI] Registered connection ${socketId} for robot: ${robotName} (${remoteAddress}:${remotePort})`);
        
        // If robot was identified, send queued messages
        if (robotName !== 'pending' && robotName !== this.defaultRobotName) {
            this.processQueuedMessages(robotName);
        }
        
        this.emit('connectionRegistered', { socketId, robot: robotName, connectionInfo });
        return socketId;
    }

    identifyRobotByIP(ipAddress) {
        // Clean IP address (remove IPv6 prefix if present)
        const cleanIP = ipAddress.replace(/^::ffff:/, '');
        
        for (const [robotName, robotIP] of Object.entries(this.robotIPs)) {
            if (robotIP && cleanIP === robotIP) {
                console.log(`[RobotAPI] Identified robot by IP: ${cleanIP} -> ${robotName}`);
                return robotName;
            }
        }
        
        console.log(`[RobotAPI] Could not identify robot by IP: ${cleanIP}`);
        return this.defaultRobotName;
    }

    updateRobotIdentification(socketId, robotName) {
        const connection = this.connections.get(socketId);
        if (!connection) {
            console.warn(`[RobotAPI] Cannot update identification - connection ${socketId} not found`);
            return;
        }
        
        const oldRobot = connection.robot;
        connection.robot = robotName;
        connection.identificationMethod = 'socket_data';
        
        console.log(`[RobotAPI] Updated robot identification: ${socketId} ${oldRobot} -> ${robotName}`);
        
        // Send queued messages for this robot
        this.processQueuedMessages(robotName);
        
        this.emit('robotIdentified', { socketId, oldRobot, newRobot: robotName });
    }

    /**
     * Remove a socket connection
     */
    unregisterConnection(socketId) {
        const connection = this.connections.get(socketId);
        if (connection) {
            console.log(`[RobotAPI] Unregistered connection ${socketId} for robot: ${connection.robot}`);
            this.connections.delete(socketId);
            this.emit('connectionUnregistered', { socketId, robot: connection.robot });
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
    handleIncomingData(socketId, data) {
        const connection = this.connections.get(socketId);
        if (!connection) {
            console.warn(`[RobotAPI] Received data from unknown connection: ${socketId}`);
            return;
        }

        try {
            // Update last activity
            connection.lastActivity = Date.now();
            
            // Try to parse as JSON
            const message = JSON.parse(data.toString());
            
            // Apply middleware
            const processedMessage = this.applyMiddleware('incoming', message);
            if (!processedMessage) {
                console.warn('[RobotAPI] Incoming message blocked by middleware');
                return;
            }
            
            // Store in message history
            this.addToHistory(connection.robot, 'incoming', processedMessage);
            
            // Update statistics
            this.stats.messagesReceived++;
            
            // Try to identify robot from message if pending
            if (connection.robot === 'pending' && processedMessage.robot) {
                this.updateRobotIdentification(socketId, processedMessage.robot);
            }
            
            // Call message handlers
            this.callMessageHandlers(processedMessage, socketId, connection.robot);
            
            // Emit general message event
            this.emit('messageReceived', { 
                message: processedMessage, 
                socketId, 
                robot: connection.robot 
            });
            
        } catch (error) {
            console.warn(`[RobotAPI] Failed to parse incoming data as JSON:`, error.message);
            // Handle as raw data if needed
            this.emit('rawDataReceived', { data, socketId, robot: connection.robot });
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
        let processedMessage = { ...message };
        
        for (const middleware of this.middleware) {
            try {
                const result = middleware(direction, processedMessage);
                if (result === null || result === false) {
                    return null; // Block message
                }
                if (result) {
                    processedMessage = result;
                }
            } catch (error) {
                console.error('[RobotAPI] Middleware error:', error);
            }
        }
        
        return processedMessage;
    }

    /**
     * Register a message handler for specific message types
     */
    onMessageType(messageType, handler) {
        this.messageHandlers.set(messageType, handler);
    }

    /**
     * Call registered message handlers
     */
    callMessageHandlers(message, socketId, robot) {
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
            try {
                handler(message, socketId, robot);
            } catch (error) {
                console.error(`[RobotAPI] Message handler error for type ${message.type}:`, error);
            }
        }
    }

    /**
     * Get status information for all robots
     */
    getStatus() {
        const connections = Array.from(this.connections.values()).map(conn => ({
            socketId: conn.socketId,
            robot: conn.robot,
            remoteAddress: conn.remoteAddress,
            remotePort: conn.remotePort,
            connectedAt: conn.connectedAt,
            lastActivity: conn.lastActivity,
            active: conn.active,
            identificationMethod: conn.identificationMethod
        }));

        return {
            connections,
            stats: this.stats,
            uptime: Date.now() - this.startTime,
            queuedMessages: Array.from(this.messageQueue.values()).reduce((total, queue) => total + queue.length, 0),
            activeSessions: this.llmSessions.size
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
        this.messageHistory.delete(robot);
    }

    /**
     * Add message to history
     */
    addToHistory(robot, direction, message) {
        if (!robot) robot = 'unknown';
        
        if (!this.messageHistory.has(robot)) {
            this.messageHistory.set(robot, []);
        }
        
        const history = this.messageHistory.get(robot);
        history.push({
            direction,
            message,
            timestamp: Date.now()
        });
        
        // Keep only last 1000 messages
        if (history.length > 1000) {
            history.splice(0, history.length - 1000);
        }
    }

    /**
     * Queue message for later delivery
     */
    queueMessage(robot, message) {
        if (!this.messageQueue.has(robot)) {
            this.messageQueue.set(robot, []);
        }
        
        const queue = this.messageQueue.get(robot);
        queue.push({
            message,
            timestamp: Date.now()
        });
        
        // Limit queue size
        if (queue.length > 100) {
            queue.shift();
        }
    }

    /**
     * Send queued messages when connections become available
     */
    processQueuedMessages(robotName) {
        const queue = this.messageQueue.get(robotName);
        if (!queue || queue.length === 0) {
            return;
        }

        console.log(`[RobotAPI] Processing ${queue.length} queued messages for ${robotName}`);
        
        while (queue.length > 0) {
            const queuedItem = queue.shift();
            this.sendMessage(queuedItem.message, robotName);
        }
    }

    /**
     * Process LLM response chunks for robot speech
     */
    processLLMChunk(sessionId, content, isFinished = false, targetRobot = 'Haku') {
        console.log(`[RobotAPI] 🔄 Processing LLM chunk for session ${sessionId}: content=${content ? content.length : 0} chars, finished=${isFinished}, robot=${targetRobot}`);
        
        // Get or create session
        if (!this.llmSessions.has(sessionId)) {
            this.llmSessions.set(sessionId, {
                speechBuffer: '',
                chunkMode: LLM_CHUNK_MODE,
                targetRobot: targetRobot
            });
            console.log(`[RobotAPI] 📝 Created new LLM session ${sessionId} with mode: ${LLM_CHUNK_MODE}`);
        }
        
        const session = this.llmSessions.get(sessionId);
        
        // Add new content to buffer
        if (content) {
            session.speechBuffer += content;
            console.log(`[RobotAPI] 📝 Added ${content.length} chars to session ${sessionId} buffer. Total: ${session.speechBuffer.length} chars`);
            console.log(`[RobotAPI] 📄 Current buffer: "${session.speechBuffer.substring(0, 200)}${session.speechBuffer.length > 200 ? '...' : ''}"`);
        }
        
        // Process based on chunk mode
        switch (session.chunkMode) {
            case 'raw':
                this.processRawChunks(sessionId, content, isFinished);
                break;
            case 'pattern':
                this.processPatternPreservingChunks(sessionId, content, isFinished);
                break;
            case 'smart':
            default:
                this.processSmartChunks(sessionId, content, isFinished);
                break;
        }
        
        // Clean up finished session
        if (isFinished) {
            console.log(`[RobotAPI] 🏁 Session ${sessionId} finished - cleaning up`);
            this.llmSessions.delete(sessionId);
        }
    }

    /**
     * Raw mode: Send chunks immediately
     */
    processRawChunks(sessionId, content, isFinished) {
        if (content && content.trim()) {
            console.log(`[RobotAPI] 🚀 RAW MODE: Sending immediate chunk for ${sessionId}: "${content}"`);
            this.sendSpeechToRobot(content.trim(), sessionId);
        }
        
        if (isFinished) {
            const session = this.llmSessions.get(sessionId);
            if (session && session.speechBuffer.trim()) {
                console.log(`[RobotAPI] 🏁 RAW MODE: Sending final buffer for ${sessionId}: "${session.speechBuffer}"`);
                this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
            }
        }
    }

    /**
     * Pattern mode: Only preserve ^ and {} patterns
     */
    processPatternPreservingChunks(sessionId, content, isFinished) {
        const session = this.llmSessions.get(sessionId);
        if (!session) return;
        
        if (isFinished) {
            // Send everything remaining
            if (session.speechBuffer.trim()) {
                console.log(`[RobotAPI] 🏁 PATTERN MODE: Sending final buffer for ${sessionId}: "${session.speechBuffer}"`);
                this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
            }
            return;
        }
        
        // Check if buffer is safe to send (only pattern preservation)
        if (session.speechBuffer.length > LLM_MAX_BUFFER_SIZE || this.canSendChunkToRobot(session.speechBuffer)) {
            const safeChunk = this.extractSafePatternChunk(sessionId);
            if (safeChunk) {
                console.log(`[RobotAPI] 🎯 PATTERN MODE: Sending safe chunk for ${sessionId}: "${safeChunk}"`);
                this.sendSpeechToRobot(safeChunk, sessionId);
                session.speechBuffer = session.speechBuffer.substring(safeChunk.length).trim();
            }
        }
    }

    /**
     * Smart mode: Preserve patterns AND sentence boundaries
     */
    processSmartChunks(sessionId, content, isFinished) {
        const session = this.llmSessions.get(sessionId);
        if (!session) return;
        
        if (isFinished) {
            // Send everything remaining
            if (session.speechBuffer.trim()) {
                console.log(`[RobotAPI] 🏁 SMART MODE: Sending final buffer for ${sessionId}: "${session.speechBuffer}"`);
                this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
            }
            return;
        }
        
        // If buffer is getting too large, force send
        if (session.speechBuffer.length > LLM_MAX_BUFFER_SIZE) {
            console.log(`[RobotAPI] ⚠️ SMART MODE: Buffer too large for ${sessionId} (${session.speechBuffer.length}), forcing send`);
            const chunk = this.extractForcedChunk(sessionId);
            if (chunk) {
                this.sendSpeechToRobot(chunk, sessionId);
                session.speechBuffer = session.speechBuffer.substring(chunk.length).trim();
            }
            return;
        }
        
        // Try to extract complete sentences that don't break patterns
        const extractedChunks = this.extractSmartChunks(sessionId);
        
        // Send any complete chunks we found
        for (const chunk of extractedChunks) {
            if (chunk.trim()) {
                console.log(`[RobotAPI] 🧠 SMART MODE: Sending intelligent chunk for ${sessionId}: "${chunk}"`);
                this.sendSpeechToRobot(chunk, sessionId);
                
                // Remove sent content from buffer
                const chunkIndex = session.speechBuffer.indexOf(chunk);
                if (chunkIndex !== -1) {
                    session.speechBuffer = session.speechBuffer.substring(chunkIndex + chunk.length).trim();
                }
            }
        }
    }

    /**
     * Extract chunks that only preserve ^ and {} patterns
     */
    extractSafePatternChunk(sessionId) {
        const session = this.llmSessions.get(sessionId);
        if (!session) return null;
        
        // Find the longest safe chunk from the beginning of buffer
        let safeLength = 0;
        for (let i = 1; i <= session.speechBuffer.length; i++) {
            const testChunk = session.speechBuffer.substring(0, i);
            if (this.canSendChunkToRobot(testChunk)) {
                safeLength = i;
            } else {
                break;
            }
        }
        
        if (safeLength >= LLM_MIN_CHUNK_LENGTH) {
            return session.speechBuffer.substring(0, safeLength);
        }
        
        return null;
    }

    /**
     * Extract chunks preserving both patterns and sentence boundaries
     */
    extractSmartChunks(sessionId) {
        const session = this.llmSessions.get(sessionId);
        if (!session) return [];
        
        const extractedChunks = [];
        
        // Create sentence boundary regex
        const sentenceRegex = new RegExp(`([${LLM_SENTENCE_MARKERS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]\\s+)`, 'g');
        const sentences = session.speechBuffer.split(sentenceRegex);
        
        let currentChunk = '';
        
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const testChunk = currentChunk + sentence;
            
            // Check if this chunk is safe to send and meets minimum length
            if (this.canSendChunkToRobot(testChunk)) {
                currentChunk = testChunk;
                
                // If we hit a sentence boundary and have meaningful content, extract it
                if (sentence.match(sentenceRegex) && currentChunk.trim().length >= LLM_MIN_CHUNK_LENGTH) {
                    extractedChunks.push(currentChunk.trim());
                    currentChunk = '';
                }
            } else {
                // This chunk would break patterns, so finalize current chunk if it's valid
                if (currentChunk.trim().length >= LLM_MIN_CHUNK_LENGTH) {
                    extractedChunks.push(currentChunk.trim());
                }
                currentChunk = '';
                break; // Stop processing to wait for more content
            }
        }
        
        return extractedChunks;
    }

    /**
     * Force extraction when buffer is too large
     */
    extractForcedChunk(sessionId) {
        const session = this.llmSessions.get(sessionId);
        if (!session) return null;
        
        // Try to find the best breakpoint even if not ideal
        const words = session.speechBuffer.split(' ');
        let safeChunk = '';
        
        for (let i = 0; i < words.length; i++) {
            const testChunk = words.slice(0, i + 1).join(' ');
            if (this.canSendChunkToRobot(testChunk)) {
                safeChunk = testChunk;
            } else {
                break;
            }
        }
        
        // If no safe word boundary found, just take a safe character-by-character chunk
        if (!safeChunk && session.speechBuffer.length > 0) {
            for (let i = LLM_MIN_CHUNK_LENGTH; i <= session.speechBuffer.length; i++) {
                const testChunk = session.speechBuffer.substring(0, i);
                if (this.canSendChunkToRobot(testChunk)) {
                    safeChunk = testChunk;
                } else {
                    break;
                }
            }
        }
        
        return safeChunk || session.speechBuffer.substring(0, LLM_MIN_CHUNK_LENGTH);
    }

    /**
     * Check if a chunk can be safely sent to robot (doesn't split important patterns)
     */
    canSendChunkToRobot(chunk) {
        if (!chunk || !chunk.trim()) return false;
        
        // Count occurrences of special characters
        const openBraces = (chunk.match(/{/g) || []).length;
        const closeBraces = (chunk.match(/}/g) || []).length;
        const carets = (chunk.match(/\^/g) || []).length;
        const closeParens = (chunk.match(/\)/g) || []).length;
        
        // Check if braces are balanced
        const bracesBalanced = openBraces === closeBraces;
        
        // Check if caret patterns are complete
        const caretPatternsComplete = carets === closeParens;
        
        // Additional check: ensure we don't have orphaned ^ without (
        const openPatterns = (chunk.match(/\^[^)]*$/g) || []).length;
        const hasOrphanedPattern = openPatterns > 0;
        
        const isSafe = bracesBalanced && caretPatternsComplete && !hasOrphanedPattern;
        
        return isSafe;
    }

    /**
     * Send speech to robot via Robot API
     */
    sendSpeechToRobot(text, sessionId) {
        if (!text || !text.trim()) {
            console.log(`[RobotAPI] ⚠️ Attempted to send empty text to robot - skipping`);
            return;
        }
        
        const session = this.llmSessions.get(sessionId);
        const targetRobot = session?.targetRobot || 'Haku';
        
        console.log(`[RobotAPI] 🤖 Sending speech to robot ${targetRobot}: "${text}"`);
        console.log(`[RobotAPI] 📊 Speech details - length: ${text.length} chars`);
        
        try {
            const messageData = {
                cmd: 'req-execute',
                type: 'conversation-response',
                message: text.trim(),
                robot: targetRobot,
                source: 'llm-chunk',
                sessionId: sessionId,
                timestamp: Date.now()
            };
            
            const sent = this.sendMessage(messageData, targetRobot);
            
            if (sent) {
                console.log(`[RobotAPI] ✅ Speech sent to robot ${targetRobot} successfully`);
            } else {
                console.log(`[RobotAPI] ⚠️ Speech queued for robot ${targetRobot} (no active connections)`);
            }
            
        } catch (error) {
            console.error(`[RobotAPI] ❌ Error sending speech to robot:`, error);
        }
    }

    updateRobotStatus(robot, event, data = null) {
        if (!robot) return;
        
        const currentTime = Date.now();
        const currentStatus = this.robotStatus.get(robot) || {
            lastActivity: currentTime,
            events: [],
            messageCount: 0,
            lastMessage: null
        };
        
        // Add event to history (keep last 10)
        const eventEntry = {
            event: event,
            timestamp: currentTime,
            data: data
        };
        
        currentStatus.events.push(eventEntry);
        if (currentStatus.events.length > 10) {
            currentStatus.events.shift();
        }
        
        // Update general status
        currentStatus.lastActivity = currentTime;
        
        if (event === 'speaking' || event === 'spoke') {
            currentStatus.messageCount++;
            currentStatus.lastMessage = data;
        }
        
        this.robotStatus.set(robot, currentStatus);
    }

    cleanupInactiveConnections() {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
        
        for (const [socketId, connection] of this.connections.entries()) {
            if (now - connection.lastActivity > inactiveThreshold) {
                console.log(`[RobotAPI] Cleaning up inactive connection: ${socketId}`);
                this.connections.delete(socketId);
            }
        }
    }

    handleShutdownCommand(socketId) {
        console.log(`[RobotAPI] Handling shutdown command for connection: ${socketId}`);
        this.unregisterConnection(socketId);
    }
}

module.exports = new RobotAPI();
