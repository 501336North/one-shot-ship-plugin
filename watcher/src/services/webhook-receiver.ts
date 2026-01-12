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

import * as http from 'http';
import * as crypto from 'crypto';

/** Maximum request body size in bytes (1MB) */
const MAX_BODY_SIZE = 1024 * 1024;

/** Default timeout for graceful shutdown in milliseconds */
const SHUTDOWN_TIMEOUT_MS = 5000;

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
export class WebhookReceiver {
  private readonly port: number;
  private readonly webhookSecret: string;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitMax: number;
  private server: http.Server | null = null;
  private running = false;

  // Rate limiting state
  private requestCount = 0;
  private windowStart = Date.now();

  // Event handler
  private eventHandler: WebhookEventHandler | null = null;

  constructor(config: WebhookReceiverConfig) {
    this.port = config.port ?? 3456;
    this.webhookSecret = config.webhookSecret;
    this.rateLimitWindowMs = config.rateLimitWindowMs ?? 60000; // 1 minute default
    this.rateLimitMax = config.rateLimitMax ?? 10; // 10 requests per window
  }

  /**
   * Register an event handler for processed webhook events
   */
  onEvent(handler: WebhookEventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    // Reset rate limiting state on start
    this.requestCount = 0;
    this.windowStart = Date.now();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        this.running = false;
        reject(err);
      });

      this.server.listen(this.port, () => {
        this.running = true;
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server with graceful shutdown
   * Forces connection cleanup after timeout to prevent hanging
   */
  async stop(): Promise<void> {
    if (!this.server || !this.running) {
      this.running = false;
      return;
    }

    const server = this.server;

    return new Promise((resolve) => {
      // Force close connections after timeout
      const forceTimeout = setTimeout(() => {
        // closeAllConnections available in Node.js 18.2+
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }, SHUTDOWN_TIMEOUT_MS);

      server.close(() => {
        clearTimeout(forceTimeout);
        this.running = false;
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Check if the server is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the configured port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || '/';

    // Health check endpoint
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Webhook endpoint
    if (url === '/webhook' && req.method === 'POST') {
      // Check rate limit before processing webhook
      if (!this.checkRateLimit()) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
        return;
      }
      this.handleWebhook(req, res);
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  /**
   * Handle webhook POST requests with signature validation
   */
  private handleWebhook(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;

      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf8');
      const signature = req.headers['x-hub-signature-256'] as string | undefined;
      const eventType = req.headers['x-github-event'] as string | undefined;

      // Validate signature
      if (!this.validateSignature(body, signature)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // Only process pull_request_review events
      if (eventType === 'pull_request_review' && this.eventHandler) {
        try {
          const payload = JSON.parse(body);
          this.eventHandler(payload);
        } catch {
          // Ignore JSON parse errors - still return 200
        }
      }

      // Valid request - always return 200 for authenticated requests
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'received' }));
    });

    req.on('error', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad request' }));
    });
  }

  /**
   * Validate GitHub webhook signature using HMAC-SHA256
   * Uses timing-safe comparison to prevent timing attacks
   */
  private validateSignature(payload: string, signature: string | undefined): boolean {
    if (!signature) {
      return false;
    }

    // Extract the hash from the signature (format: sha256=<hash>)
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const expectedHash = signature.substring(7);

    // Compute the expected signature
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(payload, 'utf8');
    const computedHash = hmac.digest('hex');

    // Timing-safe comparison
    try {
      const expectedBuffer = Buffer.from(expectedHash, 'hex');
      const computedBuffer = Buffer.from(computedHash, 'hex');

      if (expectedBuffer.length !== computedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
    } catch {
      // Invalid hex in signature
      return false;
    }
  }

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
  private checkRateLimit(): boolean {
    const now = Date.now();

    // Check if we're in a new window
    if (now - this.windowStart >= this.rateLimitWindowMs) {
      // Reset the window
      this.windowStart = now;
      this.requestCount = 0;
    }

    // Check if we've exceeded the limit
    if (this.requestCount >= this.rateLimitMax) {
      return false;
    }

    // Increment counter and allow request
    this.requestCount++;
    return true;
  }
}
