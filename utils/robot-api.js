const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

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
        
        // LLM communication broadcast function (will be set by main server)
        this.broadcastLLMCommunication = null;
        
        // LLM chunk processing sessions
        this.llmSessions = new Map(); // sessionId -> { speechBuffer, chunkMode }
        
        // Robot identification configuration
        this.identificationMethod = process.env.ROBOT_IDENTIFICATION_METHOD || 'socket';
        this.robotIPs = {
            'Haku': process.env.HAKU_IP,
            'Bandit': process.env.BANDIT_IP
        };
        this.defaultRobotName = process.env.DEFAULT_ROBOT_NAME || 'unknown';
        
        // Session-based chunk buffering - track sessions separately from LLM sessions
        this.chunkBuffers = new Map(); // sessionId -> { buffer, lastChunkTime, robot }
        this.CHUNK_TIMEOUT = 2000; // Send buffer if no new chunks for 2 seconds
        this.BUFFER_CHECK_INTERVAL = 250; // Check buffers every 250ms

        // Chunk ordering and validation for race condition prevention
        this.chunkOrdering = new Map(); // sessionId -> { expectedChunk, pendingChunks, maxWaitTime }
        this.CHUNK_WAIT_TIMEOUT = 1000; // Max time to wait for out-of-order chunks (ms)
        this.MAX_PENDING_CHUNKS = 20; // Max number of out-of-order chunks to buffer
        // If we see many chunks but never chunk 0, optionally assume the stream starts at 1
        this.CHUNK_START_ASSUME_THRESHOLD = parseInt(process.env.LLM_FIRST_CHUNK_ASSUME_AFTER || process.env.LLM_CHUNK_START_ASSUME_THRESHOLD) || 5;
        
        // Robot status system
        this.statusConfig = null;
        this.triggersConfig = null;
        this.scrollConfig = null;
        this.detailedRobotStatus = new Map(); // robot -> detailed status object
        this.statusUpdateCallbacks = new Map(); // robot -> callback functions
        
        // Turn-taking control system
        this.conversationSessions = new Map(); // sessionId -> { robot, llmActive, robotSpeaking, sttAllowed }
        this.sttPaused = false;
        this.sttTemporarilyDisabled = false;
        this.llmActiveSessions = new Set(); // Track active LLM sessions
        
        // Robot State Management System (similar to STT)
        this.robotStateManager = {
            connected: new Set(),
            expectedStates: new Map(), // robot -> expected state object
            lastStateSync: new Map(),  // robot -> timestamp
            healthCheckInterval: null,
            stateSyncInterval: null
        };
        
        // Robot state sync configuration
        this.ROBOT_HEALTH_CHECK_INTERVAL = parseInt(process.env.ROBOT_HEALTH_CHECK_INTERVAL) || 15000;
        this.ROBOT_STATE_SYNC_INTERVAL = parseInt(process.env.ROBOT_STATE_SYNC_INTERVAL) || 30000;
        this.ROBOT_RECONNECT_DELAY = parseInt(process.env.ROBOT_RECONNECT_DELAY) || 3000;
        this.ROBOT_MAX_SYNC_RETRIES = parseInt(process.env.ROBOT_MAX_SYNC_RETRIES) || 3;
        
        // Robot name mappings: robot name as primary identifier
        this.robotNameToSocketId = new Map();     // robot name -> socket ID
        this.robotNameToSessionId = new Map();    // robot name -> LLM session ID
        this.socketIdToRobotName = new Map();     // socket ID -> robot name
        this.sessionIdToRobotName = new Map();    // LLM session ID -> robot name
        
        console.log('[RobotAPI] Initialized with identification method:', this.identificationMethod);
        console.log('[RobotAPI] Robot IP mappings:', this.robotIPs);
        console.log('[RobotAPI] LLM chunk processing mode:', LLM_CHUNK_MODE);
        
        // STT WebSocket connection
        this.sttWebSocket = null;
        this.sttReconnectTimeout = null;
        this.sttHost = process.env.STT_SERVER_HOST || 'localhost';
        this.sttPort = process.env.STT_SERVER_PORT || 8765;
        
        // Enhanced STT state management
        this.sttState = {
            connected: false,
            expectedState: 'running', // 'running', 'paused', 'stopped'
            actualState: 'unknown',   // State reported by STT server
            lastHealthCheck: null,
            lastStateSync: null,
            syncRetries: 0,
            maxSyncRetries: this.STT_MAX_SYNC_RETRIES
        };
        this.sttHealthCheckInterval = null;
        this.sttStateCheckInterval = null;
        this.STT_HEALTH_CHECK_INTERVAL = parseInt(process.env.STT_HEALTH_CHECK_INTERVAL) || 10000;
        this.STT_STATE_CHECK_INTERVAL = parseInt(process.env.STT_STATE_CHECK_INTERVAL) || 5000;
        this.STT_RECONNECT_DELAY = parseInt(process.env.STT_RECONNECT_DELAY) || 5000;
        this.STT_MAX_SYNC_RETRIES = parseInt(process.env.STT_MAX_SYNC_RETRIES) || 3;
        this.sttServerDownFallbackSent = new Set(); // Track which conversations got fallback message
        
        this.loadStatusConfiguration();
        this.setupDefaultHandlers();
        this.setupCleanupInterval();
        this.startBufferMonitoring();
        this.initializeSTTConnection();
        this.startSTTHealthMonitoring();
        this.startRobotStateManagement();
    }

    setupDefaultHandlers() {
        // Add middleware for LLM conversation responses
        this.addMiddleware((direction, message) => {
            if (direction === 'outgoing' && message.type === 'conversation-response') {
                console.log(`[RobotAPI] 🗣️ Processing LLM conversation response: "${message.message?.substring(0, 50)}${message.message?.length > 50 ? '...' : ''}"`);
                console.log(`[RobotAPI] 📊 Response details - robot: ${message.robot}, source: ${message.source || 'unknown'}, sessionId: ${message.sessionId || 'none'}`);
                
                // Validate the message content
                if (!message.message || !message.message.trim()) {
                    console.warn(`[RobotAPI] ⚠️ Empty conversation response message - blocking`);
                    return null; // Block empty messages
                }
                
                // Don't re-process messages that already came from chunk buffer
                if (message.source === 'chunk-buffer') {
                    console.log(`[RobotAPI] ✅ Message from chunk buffer - sending directly without re-buffering`);
                    // Update robot status but don't buffer again
                    this.updateRobotStatus(message.robot, 'speaking', {
                        messageLength: message.message.length,
                        source: message.source,
                        timestamp: message.timestamp
                    });
                    
                    return message; // Send directly without buffering
                }
                
                // Only buffer messages from API calls (not from chunk buffer)
                if (message.source === 'api' && message.sessionId) {
                    console.log(`[RobotAPI] 📥 Intercepting chunk for buffering: "${message.message}"`);
                    this.addToChunkBuffer(message.sessionId, message.message, message.robot);
                    console.log(`[RobotAPI] Message blocked by middleware:`, message);
                    return null; // Block the original message since we're buffering it
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

        // Handler for robot identification messages
        this.onMessageType('robot-identify', (message, socketId, robot) => {
            console.log(`[RobotAPI] Robot identification message from ${robot || 'unknown'} (${socketId}):`, JSON.stringify(message, null, 2));
            
            // Extract robot name from the message
            const robotName = message.robot || robot;
            
            if (robotName && robotName !== 'pending') {
                // Update the connection with the identified robot name
                this.updateRobotIdentification(socketId, robotName);
                
                // Update robot status to indicate successful identification
                this.updateDetailedRobotStatus(robotName, {
                    last_identification: Date.now(),
                    connection_status: 'identified'
                });
                
                console.log(`[RobotAPI] ✅ Robot ${robotName} successfully identified and status initialized`);
            } else {
                console.warn(`[RobotAPI] ⚠️ Invalid robot name in identification message:`, robotName);
            }
        });

        // Handler for robot status updates
        this.onMessageType('status-update', (message, socketId, robot) => {
            console.log(`[RobotAPI] 📊 Status update received from ${robot || 'unknown'}:`, JSON.stringify(message, null, 2));
            
            // Extract status data from message.message or message.status or direct from message
            const statusData = message.message || message.status || message;
            
            if (statusData && typeof statusData === 'object') {
                this.handleRobotStatusUpdate(robot, statusData);
            } else {
                console.warn(`[RobotAPI] ⚠️ No valid status data found in status-update message from ${robot}`);
            }
        });

        // Handler for robot heartbeat
        this.onMessageType('heartbeat', (message, socketId, robot) => {
            const heartbeatData = {
                last_heartbeat: Date.now(),
                connection_quality: message.signal_strength || 100
            };
            if (message.uptime) heartbeatData.uptime = message.uptime;
            this.updateDetailedRobotStatus(robot, heartbeatData);
        });

        // Handler for robot health check responses
        this.onMessageType('health_check_response', (message, socketId, robot) => {
            console.log(`[RobotAPI] Health check response from ${robot}:`, message);
            this.robotStateManager.connected.add(robot);
        });

        // Handler for robot state sync responses
        this.onMessageType('state_sync_response', (message, socketId, robot) => {
            console.log(`[RobotAPI] 📊 State sync response from ${robot}:`, message);
            if (message.state) {
                this.handleRobotStateResponse(robot, message.state);
            }
        });

        // Handler for robot state updates (pushed by robot)
        this.onMessageType('state_update', (message, socketId, robot) => {
            console.log(`[RobotAPI] 🔄 State update from ${robot}:`, message);
            if (message.state) {
                this.handleRobotStateResponse(robot, message.state);
            }
        });

        // Handler for robot speaking state changes
        this.onMessageType('speaking-state', (message, socketId, robot) => {
            console.log(`[RobotAPI] Speaking state message from ${robot}:`, JSON.stringify(message, null, 2));
            
            // Extract speaking state from message.message or direct from message
            const isSpeaking = message.message?.speaking ?? message.speaking ?? false;
            const wasSpeaking = this.getRobotStatus(robot)?.speaking || false;
            const providedSessionId = message.session_id || message.message?.session_id;
            
            // Infer session ID if not provided by robot
            const sessionId = this.inferSessionIdForRobot(robot, providedSessionId);
            
            console.log(`[RobotAPI] Speaking state change for ${robot}: ${wasSpeaking} → ${isSpeaking} (session: ${sessionId})`);
            
            // CRITICAL: Robot's actual state overrides web controller's state
            if (isSpeaking !== wasSpeaking) {
                console.log(`[RobotAPI] 🎯 Robot ${robot} reporting different speaking state - overriding web controller state`);
                
                // If robot reports stopped speaking when we thought it was speaking
                if (wasSpeaking && !isSpeaking) {
                    console.log(`[RobotAPI] 🎤 Robot ${robot} finished speaking - handling state override and STT resumption`);
                    this.handleRobotStoppedSpeaking(robot, sessionId);
                }
            }
            
            // Turn-taking validation
            if (!isSpeaking && wasSpeaking && sessionId) {
                // Robot stopped speaking - check if LLM is still active
                if (this.llmActiveSessions.has(sessionId)) {
                    console.warn(`[RobotAPI] ⚠️ TURN-TAKING VIOLATION: Robot ${robot} stopped speaking but LLM session ${sessionId} is still active!`);
                    this.emit('turnTakingViolation', {
                        type: 'robot_finished_while_llm_active',
                        robot,
                        sessionId,
                        timestamp: Date.now()
                    });
                }
            }
            
            const speakingUpdate = {
                speaking: isSpeaking,
                current_behavior: isSpeaking ? 'speaking' : 'idle'
            };
            if (sessionId) {
                speakingUpdate.conversation_session_id = sessionId;
            }
            this.updateDetailedRobotStatus(robot, speakingUpdate);
            
            // Update conversation session state
            if (sessionId) {
                this.updateConversationSession(sessionId, robot, { robotSpeaking: isSpeaking });
            }
            
            // STT Control Logic - Always pause/resume regardless of session ID
            if (isSpeaking && !wasSpeaking) {
                // Robot started speaking - pause STT immediately
                console.log(`[RobotAPI] 🎤 Robot ${robot} started speaking - pausing STT immediately`);
                this.pauseSTTProcessing();
                
                // // Also set a flag to ignore STT messages for a brief moment
                // this.sttTemporarilyDisabled = true;
                // setTimeout(() => {
                //     this.sttTemporarilyDisabled = false;
                // }, 1000); // 1 second buffer // TODO: Verify if this is still needed
                
                this.sttTemporarilyDisabled = false;
                

            } else if (!isSpeaking && wasSpeaking) {
                // Robot stopped speaking - only resume STT if turn-taking rules allow it
                console.log(`[RobotAPI] 🎤 Robot ${robot} stopped speaking - checking if STT can be resumed`);
                
                // Check if turn-taking rules allow STT resumption
                const canResume = this.checkSTTResumption(sessionId, robot);
                if (canResume) {
                    // Add delay to avoid picking up tail end of robot speech
                    console.log(`[RobotAPI] 🎤 Resuming STT after ${robot} finished speaking (turn-taking rules satisfied)`);
                    this.resumeSTTProcessing();
                    this.sttTemporarilyDisabled = false;
                } else {
                    console.log(`[RobotAPI] ⏸️ Robot ${robot} stopped speaking but turn-taking rules prevent STT resumption`);
                    // Don't resume STT - wait for proper turn-taking signal
                }
                
                // Handle session-specific cleanup
                if (sessionId) {
                    this.handleSpeakingFinished(robot, sessionId);
                }
            }
        });
    }

    setupCleanupInterval() {
        // Start cleanup interval
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveConnections();
            this.cleanupStaleChunks();
        }, 30000); // Clean up every 30 seconds
    }

    startBufferMonitoring() {
        setInterval(() => {
            this.checkStaleBuffers();
        }, this.BUFFER_CHECK_INTERVAL);
    }

    /**
     * Load status configuration from JSON files
     */
    loadStatusConfiguration() {
        try {
            const statusConfigPath = path.join(__dirname, '..', 'settings', 'robot_status_config.json');
            
            if (fs.existsSync(statusConfigPath)) {
                this.statusConfig = JSON.parse(fs.readFileSync(statusConfigPath, 'utf8'));
                console.log('[RobotAPI] Status configuration loaded');
            } else {
                console.warn('[RobotAPI] ⚠️ Status configuration file not found');
            }

            // Load signal configurations for validation
            this.loadSignalConfigs();
        } catch (error) {
            console.error('[RobotAPI] ❌ Failed to load status configuration:', error);
        }
    }

    /**
     * Load trigger and scroll controller configs for signal validation
     */
    loadSignalConfigs() {
        try {
            // Load triggers config
            const triggersPath = path.join(__dirname, '..', 'settings', 'triggers.json');
            if (fs.existsSync(triggersPath)) {
                this.triggersConfig = JSON.parse(fs.readFileSync(triggersPath, 'utf8'));
                console.log('[RobotAPI] ✅ Triggers configuration loaded');
            } else {
                console.warn('[RobotAPI] ⚠️ Triggers config file not found');
                this.triggersConfig = {};
            }

            // Load scroll controllers config
            const scrollPath = path.join(__dirname, '..', 'settings', 'scroll_controllers_config.json');
            if (fs.existsSync(scrollPath)) {
                this.scrollConfig = JSON.parse(fs.readFileSync(scrollPath, 'utf8'));
                console.log('[RobotAPI] ✅ Scroll controllers configuration loaded');
            } else {
                console.warn('[RobotAPI] ⚠️ Scroll controllers config file not found');
                this.scrollConfig = {};
            }
        } catch (error) {
            console.error('[RobotAPI] ❌ Failed to load signal configurations:', error);
            this.triggersConfig = {};
            this.scrollConfig = {};
        }
    }

    /**
     * Initialize status for a robot based on configuration
     */
    initializeRobotStatus(robotName) {
        if (!this.statusConfig) {
            console.warn(`[RobotAPI] Cannot initialize status for ${robotName} - no configuration loaded`);
            return;
        }

        const status = {};
        
        // Add base status definitions
        for (const [key, config] of Object.entries(this.statusConfig.statusDefinitions)) {
            status[key] = config.default;
        }
        
        // Apply robot-specific overrides and additions
        if (this.statusConfig.robotSpecific?.[robotName]) {
            const robotConfig = this.statusConfig.robotSpecific[robotName];
            
            // Apply overrides
            if (robotConfig.statusOverrides) {
                for (const [key, override] of Object.entries(robotConfig.statusOverrides)) {
                    if (status.hasOwnProperty(key) && override.default !== undefined) {
                        status[key] = override.default;
                    }
                }
            }
            
            // Add additional status fields
            if (robotConfig.additionalStatus) {
                for (const [key, config] of Object.entries(robotConfig.additionalStatus)) {
                    status[key] = config.default;
                }
            }
        }
        
        // Add metadata
        status._metadata = {
            lastUpdate: Date.now(),
            robotName: robotName,
            initialized: true
        };
        
        this.detailedRobotStatus.set(robotName, status);
        console.log(`[RobotAPI] ✅ Status initialized for ${robotName} with ${Object.keys(status).length - 1} fields`);
        
        // Emit status initialization event
        this.emit('statusInitialized', { robot: robotName, status });
    }

    /**
     * Update robot status field(s)
     */
    updateDetailedRobotStatus(robotName, updates) {
        if (!this.detailedRobotStatus.has(robotName)) {
            this.initializeRobotStatus(robotName);
        }
        
        const currentStatus = this.detailedRobotStatus.get(robotName);
        const previousValues = {};
        const changedFields = [];
        
        // Process updates
        for (const [key, value] of Object.entries(updates)) {
            if (currentStatus[key] !== value) {
                previousValues[key] = currentStatus[key];
                currentStatus[key] = value;
                changedFields.push(key);
            }
        }
        
        if (changedFields.length > 0) {
            // Update metadata
            currentStatus._metadata.lastUpdate = Date.now();
            
            console.log(`[RobotAPI] 📊 Status updated for ${robotName}:`, changedFields.map(field => `${field}: ${previousValues[field]} → ${currentStatus[field]}`).join(', '));
            
            // Check for critical values
            this.checkCriticalStatusValues(robotName, currentStatus, changedFields);
            
            // Emit status change event
            this.emit('statusChanged', { 
                robot: robotName, 
                changedFields, 
                previousValues, 
                currentStatus: { ...currentStatus }
            });
            
            // Call registered callbacks
            const callback = this.statusUpdateCallbacks.get(robotName);
            if (callback) {
                try {
                    callback(changedFields, currentStatus, previousValues);
                } catch (error) {
                    console.error(`[RobotAPI] ❌ Status callback error for ${robotName}:`, error);
                }
            }
        }
        
        return currentStatus;
    }

    /**
     * Get current status for a robot
     */
    getRobotStatus(robotName) {
        if (!this.detailedRobotStatus.has(robotName)) {
            this.initializeRobotStatus(robotName);
        }
        return { ...this.detailedRobotStatus.get(robotName) };
    }

    /**
     * Get status for all robots
     */
    getAllRobotStatus() {
        const allStatus = {};
        for (const [robotName, status] of this.detailedRobotStatus.entries()) {
            allStatus[robotName] = { ...status };
        }
        return allStatus;
    }

    /**
     * Check for critical status values and emit warnings
     */
    checkCriticalStatusValues(robotName, status, changedFields) {
        if (!this.statusConfig) return;
        
        for (const field of changedFields) {
            const fieldConfig = this.statusConfig.statusDefinitions[field];
            
            if (!fieldConfig) continue;
            
            const value = status[field];
            
            // Check critical threshold
            if (fieldConfig.critical_threshold !== undefined) {
                if ((fieldConfig.max !== undefined && value >= fieldConfig.critical_threshold) ||
                    (fieldConfig.min !== undefined && value <= fieldConfig.critical_threshold)) {
                    console.error(`[RobotAPI] 🚨 CRITICAL: ${robotName} ${field} is ${value} (threshold: ${fieldConfig.critical_threshold})`);
                    this.emit('criticalStatus', { robot: robotName, field, value, threshold: fieldConfig.critical_threshold });
                }
            }
            
            // Check warning threshold
            if (fieldConfig.warning_threshold !== undefined) {
                if ((fieldConfig.max !== undefined && value >= fieldConfig.warning_threshold) ||
                    (fieldConfig.min !== undefined && value <= fieldConfig.warning_threshold)) {
                    console.warn(`[RobotAPI] ⚠️ WARNING: ${robotName} ${field} is ${value} (threshold: ${fieldConfig.warning_threshold})`);
                    this.emit('warningStatus', { robot: robotName, field, value, threshold: fieldConfig.warning_threshold });
                }
            }
        }
    }

    /**
     * Register a callback for status updates for a specific robot
     */
    onRobotStatusUpdate(robotName, callback) {
        this.statusUpdateCallbacks.set(robotName, callback);
    }

    /**
     * Handle incoming status update from robot
     */
    handleRobotStatusUpdate(robotName, statusUpdate) {
        console.log(`[RobotAPI] 📨 Received status update from ${robotName}:`, statusUpdate);
        
        // Validate and process the status update
        const validatedUpdate = this.validateStatusUpdate(statusUpdate);
        if (Object.keys(validatedUpdate).length > 0) {
            this.updateDetailedRobotStatus(robotName, validatedUpdate);
        }
    }

    /**
     * Validate incoming status update against configuration
     */
    validateStatusUpdate(statusUpdate) {
        const validated = {};
        
        for (const [key, value] of Object.entries(statusUpdate)) {
            // Check if it's a defined status field
            const fieldConfig = this.statusConfig?.statusDefinitions?.[key];
            
            if (fieldConfig) {
                // Validate against status config
                if (!this.validateFieldValue(key, value, fieldConfig)) {
                    continue;
                }
                validated[key] = value;
            } else {
                // Check if it's a signal field (from triggers or scroll controllers)
                const signalValidation = this.validateSignalField(key, value);
                if (signalValidation.valid) {
                    validated[key] = value;
                } else {
                    console.warn(`[RobotAPI] ⚠️ ${signalValidation.reason}`);
                }
            }
        }
        
        return validated;
    }

    /**
     * Validate field value against configuration
     */
    validateFieldValue(key, value, fieldConfig) {
        // Type validation
        if (fieldConfig.type === 'boolean' && typeof value !== 'boolean') {
            console.warn(`[RobotAPI] ⚠️ Invalid type for ${key}: expected boolean, got ${typeof value}`);
            return false;
        }
        
        if (fieldConfig.type === 'number' && typeof value !== 'number') {
            console.warn(`[RobotAPI] ⚠️ Invalid type for ${key}: expected number, got ${typeof value}`);
            return false;
        }
        
        if (fieldConfig.type === 'string' && typeof value !== 'string') {
            console.warn(`[RobotAPI] ⚠️ Invalid type for ${key}: expected string, got ${typeof value}`);
            return false;
        }
        
        // Range validation for numbers
        if (fieldConfig.type === 'number') {
            if (fieldConfig.min !== undefined && value < fieldConfig.min) {
                console.warn(`[RobotAPI] ⚠️ Value ${value} for ${key} below minimum ${fieldConfig.min}`);
                return false;
            }
            if (fieldConfig.max !== undefined && value > fieldConfig.max) {
                console.warn(`[RobotAPI] ⚠️ Value ${value} for ${key} above maximum ${fieldConfig.max}`);
                return false;
            }
        }
        
        // Allowed values validation
        if (fieldConfig.allowed_values && !fieldConfig.allowed_values.includes(value)) {
            console.warn(`[RobotAPI] ⚠️ Invalid value ${value} for ${key}: allowed values are ${fieldConfig.allowed_values.join(', ')}`);
            return false;
        }
        
        return true;
    }

    /**
     * Validate signal field from triggers or scroll controllers
     */
    validateSignalField(key, value) {
        try {
            // Check triggers from loaded config
            if (this.triggersConfig) {
                for (const robotConfig of Object.values(this.triggersConfig)) {
                    for (const trigger of Object.values(robotConfig)) {
                        if (trigger.Signal === key) {
                            // Trigger signals should be boolean
                            if (typeof value !== 'boolean') {
                                return { valid: false, reason: `Signal ${key} should be boolean, got ${typeof value}` };
                            }
                            return { valid: true };
                        }
                    }
                }
            }

            // Check scroll controllers from loaded config
            if (this.scrollConfig) {
                for (const robotConfig of Object.values(this.scrollConfig)) {
                    for (const scroll of Object.values(robotConfig)) {
                        if (scroll.signal === key) {
                            // Scroll controller signals should be numbers
                            if (typeof value !== 'number') {
                                return { valid: false, reason: `Signal ${key} should be number, got ${typeof value}` };
                            }
                            // Validate range if specified
                            if (scroll.min !== undefined && value < scroll.min) {
                                return { valid: false, reason: `Signal ${key} value ${value} below minimum ${scroll.min}` };
                            }
                            if (scroll.max !== undefined && value > scroll.max) {
                                return { valid: false, reason: `Signal ${key} value ${value} above maximum ${scroll.max}` };
                            }
                            return { valid: true };
                        }
                    }
                }
            }

            // Check if this is a robot-generated status field from the status config
            if (this.statusConfig?.statusDefinitions?.[key]) {
                // Allow robot-generated status fields without validation
                return { valid: true };
            }

            return { valid: false, reason: `Unknown status field: ${key}` };
        } catch (error) {
            console.error(`[RobotAPI] Error validating signal field ${key}:`, error);
            return { valid: false, reason: `Validation error for ${key}` };
        }
    }

    /**
     * Handle when robot finishes speaking - notifies STT to flush buffer
     */
    handleSpeakingFinished(robotName, sessionId) {
        // If no session ID provided, use robot's socket ID as session ID
        if (!sessionId) {
            sessionId = this.getRobotSocketId(robotName);
            if (sessionId) {
                console.log(`[RobotAPI] 🎤 Using robot ${robotName} socket ID ${sessionId} for speaking finished handling`);
            }
        }
        
        console.log(`[RobotAPI] 🎤 Robot ${robotName} finished speaking (session: ${sessionId})`);
        
        // Update robot status
        this.updateDetailedRobotStatus(robotName, {
            listening: true,
            stt_buffer_state: 'ready',
            current_behavior: 'listening'
        });
        
        // Emit event for STT integration
        this.emit('robotFinishedSpeaking', { 
            robot: robotName, 
            sessionId,
            timestamp: Date.now()
        });
    }

    /**
     * Initialize STT WebSocket connection
     */
    initializeSTTConnection() {
        if (this.sttHost === 'disabled') {
            console.log('[RobotAPI] STT connection disabled via configuration');
            return;
        }
        
        if (this.sttWebSocket && this.sttWebSocket.readyState === WebSocket.OPEN) {
            return; // Already connected
        }

        const sttUrl = `ws://${this.sttHost}:${this.sttPort}`;
        console.log(`[RobotAPI] 🔌 Connecting to STT server at ${sttUrl}`);

        try {
            this.sttWebSocket = new WebSocket(sttUrl);

            this.sttWebSocket.on('open', () => {
                console.log('[RobotAPI] ✅ STT WebSocket connected');
                this.sttState.connected = true;
                this.sttState.lastHealthCheck = Date.now();
                
                // Clear any reconnect timeout
                if (this.sttReconnectTimeout) {
                    clearTimeout(this.sttReconnectTimeout);
                    this.sttReconnectTimeout = null;
                }
                
                // Request current state from STT server first
                this.requestSTTState();
                
                // Don't immediately sync state - wait for the server to report its actual state first
                // The state sync will happen in the message handler when we receive the state response
            });

            this.sttWebSocket.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('[RobotAPI] 📥 STT message received:', message);
                    
                    // Update health check timestamp
                    this.sttState.lastHealthCheck = Date.now();
                    
                    // Handle state-related messages
                    this.handleSTTStateMessage(message);
                    
                    // Handle STT messages with turn-taking validation
                    this.handleSTTMessage(message);
                } catch (error) {
                    console.error('[RobotAPI] ❌ Failed to parse STT message:', error);
                }
            });

            this.sttWebSocket.on('close', () => {
                console.log('[RobotAPI] STT WebSocket disconnected, attempting reconnect...');
                this.handleSTTDisconnection();
                this.scheduleSTTReconnect();
            });

            this.sttWebSocket.on('error', (error) => {
                console.error('[RobotAPI] ❌ STT WebSocket error:', error);
                this.handleSTTDisconnection();
                this.scheduleSTTReconnect();
            });

        } catch (error) {
            console.error('[RobotAPI] ❌ Failed to create STT WebSocket:', error);
            this.scheduleSTTReconnect();
        }
    }

    /**
     * Schedule STT WebSocket reconnection
     */
    scheduleSTTReconnect() {
        if (this.sttReconnectTimeout) {
            return; // Already scheduled
        }

        this.sttReconnectTimeout = setTimeout(() => {
            this.sttReconnectTimeout = null;
            this.initializeSTTConnection();
        }, this.STT_RECONNECT_DELAY);
    }

    /**
     * Send command to STT server
     */
    sendSTTCommand(action, additionalData = {}) {
        if (!this.sttWebSocket || this.sttWebSocket.readyState !== WebSocket.OPEN) {
            console.warn(`[RobotAPI] ⚠️ STT WebSocket not connected, cannot send ${action} command`);
            return false;
        }

        const command = {
            type: 'control',
            action: action,
            timestamp: Date.now(),
            ...additionalData
        };

        try {
            this.sttWebSocket.send(JSON.stringify(command));
            console.log(`[RobotAPI] 📤 STT command sent: ${action}`, command);
            return true;
        } catch (error) {
            console.error(`[RobotAPI] ❌ Failed to send STT command ${action}:`, error);
            return false;
        }
    }

    /**
     * Pause STT processing (called when robot starts speaking)
     */
    pauseSTTProcessing() {
        console.log('[RobotAPI] ⏸️ Pausing STT processing - robot is speaking');
        
        // Only update sttPaused if the STT server is actually in running state
        // This prevents race conditions where we set sttPaused=true but server is already paused
        if (this.sttState.actualState === 'running') {
            this.sttPaused = true;
            this.sttState.expectedState = 'paused';
            this.sttState.syncRetries = 0; // Reset retries for new command
            return this.sendSTTCommand('pause');
        } else if (this.sttState.actualState === 'paused') {
            // Server is already paused, just update our internal state
            console.log('[RobotAPI] ✅ STT server already paused, updating internal state');
            this.sttPaused = true;
            this.sttState.expectedState = 'paused';
            this.sttState.syncRetries = 0; // States are aligned
            return true;
        } else {
            // Server state unknown, send pause command but don't set sttPaused yet
            console.log('[RobotAPI] ⚠️ STT server state unknown, sending pause command');
            this.sttState.expectedState = 'paused';
            this.sttState.syncRetries = 0; // Reset retries for new command
            return this.sendSTTCommand('pause');
        }
    }

    /**
     * Resume STT processing (called when robot stops speaking)
     */
    resumeSTTProcessing() {
        console.log('[RobotAPI] ▶️ Resuming STT processing - robot finished speaking');
        
        // Only update sttPaused if the STT server is actually in paused state  
        if (this.sttState.actualState === 'paused') {
            this.sttPaused = false;
            this.sttState.expectedState = 'running';
            this.sttState.syncRetries = 0; // Reset retries for new command
            return this.sendSTTCommand('resume');
        } else if (this.sttState.actualState === 'running') {
            // Server is already running, just update our internal state
            console.log('[RobotAPI] ✅ STT server already running, updating internal state');
            this.sttPaused = false;
            this.sttState.expectedState = 'running';
            this.sttState.syncRetries = 0; // States are aligned
            return true;
        } else {
            // Server state unknown, send resume command but don't set sttPaused yet
            console.log('[RobotAPI] ⚠️ STT server state unknown, sending resume command');
            this.sttState.expectedState = 'running';
            this.sttState.syncRetries = 0; // Reset retries for new command
            return this.sendSTTCommand('resume');
        }
    }

    /**
     * Enhanced STT State Management Methods
     */
    
    /**
     * Start STT health monitoring with periodic state checks
     */
    startSTTHealthMonitoring() {
        // Health check interval
        this.sttHealthCheckInterval = setInterval(() => {
            this.performSTTHealthCheck();
        }, this.STT_HEALTH_CHECK_INTERVAL);
        
        // State sync interval 
        this.sttStateCheckInterval = setInterval(() => {
            this.checkSTTStateSync();
        }, this.STT_STATE_CHECK_INTERVAL);
        
        console.log('[RobotAPI] STT health monitoring started');
    }
    
    /**
     * Perform STT server health check
     */
    performSTTHealthCheck() {
        if (this.sttWebSocket && this.sttWebSocket.readyState === WebSocket.OPEN) {
            // Send ping/health check command
            this.sendSTTCommand('ping', { healthCheck: true });
        } else {
            console.log('[RobotAPI] STT server health check failed - not connected');
            this.handleSTTDisconnection();
        }
    }
    
    /**
     * Check STT state synchronization
     */
    checkSTTStateSync() {
        if (!this.sttState.connected) {
            return; // Can't sync if not connected
        }
        
        const now = Date.now();
        
        // Check if we've received health updates recently
        if (this.sttState.lastHealthCheck && 
            (now - this.sttState.lastHealthCheck) > (this.STT_HEALTH_CHECK_INTERVAL * 2)) {
            console.warn('[RobotAPI] ⚠️ STT server health check timeout - assuming disconnected');
            this.handleSTTDisconnection();
            return;
        }
        
        // Check if state sync is needed
        if (this.sttState.expectedState !== this.sttState.actualState) {
            console.log(`[RobotAPI] 🔄 STT state mismatch - expected: ${this.sttState.expectedState}, actual: ${this.sttState.actualState}`);
            
            // Check if enough time has passed since last sync attempt to avoid spam
            const timeSinceLastSync = this.sttState.lastStateSync ? (now - this.sttState.lastStateSync) : Infinity;
            const MIN_SYNC_INTERVAL = 2000; // Minimum 2 seconds between sync attempts
            
            if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
                console.log(`[RobotAPI] ⏳ Waiting for sync cooldown (${MIN_SYNC_INTERVAL - timeSinceLastSync}ms remaining)`);
                return;
            }
            
            if (this.sttState.syncRetries < this.sttState.maxSyncRetries) {
                this.syncSTTState();
            } else {
                console.error('[RobotAPI] ❌ STT state sync failed after max retries - resetting retry counter and trying once more');
                // Reset retry counter to give it another chance, but only after a longer delay
                this.sttState.syncRetries = 0;
                this.sttState.lastStateSync = now + 5000; // Wait 5 seconds before trying again
            }
        } else if (this.sttState.syncRetries > 0) {
            // States match - reset retry counter
            this.sttState.syncRetries = 0;
            console.log(`[RobotAPI] ✅ STT state synchronized: ${this.sttState.actualState}`);
        }
    }
    
    /**
     * Request current state from STT server
     */
    requestSTTState() {
        console.log('[RobotAPI] 📋 Requesting current STT server state');
        return this.sendSTTCommand('get_state');
    }
    
    /**
     * Sync our expected state with STT server
     */
    syncSTTState() {
        if (!this.sttState.connected) {
            return false;
        }
        
        console.log(`[RobotAPI] 🔄 Syncing STT state - sending ${this.sttState.expectedState} command`);
        this.sttState.syncRetries++;
        this.sttState.lastStateSync = Date.now();
        
        if (this.sttState.expectedState === 'running') {
            return this.sendSTTCommand('resume');
        } else if (this.sttState.expectedState === 'paused') {
            return this.sendSTTCommand('pause');
        } else if (this.sttState.expectedState === 'stopped') {
            return this.sendSTTCommand('stop');
        }
        
        return false;
    }
    
    /**
     * Handle STT server state-related messages
     */
    handleSTTStateMessage(message) {
        if (message.type === 'status') {
            if (message.status) {
                const previousState = this.sttState.actualState;
                this.sttState.actualState = message.status;
                console.log(`[RobotAPI] 📊 STT server state update: ${message.status}`);
                
                // Always update sttPaused to reflect actual server state (but not for 'connected' state)
                if (message.status !== 'connected') {
                    this.sttPaused = (message.status === 'paused');
                }
                
                // Handle initial connection states
                if (previousState === 'unknown') {
                    console.log(`[RobotAPI] 🔄 Initial STT state detected: ${message.status}`);
                    
                    if (message.status === 'connected') {
                        // 'connected' is just the initial welcome message, expect 'running' next
                        console.log(`[RobotAPI] 📡 STT server connected, expecting transition to 'running' state`);
                        this.sttState.expectedState = 'running';
                        // Don't change sttPaused for 'connected' state
                    } else {
                        // Server started in a processing state, align with it
                        console.log(`[RobotAPI] 🔄 Aligning expected state with server state: ${message.status}`);
                        this.sttState.expectedState = message.status;
                        this.sttState.syncRetries = 0; // Reset retries for initial alignment
                        
                        // Check if we need to change the state for turn-taking reasons
                        const anyRobotSpeaking = Array.from(this.detailedRobotStatus.values()).some(status => status.speaking);
                        
                        if (anyRobotSpeaking && message.status === 'running') {
                            console.log('[RobotAPI] 🔇 Robot is speaking, need to pause STT');
                            this.pauseSTTProcessing();
                        } else if (!anyRobotSpeaking && message.status === 'paused') {
                            console.log('[RobotAPI] 🔊 No robots speaking, STT should be running');
                            this.resumeSTTProcessing();
                        } else {
                            console.log(`[RobotAPI] ✅ STT state ${message.status} is appropriate for current conditions`);
                        }
                    }
                } else {
                    // Normal state update - check for sync completion
                    if (message.status === 'connected') {
                        // Ignore 'connected' messages after initial connection
                        console.log(`[RobotAPI] 📡 Ignoring subsequent 'connected' message`);
                        return;
                    }
                    
                    // Check if this state update resolves our expected state
                    if (this.sttState.expectedState === this.sttState.actualState) {
                        if (this.sttState.syncRetries > 0) {
                            console.log(`[RobotAPI] ✅ STT state synchronized after ${this.sttState.syncRetries} attempts: ${message.status}`);
                        } else {
                            console.log(`[RobotAPI] ✅ STT state confirmed: ${message.status}`);
                        }
                        this.sttState.syncRetries = 0;
                    } else {
                        console.log(`[RobotAPI] 🔄 STT state mismatch persists - expected: ${this.sttState.expectedState}, actual: ${message.status}`);
                        
                        // If we're in the middle of syncing, be more patient
                        if (this.sttState.syncRetries > 0) {
                            const timeSinceLastSync = this.sttState.lastStateSync ? (Date.now() - this.sttState.lastStateSync) : Infinity;
                            if (timeSinceLastSync < 3000) { // Give 3 seconds for sync to complete
                                console.log(`[RobotAPI] ⏳ Recent sync in progress, waiting for completion...`);
                                return;
                            }
                        }
                    }
                }
            }
        } else if (message.type === 'command_ack') {
            console.log(`[RobotAPI] ✅ STT command acknowledged: ${message.action}`);
            // Command was received, but state might not have changed yet
            // Don't reset retries here, wait for actual state change
        } else if (message.type === 'pong' || (message.type === 'status' && message.healthCheck)) {
            // Health check response
            this.sttState.lastHealthCheck = Date.now();
            console.log('[RobotAPI] STT server health check OK');
        }
    }
    
    /**
     * Handle STT server disconnection and notify active conversations
     */
    handleSTTDisconnection() {
        const wasConnected = this.sttState.connected;
        this.sttState.connected = false;
        this.sttState.actualState = 'disconnected';
        this.sttWebSocket = null;
        
        if (wasConnected) {
            console.log('[RobotAPI] STT server disconnected');
            
            // Check for active conversations and send fallback messages
            this.handleSTTServerDownFallback();
        }
    }
    
    /**
     * Send fallback messages to robots when STT server is down during active conversations
     */
    handleSTTServerDownFallback() {
        // Check for active LLM sessions or conversations
        for (const [sessionId, session] of this.conversationSessions.entries()) {
            if (session.llmActive || this.llmActiveSessions.has(sessionId)) {
                // Don't send duplicate fallback messages for the same session
                if (!this.sttServerDownFallbackSent.has(sessionId)) {
                    this.sttServerDownFallbackSent.add(sessionId);
                    
                    const fallbackMessage = "Sorry, I can't hear you right now, I'm getting some help from my support crew.";
                    console.log(`[RobotAPI] 🆘 Sending STT server down fallback message to ${session.robot} (session: ${sessionId})`);
                    
                    // Send fallback message to robot
                    this.sendMessageToRobot(session.robot, {
                        cmd: 'req-execute',
                        type: 'conversation-response',
                        message: fallbackMessage,
                        robot: session.robot,
                        source: 'stt-fallback',
                        sessionId: sessionId,
                        timestamp: Date.now()
                    });
                }
            }
        }
    }
    
    /**
     * Clean up STT state when conversations end
     */
    cleanupSTTFallbackTracking(sessionId) {
        this.sttServerDownFallbackSent.delete(sessionId);
    }

    // ===============================
    // ROBOT STATE MANAGEMENT SYSTEM
    // ===============================

    /**
     * Start robot state management system
     */
    startRobotStateManagement() {
        console.log('[RobotAPI] 🤖 Starting robot state management system');
        
        // Health check interval - verify robot connections
        this.robotStateManager.healthCheckInterval = setInterval(() => {
            this.performRobotHealthChecks();
        }, this.ROBOT_HEALTH_CHECK_INTERVAL);

        // State sync interval - ensure states are synchronized
        this.robotStateManager.stateSyncInterval = setInterval(() => {
            this.performRobotStateSync();
        }, this.ROBOT_STATE_SYNC_INTERVAL);

        console.log(`[RobotAPI] 🏥 Robot health checks every ${this.ROBOT_HEALTH_CHECK_INTERVAL}ms`);
        console.log(`[RobotAPI] 🔄 Robot state sync every ${this.ROBOT_STATE_SYNC_INTERVAL}ms`);
    }

    /**
     * Perform health checks on all connected robots
     */
    performRobotHealthChecks() {
        for (const [socketId, connection] of this.connections) {
            if (connection.robot && connection.robot !== 'pending') {
                this.sendRobotHealthCheck(connection.robot);
            }
        }
    }

    /**
     * Send health check to a specific robot
     */
    sendRobotHealthCheck(robotName) {
        const healthCheckMessage = {
            type: 'health_check',
            action: 'ping',
            timestamp: Date.now(),
            source: 'web_controller'
        };

        const sent = this.sendMessage(healthCheckMessage, robotName);
        if (sent) {
            console.log(`[RobotAPI] Health check sent to robot ${robotName}`);
        } else {
            console.warn(`[RobotAPI] ⚠️ Failed to send health check to robot ${robotName}`);
            this.robotStateManager.connected.delete(robotName);
        }
    }

    /**
     * Perform state synchronization with all robots
     */
    performRobotStateSync() {
        for (const [socketId, connection] of this.connections) {
            if (connection.robot && connection.robot !== 'pending') {
                this.syncRobotState(connection.robot);
            }
        }
    }

    /**
     * Sync state with a specific robot
     */
    syncRobotState(robotName) {
        const now = Date.now();
        const lastSync = this.robotStateManager.lastStateSync.get(robotName) || 0;
        
        // Only sync if enough time has passed since last sync
        if (now - lastSync < this.ROBOT_STATE_SYNC_INTERVAL / 2) {
            return;
        }

        const stateRequest = {
            type: 'state_sync',
            action: 'get_state',
            timestamp: now,
            source: 'web_controller'
        };

        const sent = this.sendMessage(stateRequest, robotName);
        if (sent) {
            console.log(`[RobotAPI] 📋 State sync request sent to robot ${robotName}`);
            this.robotStateManager.lastStateSync.set(robotName, now);
        }
    }

    /**
     * Handle robot state synchronization response
     */
    handleRobotStateResponse(robot, stateData) {
        console.log(`[RobotAPI] 📊 Robot ${robot} state response:`, stateData);
        
        // Update expected state based on robot's actual state
        this.robotStateManager.expectedStates.set(robot, {
            speaking: stateData.speaking || false,
            listening: stateData.listening || false,
            current_behavior: stateData.current_behavior || 'idle',
            conversation_session_id: stateData.conversation_session_id || null,
            last_updated: Date.now(),
            ...stateData
        });

        // Override web controller state if robot reports different speaking state
        const webControllerState = this.getRobotStatus(robot);
        const robotSpeaking = stateData.speaking || false;
        const webSpeaking = webControllerState?.speaking || false;

        if (robotSpeaking !== webSpeaking) {
            console.log(`[RobotAPI] 🔄 State mismatch detected - Robot ${robot} speaking: ${robotSpeaking}, Web Controller: ${webSpeaking}`);
            console.log(`[RobotAPI] 🎯 Overriding web controller state with robot's actual state`);
            
            // Update robot status to match robot's actual state
            this.updateDetailedRobotStatus(robot, {
                speaking: robotSpeaking,
                state_override: true,
                override_reason: 'robot_reported_different_state',
                override_timestamp: Date.now()
            });

            // If robot stopped speaking, handle STT resumption
            if (webSpeaking && !robotSpeaking) {
                console.log(`[RobotAPI] 🎤 Robot ${robot} reports speaking=false, checking STT resumption`);
                this.handleRobotStoppedSpeaking(robot, stateData.conversation_session_id);
            }
        }

        // Mark robot as connected and healthy
        this.robotStateManager.connected.add(robot);
    }

    /**
     * Handle when robot stops speaking (including state overrides)
     */
    handleRobotStoppedSpeaking(robot, sessionId) {
        // If no session ID provided, use robot's socket ID as session ID
        if (!sessionId) {
            sessionId = this.getRobotSocketId(robot);
            if (sessionId) {
                console.log(`[RobotAPI] 🎤 Using robot ${robot} socket ID ${sessionId} for stopped speaking handling`);
            }
        }
        
        // Update conversation session if we have one
        if (sessionId) {
            this.updateConversationSession(sessionId, robot, { robotSpeaking: false });
        }

        // Check if we should resume STT
        const canResumeSTT = this.checkSTTResumption(sessionId, robot);
        
        if (canResumeSTT) {
            console.log(`[RobotAPI] 🎤 Resuming STT after ${robot} finished speaking (state synchronized)`);
            this.resumeSTTProcessing();
        } else {
            console.log(`[RobotAPI] ⏸️ Robot ${robot} stopped speaking but turn-taking rules prevent STT resumption`);
            this.pauseSTTProcessing();
        }
    }

    /**
     * Send $StopAction command to robot
     */
    sendStopActionToRobot(robotName) {
        const stopMessage = {
            type: 'control',
            action: 'stop',
            command: '$StopAction',
            timestamp: Date.now(),
            source: 'web_controller'
        };

        const sent = this.sendMessage(stopMessage, robotName);
        if (sent) {
            console.log(`[RobotAPI] 🛑 $StopAction sent to robot ${robotName}`);
            
            // Update expected state
            this.robotStateManager.expectedStates.set(robotName, {
                speaking: false,
                current_behavior: 'idle',
                conversation_session_id: null,
                last_updated: Date.now()
            });
            
            // Update web controller state
            this.updateDetailedRobotStatus(robotName, {
                speaking: false,
                current_behavior: 'idle',
                stop_action_sent: true,
                stop_action_timestamp: Date.now()
            });
        } else {
            console.warn(`[RobotAPI] ⚠️ Failed to send $StopAction to robot ${robotName}`);
        }

        return sent;
    }

    /**
     * Stop all robot activities (for start/stop conversation)
     */
    stopAllRobotActivities() {
        console.log('[RobotAPI] 🛑 Stopping all robot activities');
        
        let stoppedRobots = [];
        for (const [socketId, connection] of this.connections) {
            if (connection.robot && connection.robot !== 'pending') {
                if (this.sendStopActionToRobot(connection.robot)) {
                    stoppedRobots.push(connection.robot);
                }
            }
        }
        
        // Also pause STT to prevent further input during stop
        this.pauseSTTProcessing();
        
        console.log(`[RobotAPI] 🛑 Sent $StopAction to ${stoppedRobots.length} robots: ${stoppedRobots.join(', ')}`);
        return stoppedRobots;
    }

    /**
     * Clean up robot state management intervals
     */
    cleanupRobotStateManagement() {
        if (this.robotStateManager.healthCheckInterval) {
            clearInterval(this.robotStateManager.healthCheckInterval);
        }
        if (this.robotStateManager.stateSyncInterval) {
            clearInterval(this.robotStateManager.stateSyncInterval);
        }
        console.log('[RobotAPI] 🧹 Robot state management cleaned up');
    }

    /**
     * Turn-taking management: Update conversation session state
     */
    updateConversationSession(sessionId, robot, updates) {
        // If no session ID provided but we have a robot, try to infer from mappings or use socket ID
        if (!sessionId && robot) {
            sessionId = this.inferSessionIdForRobot(robot);
            if (sessionId) {
                console.log(`[RobotAPI] 📝 Inferred session ID ${sessionId} for robot ${robot}`);
            }
        }
        
        if (!sessionId) {
            console.warn(`[RobotAPI] ⚠️ Cannot update conversation session - no session ID available for robot ${robot}`);
            return;
        }
        
        if (!this.conversationSessions.has(sessionId)) {
            this.conversationSessions.set(sessionId, {
                robot: robot,
                llmActive: false,
                robotSpeaking: false,
                sttAllowed: true,
                startTime: Date.now()
            });
        }

        const session = this.conversationSessions.get(sessionId);
        Object.assign(session, updates);
        
        // Track this as the most recent session for this robot
        if (robot) {
        }
        
        console.log(`[RobotAPI] 🔄 Updated conversation session ${sessionId}:`, session);
        
        // Emit session state change
        this.emit('conversationSessionUpdate', {
            sessionId,
            ...session,
            timestamp: Date.now()
        });
    }

    /**
     * Turn-taking management: Start LLM session
     */
    startLLMSession(sessionId, robot) {
        // If no session ID provided but we have a robot, try to infer session ID
        if (!sessionId && robot) {
            sessionId = this.inferSessionIdForRobot(robot);
            if (sessionId) {
                console.log(`[RobotAPI] 🤖 Inferred session ID ${sessionId} for LLM session start for robot ${robot}`);
            }
        }
        
        if (!sessionId) {
            console.warn(`[RobotAPI] ⚠️ Cannot start LLM session - no session ID available for robot ${robot}`);
            return;
        }
        
        console.log(`[RobotAPI] 🤖 Starting LLM session ${sessionId} for robot ${robot}`);
        
        this.llmActiveSessions.add(sessionId);
        this.updateConversationSession(sessionId, robot, { 
            llmActive: true,
            sttAllowed: false 
        });
        
        // Pause STT while LLM is processing
        this.pauseSTTProcessing();
    }

    /**
     * Turn-taking management: End LLM session
     */
    endLLMSession(sessionId) {
        // For endLLMSession, we use the session ID as provided since it should already be mapped
        console.log(`[RobotAPI] 🤖 Ending LLM session ${sessionId}`);
        
        this.llmActiveSessions.delete(sessionId);
        
        // Clean up STT fallback tracking for this session
        this.cleanupSTTFallbackTracking(sessionId);
        
        // Clean up thinking filter for this session
        this.cleanupThinkingFilter(sessionId);
        
        if (this.conversationSessions.has(sessionId)) {
            this.updateConversationSession(sessionId, null, { 
                llmActive: false
            });
            
            // Note: STT resumption will be handled by robot speaking state changes only
            console.log(`[RobotAPI] 🎤 LLM session ${sessionId} ended - STT resumption will be handled by robot speaking state`);
        }
    }

    /**
     * Turn-taking management: Check if STT can be resumed
     * NOTE: This method only validates turn-taking rules but does NOT resume STT.
     * STT resumption should only happen when robot speaking state changes to false.
     */
    checkSTTResumption(sessionId, robot) {
        // If no session ID provided but we have a robot, use robot's socket ID as session ID
        if (!sessionId && robot) {
            sessionId = this.getRobotSocketId(robot);
            if (sessionId) {
                console.log(`[RobotAPI] 🎤 Using robot ${robot} socket ID ${sessionId} for STT resumption check`);
            }
        }
        
        if (!sessionId) {
            console.log('[RobotAPI] 🎤 No session ID provided - STT resumption will be handled by robot speaking state');
            return true; // Allow resumption when robot speaking state changes
        }

        const session = this.conversationSessions.get(sessionId);
        if (!session) {
            console.log(`[RobotAPI] 🎤 No session found for ${sessionId} - STT resumption will be handled by robot speaking state`);
            return true; // Allow resumption when robot speaking state changes
        }

        const canResumeSTT = !session.robotSpeaking && !session.llmActive;
        
        console.log(`[RobotAPI] 🎤 STT resumption check for session ${sessionId}: robotSpeaking=${session.robotSpeaking}, llmActive=${session.llmActive}, canResume=${canResumeSTT}`);
        
        if (canResumeSTT) {
            console.log(`[RobotAPI] ✅ Turn-taking rules satisfied - STT can be resumed when robot stops speaking`);
            this.updateConversationSession(sessionId, robot, { sttAllowed: true });
            return true; // Allow resumption when robot speaking state changes
        } else {
            console.log(`[RobotAPI] ⏸️ Turn-taking rules not satisfied - STT should remain paused`);
            this.updateConversationSession(sessionId, robot, { sttAllowed: false });
            return false; // Prevent resumption even when robot stops speaking
        }
    }

    /**
     * Infer session ID for robot messages when not provided
     * First checks for existing LLM session mappings, then falls back to socket ID
     */
    inferSessionIdForRobot(robot, providedSessionId = null) {
        if (providedSessionId) {
            // Session ID was provided, use it
            return providedSessionId;
        }
        
        // Check if we have an existing LLM session mapping for this robot
        if (this.robotNameToSessionId.has(robot)) {
            const mappedSessionId = this.robotNameToSessionId.get(robot);
            console.log(`[RobotAPI] 💡 Using mapped LLM session ID ${mappedSessionId} for robot ${robot}`);
            return mappedSessionId;
        }
        
        // No LLM session mapping found, use the robot's socket connection ID as session ID
        const robotSocketId = this.robotNameToSocketId.get(robot);
        if (robotSocketId) {
            console.log(`[RobotAPI] 💡 Using socket connection ID ${robotSocketId} as session ID for robot ${robot}`);
            return robotSocketId;
        }
        
        console.log(`[RobotAPI] ❓ No session ID provided and no socket connection found for robot ${robot}`);
        return null;
    }

    /**
     * Turn-taking management: Handle STT message with validation
     */
    validateSTTMessage(message, sessionId) {
        // Check if STT is paused globally, but only if the server should actually be paused
        if (this.sttPaused && this.sttState.actualState === 'paused') {
            console.warn(`[RobotAPI] ⚠️ TURN-TAKING VIOLATION: Received STT message while globally paused!`);
            
            // Send pause command to STT server to stop further messages
            console.log(`[RobotAPI] 📤 Sending pause command to STT server due to turn-taking violation`);
            this.pauseSTTProcessing();
            
            this.emit('turnTakingViolation', {
                type: 'stt_message_while_paused',
                sessionId,
                message: message.text?.substring(0, 50),
                timestamp: Date.now()
            });
            return false;
        }
        
        // If sttPaused=true but server actualState is still 'running', this means we're in transition
        // Allow a few messages during this transition period before treating as violation
        if (this.sttPaused && this.sttState.actualState === 'running') {
            console.log(`[RobotAPI] ⚡ STT message during pause transition (server still running) - allowing: "${message.text?.substring(0, 30)}"`);
            // Send another pause command to ensure server gets it
            this.sendSTTCommand('pause');
            return true; // Allow the message
        }

        // Check if STT is temporarily disabled (during LLM conversation startup)
        if (this.sttTemporarilyDisabled) {
            console.warn(`[RobotAPI] ⚠️ TURN-TAKING VIOLATION: Received STT message while temporarily disabled for LLM conversation!`);
            
            // Send pause command to STT server to stop further messages
            console.log(`[RobotAPI] 📤 Sending pause command to STT server due to temporary disable violation`);
            this.pauseSTTProcessing();
            
            this.emit('turnTakingViolation', {
                type: 'stt_message_while_temporarily_disabled',
                sessionId,
                message: message.text?.substring(0, 50),
                timestamp: Date.now()
            });
            return false;
        }

        // Check session-specific rules
        if (sessionId && this.conversationSessions.has(sessionId)) {
            const session = this.conversationSessions.get(sessionId);
            
            if (session.robotSpeaking) {
                console.warn(`[RobotAPI] ⚠️ TURN-TAKING VIOLATION: Received STT message while robot ${session.robot} is speaking (session: ${sessionId})!`);
                
                // Send pause command to STT server to stop further messages
                console.log(`[RobotAPI] 📤 Sending pause command to STT server due to robot speaking violation`);
                this.pauseSTTProcessing();
                
                this.emit('turnTakingViolation', {
                    type: 'stt_message_while_robot_speaking',
                    robot: session.robot,
                    sessionId,
                    message: message.text?.substring(0, 50),
                    timestamp: Date.now()
                });
                return false;
            }

            if (session.llmActive) {
                console.warn(`[RobotAPI] ⚠️ TURN-TAKING VIOLATION: Received STT message while LLM is active (session: ${sessionId})!`);
                
                // Send pause command to STT server to stop further messages
                console.log(`[RobotAPI] 📤 Sending pause command to STT server due to LLM active violation`);
                this.pauseSTTProcessing();
                
                this.emit('turnTakingViolation', {
                    type: 'stt_message_while_llm_active',
                    sessionId,
                    message: message.text?.substring(0, 50),
                    timestamp: Date.now()
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Handle STT messages with turn-taking validation
     */
    handleSTTMessage(message) {
        // Extract session ID if available
        const sessionId = message.sessionId || message.session_id;
        
        // For transcription messages (partial or complete), validate turn-taking
        if (message.type === 'partial' || message.type === 'complete' || 
            message.type === 'partial_transcript' || message.type === 'complete_transcript') {
            if (!this.validateSTTMessage(message, sessionId)) {
                console.log(`[RobotAPI] 🚫 Ignoring STT message due to turn-taking violation: "${message.text?.substring(0, 50)}"`);
                return; // Ignore the message
            }
            
            // Only broadcast user input to tablet displays if LLM is active or robots are speaking
            if ((message.type === 'complete' || message.type === 'partial') && message.text && message.text.trim() && this.broadcastLLMCommunication) {
                const activeLLMSessions = this.llmActiveSessions.size > 0;
                const anyRobotSpeaking = Array.from(this.detailedRobotStatus.values()).some(status => status.speaking);
                
                console.log(`[RobotAPI] 🔍 STT broadcast check - LLM sessions: ${activeLLMSessions} (${Array.from(this.llmActiveSessions).join(', ')}), robot speaking: ${anyRobotSpeaking}, message: "${message.text?.substring(0, 30)}"`);
                
                if (activeLLMSessions || anyRobotSpeaking) {
                    console.log(`[RobotAPI] 📢 Broadcasting user input to tablet: "${message.text}" (type: ${message.type}) - LLM active: ${activeLLMSessions}, robot speaking: ${anyRobotSpeaking}`);
                    this.broadcastLLMCommunication('llm-user-input', message.text, 'Haku');
                } else {
                    console.log(`[RobotAPI] 🔇 Skipping tablet broadcast - no active LLM sessions or speaking robots`);
                }
            } else if ((message.type === 'complete' || message.type === 'partial') && message.text && message.text.trim()) {
                console.log(`[RobotAPI] 🚫 No broadcastLLMCommunication function available`);
            }
        }
        
        // Process valid STT messages
        console.log(`[RobotAPI] ✅ Processing valid STT message: ${message.type}`);
        
        // Special handling for complete transcripts
        if (message.type === 'complete') {
            console.log(`[RobotAPI] 🎯 Complete STT transcript received: "${message.text}"`);
            if (!message.text || message.text.trim().length === 0) {
                console.log(`[RobotAPI] ⚠️ Empty transcript - skipping`);
                return;
            }
            
            // Only pause STT if there are active LLM sessions or robots currently speaking
            // This allows STT to continue running for new conversations
            const activeLLMSessions = this.llmActiveSessions.size > 0;
            const anyRobotSpeaking = Array.from(this.detailedRobotStatus.values()).some(status => status.speaking);
            
            if (activeLLMSessions || anyRobotSpeaking) {
                console.log(`[RobotAPI] ⏸ Pausing STT processing - LLM active: ${activeLLMSessions}, robot speaking: ${anyRobotSpeaking}`);
            this.pauseSTTProcessing();
            } else {
                console.log(`[RobotAPI] 🎤 Keeping STT running - no active LLM sessions or speaking robots, ready for conversation`);
            }
        }
        
        // Forward to any registered STT message handlers
        this.emit('sttMessage', message);
    }

    /**
     * Handle robot identification from incoming messages
     */
    updateRobotIdentification(socketId, robotName) {
        const connection = this.connections.get(socketId);
        if (connection && connection.robot === 'pending') {
            connection.robot = robotName;
            console.log(`[RobotAPI] ✅ Robot identified via message: ${robotName} (${socketId})`);
            
            // Initialize status for newly identified robot
            this.initializeRobotStatus(robotName);
            
            // Process any queued messages
            this.processQueuedMessages(robotName);
            
            this.emit('robotIdentified', { socketId, robot: robotName });
        }
    }

    /**
     * Get the socket ID for a specific robot
     */
    getRobotSocketId(robotName) {
        return this.robotNameToSocketId.get(robotName) || null;
    }

    checkStaleBuffers() {
        const now = Date.now();
        for (const [sessionId, bufferInfo] of this.chunkBuffers.entries()) {
            if (bufferInfo.buffer.trim() && (now - bufferInfo.lastChunkTime) > this.CHUNK_TIMEOUT) {
                console.log(`[RobotAPI] 🕒 Buffer timeout for session ${sessionId}, flushing: "${bufferInfo.buffer}"`);
                this.flushChunkBuffer(sessionId);
            }
        }
    }

    /**
     * Clean up thinking filter for finished sessions
     */
    cleanupThinkingFilter(sessionId) {
        // No longer needed since thinking filtering is integrated into buffer processing
        console.log(`[RobotAPI] Thinking filter cleanup no longer needed for session ${sessionId} (integrated into buffer processing)`);
    }

    /**
     * Add content to chunk buffer for session-based buffering
     */
    addToChunkBuffer(sessionId, content, targetRobot = 'Haku') {
        // Add all content directly to buffer without individual chunk filtering
        if (!this.chunkBuffers.has(sessionId)) {
            this.chunkBuffers.set(sessionId, {
                buffer: '',
                lastChunkTime: Date.now(),
                robot: targetRobot
            });
        }

        const bufferInfo = this.chunkBuffers.get(sessionId);        
        bufferInfo.buffer += content; // Add all content to buffer
        bufferInfo.lastChunkTime = Date.now();
        bufferInfo.robot = targetRobot;

        console.log(`[RobotAPI] 📝 Added to buffer ${sessionId}: "${content}" (total: ${bufferInfo.buffer.length} chars)`);
        
        // Check if we should send the buffer
        this.processChunkBuffer(sessionId, false);
    }

    /**
     * Check if a chunk of text is safe to send to the robot.
     * It's safe if all ^...() and {...} patterns are complete.
     * Special rule: ^start(...) commands require sentence-ending punctuation to be sendable.
     * Additionally, chunks containing only punctuation are not sendable. (Like "!!!" or "..." alone).
     */
    canSendChunkToRobot(chunk) {
        // Check for balanced braces
        let braceCount = 0;
        for (const char of chunk) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (braceCount < 0) return false; // Unmatched closing brace
        }
        if (braceCount > 0) return false; // Unmatched opening brace

        // Check for ^...() patterns. A '^' must be followed by a closing ')'
        let caretIndex = chunk.lastIndexOf('^');
        if (caretIndex !== -1) {
            // If a caret exists, check if a corresponding ')' exists after it.
            // This is a simplification. It assumes no nested parentheses in commands.
            if (chunk.indexOf(')', caretIndex) === -1) {
                return false; // Unmatched caret
            }
        }

        // Special rule: Check for ^start(...) commands
        const startCommandRegex = /\^start\([^)]*\)/;
        if (startCommandRegex.test(chunk)) {
            // If the chunk contains a ^start(...) command, it must also contain sentence-ending punctuation
            const sentenceEndingRegex = new RegExp(`[${LLM_SENTENCE_MARKERS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
            if (!sentenceEndingRegex.test(chunk)) {
                console.log(`[RobotAPI] 🚫 Chunk contains ^start(...) but no sentence ending - holding back: "${chunk}"`);
                return false; // ^start(...) without sentence ending is not sendable
            }
            console.log(`[RobotAPI] ✅ Chunk contains ^start(...) with sentence ending - safe to send: "${chunk}"`);
        }

        // Check if the chunk contains any alphabetic or numeric characters
        const hasAlphanumeric = /[a-zA-Z0-9]/.test(chunk);
        if (!hasAlphanumeric) {
            console.log(`[RobotAPI] 🚫 Chunk contains only punctuation or whitespace - holding back: "${chunk}"`);
            return false;
        }

        return true;
    }

    /**
     * Checks if a string consists only of valid, complete patterns.
     */
    isOnlyPatterns(text) {
        if (!text || !text.trim()) return false;

        // Regex for ^...() patterns, allowing for nested parentheses.
        const caretPattern = /\^[\w\d_]+\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/g;
        // Regex for {...} patterns, simplified for JavaScript compatibility.
        const bracePattern = /\{[^{}]*\}/g;

        let remainingText = text.trim();
        
        // Remove all occurrences of both patterns
        remainingText = remainingText.replace(caretPattern, '').trim();
        remainingText = remainingText.replace(bracePattern, '').trim();

        // If nothing is left, it was only patterns
        return remainingText.length === 0;
    }

    /**
     * Process chunk buffer to extract complete sentences with pattern boundaries
     * Now includes thinking filter removal integrated with sentence boundary detection
     */
    processChunkBuffer(sessionId, isFinished = false) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo || !bufferInfo.buffer) return;

        let buffer = bufferInfo.buffer;
        const sentenceMarkers = ['.', '!', '?'];

        // STEP 1: Remove any complete thinking sections from the buffer
        buffer = this.removeCompleteThinkingSections(buffer, sessionId);
        bufferInfo.buffer = buffer;

        // STEP 2: Process complete sentences (existing logic)
        for (let i = 0; i < buffer.length; i++) {
            if (sentenceMarkers.includes(buffer[i])) {
                const potentialChunk = buffer.substring(0, i + 1);
                console.log(`[RobotAPI] 🔍 Evaluating potential chunk for session ${sessionId}: "${potentialChunk}"`);
                
                // Check if this chunk is inside or contains thinking tags
                if (!this.containsIncompleteThinkingTags(potentialChunk) && this.canSendChunkToRobot(potentialChunk)) {
                    console.log(`[RobotAPI] 🚀 Found sendable sentence for session ${sessionId}: "${potentialChunk}"`);
                    this.flushChunkBufferWithContent(sessionId, potentialChunk);
                    
                    // Update buffer and reset search
                    buffer = buffer.substring(potentialChunk.length);
                    bufferInfo.buffer = buffer;
                    i = -1; // Restart loop from the beginning of the new buffer
                }
            }
        }
        
        // STEP 3: After sentence processing, check the remainder of the buffer
        const remainingBuffer = buffer; // Use the buffer directly, don't trim here
        if (remainingBuffer.trim().length > 0) {
            // Condition 1: The entire remaining buffer is ONLY patterns and is safe to send
            if (!this.containsIncompleteThinkingTags(remainingBuffer) && 
                this.isOnlyPatterns(remainingBuffer) && 
                this.canSendChunkToRobot(remainingBuffer)) {
                console.log(`[RobotAPI] 🚀 Found sendable pattern-only chunk for session ${sessionId}: "${remainingBuffer}"`);
                this.flushChunkBuffer(sessionId); // Flush the entire remaining buffer
            }
            // Condition 2: The stream is finished, flush whatever is left (but not thinking content)
            else if (isFinished) {
                const finalBuffer = this.removeIncompleteThinkingTags(remainingBuffer, sessionId);
                if (finalBuffer.trim()) {
                    console.log(`[RobotAPI] 🏁 Stream finished, flushing remaining valid content for session ${sessionId}: "${finalBuffer}"`);
                    this.flushChunkBufferWithContent(sessionId, finalBuffer);
                    bufferInfo.buffer = ''; // Clear the buffer
                } else {
                    console.log(`[RobotAPI] 🏁 Stream finished, but only thinking content remained for session ${sessionId}`);
                }
            }
        }
    }

    /**
     * Remove complete thinking sections from buffer
     */
    removeCompleteThinkingSections(buffer, sessionId) {
        let processedBuffer = buffer;
        let foundThinking = true;
        
        while (foundThinking) {
            foundThinking = false;
            const openIndex = processedBuffer.toLowerCase().indexOf('<thinking>');
            
            if (openIndex !== -1) {
                const closeIndex = processedBuffer.toLowerCase().indexOf('</thinking>', openIndex + 10);
                
                if (closeIndex !== -1) {
                    // Found complete thinking section, remove it
                    const beforeThinking = processedBuffer.substring(0, openIndex);
                    const afterThinking = processedBuffer.substring(closeIndex + 11);
                    const removedSection = processedBuffer.substring(openIndex, closeIndex + 11);
                    
                    console.log(`[RobotAPI] 🧠 Removed complete thinking section from buffer ${sessionId}: "${removedSection}"`);
                    
                    processedBuffer = beforeThinking + afterThinking;
                    foundThinking = true; // Check for more thinking sections
                }
            }
        }
        
        return processedBuffer;
    }

    /**
     * Check if content contains incomplete thinking tags
     */
    containsIncompleteThinkingTags(content) {
        const contentLower = content.toLowerCase();
        const openIndex = contentLower.indexOf('<thinking>');
        const closeIndex = contentLower.indexOf('</thinking>');
        
        // Has opening tag but no closing tag
        if (openIndex !== -1 && closeIndex === -1) {
            return true;
        }
        
        // Has closing tag but no opening tag (continuation of thinking section)
        if (openIndex === -1 && closeIndex !== -1) {
            return true;
        }
        
        // Check for partial tags at the end
        const incompletePatterns = ['<', '<t', '<th', '<thi', '<thin', '<think', '<thinki', '<thinkin'];
        for (const pattern of incompletePatterns) {
            if (contentLower.endsWith(pattern)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Remove incomplete thinking tags from content (for final flush)
     */
    removeIncompleteThinkingTags(content, sessionId) {
        const contentLower = content.toLowerCase();
        
        // Check for incomplete opening tag at the end
        const incompletePatterns = ['<', '<t', '<th', '<thi', '<thin', '<think', '<thinki', '<thinkin'];
        for (const pattern of incompletePatterns) {
            if (contentLower.endsWith(pattern)) {
                const cleanContent = content.substring(0, content.length - pattern.length);
                console.log(`[RobotAPI] 🧠 Removed incomplete thinking tag "${pattern}" from final content for session ${sessionId}`);
                return cleanContent;
            }
        }
        
        return content;
    }

    /**
     * Flush chunk buffer with specific content
     */
    flushChunkBufferWithContent(sessionId, content) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo) {
            return {
                success: false,
                message: `No buffer found for session ${sessionId}`,
                content: ''
            };
        }

        const targetRobot = bufferInfo.robot;

        console.log(`[RobotAPI] 🗣️ Sending buffered response: "${content}"`);

        // Broadcast AI response to tablet displays
        if (content && content.trim() && this.broadcastLLMCommunication) {
            console.log(`[RobotAPI] 📢 Broadcasting AI response to tablets: "${content}"`);
            this.broadcastLLMCommunication('llm-ai-response', content, targetRobot);
        }

        // Send the content to robot with chunk-buffer source to avoid re-processing
        const messageData = {
            cmd: 'req-execute',
            type: 'conversation-response',
            message: content,
            robot: targetRobot,
            source: 'chunk-buffer', // CRITICAL: Mark as chunk-buffer to prevent re-processing
            sessionId: sessionId,
            timestamp: Date.now()
        };

        const sent = this.sendMessage(messageData, targetRobot);

        // Update the buffer by removing the sent content // TODO: Evaluate if this is needed
        if (bufferInfo.buffer.startsWith(content)) {
            bufferInfo.buffer = bufferInfo.buffer.substring(content.length);
        }
        
        return {
            success: true,
            message: `Sent ${content.length} characters to robot ${targetRobot}`,
            content: content,
            sent: sent
        };
    }

    /**
     * Flush chunk buffer and send to robot
     */
    flushChunkBuffer(sessionId) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo || !bufferInfo.buffer) {
            return {
                success: false,
                message: `No buffer found for session ${sessionId}`,
                content: ''
            };
        }

        const content = bufferInfo.buffer;
        const targetRobot = bufferInfo.robot;

        console.log(`[RobotAPI] 🚀 Flushing buffer for session ${sessionId} to robot ${targetRobot}: "${content}"`);

        // Broadcast AI response to tablet displays
        if (content && content.trim() && this.broadcastLLMCommunication) {
            console.log(`[RobotAPI] 📢 Broadcasting AI response to tablets: "${content}"`);
            this.broadcastLLMCommunication('llm-ai-response', content, targetRobot);
        }

        // Send the buffered content to robot with chunk-buffer source to avoid re-processing
        const messageData = {
            cmd: 'req-execute',
            type: 'conversation-response',
            message: content,
            robot: targetRobot,
            source: 'chunk-buffer', // CRITICAL: Mark as chunk-buffer to prevent re-processing
            sessionId: sessionId,
            timestamp: Date.now()
        };

        const sent = this.sendMessage(messageData, targetRobot);
        
        // Clear the buffer
        this.chunkBuffers.delete(sessionId);
        
        return {
            success: true,
            message: `Flushed ${content.length} characters to robot ${targetRobot}`,
            content: content,
            sent: sent
        };
    }

    /**
     * Flushes the remaining buffer, typically at the end of a stream.
     */
    flushRemainingBuffer(sessionId) {
        console.log(`[RobotAPI] Flushing remaining buffer for session ${sessionId} due to end of stream.`);
        this.processChunkBuffer(sessionId, true);
        // Ensure buffer is cleared if processChunkBuffer didn't flush
        if (this.chunkBuffers.has(sessionId)) {
            this.flushChunkBuffer(sessionId);
        }
    }

    /**
     * Clear chunk buffer without sending
     */
    clearChunkBuffer(sessionId) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo) {
            return { success: false, message: 'No buffer found' };
        }

        const content = bufferInfo.buffer;
        this.chunkBuffers.delete(sessionId);
        
        console.log(`[RobotAPI] 🗑️ Cleared buffer for session ${sessionId}: "${content}"`);
        
        return {
            success: true,
            message: `Cleared ${content.length} characters`,
            content: content
        };
    }

    /**
     * Get chunk buffer status
     */
    getChunkBufferStatus(sessionId) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo) {
            return { exists: false, message: 'No buffer found' };
        }

        return {
            exists: true,
            sessionId: sessionId,
            bufferLength: bufferInfo.buffer.length,
            content: bufferInfo.buffer,
            lastChunkTime: bufferInfo.lastChunkTime,
            robot: bufferInfo.robot,
            age: Date.now() - bufferInfo.lastChunkTime
        };
    }

    /**
     * Get all chunk buffer statuses
     */
    getAllChunkBufferStatuses() {
        const statuses = {};
        for (const [sessionId, bufferInfo] of this.chunkBuffers.entries()) {
            statuses[sessionId] = {
                bufferLength: bufferInfo.buffer.length,
                content: bufferInfo.buffer.substring(0, 100) + (bufferInfo.buffer.length > 100 ? '...' : ''),
                lastChunkTime: bufferInfo.lastChunkTime,
                robot: bufferInfo.robot,
                age: Date.now() - bufferInfo.lastChunkTime
            };
        }
        return {
            totalBuffers: this.chunkBuffers.size,
            buffers: statuses
        };
    }

    /**
     * Force process chunk buffer regardless of completion state
     */
    forceProcessChunkBuffer(sessionId, targetRobot) {
        const bufferInfo = this.chunkBuffers.get(sessionId);
        if (!bufferInfo) {
            return { success: false, message: 'No buffer found' };
        }

        if (targetRobot) {
            bufferInfo.robot = targetRobot;
        }

        return this.flushChunkBuffer(sessionId);
    }

    // Add compatibility methods for the endpoints
    flushBuffer(sessionId, targetRobot) {
        return this.flushChunkBuffer(sessionId);
    }

    clearBuffer(sessionId) {
        return this.clearChunkBuffer(sessionId);
    }

    getBufferStatus(sessionId) {
        return this.getChunkBufferStatus(sessionId);
    }

    getAllBufferStatuses() {
        return this.getAllChunkBufferStatuses();
    }

    forceProcessBuffer(sessionId, targetRobot) {
        return this.forceProcessChunkBuffer(sessionId, targetRobot);
    }

    updateSessionChunkMode(sessionId, chunkMode) {
        const session = this.llmSessions.get(sessionId);
        if (!session) {
            return { success: false, message: 'Session not found' };
        }
        
        const oldMode = session.chunkMode;
        session.chunkMode = chunkMode;
        
        console.log(`[RobotAPI] Updated chunk mode for session ${sessionId}: ${oldMode} → ${chunkMode}`);
        
        return {
            success: true,
            message: `Updated chunk mode from ${oldMode} to ${chunkMode}`,
            sessionId: sessionId,
            oldMode: oldMode,
            newMode: chunkMode
        };
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
        
        // Initialize status for identified robots
        if (robotName !== 'pending' && robotName !== this.defaultRobotName) {
            this.initializeRobotStatus(robotName);
            this.processQueuedMessages(robotName);
            
            // Establish robot name mappings
            this.robotNameToSocketId.set(robotName, socketId);
            this.socketIdToRobotName.set(socketId, robotName);
            console.log(`[RobotAPI] 📝 Established robot name mapping: ${robotName} -> socket ${socketId}`);
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
        
        // Establish robot name mappings
        this.robotNameToSocketId.set(robotName, socketId);
        this.socketIdToRobotName.set(socketId, robotName);
        console.log(`[RobotAPI] 📝 Established robot name mapping: ${robotName} -> socket ${socketId}`);
        
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
            
            const robotName = connection.robot;
            
            // Clean up robot name mappings
            if (robotName && robotName !== 'pending' && robotName !== this.defaultRobotName) {
                // Clean up robot name to socket mapping
                if (this.robotNameToSocketId.get(robotName) === socketId) {
                    this.robotNameToSocketId.delete(robotName);
                    console.log(`[RobotAPI] 🧹 Cleaned up robot name to socket mapping for ${robotName}`);
                }
                
                // Clean up socket to robot name mapping
                this.socketIdToRobotName.delete(socketId);
                
                // Clean up LLM session mappings if they exist
                if (this.robotNameToSessionId.has(robotName)) {
                    const sessionId = this.robotNameToSessionId.get(robotName);
                    this.robotNameToSessionId.delete(robotName);
                    this.sessionIdToRobotName.delete(sessionId);
                    console.log(`[RobotAPI] 🧹 Cleaned up LLM session mapping for ${robotName}: ${sessionId}`);
                    
                    // Clean up conversation session, chunk buffers, and ordering for the LLM session ID
                    this.conversationSessions.delete(sessionId);
                    this.chunkBuffers.delete(sessionId);
                    this.chunkOrdering.delete(sessionId);
                    this.cleanupThinkingFilter(sessionId);
                } else {
                    // If no LLM session mapping, clean up using socket ID as session ID
                    this.conversationSessions.delete(socketId);
                    this.chunkBuffers.delete(socketId);
                    this.chunkOrdering.delete(socketId);
                    this.cleanupThinkingFilter(socketId);
                }
            } else {
                // Clean up for unidentified connections
                this.socketIdToRobotName.delete(socketId);
                this.conversationSessions.delete(socketId);
                this.chunkBuffers.delete(socketId);
                this.chunkOrdering.delete(socketId);
            }
            
            this.connections.delete(socketId);
            this.emit('connectionUnregistered', { socketId, robot: connection.robot });
        }
    }

    /**
     * Send a message to a specific robot or all robots
     */
    sendMessage(messageData, targetRobot = null) {
        const { cmd, type, message, robot, sessionId } = messageData;
        
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
        
        // **PROACTIVE STT PAUSING** - Pause STT before sending conversation responses
        // This prevents the robot from hearing itself during LLM conversations
        if (processedMessage.type === 'conversation-response' && 
            processedMessage.source !== 'manual' && 
            !this.sttPaused) {
            console.log(`[RobotAPI] 🎤 Proactively pausing STT before sending LLM response to prevent feedback`);
            this.pauseSTTProcessing();
        }
        
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
            
            console.log(`[RobotAPI] Raw message received from ${connection.robot || 'unknown'} (${socketId}):`, JSON.stringify(message, null, 2));
            
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
                console.log(`[RobotAPI] Updating robot identification from 'pending' to '${processedMessage.robot}' for ${socketId}`);
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
            console.warn(`[RobotAPI] Raw data:`, data.toString());
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
        // Use type field first, fallback to cmd field for compatibility
        const messageType = message.type || message.cmd;

        console.log(`[RobotAPI] Processing message type '${messageType}' from ${robot || 'unknown'} (${socketId})`);

        const handler = this.messageHandlers.get(messageType);
        if (handler) {
            try {
                console.log(`[RobotAPI] Found handler for message type '${messageType}'`);
                handler(message, socketId, robot);
            } catch (error) {
                console.error(`[RobotAPI] ❌ Message handler error for type ${messageType}:`, error);
            }
        } else {
            console.warn(`[RobotAPI] ⚠️ No handler found for message type '${messageType}' from ${robot}`);
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
     * Process LLM chunk for robot speech
     * Now groups incoming chunks in buffer and only sends to robot when a safe boundary is reached.
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
        }
        const session = this.llmSessions.get(sessionId);

        // Add new content to buffer
        if (content) {
            session.speechBuffer += content;
        }

        // Only send to robot when a safe boundary is reached
        switch (session.chunkMode) {
            case 'raw':
                // For raw, send immediately (legacy, not recommended)
                if (content && content.trim()) {
                    this.sendSpeechToRobot(content.trim(), sessionId);
                }
                if (isFinished && session.speechBuffer.trim()) {
                    this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
                    session.speechBuffer = '';
                }
                break;
            case 'pattern':
                // Send only when buffer contains complete ^...() or {...}
                while (true) {
                    const safeChunk = this.extractSafePatternChunk(sessionId);
                    if (safeChunk) {
                        this.sendSpeechToRobot(safeChunk, sessionId);
                        session.speechBuffer = session.speechBuffer.substring(safeChunk.length);
                    } else {
                        break;
                    }
                }
                if (isFinished && session.speechBuffer.trim()) {
                    this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
                    session.speechBuffer = '';
                }
                break;
            case 'smart':
            default:
                // Send only when buffer contains a complete sentence and safe patterns
                while (true) {
                    const smartChunks = this.extractSmartChunks(sessionId);
                    if (smartChunks.length > 0) {
                        for (const chunk of smartChunks) {
                            this.sendSpeechToRobot(chunk, sessionId);
                            // Remove sent chunk from buffer
                            const idx = session.speechBuffer.indexOf(chunk);
                            if (idx !== -1) {
                                session.speechBuffer = session.speechBuffer.substring(idx + chunk.length);
                            }
                        }
                    } else {
                        break;
                    }
                }
                if (isFinished && session.speechBuffer.trim()) {
                    this.sendSpeechToRobot(session.speechBuffer.trim(), sessionId);
                    session.speechBuffer = '';
                }
                break;
        }

        // Clean up finished session
        if (isFinished) {
            this.llmSessions.delete(sessionId);
            this.cleanupThinkingFilter(sessionId);
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
        
        // Create sentence boundary regex - match sentence endings with optional trailing whitespace
        const sentenceRegex = new RegExp(`([${LLM_SENTENCE_MARKERS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]\\s*)`, 'g');
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
        
        // Update specific fields based on event
        if (event === 'speaking' && data) {
            currentStatus.speaking = true;
            currentStatus.lastSpeakTime = currentTime;
            
            // Also update detailed status if available
            if (this.detailedRobotStatus.has(robot)) {
                this.updateDetailedRobotStatus(robot, {
                    speaking: true,
                    current_behavior: 'speaking'
                });
            }
        } else if (event === 'spoke') {
            currentStatus.speaking = false;
            
            // Also update detailed status if available
            if (this.detailedRobotStatus.has(robot)) {
                this.updateDetailedRobotStatus(robot, {
                    speaking: false,
                    current_behavior: 'idle'
                });
            }
        }
        
        // Store updated status
        this.robotStatus.set(robot, currentStatus);
        
        // Emit legacy status event
        this.emit('robotStatusUpdate', { robot, event, data, status: currentStatus });
    }

    cleanupInactiveConnections() {
        const now = Date.now();
        const inactiveThreshold = 5 * 60 * 1000; // 5 minutes
        
        for (const [socketId, connection] of this.connections.entries()) {
            
            if (now - connection.lastActivity > inactiveThreshold) {
                console.warn(`[RobotAPI] Inactive connection: ${socketId}`);
                console.warn('Clean up of inactive connections is currently disabled for safety.');
                // TODO: Re-enable cleanup once heartbeat/ping system is implemented
                // console.log(`[RobotAPI] Cleaning up inactive connection: ${socketId}`);
                // this.connections.delete(socketId);
            }
        }
    }

    cleanupStaleChunks() {
        const now = Date.now();
        const staleThreshold = 60000; // 1 minute
        let cleanedCount = 0;
        
        for (const [sessionId, orderingData] of this.chunkOrdering.entries()) {
            if (now - orderingData.lastActivity > staleThreshold) {
                console.log(`[RobotAPI] 🧹 Cleaning up stale chunk ordering for session: ${sessionId}`);
                this.chunkOrdering.delete(sessionId);
                cleanedCount++;
            } else {
                // Check for individual stuck chunks within active sessions
                const stuckChunks = [];
                for (const [chunkNum, chunkData] of orderingData.pendingChunks.entries()) {
                    if (now - chunkData.receivedAt > staleThreshold) {
                        stuckChunks.push(chunkNum);
                    }
                }
                
                if (stuckChunks.length > 0) {
                    console.log(`[RobotAPI] ⚠️ Found ${stuckChunks.length} stuck chunks in session ${sessionId}:`, stuckChunks);
                    // Process stuck chunks as timeout - force them through to prevent indefinite blocking
                    for (const chunkNum of stuckChunks) {
                        console.log(`[RobotAPI] 🚨 Force-processing stuck chunk ${chunkNum} due to timeout`);
                        this.processTimeoutChunk(sessionId, chunkNum);
                    }
                    cleanedCount += stuckChunks.length;
                }
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`[RobotAPI] 🧹 Cleanup complete: cleaned ${cleanedCount} stale/stuck chunks`);
        }
    }

    handleShutdownCommand(socketId) {
        console.log(`[RobotAPI] Handling shutdown command for connection: ${socketId}`);
        this.unregisterConnection(socketId);
    }

    /**
     * Handle LLM conversation response with proper chunking and buffering
     * This is the primary method for handling LLM responses that need chunking
     */
    handleConversationResponse(content, targetRobot = 'Haku', sessionId, isFinished = false, isFirstChunk = false, chunkNumber = null) {
        console.log(`[RobotAPI] 🗣️ Processing conversation response for ${targetRobot} (session: ${sessionId})`);
        console.log(`[RobotAPI] 📝 Content: "${content}", finished: ${isFinished}, firstChunk: ${isFirstChunk}, chunkNumber: ${chunkNumber}`);
        
        // Broadcast AI response to tablet displays if content exists
        if (content && content.trim() && this.broadcastLLMCommunication) {
            this.broadcastLLMCommunication('llm-ai-response', content, targetRobot);
        }
        
        // Validate session ID
        if (!sessionId) {
            console.error('[RobotAPI] ❌ Session ID is required for conversation responses');
            return {
                success: false,
                error: 'Session ID is required',
                buffered: false
            };
        }

        // Establish robot name and session ID mapping if this is the first chunk or if mapping doesn't exist
        if (isFirstChunk || !this.robotNameToSessionId.has(targetRobot)) {
            const robotSocketId = this.robotNameToSocketId.get(targetRobot);
            if (robotSocketId) {
                console.log(`[RobotAPI] 🔗 Mapping robot ${targetRobot} to LLM session ${sessionId}`);
                this.robotNameToSessionId.set(targetRobot, sessionId);
                this.sessionIdToRobotName.set(sessionId, targetRobot);
            } else {
                console.error(`[RobotAPI] ❌ No socket connection found for robot ${targetRobot}`);
                return {
                    success: false,
                    error: `No socket connection found for robot ${targetRobot}`,
                    buffered: false
                };
            }
        }
        
        // Use robot name as primary identifier for chunking
        const robotSocketId = this.robotNameToSocketId.get(targetRobot);
        if (!robotSocketId) {
            console.error(`[RobotAPI] ❌ No robot socket found for robot ${targetRobot}`);
            return {
                success: false,
                error: `No robot socket found for robot ${targetRobot}`,
                buffered: false
            };
        }

        // Handle chunk ordering if chunkNumber is provided
        let orderingResult = null;
        if (chunkNumber !== null && chunkNumber !== undefined) {
            orderingResult = this.validateChunkOrder(sessionId, chunkNumber, content, targetRobot, isFinished, isFirstChunk);
            if (!orderingResult.processNow) {
                console.log(`[RobotAPI] ⏳ Chunk ${chunkNumber} for session ${sessionId} queued - waiting for earlier chunks`);
                return {
                    success: true,
                    message: `Chunk ${chunkNumber} queued - waiting for earlier chunks`,
                    buffered: false,
                    sessionId: sessionId,
                    chunkNumber: chunkNumber,
                    chunksWaiting: orderingResult.chunksWaiting
                };
            }
            // If we reach here, this chunk and possibly some queued chunks are ready to process
            console.log(`[RobotAPI] ✅ Processing chunk ${chunkNumber} for session ${sessionId} (${orderingResult.chunksToProcess.length} chunks ready)`);
        }
        
        // Handle LLM session management for turn-taking
        // If current call is first chunk OR ordering assumed start and indicates a first chunk among ready ones
        if ((isFirstChunk && sessionId) || (orderingResult && orderingResult.assumeStartFromOne && orderingResult.shouldStartSession)) {
            console.log(`[RobotAPI] 🚀 Starting LLM session for first chunk (assumed or explicit): ${sessionId}`);
            // Establish robot mapping if needed
            if (!this.robotNameToSessionId.has(targetRobot)) {
                const robotSocketId = this.robotNameToSocketId.get(targetRobot);
                if (robotSocketId) {
                    console.log(`[RobotAPI] 🔗 Mapping robot ${targetRobot} to LLM session ${sessionId}`);
                    this.robotNameToSessionId.set(targetRobot, sessionId);
                    this.sessionIdToRobotName.set(sessionId, targetRobot);
                }
            }
            this.startLLMSession(sessionId, targetRobot);
        }

        // Process this chunk and any ready chunks from the ordering system
        const chunksToProcess = orderingResult ? 
            orderingResult.chunksToProcess : 
            [{ content, targetRobot, sessionId, isFinished, isFirstChunk, chunkNumber }];
        
        let totalContentLength = 0;
        let hasContent = false;
        
        // Process all ready chunks in order
        for (const chunk of chunksToProcess) {
            if (chunk.content && chunk.content.trim()) {
                // CRITICAL: Don't trim the content here to preserve leading/trailing spaces
                // Only trim for the length check, but use original content for buffering
                this.addToChunkBuffer(chunk.sessionId, chunk.content, chunk.targetRobot);
                totalContentLength += chunk.content.length;
                hasContent = true;
                
                console.log(`[RobotAPI] 📋 Processed chunk ${chunk.chunkNumber !== null && chunk.chunkNumber !== undefined ? chunk.chunkNumber : 'unnumbered'}: "${chunk.content}" (${chunk.content.length} chars)`);
                
                // Add warning for missing chunk numbers
                if (chunk.chunkNumber === null || chunk.chunkNumber === undefined) {
                    console.warn(`[RobotAPI] ⚠️ WARNING: Chunk received without number. Could lead to processing issues.`);
                }
            }
        }
        
        // Prepare result
        if (hasContent) {
            var result = {
                success: true,
                message: `Content added to chunk buffer for intelligent processing (${chunksToProcess.length} chunks processed)`,
                buffered: true,
                sessionId: sessionId,
                contentLength: totalContentLength
            };
        } else {
            // No content to process
            var result = {
                success: true,
                message: 'No content to process',
                buffered: false,
                sessionId: sessionId
            };
        }
        
        // Handle completion
        if (isFinished && sessionId) {
            console.log(`[RobotAPI] 🏁 Ending LLM session for final chunk: ${sessionId}`);
            
            // Process any remaining buffer content as finished
            this.processChunkBuffer(sessionId, true);
            
            // Clean up chunk ordering for this session
            this.chunkOrdering.delete(sessionId);
            
            // End the LLM session for turn-taking
            this.endLLMSession(sessionId);
            
            result.llmActive = false;
            result.message += ' - Session completed and buffer flushed';
        } else {
            result.llmActive = this.llmActiveSessions.has(sessionId);
        }
        
        return result;
    }

    /**
     * Validate chunk order and handle out-of-order chunks
     */
    validateChunkOrder(sessionId, chunkNumber, content, targetRobot, isFinished, isFirstChunk) {
        if (!this.chunkOrdering.has(sessionId)) {
            // First chunk for this session - always expect chunk 0 first
            this.chunkOrdering.set(sessionId, {
                expectedChunk: 0,
                pendingChunks: new Map(), // chunkNumber -> chunk data
                maxWaitTime: Date.now() + this.CHUNK_WAIT_TIMEOUT,
                lastActivity: Date.now(),
                assumedStart: 0 // 0 by default; can flip to 1 if we never get chunk 0
            });
            console.log(`[RobotAPI] 🆕 Initialized chunk ordering for session ${sessionId}, expecting chunk 0`);
        }
        
        const ordering = this.chunkOrdering.get(sessionId);
        ordering.lastActivity = Date.now(); // Update activity timestamp
        
        // Check if this is the expected chunk
        if (chunkNumber === ordering.expectedChunk) {
            // This is the next expected chunk - we can process it
            ordering.expectedChunk = chunkNumber + 1;
            
            // Store this chunk to be processed
            const currentChunk = { content, targetRobot, sessionId, isFinished, isFirstChunk, chunkNumber };
            
            // Check if any pending chunks are now ready
            const readyChunks = [currentChunk];
            while (ordering.pendingChunks.has(ordering.expectedChunk)) {
                const nextChunk = ordering.pendingChunks.get(ordering.expectedChunk);
                readyChunks.push(nextChunk);
                ordering.pendingChunks.delete(ordering.expectedChunk);
                ordering.expectedChunk++;
                console.log(`[RobotAPI] ⏭️ Processing queued chunk ${ordering.expectedChunk - 1} for session ${sessionId}`);
            }
            
            return {
                processNow: true,
                chunksToProcess: readyChunks,
                chunksWaiting: ordering.pendingChunks.size
            };
        } else if (chunkNumber > ordering.expectedChunk) {
            // This chunk arrived too early - store it for later
            if (ordering.pendingChunks.size >= this.MAX_PENDING_CHUNKS) {
                console.warn(`[RobotAPI] ⚠️ Too many pending chunks for session ${sessionId} - dropping chunk ${chunkNumber}`);
                return {
                    processNow: false,
                    error: 'Too many pending chunks',
                    chunksWaiting: ordering.pendingChunks.size
                };
            }
            
            ordering.pendingChunks.set(chunkNumber, {
                content, targetRobot, sessionId, isFinished, isFirstChunk, chunkNumber,
                receivedAt: Date.now()
            });
            
            console.log(`[RobotAPI] 📦 Queued out-of-order chunk ${chunkNumber} for session ${sessionId} (expecting ${ordering.expectedChunk})`);
            
            // Check if we should process pending chunks due to timeout
            this.checkChunkTimeout(sessionId);
            
            // If we've received many chunks (>= threshold), none are 0, but 1 is present,
            // assume numbering starts at 1 and process from there.
            const maybeAssumed = this.maybeAssumeOneStart(sessionId);
            if (maybeAssumed && maybeAssumed.length > 0) {
                console.warn(`[RobotAPI] 🔁 Adjusted expected chunk to ${this.chunkOrdering.get(sessionId).expectedChunk} and processing ${maybeAssumed.length} queued chunk(s) for session ${sessionId}`);
                return {
                    processNow: true,
                    chunksToProcess: maybeAssumed,
                    chunksWaiting: this.chunkOrdering.get(sessionId).pendingChunks.size,
                    assumeStartFromOne: true,
                    shouldStartSession: true
                };
            }
            
            return {
                processNow: false,
                chunksWaiting: ordering.pendingChunks.size
            };
        } else {
            // This chunk is older than expected (duplicate or very delayed)
            console.warn(`[RobotAPI] ⚠️ Received duplicate or very delayed chunk ${chunkNumber} for session ${sessionId} (expecting ${ordering.expectedChunk})`);
            return {
                processNow: false,
                error: 'Duplicate or delayed chunk',
                chunksWaiting: ordering.pendingChunks.size
            };
        }
    }

    /**
     * Check for chunk timeouts and process pending chunks if needed
     */
    checkChunkTimeout(sessionId) {
        const ordering = this.chunkOrdering.get(sessionId);
        if (!ordering || ordering.pendingChunks.size === 0) return;
        
        const now = Date.now();
        
        // Check if any pending chunks have timed out
        let hasTimedOut = false;
        for (const [chunkNumber, chunkData] of ordering.pendingChunks) {
            if (now - chunkData.receivedAt > this.CHUNK_WAIT_TIMEOUT) {
                hasTimedOut = true;
                break;
            }
        }
        
        if (hasTimedOut) {
            console.warn(`[RobotAPI] ⏰ Chunk timeout for session ${sessionId} - processing available chunks`);
            
            // Find the lowest chunk number we can process
            const sortedChunks = Array.from(ordering.pendingChunks.keys()).sort((a, b) => a - b);
            const readyChunks = [];
            
            for (const chunkNumber of sortedChunks) {
                if (chunkNumber === ordering.expectedChunk) {
                    const chunkData = ordering.pendingChunks.get(chunkNumber);
                    readyChunks.push(chunkData);
                    ordering.pendingChunks.delete(chunkNumber);
                    ordering.expectedChunk++;
                } else {
                    break; // Can't process non-consecutive chunks
                }
            }
            
            if (readyChunks.length > 0) {
                console.log(`[RobotAPI] 🚀 Processing ${readyChunks.length} timed-out chunks for session ${sessionId}`);
                
                // Process the ready chunks
                for (const chunk of readyChunks) {
                    this.handleConversationResponse(
                        chunk.content, 
                        chunk.targetRobot, 
                        chunk.sessionId, 
                        chunk.isFinished, 
                        chunk.isFirstChunk,
                        null // Don't pass chunkNumber to avoid infinite recursion
                    );
                }
            }
        }
    }

    /**
     * If after receiving at least CHUNK_START_ASSUME_THRESHOLD pending chunks we still haven't
     * seen chunk 0 but have chunk 1, assume numbering starts at 1 and adjust expectedChunk.
     * Returns an array of ready, consecutive chunks starting at 1 if adjustment occurs,
     * otherwise returns null/empty.
     */
    maybeAssumeOneStart(sessionId) {
        const ordering = this.chunkOrdering.get(sessionId);
        if (!ordering) return null;

        // Only consider this path when still waiting for chunk 0
        if (ordering.expectedChunk !== 0) return null;

        const pendingSize = ordering.pendingChunks.size;
        if (pendingSize < this.CHUNK_START_ASSUME_THRESHOLD) return null;

        const hasChunk0 = ordering.pendingChunks.has(0);
        const hasChunk1 = ordering.pendingChunks.has(1);

        if (!hasChunk0 && hasChunk1) {
            console.warn(`[RobotAPI] ⚠️ No chunk 0 after ${pendingSize} chunk(s), but chunk 1 exists. Assuming first chunk is 1 for session ${sessionId}.`);

            // Adjust expectation to 1
            ordering.expectedChunk = 1;
            ordering.assumedStart = 1;

            // Collect consecutive chunks starting at 1
            const ready = [];
            while (ordering.pendingChunks.has(ordering.expectedChunk)) {
                const next = ordering.pendingChunks.get(ordering.expectedChunk);
                ready.push(next);
                ordering.pendingChunks.delete(ordering.expectedChunk);
                ordering.expectedChunk++;
            }

            return ready;
        }

        return null;
    }

    /**
     * Store ready chunks for processing
     */
    /**
     * Process a stuck chunk by forcing it through due to timeout
     */
    processTimeoutChunk(sessionId, chunkNumber) {
        const ordering = this.chunkOrdering.get(sessionId);
        if (!ordering || !ordering.pendingChunks.has(chunkNumber)) {
            console.warn(`[RobotAPI] ⚠️ Cannot process timeout chunk ${chunkNumber} for session ${sessionId} - chunk not found`);
            return;
        }
        
        const chunkData = ordering.pendingChunks.get(chunkNumber);
        ordering.pendingChunks.delete(chunkNumber);
        
        console.log(`[RobotAPI] 🚨 Force-processing chunk ${chunkNumber} for session ${sessionId} due to timeout`);
        
        // Process this chunk regardless of order
        this.handleConversationResponse(
            chunkData.content,
            chunkData.targetRobot,
            chunkData.sessionId,
            chunkData.isFinished,
            chunkData.isFirstChunk,
            null // Don't pass chunkNumber to avoid infinite recursion
        );
    }

    /**
     * Cleanup method for graceful shutdown
     */
    cleanup() {
        console.log('[RobotAPI] 🧹 Cleaning up resources...');
        
        // Clear reconnect timeout
        if (this.sttReconnectTimeout) {
            clearTimeout(this.sttReconnectTimeout);
            this.sttReconnectTimeout = null;
        }
        
        // Close STT WebSocket connection
        if (this.sttWebSocket) {
            this.sttWebSocket.close();
            this.sttWebSocket = null;
        }
        
        // Clear intervals
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        if (this.bufferCheckInterval) {
            clearInterval(this.bufferCheckInterval);
            this.bufferCheckInterval = null;
        }
        
        // Clear STT monitoring intervals
        if (this.sttHealthCheckInterval) {
            clearInterval(this.sttHealthCheckInterval);
            this.sttHealthCheckInterval = null;
        }
        
        if (this.sttStateCheckInterval) {
            clearInterval(this.sttStateCheckInterval);
            this.sttStateCheckInterval = null;
        }
        
        // Clean up robot state management
        this.cleanupRobotStateManagement();
        
        console.log('[RobotAPI] ✅ Cleanup completed');
    }
}

module.exports = new RobotAPI();
