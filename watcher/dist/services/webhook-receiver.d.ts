/**
 * WebhookReceiver
 *
 * HTTP server that receives GitHub webhook events.
 * Validates signatures, respects rate limits, and forwards valid events.
 *
 * Security features:
 * - HMAC-SHA256 signature validation with timing-safe comparison
 * - Fixed-window rate limiting (resets at window boundary, not sliding)
 * - Request body size limit (1MB) to prevent memory exhaustion
 * - Graceful shutdown with connection cleanup timeout
 */
/**
 * Configuration options for WebhookReceiver
 */
export interface WebhookReceiverConfig {
    /** Port to listen on (default: 3456) */
    port?: number;
    /** GitHub webhook secret for signature validation */
    webhookSecret: string;
    /** Rate limit window in milliseconds (default: 60000 = 1 minute) */
    rateLimitWindowMs?: number;
    /** Maximum requests per rate limit window (default: 10) */
    rateLimitMax?: number;
}
/**
 * Event handler callback type
 */
export type WebhookEventHandler = (payload: unknown) => void;
/**
 * WebhookReceiver - HTTP server for GitHub webhooks
 */
export declare class WebhookReceiver {
    private readonly port;
    private readonly webhookSecret;
    private readonly rateLimitWindowMs;
    private readonly rateLimitMax;
    private server;
    private running;
    private requestCount;
    private windowStart;
    private eventHandler;
    constructor(config: WebhookReceiverConfig);
    /**
     * Register an event handler for processed webhook events
     */
    onEvent(handler: WebhookEventHandler): void;
    /**
     * Start the HTTP server
     */
    start(): Promise<void>;
    /**
     * Stop the HTTP server with graceful shutdown
     * Forces connection cleanup after timeout to prevent hanging
     */
    stop(): Promise<void>;
    /**
     * Check if the server is currently running
     */
    isRunning(): boolean;
    /**
     * Get the configured port
     */
    getPort(): number;
    /**
     * Handle incoming HTTP requests
     */
    private handleRequest;
    /**
     * Handle webhook POST requests with signature validation
     */
    private handleWebhook;
    /**
     * Validate GitHub webhook signature using HMAC-SHA256
     * Uses timing-safe comparison to prevent timing attacks
     */
    private validateSignature;
    /**
     * Check if request is within rate limit (fixed-window algorithm)
     *
     * Note: Uses fixed-window, not sliding-window rate limiting.
     * This means the counter resets at window boundaries, so up to
     * 2x the limit could theoretically occur across a window boundary.
     * For webhook receivers, this is acceptable as it's simpler and O(1).
     *
     * @returns true if allowed, false if rate limited
     */
    private checkRateLimit;
}
//# sourceMappingURL=webhook-receiver.d.ts.map