/**
 * OllamaHandler - Handle requests to local Ollama server
 *
 * @behavior Transforms Anthropic requests to Ollama format and connects to local server
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */
import * as http from 'http';
/**
 * OllamaHandler - Connects to local Ollama server
 *
 * - Transforms Anthropic requests to Ollama format
 * - No API key required (local server)
 * - Transforms Ollama responses back to Anthropic format
 */
export class OllamaHandler {
    baseUrl;
    constructor(config) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
    }
    /**
     * Get the base URL for the Ollama server
     */
    getBaseUrl() {
        return this.baseUrl;
    }
    /**
     * Get the Ollama chat endpoint
     */
    getEndpoint() {
        return `${this.baseUrl}/api/chat`;
    }
    /**
     * Handle a request by forwarding to Ollama
     */
    async handle(request) {
        // Transform Anthropic request to Ollama format
        const ollamaRequest = this.transformToOllama(request);
        // Make request to Ollama
        const ollamaResponse = await this.makeRequest('/api/chat', ollamaRequest);
        // Transform response back to Anthropic format
        return this.transformFromOllama(ollamaResponse);
    }
    /**
     * Check if Ollama server is running
     */
    async checkHealth() {
        try {
            await this.makeRequest('/', null, 'GET');
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * List available models
     */
    async listModels() {
        const response = (await this.makeRequest('/api/tags', null, 'GET'));
        return response.models.map((m) => m.name);
    }
    /**
     * Transform Anthropic request to Ollama format
     */
    transformToOllama(request) {
        const messages = [];
        // Handle system message
        if (request.system) {
            messages.push({
                role: 'system',
                content: request.system,
            });
        }
        // Transform messages
        for (const msg of request.messages) {
            if (typeof msg.content === 'string') {
                messages.push({
                    role: msg.role,
                    content: msg.content,
                });
            }
            else {
                // Handle content array - concatenate text parts
                const textContent = msg.content
                    .filter((block) => block.type === 'text')
                    .map((block) => block.text)
                    .join('');
                messages.push({
                    role: msg.role,
                    content: textContent,
                });
            }
        }
        return {
            model: request.model,
            messages,
            stream: false,
            options: {
                num_predict: request.max_tokens,
                temperature: request.temperature,
                top_p: request.top_p,
            },
        };
    }
    /**
     * Transform Ollama response to Anthropic format
     */
    transformFromOllama(response) {
        const content = [
            {
                type: 'text',
                text: response.message.content,
            },
        ];
        return {
            id: `msg_${generateId()}`,
            type: 'message',
            role: 'assistant',
            model: response.model,
            content,
            stop_reason: response.done ? 'end_turn' : null,
            usage: {
                input_tokens: response.prompt_eval_count || 0,
                output_tokens: response.eval_count || 0,
            },
        };
    }
    /**
     * Make HTTP request to Ollama server
     */
    makeRequest(path, body, method = 'POST') {
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            const data = body ? JSON.stringify(body) : '';
            const options = {
                hostname: url.hostname,
                port: parseInt(url.port) || 11434,
                path,
                method,
                headers: body
                    ? {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data),
                    }
                    : {},
            };
            const req = http.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        let errorMessage = `Ollama error: ${res.statusCode}`;
                        try {
                            const errorBody = JSON.parse(responseData);
                            if (errorBody.error) {
                                errorMessage = `Ollama error: ${errorBody.error}`;
                            }
                        }
                        catch {
                            // Use default error message
                        }
                        reject(new Error(errorMessage));
                        return;
                    }
                    try {
                        // Handle empty responses (like health check)
                        if (!responseData.trim()) {
                            resolve({});
                            return;
                        }
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    }
                    catch (err) {
                        // For non-JSON responses (like health check text)
                        resolve({ text: responseData });
                    }
                });
            });
            req.on('error', (err) => {
                if (err.code === 'ECONNREFUSED') {
                    reject(new Error('Ollama is not running. Start Ollama with: ollama serve'));
                }
                else {
                    reject(err);
                }
            });
            if (body) {
                req.write(data);
            }
            req.end();
        });
    }
}
/**
 * Generate a random ID for responses
 */
function generateId() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 24; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
//# sourceMappingURL=ollama-handler.js.map