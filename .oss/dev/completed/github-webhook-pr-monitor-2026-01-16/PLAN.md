# Implementation Plan: GitHub Webhook PR Monitor

**Feature:** Real-time GitHub webhook integration for PR change-request monitoring
**Location:** `/Users/ysl/dev/one-shot-ship-plugin/watcher/`
**Method:** London-style TDD (Outside-In)

---

## Phase 1: Webhook Receiver Foundation

**Objective:** Create the HTTP server that receives GitHub webhooks

### Task 1.1: WebhookReceiver Class Structure
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
// test/services/webhook-receiver.test.ts
describe('WebhookReceiver', () => {
  it('should start server on specified port', async () => {
    // GIVEN - Mock dependencies
    const mockPRMonitor = mock<PRMonitorAgent>();
    const receiver = new WebhookReceiver(3838, 'secret', mockPRMonitor);

    // WHEN - Start server
    await receiver.start();

    // THEN - Server is listening
    expect(receiver.isRunning()).toBe(true);

    await receiver.stop();
  });
});
```

**Acceptance Criteria:**
- [ ] Server starts on configurable port
- [ ] Server stops gracefully
- [ ] Health endpoint responds at `/health`

---

### Task 1.2: Webhook Signature Validation
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('WebhookReceiver - Signature Validation', () => {
  it('should reject requests without signature', async () => {
    // GIVEN - Request without X-Hub-Signature-256 header
    const req = createMockRequest({ body: '{}', headers: {} });

    // WHEN - Handle webhook
    const response = await receiver.handleWebhook(req);

    // THEN - 401 Unauthorized
    expect(response.status).toBe(401);
  });

  it('should reject requests with invalid signature', async () => {
    // GIVEN - Request with wrong signature
    const req = createMockRequest({
      body: '{"action":"submitted"}',
      headers: { 'X-Hub-Signature-256': 'sha256=invalid' }
    });

    // WHEN - Handle webhook
    const response = await receiver.handleWebhook(req);

    // THEN - 401 Unauthorized
    expect(response.status).toBe(401);
  });

  it('should accept requests with valid signature', async () => {
    // GIVEN - Request with valid HMAC signature
    const body = '{"action":"submitted"}';
    const signature = computeHmacSha256(body, 'secret');
    const req = createMockRequest({
      body,
      headers: { 'X-Hub-Signature-256': `sha256=${signature}` }
    });

    // WHEN - Handle webhook
    const response = await receiver.handleWebhook(req);

    // THEN - 200 OK (or 202 Accepted)
    expect(response.status).toBe(200);
  });
});
```

**Acceptance Criteria:**
- [ ] Rejects unsigned requests with 401
- [ ] Rejects invalid signatures with 401
- [ ] Accepts valid HMAC-SHA256 signatures
- [ ] Uses timing-safe comparison to prevent timing attacks

---

### Task 1.3: Rate Limiting
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('WebhookReceiver - Rate Limiting', () => {
  it('should accept requests under rate limit', async () => {
    // GIVEN - 5 requests in quick succession
    const requests = Array(5).fill(null).map(() => createValidRequest());

    // WHEN - Process all
    const responses = await Promise.all(
      requests.map(r => receiver.handleWebhook(r))
    );

    // THEN - All accepted
    expect(responses.every(r => r.status === 200)).toBe(true);
  });

  it('should reject requests over rate limit', async () => {
    // GIVEN - 15 requests (over 10/min limit)
    const requests = Array(15).fill(null).map(() => createValidRequest());

    // WHEN - Process all
    const responses = await Promise.all(
      requests.map(r => receiver.handleWebhook(r))
    );

    // THEN - Some rejected with 429
    const rejected = responses.filter(r => r.status === 429);
    expect(rejected.length).toBeGreaterThan(0);
  });
});
```

**Acceptance Criteria:**
- [ ] Allows up to 10 requests per minute
- [ ] Returns 429 Too Many Requests when exceeded
- [ ] Rate limit resets after window

---

## Phase 2: GitHub Event Processing

**Objective:** Parse and filter GitHub pull_request_review events

### Task 2.1: Event Type Filtering
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('WebhookReceiver - Event Filtering', () => {
  it('should ignore non-review events', async () => {
    // GIVEN - Push event (not pull_request_review)
    const req = createValidRequest({
      headers: { 'X-GitHub-Event': 'push' },
      body: JSON.stringify({ ref: 'refs/heads/main' })
    });

    // WHEN - Handle webhook
    const response = await receiver.handleWebhook(req);

    // THEN - 200 OK but no task queued
    expect(response.status).toBe(200);
    expect(mockPRMonitor.processWebhook).not.toHaveBeenCalled();
  });

  it('should process pull_request_review events', async () => {
    // GIVEN - pull_request_review event
    const req = createValidRequest({
      headers: { 'X-GitHub-Event': 'pull_request_review' },
      body: JSON.stringify({
        action: 'submitted',
        review: { state: 'changes_requested' },
        pull_request: { number: 123 }
      })
    });

    // WHEN - Handle webhook
    const response = await receiver.handleWebhook(req);

    // THEN - Event processed
    expect(response.status).toBe(200);
    expect(mockPRMonitor.processWebhook).toHaveBeenCalled();
  });
});
```

**Acceptance Criteria:**
- [ ] Filters for `pull_request_review` events only
- [ ] Ignores push, issue, etc. events
- [ ] Passes review payload to PRMonitor

---

### Task 2.2: Changes Requested Detection
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('PRMonitorAgent - Webhook Processing', () => {
  it('should queue task for changes_requested review', async () => {
    // GIVEN - Review with changes_requested state
    const webhook = {
      action: 'submitted',
      review: {
        state: 'changes_requested',
        body: 'Please fix the type error on line 42',
        user: { login: 'reviewer' }
      },
      pull_request: {
        number: 123,
        head: { ref: 'feat/my-feature' }
      }
    };

    // WHEN - Process webhook
    await prMonitor.processWebhook(webhook);

    // THEN - Task queued
    const tasks = prMonitor.getQueuedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prNumber).toBe(123);
  });

  it('should ignore approved reviews', async () => {
    // GIVEN - Review with approved state
    const webhook = {
      action: 'submitted',
      review: { state: 'approved', body: 'LGTM!' },
      pull_request: { number: 123 }
    };

    // WHEN - Process webhook
    await prMonitor.processWebhook(webhook);

    // THEN - No task queued
    expect(prMonitor.getQueuedTasks()).toHaveLength(0);
  });
});
```

**Acceptance Criteria:**
- [ ] Queues task for `changes_requested` reviews
- [ ] Ignores `approved` and `commented` reviews
- [ ] Extracts review body for task context

---

## Phase 3: Telegram Integration

**Objective:** Send push notifications via existing Telegram bridge

### Task 3.1: TelegramNotifier Interface
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('TelegramNotifier', () => {
  it('should send PR review notification', async () => {
    // GIVEN - Mock telegram bridge client
    const mockClient = mock<TelegramBridgeClient>();
    const notifier = new TelegramNotifier(mockClient);

    // WHEN - Send notification
    await notifier.sendPRReviewNotification({
      prNumber: 123,
      prTitle: 'Add user authentication',
      reviewerName: 'alice',
      reviewBody: 'Please fix type error'
    });

    // THEN - Telegram message sent
    verify(mockClient.sendMessage(anything())).once();
  });
});
```

**Acceptance Criteria:**
- [ ] Sends notification with PR details
- [ ] Includes reviewer name and comment excerpt
- [ ] Uses existing telegram-bridge service

---

### Task 3.2: Notification Message Format
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('TelegramNotifier - Message Format', () => {
  it('should format message with PR details', async () => {
    // GIVEN - PR review info
    const review = {
      prNumber: 123,
      prTitle: 'Add user authentication',
      reviewerName: 'alice',
      reviewBody: 'Please fix the type error on line 42'
    };

    // WHEN - Format message
    const message = notifier.formatReviewMessage(review);

    // THEN - Contains required info
    expect(message).toContain('PR #123');
    expect(message).toContain('alice');
    expect(message).toContain('Changes Requested');
  });

  it('should truncate long review bodies', async () => {
    // GIVEN - Very long review body
    const review = {
      prNumber: 123,
      reviewBody: 'A'.repeat(1000)
    };

    // WHEN - Format message
    const message = notifier.formatReviewMessage(review);

    // THEN - Truncated with ellipsis
    expect(message.length).toBeLessThan(500);
    expect(message).toContain('...');
  });
});
```

**Acceptance Criteria:**
- [ ] Includes PR number and title
- [ ] Includes reviewer name
- [ ] Truncates long comments
- [ ] Emojis for visual distinction

---

## Phase 4: Configuration & Setup

**Objective:** Add `/oss:settings webhook` command for setup

### Task 4.1: Webhook Secret Generation
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('WebhookConfig', () => {
  it('should generate secure random secret', () => {
    // WHEN - Generate secret
    const secret = WebhookConfig.generateSecret();

    // THEN - 32 bytes hex = 64 chars
    expect(secret).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should save config to .oss/config.json', async () => {
    // GIVEN - New config
    const config = new WebhookConfig('/path/to/.oss');

    // WHEN - Enable webhook
    await config.enable({ port: 3838 });

    // THEN - Config saved
    const saved = await config.load();
    expect(saved.webhook.enabled).toBe(true);
    expect(saved.webhook.port).toBe(3838);
    expect(saved.webhook.secret).toBeDefined();
  });
});
```

**Acceptance Criteria:**
- [ ] Generates cryptographically secure secret
- [ ] Saves to .oss/config.json
- [ ] Reads existing config on load

---

### Task 4.2: Setup Skill Implementation
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('/oss:settings webhook setup', () => {
  it('should generate config and display instructions', async () => {
    // GIVEN - No existing webhook config
    const mockConfig = mock<WebhookConfig>();
    when(mockConfig.isConfigured()).thenReturn(false);

    // WHEN - Run setup
    const output = await runSetup(mockConfig);

    // THEN - Config generated, instructions displayed
    verify(mockConfig.enable(anything())).once();
    expect(output).toContain('Webhook URL');
    expect(output).toContain('Add this webhook to GitHub');
  });
});
```

**Acceptance Criteria:**
- [ ] Generates webhook secret
- [ ] Displays GitHub webhook URL
- [ ] Shows step-by-step instructions
- [ ] Validates cloudflared is installed

---

## Phase 5: Integration & E2E

**Objective:** Full end-to-end flow verification

### Task 5.1: Watcher Integration
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('Watcher - Webhook Integration', () => {
  it('should start webhook receiver when enabled', async () => {
    // GIVEN - Webhook config enabled
    const config = { webhook: { enabled: true, port: 3838, secret: 'test' } };
    const watcher = new Watcher('/path/to/.oss', 'api-key', config);

    // WHEN - Start watcher
    await watcher.start();

    // THEN - Webhook receiver running
    expect(watcher.getWebhookReceiver()?.isRunning()).toBe(true);

    await watcher.stop();
  });
});
```

**Acceptance Criteria:**
- [ ] WebhookReceiver starts with Watcher
- [ ] WebhookReceiver stops with Watcher
- [ ] Config controls enabled/disabled state

---

### Task 5.2: Full E2E Flow
**TDD Cycle:** RED → GREEN → REFACTOR

**Test First:**
```typescript
describe('E2E: GitHub Review → Telegram Notification', () => {
  it('should notify user when PR changes requested', async () => {
    // GIVEN - Full system running
    const watcher = await startTestWatcher();
    const telegramSpy = vi.spyOn(telegramBridge, 'sendMessage');

    // WHEN - Simulate GitHub webhook
    await sendWebhook(watcher.webhookUrl, {
      event: 'pull_request_review',
      payload: {
        action: 'submitted',
        review: { state: 'changes_requested', body: 'Fix this' },
        pull_request: { number: 42, title: 'My PR' }
      }
    });

    // THEN - Telegram notification sent
    expect(telegramSpy).toHaveBeenCalledWith(
      expect.stringContaining('PR #42')
    );

    // AND - Task queued
    const queue = await readQueue();
    expect(queue.tasks).toContainEqual(
      expect.objectContaining({ prNumber: 42 })
    );

    await watcher.stop();
  });
});
```

**Acceptance Criteria:**
- [ ] Webhook received and validated
- [ ] Task queued in .oss/queue.json
- [ ] Telegram notification sent
- [ ] Complete flow under 5 seconds

---

## Task Summary

| Phase | Task | Tests | Priority |
|-------|------|-------|----------|
| 1 | WebhookReceiver Class | 3 | P0 |
| 1 | Signature Validation | 3 | P0 |
| 1 | Rate Limiting | 2 | P1 |
| 2 | Event Type Filtering | 2 | P0 |
| 2 | Changes Requested Detection | 2 | P0 |
| 3 | TelegramNotifier Interface | 1 | P1 |
| 3 | Notification Message Format | 2 | P1 |
| 4 | Webhook Secret Generation | 2 | P0 |
| 4 | Setup Skill Implementation | 1 | P1 |
| 5 | Watcher Integration | 1 | P0 |
| 5 | Full E2E Flow | 1 | P0 |

**Total: 20 tests across 11 tasks**

---

## Dependencies

- `crypto` - Node.js built-in for HMAC
- `express` or `http` - HTTP server (use existing pattern)
- Existing: `telegram-bridge-service` for notifications
- Existing: `PRMonitorAgent` for task queueing

---

## Files to Create/Modify

**New Files:**
- `watcher/src/services/webhook-receiver.ts`
- `watcher/src/services/telegram-notifier.ts`
- `watcher/src/config/webhook-config.ts`
- `watcher/test/services/webhook-receiver.test.ts`
- `watcher/test/services/telegram-notifier.test.ts`
- `watcher/test/config/webhook-config.test.ts`
- `watcher/test/integration/webhook-e2e.test.ts`
- `commands/oss-settings-webhook.md` (skill extension)

**Modified Files:**
- `watcher/src/index.ts` - Add webhook receiver initialization
- `watcher/src/agents/pr-monitor.ts` - Add `processWebhook()` method
- `commands/settings.md` - Add webhook subcommand docs

---

## Command Chain

After plan approval:
1. `/oss:build` - Execute Phase 1-5 with TDD
2. `/oss:ship` - PR and merge

---

*Generated by /oss:plan*
*Last Updated: 2026-01-12*
