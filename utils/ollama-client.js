// Ollama LLM Streaming Client
// Streams NDJSON responses from Ollama's /api/generate endpoint

/**
 * Streams LLM responses from Ollama
 * @param {Object} params
 * @param {string} params.prompt - User prompt
 * @param {Array} [params.context] - Conversation context array
 * @param {Object} [params.options] - Model options (temperature, etc)
 * @param {string} [params.model] - Model name (default: 'haku')
 * @param {string} [params.host] - Ollama host
 * @param {number} [params.port] - Ollama port
 * @param {number} [params.timeout] - Timeout in ms
 * @returns {AsyncGenerator<string, Array|null>} - Yields response chunks, returns final context
 */
async function* ollamaStream({ prompt, context = null, options = {}, model = 'haku', host = 'localhost', port = 11434, timeout = 120000 }) {
    const payload = {
        model,
        prompt,
        stream: true,
        options,
    };
    if (context) payload.context = context;

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(`http://${host}:${port}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalContext = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (line.trim()) {
                    const chunk = JSON.parse(line);
                    if (chunk.response) {
                        // Yield an object with content and metadata
                        yield {
                            content: chunk.response,
                            created_at: chunk.created_at,
                            model: chunk.model,
                            done: chunk.done || false
                        };
                    }
                    if (chunk.done) finalContext = chunk.context || null;
                }
            }
        }
        return finalContext;
    } finally {
        clearTimeout(timeoutId);
    }
}

module.exports = { ollamaStream };

module.exports = { ollamaStream };