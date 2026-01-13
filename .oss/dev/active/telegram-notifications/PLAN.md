# TDD Implementation Plan: Telegram Notifications

## Overview

Enable Claude Code to notify users via Telegram when input is needed or tasks complete.
Toggle on/off, default off. Blocks until response from Telegram OR terminal.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                           New Files                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  watcher/src/services/telegram.ts      # Core Telegram API       │
│  watcher/src/types/telegram.ts         # Type definitions        │
│  watcher/test/services/telegram.test.ts # Unit tests             │
│  watcher/test/services/telegram-integration.test.ts # E2E        │
│  commands/telegram.md                  # Command prompt          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Types & Configuration

### Task 1.1: Telegram Type Definitions

**File:** `watcher/src/types/telegram.ts`

**Test First (RED):**
```typescript
// watcher/test/types/telegram.test.ts
describe('Telegram Types', () => {
  it('should define TelegramConfig interface', () => {
    const config: TelegramConfig = {
      enabled: false,
      botToken: '123:ABC',
      chatId: '456',
    };
    expect(config.enabled).toBe(false);
  });

  it('should define TelegramButton interface', () => {
    const button: TelegramButton = {
      text: 'Click me',
      callbackData: 'action_1',
    };
    expect(button.callbackData).toBe('action_1');
  });

  it('should define DEFAULT_TELEGRAM_CONFIG', () => {
    expect(DEFAULT_TELEGRAM_CONFIG.enabled).toBe(false);
    expect(DEFAULT_TELEGRAM_CONFIG.botToken).toBe('');
    expect(DEFAULT_TELEGRAM_CONFIG.chatId).toBe('');
  });
});
```

**Implementation (GREEN):**
- `TelegramConfig` interface
- `TelegramButton` interface
- `TelegramMessage` interface
- `TelegramCallbackQuery` interface
- `DEFAULT_TELEGRAM_CONFIG` constant

**Acceptance Criteria:**
- [ ] Types compile without errors
- [ ] Default config has enabled=false

---

### Task 1.2: Settings Service Extension

**File:** `watcher/src/services/settings.ts`

**Test First (RED):**
```typescript
// watcher/test/services/settings-telegram.test.ts
describe('SettingsService - Telegram', () => {
  it('should load telegram config from settings.json', () => {
    const settings = new SettingsService(configDir);
    expect(settings.getTelegram()).toEqual({
      enabled: false,
      botToken: '',
      chatId: '',
    });
  });

  it('should save telegram config to settings.json', () => {
    const settings = new SettingsService(configDir);
    settings.setTelegram({
      enabled: true,
      botToken: '123:ABC',
      chatId: '456',
    });
    expect(settings.getTelegram().enabled).toBe(true);
  });

  it('should toggle telegram enabled state', () => {
    const settings = new SettingsService(configDir);
    settings.setTelegramEnabled(true);
    expect(settings.getTelegram().enabled).toBe(true);
    settings.setTelegramEnabled(false);
    expect(settings.getTelegram().enabled).toBe(false);
  });
});
```

**Implementation (GREEN):**
- Add `telegram` field to `NotificationSettings` type
- `getTelegram(): TelegramConfig`
- `setTelegram(config: TelegramConfig): void`
- `setTelegramEnabled(enabled: boolean): void`

**Acceptance Criteria:**
- [ ] Telegram config persists in settings.json
- [ ] Default enabled=false
- [ ] Toggle works correctly

---

## Phase 2: Telegram API Client

### Task 2.1: TelegramService Core

**File:** `watcher/src/services/telegram.ts`

**Test First (RED):**
```typescript
// watcher/test/services/telegram.test.ts
describe('TelegramService', () => {
  describe('isConfigured', () => {
    it('should return false when botToken is empty', () => {
      const service = new TelegramService({ ...config, botToken: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('should return false when chatId is empty', () => {
      const service = new TelegramService({ ...config, chatId: '' });
      expect(service.isConfigured()).toBe(false);
    });

    it('should return true when both are set', () => {
      const service = new TelegramService(validConfig);
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('isEnabled', () => {
    it('should return false when enabled=false', () => {
      const service = new TelegramService({ ...validConfig, enabled: false });
      expect(service.isEnabled()).toBe(false);
    });

    it('should return false when not configured even if enabled=true', () => {
      const service = new TelegramService({ enabled: true, botToken: '', chatId: '' });
      expect(service.isEnabled()).toBe(false);
    });

    it('should return true when enabled and configured', () => {
      const service = new TelegramService({ ...validConfig, enabled: true });
      expect(service.isEnabled()).toBe(true);
    });
  });
});
```

**Implementation (GREEN):**
```typescript
export class TelegramService {
  constructor(private config: TelegramConfig) {}

  isConfigured(): boolean
  isEnabled(): boolean
}
```

**Acceptance Criteria:**
- [ ] isConfigured checks both token and chatId
- [ ] isEnabled requires both enabled flag AND valid config

---

### Task 2.2: Send Message

**Test First (RED):**
```typescript
describe('TelegramService.sendMessage', () => {
  it('should send message via Telegram API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 123 } }),
    });
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    const msgId = await service.sendMessage('Hello');

    expect(msgId).toBe(123);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sendMessage'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Hello'),
      })
    );
  });

  it('should include inline keyboard when buttons provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 123 } }),
    });
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    await service.sendMessage('Choose:', [[
      { text: 'Yes', callbackData: 'yes' },
      { text: 'No', callbackData: 'no' },
    ]]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.reply_markup.inline_keyboard).toBeDefined();
    expect(body.reply_markup.inline_keyboard[0]).toHaveLength(2);
  });

  it('should throw when API returns error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ description: 'Unauthorized' }),
    });

    const service = new TelegramService(validConfig);
    await expect(service.sendMessage('Hello'))
      .rejects.toThrow('Telegram API error');
  });

  it('should not send when disabled', async () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    const service = new TelegramService({ ...validConfig, enabled: false });
    await service.sendMessage('Hello');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

**Implementation (GREEN):**
```typescript
async sendMessage(
  text: string,
  buttons?: TelegramButton[][]
): Promise<number | null>
```

**Acceptance Criteria:**
- [ ] Sends to correct Telegram API endpoint
- [ ] Includes inline keyboard when buttons provided
- [ ] Returns message_id on success
- [ ] Throws on API error
- [ ] No-op when disabled

---

### Task 2.3: Notify (Fire-and-Forget)

**Test First (RED):**
```typescript
describe('TelegramService.notify', () => {
  it('should send notification without buttons', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 123 } }),
    });
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    await service.notify('Task complete!');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe('Task complete!');
    expect(body.reply_markup).toBeUndefined();
  });

  it('should not throw on API error (fire-and-forget)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const service = new TelegramService(validConfig);
    await expect(service.notify('Hello')).resolves.not.toThrow();
  });
});
```

**Implementation (GREEN):**
```typescript
async notify(text: string): Promise<void>
```

**Acceptance Criteria:**
- [ ] Sends message without buttons
- [ ] Does not throw on error (logs instead)

---

### Task 2.4: Poll for Callback

**Test First (RED):**
```typescript
describe('TelegramService.awaitCallback', () => {
  it('should poll getUpdates until callback received', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: [] }), // No updates
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: [{
            update_id: 1,
            callback_query: {
              id: 'cb1',
              message: { message_id: 123 },
              data: 'user_choice',
            },
          }],
        }),
      });
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    const result = await service.awaitCallback(123, { pollIntervalMs: 10 });

    expect(result).toBe('user_choice');
  });

  it('should answer callback query after receiving', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: [{
            update_id: 1,
            callback_query: {
              id: 'cb1',
              message: { message_id: 123 },
              data: 'choice',
            },
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true }); // answerCallbackQuery
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    await service.awaitCallback(123);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/answerCallbackQuery'),
      expect.any(Object)
    );
  });

  it('should timeout and return null when specified', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: [] }),
    });

    const service = new TelegramService(validConfig);
    const result = await service.awaitCallback(123, {
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(result).toBeNull();
  });

  it('should edit message to show selection', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          result: [{
            update_id: 1,
            callback_query: {
              id: 'cb1',
              message: { message_id: 123, text: 'Choose:' },
              data: 'yes',
            },
          }],
        }),
      })
      .mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const service = new TelegramService(validConfig);
    await service.awaitCallback(123);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/editMessageReplyMarkup'),
      expect.any(Object)
    );
  });
});
```

**Implementation (GREEN):**
```typescript
async awaitCallback(
  messageId: number,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<string | null>
```

**Acceptance Criteria:**
- [ ] Polls getUpdates until callback for messageId received
- [ ] Answers callback query to remove "loading" state
- [ ] Edits message to remove buttons after selection
- [ ] Returns callback_data
- [ ] Timeout returns null

---

### Task 2.5: Validate Configuration

**Test First (RED):**
```typescript
describe('TelegramService.validateConfig', () => {
  it('should return valid=true when bot responds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { username: 'my_bot' } }),
    });

    const service = new TelegramService(validConfig);
    const result = await service.validateConfig();

    expect(result.valid).toBe(true);
    expect(result.botUsername).toBe('my_bot');
  });

  it('should return valid=false with error when token invalid', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ description: 'Unauthorized' }),
    });

    const service = new TelegramService(validConfig);
    const result = await service.validateConfig();

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid bot token');
  });

  it('should test send permission to chatId', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { username: 'my_bot' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: { message_id: 1 } }),
      })
      .mockResolvedValueOnce({ ok: true }); // deleteMessage

    const service = new TelegramService(validConfig);
    const result = await service.validateConfig();

    expect(result.valid).toBe(true);
    expect(result.canSendToChat).toBe(true);
  });
});
```

**Implementation (GREEN):**
```typescript
async validateConfig(): Promise<{
  valid: boolean;
  errors: string[];
  botUsername?: string;
  canSendToChat?: boolean;
}>
```

**Acceptance Criteria:**
- [ ] Calls getMe to validate token
- [ ] Sends test message to validate chatId
- [ ] Deletes test message
- [ ] Returns structured validation result

---

### Task 2.6: Fetch Chat ID from Updates

**Test First (RED):**
```typescript
describe('TelegramService.fetchChatId', () => {
  it('should get chatId from recent message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        result: [{
          update_id: 1,
          message: {
            chat: { id: 12345 },
            from: { first_name: 'John' },
          },
        }],
      }),
    });

    const service = new TelegramService({ ...validConfig, chatId: '' });
    const result = await service.fetchChatId();

    expect(result.chatId).toBe('12345');
    expect(result.userName).toBe('John');
  });

  it('should return null when no messages', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: [] }),
    });

    const service = new TelegramService({ ...validConfig, chatId: '' });
    const result = await service.fetchChatId();

    expect(result).toBeNull();
  });
});
```

**Implementation (GREEN):**
```typescript
async fetchChatId(): Promise<{ chatId: string; userName: string } | null>
```

**Acceptance Criteria:**
- [ ] Extracts chat.id from most recent message
- [ ] Returns null if no messages found

---

## Phase 3: Command Implementation

### Task 3.1: /oss:telegram Command Prompt

**File:** `commands/telegram.md`

**Test First (RED):**
```typescript
// watcher/test/commands/telegram-prompt.test.ts
describe('telegram.md', () => {
  it('should exist in commands directory', () => {
    expect(fs.existsSync('commands/telegram.md')).toBe(true);
  });

  it('should have required sections', () => {
    const content = fs.readFileSync('commands/telegram.md', 'utf-8');
    expect(content).toContain('# /oss:telegram');
    expect(content).toContain('/oss:telegram on');
    expect(content).toContain('/oss:telegram off');
    expect(content).toContain('/oss:telegram setup');
    expect(content).toContain('@BotFather');
  });
});
```

**Implementation (GREEN):**
Create `commands/telegram.md` with:
- Status check section
- On/off toggle handling
- Setup wizard flow
- Configuration validation

**Acceptance Criteria:**
- [ ] Command prompt exists
- [ ] Documents all subcommands
- [ ] Includes setup instructions

---

### Task 3.2: CLI for Telegram Status

**File:** `watcher/src/cli/telegram-status.ts`

**Test First (RED):**
```typescript
// watcher/test/cli/telegram-status.test.ts
describe('telegram-status CLI', () => {
  it('should output NOT_CONFIGURED when no config', async () => {
    const result = await runCli(['telegram-status']);
    expect(result.stdout).toContain('NOT_CONFIGURED');
  });

  it('should output OFF when configured but disabled', async () => {
    await writeConfig({ telegram: { enabled: false, botToken: '123', chatId: '456' } });
    const result = await runCli(['telegram-status']);
    expect(result.stdout).toContain('OFF');
    expect(result.stdout).toContain('Bot Token: ✅');
    expect(result.stdout).toContain('Chat ID: ✅');
  });

  it('should output ON when enabled', async () => {
    await writeConfig({ telegram: { enabled: true, botToken: '123', chatId: '456' } });
    const result = await runCli(['telegram-status']);
    expect(result.stdout).toContain('ON');
  });
});
```

**Implementation (GREEN):**
CLI that outputs telegram status in structured format.

**Acceptance Criteria:**
- [ ] Shows NOT_CONFIGURED / OFF / ON state
- [ ] Shows config validation status

---

### Task 3.3: CLI for Telegram Toggle

**File:** `watcher/src/cli/telegram-toggle.ts`

**Test First (RED):**
```typescript
// watcher/test/cli/telegram-toggle.test.ts
describe('telegram-toggle CLI', () => {
  it('should enable telegram', async () => {
    await writeConfig({ telegram: { enabled: false, botToken: '123', chatId: '456' } });
    const result = await runCli(['telegram-toggle', 'on']);
    expect(result.stdout).toContain('enabled');

    const config = await readConfig();
    expect(config.telegram.enabled).toBe(true);
  });

  it('should disable telegram', async () => {
    await writeConfig({ telegram: { enabled: true, botToken: '123', chatId: '456' } });
    const result = await runCli(['telegram-toggle', 'off']);
    expect(result.stdout).toContain('disabled');

    const config = await readConfig();
    expect(config.telegram.enabled).toBe(false);
  });

  it('should fail when not configured', async () => {
    await writeConfig({ telegram: { enabled: false, botToken: '', chatId: '' } });
    const result = await runCli(['telegram-toggle', 'on']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('not configured');
  });
});
```

**Implementation (GREEN):**
CLI that toggles telegram enabled state.

**Acceptance Criteria:**
- [ ] `on` enables when configured
- [ ] `off` disables
- [ ] Fails when not configured

---

### Task 3.4: CLI for Telegram Setup

**File:** `watcher/src/cli/telegram-setup.ts`

**Test First (RED):**
```typescript
// watcher/test/cli/telegram-setup.test.ts
describe('telegram-setup CLI', () => {
  it('should save botToken to config', async () => {
    const result = await runCli(['telegram-setup', '--token', '123:ABC']);
    expect(result.exitCode).toBe(0);

    const config = await readConfig();
    expect(config.telegram.botToken).toBe('123:ABC');
  });

  it('should fetch chatId when --fetch-chat flag provided', async () => {
    mockTelegramApi({
      getUpdates: [{ message: { chat: { id: 789 } } }],
    });

    const result = await runCli(['telegram-setup', '--fetch-chat']);
    expect(result.stdout).toContain('789');

    const config = await readConfig();
    expect(config.telegram.chatId).toBe('789');
  });

  it('should validate config when --validate flag', async () => {
    mockTelegramApi({
      getMe: { username: 'test_bot' },
    });

    const result = await runCli(['telegram-setup', '--validate']);
    expect(result.stdout).toContain('test_bot');
    expect(result.stdout).toContain('✅');
  });
});
```

**Implementation (GREEN):**
CLI for setup operations.

**Acceptance Criteria:**
- [ ] Saves token to config
- [ ] Fetches chat ID
- [ ] Validates configuration

---

## Phase 4: Integration with Workflows

### Task 4.1: Notification Hook

**File:** `hooks/oss-telegram.sh`

**Test First (RED):**
```typescript
// watcher/test/hooks/oss-telegram.test.ts
describe('oss-telegram.sh hook', () => {
  it('should send notification when enabled', async () => {
    mockTelegramEnabled(true);
    const result = await runHook('oss-telegram.sh', 'notify', 'Task complete!');
    expect(result.exitCode).toBe(0);
  });

  it('should not send when disabled', async () => {
    mockTelegramEnabled(false);
    const result = await runHook('oss-telegram.sh', 'notify', 'Task complete!');
    // Should exit silently
    expect(telegramApiCalls).toHaveLength(0);
  });

  it('should send with buttons for ask mode', async () => {
    mockTelegramEnabled(true);
    const result = await runHook(
      'oss-telegram.sh',
      'ask',
      'How to proceed?',
      'Fix all|fix_all',
      'Skip|skip'
    );
    expect(telegramApiCalls[0].body.reply_markup.inline_keyboard).toBeDefined();
  });
});
```

**Implementation (GREEN):**
Shell hook that wraps telegram CLI.

**Acceptance Criteria:**
- [ ] `notify` sends fire-and-forget message
- [ ] `ask` sends message with buttons
- [ ] Respects enabled state

---

### Task 4.2: Workflow Integration Points

**Test First (RED):**
```typescript
// watcher/test/integration/telegram-workflow.test.ts
describe('Telegram Workflow Integration', () => {
  it('should notify on workflow complete when enabled', async () => {
    mockTelegramEnabled(true);
    await runHook('oss-notify.sh', '--workflow', 'build', 'complete', '{}');

    expect(telegramApiCalls).toHaveLength(1);
    expect(telegramApiCalls[0].body.text).toContain('build');
    expect(telegramApiCalls[0].body.text).toContain('complete');
  });

  it('should not notify when disabled', async () => {
    mockTelegramEnabled(false);
    await runHook('oss-notify.sh', '--workflow', 'build', 'complete', '{}');

    expect(telegramApiCalls).toHaveLength(0);
  });
});
```

**Implementation (GREEN):**
Add telegram notification to `oss-notify.sh` workflow handler.

**Acceptance Criteria:**
- [ ] Workflow complete triggers notification
- [ ] Only when enabled

---

## Phase 5: End-to-End Tests

### Task 5.1: Full Flow E2E Test

**Test First (RED):**
```typescript
// watcher/test/integration/telegram-e2e.test.ts
describe('Telegram E2E', () => {
  it('should complete full setup → enable → notify flow', async () => {
    // 1. Setup
    await runCli(['telegram-setup', '--token', '123:ABC']);
    mockTelegramApi({ getUpdates: [{ message: { chat: { id: 789 } } }] });
    await runCli(['telegram-setup', '--fetch-chat']);

    // 2. Enable
    await runCli(['telegram-toggle', 'on']);

    // 3. Send notification
    mockTelegramApi({ sendMessage: { message_id: 1 } });
    await runHook('oss-telegram.sh', 'notify', 'Hello!');

    expect(telegramApiCalls.find(c => c.endpoint === 'sendMessage')).toBeDefined();
  });

  it('should complete ask → await → respond flow', async () => {
    // Setup enabled telegram
    await setupTelegram();

    // Send question with buttons
    mockTelegramApi({ sendMessage: { message_id: 100 } });
    const askPromise = runHook('oss-telegram.sh', 'ask', 'Choose:', 'A|a', 'B|b');

    // Simulate callback
    mockTelegramApi({
      getUpdates: [{
        callback_query: { id: 'cb1', message: { message_id: 100 }, data: 'a' }
      }],
    });

    const result = await askPromise;
    expect(result.stdout).toContain('a');
  });
});
```

**Acceptance Criteria:**
- [ ] Full setup flow works
- [ ] Ask/respond flow works
- [ ] Notification flow works

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1.1-1.2 | Types & Settings |
| 2 | 2.1-2.6 | Telegram API Client |
| 3 | 3.1-3.4 | Command & CLI |
| 4 | 4.1-4.2 | Workflow Integration |
| 5 | 5.1 | E2E Tests |

**Total Tasks:** 13
**Estimated Test Count:** ~45 tests

---

## File Summary

### New Files (7)

| File | Purpose |
|------|---------|
| `watcher/src/types/telegram.ts` | Type definitions |
| `watcher/src/services/telegram.ts` | Telegram API client |
| `watcher/src/cli/telegram-status.ts` | Status CLI |
| `watcher/src/cli/telegram-toggle.ts` | Toggle CLI |
| `watcher/src/cli/telegram-setup.ts` | Setup CLI |
| `commands/telegram.md` | Command prompt |
| `hooks/oss-telegram.sh` | Shell hook |

### Modified Files (2)

| File | Change |
|------|--------|
| `watcher/src/types/notification.ts` | Add TelegramConfig |
| `watcher/src/services/settings.ts` | Add telegram methods |
| `hooks/oss-notify.sh` | Add telegram notification call |

---

## Dependencies

- **None required** - Uses native `fetch` for Telegram API
- No npm packages
- No external services

## Next Steps

1. Run `/oss:build` to execute this plan with TDD
2. Each task follows RED → GREEN → REFACTOR
3. All tests must pass before proceeding
