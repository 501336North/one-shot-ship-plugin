/**
 * WebhookReceiver Tests
 *
 * @behavior Receives GitHub webhooks via HTTP server
 * @acceptance-criteria Server starts on configurable port, validates requests, respects rate limits
 * @business-rule Only authenticated webhook requests from GitHub are processed
 * @boundary HTTP Server / External API
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { WebhookReceiver } from '../../src/services/webhook-receiver.js';

/**
 * Helper function to create valid HMAC-SHA256 signature
 */
function createSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

describe('WebhookReceiver', () => {
  let receiver: WebhookReceiver;
  const TEST_PORT = 9876;
  const TEST_SECRET = 'test-webhook-secret';

  beforeEach(() => {
    receiver = new WebhookReceiver({
      port: TEST_PORT,
      webhookSecret: TEST_SECRET,
    });
  });

  afterEach(async () => {
    if (receiver.isRunning()) {
      await receiver.stop();
    }
  });

  describe('Server Lifecycle', () => {
    /**
     * @behavior Server starts and listens on configured port
     */
    it('should start the HTTP server on configured port', async () => {
      // WHEN - We start the receiver
      await receiver.start();

      // THEN - Server should be running
      expect(receiver.isRunning()).toBe(true);
    });

    /**
     * @behavior Server stops gracefully
     */
    it('should stop the HTTP server', async () => {
      // GIVEN - Server is running
      await receiver.start();
      expect(receiver.isRunning()).toBe(true);

      // WHEN - We stop the receiver
      await receiver.stop();

      // THEN - Server should no longer be running
      expect(receiver.isRunning()).toBe(false);
    });

    /**
     * @behavior isRunning returns false before start
     */
    it('should report not running before start', () => {
      // WHEN - We check status before starting
      const running = receiver.isRunning();

      // THEN - Should not be running
      expect(running).toBe(false);
    });

    /**
     * @behavior Server can be restarted after stopping
     */
    it('should allow restart after stop', async () => {
      // GIVEN - Server started and stopped
      await receiver.start();
      await receiver.stop();
      expect(receiver.isRunning()).toBe(false);

      // WHEN - We start again
      await receiver.start();

      // THEN - Should be running
      expect(receiver.isRunning()).toBe(true);
    });
  });

  describe('Health Endpoint', () => {
    /**
     * @behavior /health endpoint returns 200 OK
     */
    it('should respond with 200 on /health endpoint', async () => {
      // GIVEN - Server is running
      await receiver.start();

      // WHEN - We call the health endpoint
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);

      // THEN - Should return 200 OK
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'ok' });
    });

    /**
     * @behavior /health endpoint returns 503 when server not fully ready
     * (This tests the edge case - health should work even if no webhook secret configured)
     */
    it('should return health status with server info', async () => {
      // GIVEN - Server is running
      await receiver.start();

      // WHEN - We call the health endpoint
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      const body = await response.json();

      // THEN - Should include status
      expect(body.status).toBe('ok');
    });
  });

  describe('Configuration', () => {
    /**
     * @behavior Uses default port when not specified
     */
    it('should use default port 3456 when not specified', () => {
      // WHEN - We create receiver without port
      const defaultReceiver = new WebhookReceiver({
        webhookSecret: TEST_SECRET,
      });

      // THEN - Should have default port
      expect(defaultReceiver.getPort()).toBe(3456);
    });

    /**
     * @behavior Uses configured port
     */
    it('should use configured port', () => {
      // WHEN - We create receiver with custom port
      const customReceiver = new WebhookReceiver({
        port: 8080,
        webhookSecret: TEST_SECRET,
      });

      // THEN - Should use custom port
      expect(customReceiver.getPort()).toBe(8080);
    });
  });

  describe('Webhook Signature Validation', () => {
    const WEBHOOK_PATH = '/webhook';

    /**
     * @behavior Rejects requests without X-Hub-Signature-256 header
     */
    it('should reject requests without signature header with 401', async () => {
      // GIVEN - Server is running
      await receiver.start();
      const payload = JSON.stringify({ action: 'opened' });

      // WHEN - We send request without signature
      const response = await fetch(`http://localhost:${TEST_PORT}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: payload,
      });

      // THEN - Should return 401 Unauthorized
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('signature');
    });

    /**
     * @behavior Rejects requests with invalid signature
     */
    it('should reject requests with invalid signature with 401', async () => {
      // GIVEN - Server is running
      await receiver.start();
      const payload = JSON.stringify({ action: 'opened' });
      const invalidSignature = 'sha256=invalid_signature_here';

      // WHEN - We send request with invalid signature
      const response = await fetch(`http://localhost:${TEST_PORT}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': invalidSignature,
        },
        body: payload,
      });

      // THEN - Should return 401 Unauthorized
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toContain('signature');
    });

    /**
     * @behavior Accepts requests with valid signature
     */
    it('should accept requests with valid signature', async () => {
      // GIVEN - Server is running
      await receiver.start();
      const payload = JSON.stringify({ action: 'opened', pull_request: { number: 1 } });
      const validSignature = createSignature(payload, TEST_SECRET);

      // WHEN - We send request with valid signature
      const response = await fetch(`http://localhost:${TEST_PORT}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': validSignature,
        },
        body: payload,
      });

      // THEN - Should return 200 OK
      expect(response.status).toBe(200);
    });

    /**
     * @behavior Uses timing-safe comparison for signature validation
     * (This is tested implicitly - correct signature passes, incorrect fails)
     */
    it('should reject modified payload even with original signature', async () => {
      // GIVEN - Server is running
      await receiver.start();
      const originalPayload = JSON.stringify({ action: 'opened' });
      const modifiedPayload = JSON.stringify({ action: 'closed' });
      const signature = createSignature(originalPayload, TEST_SECRET);

      // WHEN - We send modified payload with original signature
      const response = await fetch(`http://localhost:${TEST_PORT}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
        },
        body: modifiedPayload,
      });

      // THEN - Should reject
      expect(response.status).toBe(401);
    });

    /**
     * @behavior Rejects requests with wrong secret
     */
    it('should reject requests signed with wrong secret', async () => {
      // GIVEN - Server is running
      await receiver.start();
      const payload = JSON.stringify({ action: 'opened' });
      const wrongSecretSignature = createSignature(payload, 'wrong-secret');

      // WHEN - We send request with wrong secret signature
      const response = await fetch(`http://localhost:${TEST_PORT}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': wrongSecretSignature,
        },
        body: payload,
      });

      // THEN - Should return 401 Unauthorized
      expect(response.status).toBe(401);
    });
  });

  describe('Event Type Filtering', () => {
    const WEBHOOK_PATH = '/webhook';

    /**
     * Helper to send a webhook request with event type header
     */
    async function sendWebhookWithEvent(
      port: number,
      secret: string,
      eventType: string,
      payload: object
    ): Promise<Response> {
      const payloadStr = JSON.stringify(payload);
      const signature = createSignature(payloadStr, secret);
      return fetch(`http://localhost:${port}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': eventType,
        },
        body: payloadStr,
      });
    }

    /**
     * @behavior Only processes pull_request_review events
     */
    it('should process pull_request_review events', async () => {
      // GIVEN - Server is running with an event handler
      const processedEvents: object[] = [];
      receiver.onEvent((payload) => {
        processedEvents.push(payload);
      });
      await receiver.start();
      const payload = {
        action: 'submitted',
        review: { state: 'changes_requested', body: 'Fix this' },
        pull_request: { number: 1 },
      };

      // WHEN - We send a pull_request_review event
      const response = await sendWebhookWithEvent(TEST_PORT, TEST_SECRET, 'pull_request_review', payload);

      // THEN - Should return 200 and process the event
      expect(response.status).toBe(200);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0]).toEqual(payload);
    });

    /**
     * @behavior Ignores push events (returns 200 but doesn't process)
     */
    it('should ignore push events', async () => {
      // GIVEN - Server is running with an event handler
      const processedEvents: object[] = [];
      receiver.onEvent((payload) => {
        processedEvents.push(payload);
      });
      await receiver.start();
      const payload = { ref: 'refs/heads/main', commits: [] };

      // WHEN - We send a push event
      const response = await sendWebhookWithEvent(TEST_PORT, TEST_SECRET, 'push', payload);

      // THEN - Should return 200 but NOT process the event
      expect(response.status).toBe(200);
      expect(processedEvents.length).toBe(0);
    });

    /**
     * @behavior Ignores issue events (returns 200 but doesn't process)
     */
    it('should ignore issue events', async () => {
      // GIVEN - Server is running with an event handler
      const processedEvents: object[] = [];
      receiver.onEvent((payload) => {
        processedEvents.push(payload);
      });
      await receiver.start();
      const payload = { action: 'opened', issue: { number: 1 } };

      // WHEN - We send an issue event
      const response = await sendWebhookWithEvent(TEST_PORT, TEST_SECRET, 'issues', payload);

      // THEN - Should return 200 but NOT process the event
      expect(response.status).toBe(200);
      expect(processedEvents.length).toBe(0);
    });

    /**
     * @behavior Ignores pull_request events (different from pull_request_review)
     */
    it('should ignore pull_request events', async () => {
      // GIVEN - Server is running with an event handler
      const processedEvents: object[] = [];
      receiver.onEvent((payload) => {
        processedEvents.push(payload);
      });
      await receiver.start();
      const payload = { action: 'opened', pull_request: { number: 1 } };

      // WHEN - We send a pull_request event (not pull_request_review)
      const response = await sendWebhookWithEvent(TEST_PORT, TEST_SECRET, 'pull_request', payload);

      // THEN - Should return 200 but NOT process the event
      expect(response.status).toBe(200);
      expect(processedEvents.length).toBe(0);
    });

    /**
     * @behavior Still processes event when no handler is registered
     */
    it('should return 200 even without event handler', async () => {
      // GIVEN - Server is running WITHOUT an event handler
      await receiver.start();
      const payload = {
        action: 'submitted',
        review: { state: 'changes_requested' },
        pull_request: { number: 1 },
      };

      // WHEN - We send a pull_request_review event
      const response = await sendWebhookWithEvent(TEST_PORT, TEST_SECRET, 'pull_request_review', payload);

      // THEN - Should still return 200
      expect(response.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    const WEBHOOK_PATH = '/webhook';
    const RATE_LIMIT = 10; // 10 requests per minute

    /**
     * Helper to send a valid webhook request
     */
    async function sendValidWebhook(port: number, secret: string): Promise<Response> {
      const payload = JSON.stringify({ action: 'opened', timestamp: Date.now() });
      const signature = createSignature(payload, secret);
      return fetch(`http://localhost:${port}${WEBHOOK_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
        },
        body: payload,
      });
    }

    /**
     * @behavior Allows requests within rate limit
     */
    it('should allow requests within rate limit', async () => {
      // GIVEN - Server is running
      await receiver.start();

      // WHEN - We send requests within the limit
      const responses: Response[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await sendValidWebhook(TEST_PORT, TEST_SECRET);
        responses.push(response);
      }

      // THEN - All requests should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
      }
    });

    /**
     * @behavior Returns 429 when rate limit exceeded
     */
    it('should return 429 when rate limit exceeded', async () => {
      // GIVEN - Server with low rate limit for reliable testing
      const limitedReceiver = new WebhookReceiver({
        port: TEST_PORT + 3,
        webhookSecret: TEST_SECRET,
        rateLimitMax: 3, // Low limit for faster test
      });
      await limitedReceiver.start();

      try {
        // WHEN - We send more requests than the limit
        const responses: Response[] = [];
        for (let i = 0; i < 5; i++) {
          const response = await sendValidWebhook(TEST_PORT + 3, TEST_SECRET);
          responses.push(response);
        }

        // THEN - First 3 should succeed, rest should be rate limited
        expect(responses[0].status).toBe(200);
        expect(responses[1].status).toBe(200);
        expect(responses[2].status).toBe(200);
        expect(responses[3].status).toBe(429);
        expect(responses[4].status).toBe(429);

        // Verify response body
        const body = await responses[3].json();
        expect(body.error.toLowerCase()).toContain('rate');
      } finally {
        await limitedReceiver.stop();
      }
    });

    /**
     * @behavior Rate limit resets after window expires
     */
    it('should reset rate limit after window expires', async () => {
      // GIVEN - Server with short rate limit window for testing
      const shortWindowReceiver = new WebhookReceiver({
        port: TEST_PORT + 1,
        webhookSecret: TEST_SECRET,
        rateLimitWindowMs: 100, // 100ms window for testing
        rateLimitMax: 2,        // Only 2 requests per window
      });

      await shortWindowReceiver.start();

      try {
        // WHEN - We exceed the limit
        await sendValidWebhook(TEST_PORT + 1, TEST_SECRET);
        await sendValidWebhook(TEST_PORT + 1, TEST_SECRET);
        const blocked = await sendValidWebhook(TEST_PORT + 1, TEST_SECRET);
        expect(blocked.status).toBe(429);

        // Wait for window to expire
        await new Promise(resolve => setTimeout(resolve, 150));

        // THEN - New requests should be allowed
        const afterReset = await sendValidWebhook(TEST_PORT + 1, TEST_SECRET);
        expect(afterReset.status).toBe(200);
      } finally {
        await shortWindowReceiver.stop();
      }
    });

    /**
     * @behavior Rate limit applies per-endpoint
     * Health endpoint should not count against webhook rate limit
     */
    it('should not count health checks against rate limit', async () => {
      // GIVEN - Server with low rate limit
      const lowLimitReceiver = new WebhookReceiver({
        port: TEST_PORT + 2,
        webhookSecret: TEST_SECRET,
        rateLimitMax: 2,
      });

      await lowLimitReceiver.start();

      try {
        // WHEN - We make health checks and webhook requests
        await fetch(`http://localhost:${TEST_PORT + 2}/health`);
        await fetch(`http://localhost:${TEST_PORT + 2}/health`);
        await fetch(`http://localhost:${TEST_PORT + 2}/health`);

        // THEN - Webhook requests should still work
        const webhookResponse = await sendValidWebhook(TEST_PORT + 2, TEST_SECRET);
        expect(webhookResponse.status).toBe(200);
      } finally {
        await lowLimitReceiver.stop();
      }
    });
  });

  describe('Body Size Limit', () => {
    /**
     * @behavior Returns 413 when request body exceeds 1MB limit
     */
    it('should return 413 for oversized payloads', async () => {
      // GIVEN - Server is running
      await receiver.start();

      // WHEN - We send a payload larger than 1MB
      const largePayload = 'x'.repeat(1024 * 1024 + 100); // Just over 1MB
      const signature = createSignature(largePayload, TEST_SECRET);

      const response = await fetch(`http://localhost:${TEST_PORT}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
        },
        body: largePayload,
      });

      // THEN - Should return 413 Payload Too Large
      expect(response.status).toBe(413);
      const body = await response.json();
      expect(body.error).toContain('too large');
    });

    /**
     * @behavior Accepts payloads under 1MB limit
     */
    it('should accept payloads under size limit', async () => {
      // GIVEN - Server is running
      await receiver.start();

      // WHEN - We send a payload under 1MB
      const validPayload = JSON.stringify({ data: 'x'.repeat(1000) });
      const signature = createSignature(validPayload, TEST_SECRET);

      const response = await fetch(`http://localhost:${TEST_PORT}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
        },
        body: validPayload,
      });

      // THEN - Should return 200
      expect(response.status).toBe(200);
    });
  });
});
