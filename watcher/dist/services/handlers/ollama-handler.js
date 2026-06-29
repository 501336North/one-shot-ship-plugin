/**
 * OllamaHandler - Handle requests to local Ollama server
 *
 * @behavior Transforms Anthropic requests to Ollama format and connects to local server
 * @acceptance-criteria AC-HANDLER-OLLAMA.1 through AC-HANDLER-OLLAMA.5
 */
import * as http from 'http';
import * as https from 'https';
import { flattenAnthropicContent } from '../api-transformer.js';
/**
 * OllamaHandler - Connects to local Ollama server
 *
 * - Transforms Anthropic requests to Ollama format
 * - No API key required (local server)
 * - Transforms Ollama responses back to Anthropic format
 */
export class OllamaHandler {
    baseUrl;
    think;
    constructor(config) {
        this.baseUrl = config.baseUrl || 'http://localhost:11434';
        this.think = config.think;
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
        return (response?.models ?? []).map((m) => m.name);
    }
    /**
     * Transform Anthropic request to Ollama format
     */
    transformToOllama(request) {
        const messages = [];
        // Handle system message. Anthropic allows `system` as a string OR an array of content
        // blocks (the Claude CLI sends the array form); Ollama requires a string.
        if (request.system) {
            messages.push({
                role: 'system',
                content: flattenAnthropicContent(request.system),
            });
        }
        // Transform messages. Content may be a string, or a block array that can include tool_use
        // (assistant calls) and tool_result (results) — both must round-trip so a multi-turn tool
        // loop works against ollama.
        for (const msg of request.messages) {
            if (typeof msg.content === 'string') {
                messages.push({ role: msg.role, content: msg.content });
                continue;
            }
            const textParts = [];
            const toolUses = [];
            const toolResults = [];
            for (const block of msg.content) {
                if (block.type === 'text')
                    textParts.push(block.text);
                else if (block.type === 'tool_use')
                    toolUses.push(block);
                else if (block.type === 'tool_result')
                    toolResults.push(block);
            }
            if (msg.role === 'assistant' && toolUses.length > 0) {
                // Assistant turn that called tools → ollama assistant message carrying tool_calls.
                messages.push({
                    role: 'assistant',
                    content: textParts.join(''),
                    tool_calls: toolUses.map((tu) => ({
                        function: {
                            name: tu.name,
                            arguments: tu.input,
                        },
                    })),
                });
            }
            else if (toolResults.length > 0) {
                // Tool results → ollama tool-role messages (one per result).
                for (const tr of toolResults) {
                    const c = tr.content;
                    messages.push({ role: 'tool', content: typeof c === 'string' ? c : JSON.stringify(c) });
                }
                const text = textParts.join('');
                if (text.length > 0)
                    messages.push({ role: msg.role, content: text });
            }
            else {
                messages.push({ role: msg.role, content: textParts.join('') });
            }
        }
        const ollamaRequest = {
            // Ollama expects the bare model name; strip the "ollama/" provider prefix that the
            // OSS config/agents use (e.g. "ollama/gpt-oss:120b" → "gpt-oss:120b").
            model: request.model.replace(/^ollama\//, ''),
            messages,
            stream: false,
            options: {
                num_predict: request.max_tokens,
                temperature: request.temperature,
                top_p: request.top_p,
            },
        };
        // Per-model native think control: set ollama's top-level `think` ONLY when the bare (stripped)
        // model name is a configured key. Existence-keyed so a `false` value is honored; unlisted models
        // get no `think` key (sending it to a non-thinking model can 400).
        const bareModel = request.model.replace(/^ollama\//, '');
        // Own-key check (not `in`): avoids a model named after an Object.prototype member
        // (e.g. "constructor") spuriously matching the allow-list.
        if (this.think && Object.prototype.hasOwnProperty.call(this.think, bareModel)) {
            ollamaRequest.think = this.think[bareModel];
        }
        // Map Anthropic tools → ollama function-tool format so the model can call tools.
        if (request.tools && request.tools.length > 0) {
            ollamaRequest.tools = request.tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                },
            }));
        }
        return ollamaRequest;
    }
    /**
     * Transform Ollama response to Anthropic format
     */
    transformFromOllama(response) {
        const content = [];
        // Keep any text the model produced (omit an empty text block when it only called tools).
        if (response.message.content && response.message.content.length > 0) {
            content.push({ type: 'text', text: response.message.content });
        }
        // Translate ollama tool_calls → Anthropic tool_use blocks.
        const toolCalls = response.message.tool_calls ?? [];
        for (const call of toolCalls) {
            // Anthropic tool_use.input must be an object; coerce a stringified arguments payload.
            const rawArgs = call.function.arguments;
            let input = {};
            if (typeof rawArgs === 'string') {
                try {
                    input = JSON.parse(rawArgs);
                }
                catch {
                    input = {};
                }
            }
            else if (rawArgs && typeof rawArgs === 'object') {
                input = rawArgs;
            }
            content.push({
                type: 'tool_use',
                id: `toolu_${generateId()}`,
                name: call.function.name,
                input,
            });
        }
        // A tool call ends the turn with stop_reason 'tool_use'; otherwise end_turn when done.
        const stopReason = toolCalls.length > 0 ? 'tool_use' : response.done ? 'end_turn' : null;
        // Never return an empty content array (Anthropic clients expect at least one block).
        if (content.length === 0) {
            content.push({ type: 'text', text: '' });
        }
        return {
            id: `msg_${generateId()}`,
            type: 'message',
            role: 'assistant',
            model: response.model,
            content,
            stop_reason: stopReason,
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
            const isHttps = url.protocol === 'https:';
            const data = body ? JSON.stringify(body) : '';
            const options = {
                hostname: url.hostname,
                port: parseInt(url.port) || (isHttps ? 443 : 11434),
                path,
                method,
                headers: body
                    ? {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data),
                    }
                    : {},
            };
            // Honor the base-URL scheme: an https:// remote ollama must not be silently
            // downgraded to plaintext (would send prompts unencrypted to port 443).
            const transport = isHttps ? https : http;
            const req = transport.request(options, (res) => {
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