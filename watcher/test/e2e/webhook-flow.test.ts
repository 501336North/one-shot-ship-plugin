/**
 * E2E Webhook Flow Tests
 *
 * @behavior Complete flow from webhook reception to task queue and Telegram notification
 * @acceptance-criteria Full integration test of webhook -> task queue -> notification pipeline
 * @business-rule PR review webhooks result in queued tasks and Telegram notifications
 * @boundary System boundary test (HTTP webhook -> queue.json -> Telegram API)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Watcher, WatcherState } from '../../src/index';
import { TelegramNotifier } from '../../src/services/telegram-notifier';

/**
 * Helper function to create valid HMAC-SHA256 signature
 */
function createSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Mock fetch for Telegram notifications - but NOT for webhook HTTP calls
 */
const mockFetch = vi.fn();

describe('E2E: Webhook to Task Queue Flow', () => {
  let testDir: string;
  let ossDir: string;
  const TEST_WEBHOOK_SECRET = 'e2e-test-secret-456';
  const TEST_WEBHOOK_PORT = 9890;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `oss-e2e-webhook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
  });

  afterEach(async () => {
    // Allow time for cleanup
    await new Promise(resolve => setTimeout(resolve, 50));

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior Full E2E: Webhook received -> Task queued -> Queue contains correct data
   * @acceptance-criteria E2E-WEBHOOK.1
   */
  it('should complete full flow: webhook -> task queue', async () => {
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
        port: TEST_WEBHOOK_PORT,
        secret: TEST_WEBHOOK_SECRET,
      },
    };
    fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

    const watcher = new Watcher(ossDir, 'test-api-key');
    await watcher.start();

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // WHEN - We send a changes_requested review webhook
    const webhookPayload = {
      action: 'submitted',
      review: {
        state: 'changes_requested',
        body: 'Please fix the type error in the authentication module',
        user: { login: 'senior-dev' },
      },
      pull_request: {
        number: 42,
        title: 'Add OAuth2 authentication',
        head: { ref: 'feature/oauth2' },
      },
    };
    const payloadStr = JSON.stringify(webhookPayload);
    const signature = createSignature(payloadStr, TEST_WEBHOOK_SECRET);

    const response = await fetch(`http://localhost:${TEST_WEBHOOK_PORT}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'pull_request_review',
      },
      body: payloadStr,
    });

    // Give time for task processing
    await new Promise(resolve => setTimeout(resolve, 150));

    // THEN - Response should be 200
    expect(response.status).toBe(200);

    // AND - Queue should contain a task with correct data
    const queuePath = path.join(ossDir, 'queue.json');
    const queueContent = fs.readFileSync(queuePath, 'utf-8');
    const queue = JSON.parse(queueContent);

    expect(queue.tasks.length).toBe(1);
    const task = queue.tasks[0];

    // Verify task structure
    expect(task.id).toMatch(/^task-/);
    expect(task.priority).toBe('high');
    expect(task.source).toBe('git-monitor');
    expect(task.anomaly_type).toBe('pr_check_failed');
    expect(task.prompt).toContain('type error');
    expect(task.suggested_agent).toBe('typescript-pro'); // Because "type" is in the body
    expect(task.context.pr_number).toBe(42);
    expect(task.context.branch).toBe('feature/oauth2');
    expect(task.status).toBe('pending');

    await watcher.stop();
  });

  /**
   * @behavior Task queue persists across multiple webhooks
   * @acceptance-criteria E2E-WEBHOOK.2
   */
  it('should accumulate tasks from multiple webhooks', async () => {
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
        port: TEST_WEBHOOK_PORT + 1,
        secret: TEST_WEBHOOK_SECRET,
      },
    };
    fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(config));

    const watcher = new Watcher(ossDir, 'test-api-key');
    await watcher.start();

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // WHEN - We send multiple changes_requested webhooks
    const webhooks = [
      {
        action: 'submitted',
        review: {
          state: 'changes_requested',
          body: 'Add more test coverage',
          user: { login: 'reviewer1' },
        },
        pull_request: {
          number: 100,
          title: 'Feature A',
          head: { ref: 'feature/a' },
        },
      },
      {
        action: 'submitted',
        review: {
          state: 'changes_requested',
          body: 'Security vulnerability found',
          user: { login: 'reviewer2' },
        },
        pull_request: {
          number: 101,
          title: 'Feature B',
          head: { ref: 'feature/b' },
        },
      },
    ];

    for (const webhook of webhooks) {
      const payloadStr = JSON.stringify(webhook);
      const signature = createSignature(payloadStr, TEST_WEBHOOK_SECRET);

      await fetch(`http://localhost:${TEST_WEBHOOK_PORT + 1}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'pull_request_review',
        },
        body: payloadStr,
      });

      // Small delay between webhooks
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Give time for task processing
    await new Promise(resolve => setTimeout(resolve, 150));

    // THEN - Queue should contain both tasks
    const queuePath = path.join(ossDir, 'queue.json');
    const queueContent = fs.readFileSync(queuePath, 'utf-8');
    const queue = JSON.parse(queueContent);

    expect(queue.tasks.length).toBe(2);

    // Verify different suggested agents based on content
    const prNumbers = queue.tasks.map((t: { context: { pr_number: number } }) => t.context.pr_number);
    expect(prNumbers).toContain(100);
    expect(prNumbers).toContain(101);

    // First task should suggest test-engineer (mentions "test")
    const testTask = queue.tasks.find((t: { context: { pr_number: number } }) => t.context.pr_number === 100);
    expect(testTask.suggested_agent).toBe('test-engineer');

    // Second task should suggest security-auditor (mentions "security")
    const securityTask = queue.tasks.find((t: { context: { pr_number: number } }) => t.context.pr_number === 101);
    expect(securityTask.suggested_agent).toBe('security-auditor');

    await watcher.stop();
  });

  /**
   * @behavior Invalid signature webhooks do NOT queue tasks
   * @acceptance-criteria E2E-WEBHOOK.3
   */
  it('should NOT queue tasks from invalid signature webhooks', async () => {
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

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get initial task count
    const queuePath = path.join(ossDir, 'queue.json');
    const initialContent = fs.readFileSync(queuePath, 'utf-8');
    const initialQueue = JSON.parse(initialContent);
    const initialTaskCount = initialQueue.tasks.length;

    // WHEN - We send a webhook with INVALID signature
    const webhookPayload = {
      action: 'submitted',
      review: {
        state: 'changes_requested',
        body: 'This should not be queued',
        user: { login: 'attacker' },
      },
      pull_request: {
        number: 999,
        title: 'Malicious PR',
        head: { ref: 'attack/branch' },
      },
    };
    const payloadStr = JSON.stringify(webhookPayload);
    const invalidSignature = 'sha256=invalid_signature_here';

    const response = await fetch(`http://localhost:${TEST_WEBHOOK_PORT + 2}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': invalidSignature,
        'X-GitHub-Event': 'pull_request_review',
      },
      body: payloadStr,
    });

    // Give time for potential task processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // THEN - Response should be 401
    expect(response.status).toBe(401);

    // AND - No new tasks should be queued
    const finalContent = fs.readFileSync(queuePath, 'utf-8');
    const finalQueue = JSON.parse(finalContent);
    expect(finalQueue.tasks.length).toBe(initialTaskCount);

    await watcher.stop();
  });

  /**
   * @behavior Rate limited webhooks return 429 and do NOT queue tasks
   * @acceptance-criteria E2E-WEBHOOK.4
   */
  it('should return 429 and not queue tasks when rate limited', async () => {
    // GIVEN - Watcher with webhook enabled (default rate limit is 10/minute)
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

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // WHEN - We send more than 10 webhooks rapidly
    const responses: Response[] = [];
    for (let i = 0; i < 15; i++) {
      const webhook = {
        action: 'submitted',
        review: {
          state: 'changes_requested',
          body: `Review ${i}`,
          user: { login: `reviewer${i}` },
        },
        pull_request: {
          number: 200 + i,
          title: `PR ${i}`,
          head: { ref: `feature/${i}` },
        },
      };
      const payloadStr = JSON.stringify(webhook);
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
      responses.push(response);
    }

    // Give time for task processing
    await new Promise(resolve => setTimeout(resolve, 150));

    // THEN - First 10 should succeed (200), rest should be rate limited (429)
    const successCount = responses.filter(r => r.status === 200).length;
    const rateLimitedCount = responses.filter(r => r.status === 429).length;

    expect(successCount).toBe(10);
    expect(rateLimitedCount).toBe(5);

    // AND - Only 10 tasks should be queued (rate limited ones are not)
    const queuePath = path.join(ossDir, 'queue.json');
    const queueContent = fs.readFileSync(queuePath, 'utf-8');
    const queue = JSON.parse(queueContent);
    expect(queue.tasks.length).toBe(10);

    await watcher.stop();
  });
});

describe('TelegramNotifier Integration', () => {
  let notifier: TelegramNotifier;
  const TEST_BRIDGE_URL = 'http://localhost:3737';

  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    notifier = new TelegramNotifier(TEST_BRIDGE_URL);
    global.fetch = mockFetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /**
   * @behavior TelegramNotifier sends formatted PR review notifications
   * @acceptance-criteria E2E-TELEGRAM.1
   */
  it('should send formatted notification for PR review', async () => {
    // GIVEN - A mock successful response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    // WHEN - We send a PR review notification
    await notifier.sendPRReviewNotification({
      prNumber: 123,
      prTitle: 'Add feature X',
      reviewerName: 'alice',
      reviewBody: 'Please fix the bug',
    });

    // THEN - Fetch should have been called with correct parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BRIDGE_URL}/api/notify`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    // Verify message content
    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.message).toContain('Changes Requested');
    expect(body.message).toContain('PR #123');
    expect(body.message).toContain('Add feature X');
    expect(body.message).toContain('alice');
    expect(body.message).toContain('Please fix the bug');
  });

  /**
   * @behavior TelegramNotifier handles HTTP errors gracefully
   * @acceptance-criteria E2E-TELEGRAM.2
   */
  it('should throw error on HTTP failure', async () => {
    // GIVEN - A mock error response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    // WHEN/THEN - Should throw an error
    await expect(
      notifier.sendPRReviewNotification({
        prNumber: 1,
        prTitle: 'Test',
        reviewerName: 'tester',
        reviewBody: 'Test body',
      })
    ).rejects.toThrow('Telegram notification failed');
  });
});
