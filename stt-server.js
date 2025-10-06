const WebSocket = require('ws');
const express = require('express');
const http = require('http');

// Generic LLM client extracted from your example
class GenericLLMClient {
    constructor(endpoint, options = {}) {
        this.endpoint = endpoint;
        this.options = {
            timeout: options.timeout || 30000,
            headers: options.headers || {},
            ...options
        };
    }

    async sendMessage(messages, options = {}) {
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.options.headers
                },
                body: JSON.stringify({
                    messages,
                    ...options
                }),
                signal: AbortSignal.timeout(this.options.timeout)
            });

            if (!response.ok) {
                throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('LLM request error:', error);
            throw error;
        }
    }

    async sendStreamingMessage(messages, onChunk, options = {}) {
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    ...this.options.headers
                },
                body: JSON.stringify({
                    messages,
                    stream: true,
                    ...options
                }),
                signal: AbortSignal.timeout(this.options.timeout)
            });

            if (!response.ok) {
                throw new Error(`LLM streaming request failed: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            onChunk(parsed);
                        } catch (e) {
                            console.warn('Failed to parse streaming chunk:', data);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('LLM streaming error:', error);
            throw error;
        }
    }
}

class STTServer {
    constructor(port = 8765) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        
        this.clients = new Map();
        this.conversationHistory = new Map();
        
        // LLM configuration - can be loaded from config file
        this.llmConfig = {
            enabled: process.env.STT_LLM_ENABLED === 'true',
            endpoint: process.env.STT_LLM_ENDPOINT || 'http://localhost:8080/v1/chat/completions',
            headers: {
                'Authorization': process.env.STT_LLM_API_KEY ? `Bearer ${process.env.STT_LLM_API_KEY}` : '',
            }
        };
        
        this.llmClient = this.llmConfig.enabled ? new GenericLLMClient(
            this.llmConfig.endpoint, 
            { headers: this.llmConfig.headers }
        ) : null;

        this.setupWebSocketServer();
    }

    setupWebSocketServer() {
        this.wss.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            console.log(`STT client connected: ${clientId}`);
            
            const clientInfo = {
                ws,
                isTranscribing: false,
                config: {
                    chunk_size_ms: 200,
                    device_id: null,
                    language: 'en-US'
                }
            };
            
            this.clients.set(clientId, clientInfo);
            this.conversationHistory.set(clientId, []);

            // Send initial status
            this.sendMessage(ws, {
                type: 'status',
                status: 'connected',
                details: clientInfo.config
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(clientId, message);
                } catch (error) {
                    console.error('Invalid message format:', error);
                    this.sendError(ws, 'Invalid message format');
                }
            });

            ws.on('close', () => {
                console.log(`STT client disconnected: ${clientId}`);
                this.clients.delete(clientId);
                this.conversationHistory.delete(clientId);
            });

            ws.on('error', (error) => {
                console.error(`STT client error (${clientId}):`, error);
                this.clients.delete(clientId);
                this.conversationHistory.delete(clientId);
            });
        });
    }

    handleMessage(clientId, message) {
        const client = this.clients.get(clientId);
        if (!client) return;

        switch (message.action) {
            case 'start':
                this.startTranscription(clientId);
                break;
            case 'stop':
                this.stopTranscription(clientId);
                break;
            case 'configure':
                this.configureClient(clientId, message.config);
                break;
            case 'audio_data':
                this.processAudioData(clientId, message.data);
                break;
            default:
                console.warn(`Unknown action: ${message.action}`);
                this.sendError(client.ws, `Unknown action: ${message.action}`);
        }
    }

    startTranscription(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.isTranscribing = true;
        console.log(`Started transcription for client: ${clientId}`);
        
        this.sendMessage(client.ws, {
            type: 'status',
            status: 'started'
        });
    }

    stopTranscription(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.isTranscribing = false;
        console.log(`Stopped transcription for client: ${clientId}`);
        
        this.sendMessage(client.ws, {
            type: 'status',
            status: 'stopped'
        });
    }

    configureClient(clientId, config) {
        const client = this.clients.get(clientId);
        if (!client) return;

        client.config = { ...client.config, ...config };
        
        this.sendMessage(client.ws, {
            type: 'status',
            status: 'configured',
            details: client.config
        });
    }

    // Simulated speech recognition - replace with actual STT implementation
    processAudioData(clientId, audioData) {
        const client = this.clients.get(clientId);
        if (!client || !client.isTranscribing) return;

        // Simulate speech recognition processing
        setTimeout(() => {
            // Simulate partial result
            this.sendMessage(client.ws, {
                type: 'partial',
                text: 'Hello, this is a partial...'
            });

            setTimeout(() => {
                // Simulate complete result
                const completeText = 'Hello, this is a complete utterance from the STT system.';
                this.handleCompleteUtterance(clientId, completeText);
            }, 1000);
        }, 500);
    }

    async handleCompleteUtterance(clientId, text) {
        const client = this.clients.get(clientId);
        if (!client) return;

        console.log(`Complete utterance for ${clientId}: ${text}`);
        
        // Send the complete transcription
        this.sendMessage(client.ws, {
            type: 'complete',
            text: text,
            timestamp: Date.now() / 1000,
            confidence: 0.95
        });

    }

    async processWithLLM(clientId, userMessage) {
        const client = this.clients.get(clientId);
        if (!client) return;

        try {
            const history = this.conversationHistory.get(clientId) || [];
            
            // Add user message to history
            history.push({ role: 'user', content: userMessage });
            
            // Prepare messages for LLM (keep last 30 exchanges to manage context)
            const messages = [
                ...history.slice(-30) // Keep last 30 messages (15 exchanges)
            ];

            // Send to LLM with streaming
            let llmResponse = '';
            await this.llmClient.sendStreamingMessage(
                messages,
                (chunk) => {
                    if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                        const content = chunk.choices[0].delta.content;
                        llmResponse += content;
                        
                        // Send partial LLM response
                        this.sendMessage(client.ws, {
                            type: 'llm_partial',
                            text: content,
                            full_response: llmResponse
                        });
                    }
                }
            );

            // Add assistant response to history
            if (llmResponse.trim()) {
                history.push({ role: 'assistant', content: llmResponse });
                this.conversationHistory.set(clientId, history);
                
                // Send complete LLM response
                this.sendMessage(client.ws, {
                    type: 'llm_complete',
                    text: llmResponse,
                    timestamp: Date.now() / 1000
                });
            }

        } catch (error) {
            console.error(`LLM processing error for ${clientId}:`, error);
            this.sendMessage(client.ws, {
                type: 'llm_error',
                error: 'Failed to get LLM response'
            });
        }
    }

    sendMessage(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    sendError(ws, error) {
        this.sendMessage(ws, {
            type: 'error',
            error: error
        });
    }

    generateClientId() {
        return Math.random().toString(36).substr(2, 9);
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`STT Server listening on port ${this.port}`);
            console.log(`WebSocket endpoint: ws://localhost:${this.port}`);
            console.log(`LLM integration: ${this.llmConfig.enabled ? 'Enabled' : 'Disabled'}`);
            if (this.llmConfig.enabled) {
                console.log(`LLM endpoint: ${this.llmConfig.endpoint}`);
            }
        });
    }
}

// Start the server
const server = new STTServer(8765);
server.start();

module.exports = { STTServer, GenericLLMClient };
