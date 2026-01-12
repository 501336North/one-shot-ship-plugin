/**
 * OpenRouterHandler - Handle requests to OpenRouter API
 *
 * @behavior Transforms Anthropic requests to OpenAI format and forwards to OpenRouter
 * @acceptance-criteria AC-HANDLER-OR.1 through AC-HANDLER-OR.5
 */
import * as https from 'https';
import { transformToOpenAI, transformFromOpenAI, } from '../api-transformer.js';
/**
 * OpenRouterHandler - Forwards requests to OpenRouter API
 *
 * - Transforms Anthropic requests to OpenAI format
 * - Adds proper authorization headers
 * - Transforms OpenAI responses back to Anthropic format
 */
export class OpenRouterHandler {
    config;
    constructor(config) {
        if (!config.apiKey || config.apiKey.length === 0) {
            throw new Error('API key is required for OpenRouter');
        }
        this.config = config;
    }
    /**
     * Get headers for OpenRouter API requests
     */
    getHeaders() {
        return {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://oneshotship.com',
            'X-Title': 'OSS Dev Workflow',
        };
    }
    /**
     * Get the OpenRouter API endpoint
     */
    getEndpoint() {
        return 'https://openrouter.ai/api/v1/chat/completions';
    }
    /**
     * Handle a request by forwarding to OpenRouter
     */
    async handle(request) {
        // Transform Anthropic request to OpenAI format
        const openaiRequest = transformToOpenAI(request);
        // Make request to OpenRouter
        const openaiResponse = await this.makeRequest(openaiRequest);
        // Transform response back to Anthropic format
        return transformFromOpenAI(openaiResponse);
    }
    /**
     * Make HTTPS request to OpenRouter
     */
    makeRequest(body) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const headers = this.getHeaders();
            const req = https.request({
                hostname: 'openrouter.ai',
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(data),
                },
            }, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        let errorMessage = `OpenRouter API error: ${res.statusCode}`;
                        try {
                            const errorBody = JSON.parse(responseData);
                            if (errorBody.error?.message) {
                                errorMessage = `OpenRouter API error: ${errorBody.error.message}`;
                            }
                        }
                        catch {
                            // Use default error message
                        }
                        reject(new Error(errorMessage));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(responseData);
                        resolve(parsed);
                    }
                    catch (err) {
                        reject(new Error(`Failed to parse OpenRouter response: ${err}`));
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });
            req.write(data);
            req.end();
        });
    }
}
//# sourceMappingURL=openrouter-handler.js.map