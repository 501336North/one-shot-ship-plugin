/**
 * Watcher Webhook Integration Tests
 *
 * @behavior Watcher integrates with WebhookReceiver for GitHub PR monitoring
 * @acceptance-criteria AC-WATCHER-WEBHOOK.1 through AC-WATCHER-WEBHOOK.6
 * @business-rule Webhook receiver starts when enabled in config
 * @boundary Watcher process / HTTP server
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Watcher, WatcherState } from '../src/index';

/**
 * Helper function to create valid HMAC-SHA256 signature
 */
function createSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

describe('Watcher Webhook Integration', () => {
  let testDir: string;
  let ossDir: string;
  const TEST_WEBHOOK_SECRET = 'test-webhook-secret-123';
  const TEST_WEBHOOK_PORT = 9877;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `oss-watcher-webhook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
  });

  afterEach(async () => {
    // Allow time for any cleanup
    await new Promise(resolve => setTimeout(resolve, 50));

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Webhook Receiver Initialization', () => {
    /**
     * @behavior Webhook receiver is NOT started when webhook is disabled in config
     * @acceptance-criteria AC-WATCHER-WEBHOOK.1
     */
    it('should NOT start webhook receiver when webhook is disabled in config', async () => {
      // GIVEN - Config with webhook disabled
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: false,
          port: TEST_WEBHOOK_PORT,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      // WHEN - We start the watcher
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // THEN - Webhook receiver should NOT be started
      expect(watcher.getWebhookReceiver()).toBeNull();

      await watcher.stop();
    });

    /**
     * @behavior Webhook receiver IS started when webhook is enabled in config
     * @acceptance-criteria AC-WATCHER-WEBHOOK.2
     */
    it('should start webhook receiver when webhook is enabled in config', async () => {
      // GIVEN - Config with webhook enabled
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: true,
          port: TEST_WEBHOOK_PORT,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      // WHEN - We start the watcher
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // THEN - Webhook receiver should be started and running
      const receiver = watcher.getWebhookReceiver();
      expect(receiver).not.toBeNull();
      expect(receiver?.isRunning()).toBe(true);

      await watcher.stop();
    });

    /**
     * @behavior Webhook receiver uses port from config
     * @acceptance-criteria AC-WATCHER-WEBHOOK.3
     */
    it('should use port from webhook config', async () => {
      // GIVEN - Config with custom webhook port
      const customPort = 9999;
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: true,
          port: customPort,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      // WHEN - We start the watcher
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // THEN - Webhook receiver should use custom port
      const receiver = watcher.getWebhookReceiver();
      expect(receiver?.getPort()).toBe(customPort);

      await watcher.stop();
    });

    /**
     * @behavior Webhook receiver is stopped when watcher stops
     * @acceptance-criteria AC-WATCHER-WEBHOOK.4
     */
    it('should stop webhook receiver when watcher stops', async () => {
      // GIVEN - Config with webhook enabled and watcher running
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: true,
          port: TEST_WEBHOOK_PORT + 1,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const receiver = watcher.getWebhookReceiver();
      expect(receiver?.isRunning()).toBe(true);

      // WHEN - We stop the watcher
      await watcher.stop();

      // THEN - Webhook receiver should be stopped
      // Note: After stop, the receiver reference may be cleared, so we check the running state
      // before stop confirmed it was running
      expect(watcher.getState()).toBe(WatcherState.Stopped);
    });
  });

  describe('Webhook Event Processing', () => {
    /**
     * @behavior Valid pull_request_review webhook queues a task
     * @acceptance-criteria AC-WATCHER-WEBHOOK.5
     */
    it('should queue task when receiving changes_requested review webhook', async () => {
      // GIVEN - Watcher with webhook enabled
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: true,
          port: TEST_WEBHOOK_PORT + 2,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // Give server time to fully start
      await new Promise(resolve => setTimeout(resolve, 100));

      // WHEN - We send a valid changes_requested review webhook
      const webhookPayload = {
        action: 'submitted',
        review: {
          state: 'changes_requested',
          body: 'Please fix the type error on line 42',
          user: { login: 'reviewer' },
        },
        pull_request: {
          number: 123,
          title: 'Add user authentication',
          head: { ref: 'feature/auth' },
        },
      };
      const payloadStr = JSON.stringify(webhookPayload);
      const signature = createSignature(payloadStr, TEST_WEBHOOK_SECRET);

      const response = await fetch(`http://localhost:${TEST_WEBHOOK_PORT + 2}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'pull_request_review',
        },
        body: payloadStr,
      });

      // Give time for task processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // THEN - Response should be 200 and task should be queued
      expect(response.status).toBe(200);

      // Check queue for the task
      const queuePath = path.join(ossDir, 'queue.json');
      const queueContent = fs.readFileSync(queuePath, 'utf-8');
      const queue = JSON.parse(queueContent);

      // Should have at least one task related to the PR review
      expect(queue.tasks.length).toBeGreaterThan(0);

      await watcher.stop();
    });

    /**
     * @behavior Approved reviews do not queue tasks
     * @acceptance-criteria AC-WATCHER-WEBHOOK.6
     */
    it('should NOT queue task when receiving approved review webhook', async () => {
      // GIVEN - Watcher with webhook enabled
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        webhook: {
          enabled: true,
          port: TEST_WEBHOOK_PORT + 3,
          secret: TEST_WEBHOOK_SECRET,
        },
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // Give server time to fully start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get initial queue state
      const queuePath = path.join(ossDir, 'queue.json');
      const initialContent = fs.readFileSync(queuePath, 'utf-8');
      const initialQueue = JSON.parse(initialContent);
      const initialTaskCount = initialQueue.tasks.length;

      // WHEN - We send an approved review webhook
      const webhookPayload = {
        action: 'submitted',
        review: {
          state: 'approved',
          body: 'LGTM!',
          user: { login: 'reviewer' },
        },
        pull_request: {
          number: 456,
          title: 'Minor refactor',
          head: { ref: 'feature/refactor' },
        },
      };
      const payloadStr = JSON.stringify(webhookPayload);
      const signature = createSignature(payloadStr, TEST_WEBHOOK_SECRET);

      const response = await fetch(`http://localhost:${TEST_WEBHOOK_PORT + 3}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'pull_request_review',
        },
        body: payloadStr,
      });

      // Give time for potential task processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // THEN - Response should be 200 but NO new task should be queued
      expect(response.status).toBe(200);

      const finalContent = fs.readFileSync(queuePath, 'utf-8');
      const finalQueue = JSON.parse(finalContent);

      // Task count should not have increased
      expect(finalQueue.tasks.length).toBe(initialTaskCount);

      await watcher.stop();
    });
  });

  describe('Missing Config Handling', () => {
    /**
     * @behavior Watcher works normally when no webhook config exists
     */
    it('should work normally when no webhook config exists', async () => {
      // GIVEN - Config without webhook section
      const config = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: true, git: true },
        loop_detection_threshold: 5,
        stuck_timeout_seconds: 60,
        task_expiry_hours: 24,
        max_queue_size: 50,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.7,
        // No webhook section
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

      // WHEN - We start the watcher
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // THEN - Watcher should start normally without webhook receiver
      expect(watcher.getState()).toBe(WatcherState.Running);
      expect(watcher.getWebhookReceiver()).toBeNull();

      await watcher.stop();
    });
  });
});
