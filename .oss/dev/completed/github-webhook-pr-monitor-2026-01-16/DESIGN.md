# GitHub Webhook PR Monitor Enhancement

## Problem Statement

When PRs are created via `/oss:ship`, reviewers may leave "Request Changes" comments on GitHub. Currently:

1. **Polling-based detection** - PRMonitorAgent polls GitHub via `gh` CLI
2. **Session-dependent** - Only works when Claude session is active
3. **Delayed notification** - Minutes delay between review and detection
4. **No push notification** - User must check terminal to see pending tasks

**Result:** PR reviews go unnoticed until manually checked or next Claude session.

## Solution: Real-Time Webhook Integration

Extend the existing watcher architecture to receive GitHub webhooks, similar to the Telegram bridge pattern:

```
GitHub PR Review Event
         │
         ▼ (webhook POST)
┌─────────────────────────────────────────────────────────────┐
│  GitHub Webhook Receiver (new component)                    │
│  └─ Receives pull_request_review events                     │
│  └─ Filters for "changes_requested" action                  │
│  └─ Extracts review comments                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
┌─────────────────────┐    ┌─────────────────────────────────┐
│  Telegram Bridge    │    │  Watcher Queue                  │
│  (existing)         │    │  .oss/queue.json                │
│  └─ Notify user     │    │  └─ Task for Claude             │
└─────────────────────┘    └─────────────────────────────────┘
```

## Architecture Decisions

### AD-1: Extend Watcher, Don't Create New Daemon

**Decision:** Add webhook receiver to existing watcher system
**Rationale:**
- Reuses proven QueueManager infrastructure
- Consistent with existing PRMonitorAgent interface
- Simpler deployment (one process, not two)

### AD-2: Use Cloudflare Tunnel for Public Endpoint

**Decision:** Use `cloudflared` for exposing local webhook endpoint
**Rationale:**
- No need for dedicated server with public IP
- Works on any developer machine
- Secure HTTPS tunnel
- Alternative: ngrok, but cloudflared is free and reliable

### AD-3: Integrate with Telegram Bridge for Notifications

**Decision:** Reuse existing telegram-bridge for push notifications
**Rationale:**
- Telegram infrastructure already working
- No new notification system to build
- User already has bot configured

### AD-4: Webhook Secret for Security

**Decision:** Use HMAC-SHA256 webhook secret validation
**Rationale:**
- GitHub signs payloads with secret
- Prevents malicious webhook injection
- Standard practice for webhook security

## Components

### 1. WebhookReceiver (NEW)

```typescript
// watcher/src/services/webhook-receiver.ts
export class WebhookReceiver {
  constructor(
    private port: number,
    private webhookSecret: string,
    private prMonitor: PRMonitorAgent,
    private telegramNotifier: TelegramNotifier
  ) {}

  start(): Promise<void>
  stop(): Promise<void>
  handleWebhook(req: Request): Promise<Response>
}
```

### 2. TelegramNotifier Integration

```typescript
// Extend existing telegram-bridge client
export interface TelegramNotifier {
  sendPRReviewNotification(pr: PRInfo, review: ReviewInfo): Promise<void>
}
```

### 3. Configuration

```json
// .oss/config.json
{
  "webhook": {
    "enabled": true,
    "port": 3838,
    "secret": "auto-generated-secret"
  }
}
```

## User Flow

1. **Setup (one-time):**
   ```bash
   /oss:settings webhook setup
   ```
   - Generates webhook secret
   - Provides GitHub webhook URL
   - Starts cloudflared tunnel

2. **Runtime:**
   - Reviewer requests changes on PR
   - GitHub sends webhook to tunnel URL
   - Watcher receives, validates, queues task
   - Telegram notification sent to user
   - User opens Claude, sees pending task

3. **Task Execution:**
   - Claude picks up task from queue
   - Delegates to appropriate agent
   - Pushes fix to PR branch
   - Replies to review comment

## Security Considerations

1. **Webhook signature validation** - HMAC-SHA256
2. **Rate limiting** - Max 10 webhooks/minute
3. **Payload size limit** - Max 1MB
4. **Tunnel authentication** - cloudflared provides this

## Success Criteria

- [ ] Real-time webhook reception (<5s from GitHub event)
- [ ] Telegram notification on "changes_requested"
- [ ] Task queued in .oss/queue.json
- [ ] Works when Claude is not running
- [ ] Secure webhook validation
- [ ] Graceful degradation if tunnel unavailable

## Out of Scope

- GitHub App authentication (using existing `gh` CLI auth)
- Custom domain for webhook URL
- Multiple repository support (single repo per watcher instance)
