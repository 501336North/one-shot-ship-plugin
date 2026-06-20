/**
 * ModelProxy - HTTP proxy server that routes requests to model providers
 *
 * @behavior Starts HTTP server on localhost and routes /v1/messages to provider handlers
 * @acceptance-criteria AC-PROXY.1 through AC-PROXY.9
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createHandler, SUPPORTED_PROVIDERS } from './handler-registry.js';
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Check if config is new format (model string-based)
 */
function isNewConfig(config) {
    return 'model' in config;
}
/**
 * Parse provider from model string
 * Format: <provider>/<model-name>
 * Returns null if invalid format
 */
function parseProviderFromModel(modelString) {
    const slashIndex = modelString.indexOf('/');
    if (slashIndex <= 0) {
        return null;
    }
    const provider = modelString.substring(0, slashIndex);
    if (SUPPORTED_PROVIDERS.includes(provider)) {
        return provider;
    }
    return null;
}
/**
 * Extract model name from model string
 * For "ollama/codellama", returns "codellama"
 * For "openrouter/anthropic/claude-3-haiku", returns "anthropic/claude-3-haiku"
 */
function extractModelName(modelString) {
    const slashIndex = modelString.indexOf('/');
    if (slashIndex <= 0) {
        return modelString;
    }
    return modelString.substring(slashIndex + 1);
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
// ============================================================================
// ModelProxy Class
// ============================================================================
/**
 * ModelProxy - HTTP server that proxies requests to model providers
 *
 * Creates a localhost HTTP server that:
 * - Accepts Anthropic-format requests on POST /v1/messages
 * - Transforms requests for the target provider
 * - Forwards to the provider and returns transformed responses
 * - Provides health check endpoint at GET /health
 */
export class ModelProxy {
    config;
    server = null;
    port = 0;
    address = '127.0.0.1';
    connections = new Set();
    // Parsed values from model string
    parsedProvider = null;
    parsedModel = '';
    handler = null;
    constructor(config) {
        this.config = config;
        if (isNewConfig(config)) {
            // Parse model string to extract provider and model name
            this.parsedProvider = parseProviderFromModel(config.model);
            this.parsedModel = extractModelName(config.model);
            if (!this.parsedProvider) {
                throw new Error(`Unsupported provider in model string: ${config.model}`);
            }
            // Check if test handler is provided
            if (config._testHandler) {
                this.handler = config._testHandler;
            }
            else {
                // Create real handler using HandlerRegistry
                this.handler = createHandler({
                    provider: this.parsedProvider,
                    apiKey: config.apiKey,
                    baseUrl: config.baseUrl,
                });
            }
        }
    }
    /**
     * Get the model name (extracted from model string)
     */
    getModel() {
        return this.parsedModel;
    }
    /**
     * Get the provider (extracted from model string)
     */
    getProvider() {
        return this.parsedProvider;
    }
    /**
     * Get the handler type (provider name)
     */
    getHandlerType() {
        return this.parsedProvider;
    }
    /**
     * Start the proxy server on an available port
     */
    async start() {
        if (this.server) {
            throw new Error('Proxy server is already running');
        }
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });
            // Track connections for graceful shutdown
            this.server.on('connection', (socket) => {
                this.connections.add(socket);
                socket.on('close', () => {
                    this.connections.delete(socket);
                });
            });
            // Determine which port to listen on
            const listenPort = isNewConfig(this.config) && this.config.port ? this.config.port : 0;
            // Listen on specified port (or 0 for auto-assign)
            this.server.listen(listenPort, this.address, () => {
                const addr = this.server.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                }
                resolve();
            });
            this.server.on('error', reject);
        });
    }
    /**
     * Shutdown the proxy server
     */
    async shutdown() {
        if (!this.server) {
            return;
        }
        return new Promise((resolve) => {
            // Destroy all active connections
            for (const socket of this.connections) {
                socket.destroy();
            }
            this.connections.clear();
            this.server.close(() => {
                this.server = null;
                this.port = 0;
                resolve();
            });
        });
    }
    /**
     * Get the port the server is listening on
     */
    getPort() {
        return this.port;
    }
    /**
     * Get the address the server is bound to
     */
    getAddress() {
        return this.address;
    }
    /**
     * Check if the server is running
     */
    isRunning() {
        return this.server !== null;
    }
    /**
     * Handle incoming HTTP request
     */
    handleRequest(req, res) {
        const url = req.url || '/';
        const method = req.method || 'GET';
        const pathname = url.split('?')[0]; // claude appends query strings (e.g. /v1/messages?beta=true)
        // Reachability probe: the Claude CLI sends `HEAD /` before any work; if it 404s, claude
        // concludes the endpoint/model is unavailable ("model may not exist"). Answer it.
        if (pathname === '/' && (method === 'HEAD' || method === 'GET')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
            return;
        }
        // Route GET /health
        if (pathname === '/health' && method === 'GET') {
            this.handleHealthRequest(res);
            return;
        }
        // Route /v1/messages (tolerate query strings)
        if (pathname === '/v1/messages') {
            if (method !== 'POST') {
                res.writeHead(405, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Method not allowed' }));
                return;
            }
            this.handleMessagesRequest(req, res);
            return;
        }
        // Unknown route
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
    /**
     * Handle GET /health request
     */
    async handleHealthRequest(res) {
        // Check handler health if method exists
        let healthy = true;
        if (this.handler && typeof this.handler.checkHealth === 'function') {
            healthy = await this.handler.checkHealth();
        }
        const statusCode = healthy ? 200 : 503;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            healthy,
            provider: this.parsedProvider,
            model: this.parsedModel,
        }));
    }
    /**
     * Handle POST /v1/messages request
     */
    /**
     * Append a one-line JSON record of a forwarded request to the file named by OSS_PROXY_LOG.
     * Opt-in only: when OSS_PROXY_LOG is unset this is a no-op (no default file, no disk growth).
     * Lets the eval prove a routed agent actually hit a given provider/model. Best-effort: any
     * failure is swallowed so logging never breaks routing.
     */
    logRequest(model) {
        const logPath = process.env.OSS_PROXY_LOG;
        if (!logPath)
            return;
        try {
            const provider = isNewConfig(this.config)
                ? this.parsedProvider
                : this.config.provider;
            const baseUrl = isNewConfig(this.config) ? this.config.baseUrl : undefined;
            const line = JSON.stringify({
                ts: new Date().toISOString(),
                provider,
                model: model ?? this.parsedModel,
                baseUrl,
            }) + '\n';
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.appendFileSync(logPath, line);
        }
        catch {
            /* observability must never break the proxy */
        }
    }
    /**
     * Stream an Anthropic SSE response. The Claude CLI always sends stream:true and will time out
     * (then retry in a loop) if it sees no bytes while the backend thinks. So we flush the opening
     * events IMMEDIATELY and emit keepalive pings during inference, then stream the result as a
     * single text_delta once the backend returns. Handles its own errors mid-stream (status 200
     * is already committed once streaming begins).
     */
    async streamSseResponse(res, requestBody) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        const send = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        // Flush opening events right away so the client sees bytes before the (slow) backend responds.
        send('message_start', {
            type: 'message_start',
            message: {
                id,
                type: 'message',
                role: 'assistant',
                model: requestBody.model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
            },
        });
        // Keepalive while the backend is thinking — prevents the client's idle/first-byte timeout.
        // (Content blocks follow once we know whether the model produced text or a tool_use.)
        const ping = setInterval(() => {
            try {
                send('ping', { type: 'ping' });
            }
            catch {
                /* connection closed */
            }
        }, 5000);
        try {
            const response = await this.handler.handle(requestBody);
            clearInterval(ping);
            // Emit each content block — text as text_delta, tool_use as input_json_delta — so the
            // Claude CLI can render text AND execute tool calls.
            const blocks = response.content.length > 0 ? response.content : [{ type: 'text', text: '' }];
            blocks.forEach((block, index) => {
                if (block.type === 'tool_use') {
                    send('content_block_start', {
                        type: 'content_block_start',
                        index,
                        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
                    });
                    send('content_block_delta', {
                        type: 'content_block_delta',
                        index,
                        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) },
                    });
                }
                else {
                    send('content_block_start', {
                        type: 'content_block_start',
                        index,
                        content_block: { type: 'text', text: '' },
                    });
                    send('content_block_delta', {
                        type: 'content_block_delta',
                        index,
                        delta: { type: 'text_delta', text: block.text ?? '' },
                    });
                }
                send('content_block_stop', { type: 'content_block_stop', index });
            });
            send('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: response.stop_reason ?? 'end_turn', stop_sequence: null },
                usage: { output_tokens: response.usage?.output_tokens ?? 0 },
            });
            send('message_stop', { type: 'message_stop' });
            res.end();
        }
        catch (error) {
            clearInterval(ping);
            // Status 200 is already committed — surface the failure as an SSE error event, then end.
            const message = error instanceof Error ? error.message : 'Unknown error';
            try {
                send('error', { type: 'error', error: { type: 'api_error', message } });
            }
            catch {
                /* connection closed */
            }
            res.end();
        }
    }
    handleMessagesRequest(req, res) {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', async () => {
            // Parse JSON body
            let requestBody;
            try {
                requestBody = JSON.parse(body);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
            // Force the proxy's configured model. Clients (e.g. a nested `claude -p` offload session)
            // cannot pass a foreign model id — the Claude CLI rejects unknown --model client-side — so
            // they send their default claude id. The proxy owns model selection and overrides it here,
            // otherwise the backend (Ollama) 404s on the wrong name. (live-proof finding)
            if (isNewConfig(this.config) && this.config.model) {
                requestBody.model = this.config.model;
            }
            // Observability: record every forwarded request so callers (e.g. the model-routing eval)
            // can VERIFY which model/provider actually served an agent. Never let logging break the proxy.
            this.logRequest(requestBody?.model);
            // If we have a handler (new config), forward to it
            if (this.handler) {
                if (requestBody.stream) {
                    // The Claude CLI always streams; flush opening events early + keepalive while the
                    // backend thinks, then stream the result. (handles its own errors mid-stream)
                    await this.streamSseResponse(res, requestBody);
                }
                else {
                    try {
                        const response = await this.handler.handle(requestBody);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(response));
                    }
                    catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: errorMessage }));
                    }
                }
                return;
            }
            // Legacy behavior: return placeholder response
            const providerName = isNewConfig(this.config)
                ? this.parsedProvider
                : this.config.provider;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                id: `msg_${generateId()}`,
                type: 'message',
                role: 'assistant',
                model: providerName,
                content: [
                    {
                        type: 'text',
                        text: `Proxy received request for provider: ${providerName}`,
                    },
                ],
                stop_reason: 'end_turn',
                usage: {
                    input_tokens: 0,
                    output_tokens: 0,
                },
            }));
        });
        req.on('error', () => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request error' }));
        });
    }
}
//# sourceMappingURL=model-proxy.js.map