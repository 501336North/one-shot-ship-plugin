# Telegram Notifications for OSS Dev Workflow

## Overview

Enable Claude Code to notify users via Telegram when it needs input or completes tasks. Users who step away from their computer can receive decision prompts with inline buttons and respond directly from their phone.

## Core Behavior

### Toggle Switch

```
/oss:telegram on   → Enable notifications
/oss:telegram off  → Disable notifications (DEFAULT)
/oss:telegram      → Show current status + setup instructions if needed
```

**Default: OFF** - Users actively working at their computer don't need Telegram pings.

### When Notifications Are Sent (only when ON)

| Trigger | Message Type | Buttons |
|---------|--------------|---------|
| Claude needs user input | Decision prompt | Yes (choices) |
| Task/workflow complete | Status update | No |

**NOT sent:**
- Progress updates during builds
- Intermediate status messages
- Anything that doesn't require attention

### Blocking Behavior

When Claude Code needs input:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                   │
│  Claude Code                  User Response                       │
│      │                             │                              │
│      ▼                             │                              │
│  [Needs input] ──────────────────▶ │                              │
│      │                             │                              │
│      │  ┌──────────────────────────┴─────────────────────────┐   │
│      │  │                                                     │   │
│      │  │  Option A: User at computer                        │   │
│      │  │  └─▶ Types response in Claude Code terminal        │   │
│      │  │                                                     │   │
│      │  │  Option B: User away (Telegram ON)                 │   │
│      │  │  └─▶ Taps button in Telegram                       │   │
│      │  │                                                     │   │
│      │  └─────────────────────────────────────────────────────┘   │
│      │                             │                              │
│      ▼ ◀───────────────────────────┘                              │
│  [Continues with response]                                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Key:** Claude blocks until EITHER source provides input. First response wins.

### Multi-Turn Conversations

If Claude needs follow-up info after initial response:

```
Loop:
  1. Claude asks question → Telegram message with buttons
  2. User responds → callback relayed to Claude
  3. Claude processes → needs more info? → goto 1
  4. Claude has enough → continues autonomously
```

## User Setup (One Bot Per User)

Users create their own Telegram bot:

### Step 1: Create Bot

```
1. Open Telegram, search for @BotFather
2. Send /newbot
3. Choose name: "My OSS Notifications" (or anything)
4. Choose username: my_oss_bot (must end in 'bot')
5. Copy the token: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

### Step 2: Get Chat ID

```
1. Open your new bot in Telegram
2. Send any message to it
3. Run: /oss:telegram setup
   → Claude fetches your chat_id automatically via getUpdates
```

### Step 3: Configure

```json
// ~/.oss/config.json
{
  "apiKey": "ak_xxx",
  "telegram": {
    "enabled": false,
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "chatId": "987654321"
  }
}
```

## Command: /oss:telegram

### Usage

```bash
# Check status and show setup if incomplete
/oss:telegram

# Enable notifications
/oss:telegram on

# Disable notifications
/oss:telegram off

# Run setup wizard
/oss:telegram setup
```

### Status Check Output

```
Telegram Notifications: OFF

Configuration:
  Bot Token: ✅ Configured
  Chat ID:   ✅ Configured
  Test Ping: ✅ Successful

To enable: /oss:telegram on
```

### Missing Config Output

```
Telegram Notifications: NOT CONFIGURED

Setup Instructions:
1. Create a bot: Open Telegram → @BotFather → /newbot
2. Copy the bot token
3. Message your bot (any message)
4. Run: /oss:telegram setup
```

## Technical Implementation

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  OSS Dev Workflow Plugin                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Existing Workflows                    New: Telegram Service     │
│  (/oss:build, /oss:ship, etc)                                    │
│         │                                     ▲                   │
│         ▼                                     │                   │
│  ┌─────────────────┐                ┌─────────────────┐          │
│  │ Input Required  │───────────────▶│ telegram.ts     │          │
│  │ Decision Point  │                │                 │          │
│  └─────────────────┘                │ - sendMessage() │          │
│         │                           │ - awaitResponse()          │
│         │                           │ - pollForCallback()        │
│         ▼                           └─────────────────┘          │
│  ┌─────────────────┐                         │                   │
│  │ Task Complete   │─────────────────────────┘                   │
│  └─────────────────┘                                             │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │  Telegram Bot API   │
                    │  (Long Polling)     │
                    └─────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │  User's Telegram    │
                    │  (Mobile/Desktop)   │
                    └─────────────────────┘
```

### Core Functions

```typescript
// watcher/src/services/telegram.ts

interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

interface TelegramButton {
  text: string;
  callbackData: string;
}

// Send message with optional inline keyboard
async function sendMessage(
  message: string,
  buttons?: TelegramButton[][]
): Promise<number>  // returns message_id

// Wait for callback query (blocks until response)
async function awaitCallback(
  messageId: number,
  timeoutMs?: number  // default: no timeout (wait forever)
): Promise<string>   // returns callback_data

// Send notification (no response expected)
async function notify(message: string): Promise<void>

// Check if Telegram is enabled and configured
function isEnabled(): boolean

// Validate configuration
async function validateConfig(): Promise<{
  valid: boolean;
  errors: string[];
}>
```

### Integration Points

**1. Existing AskUserQuestion equivalent:**

```typescript
// When Claude needs input and Telegram is ON:
if (telegram.isEnabled()) {
  const msgId = await telegram.sendMessage(
    "Build found 3 TypeScript errors. How to proceed?",
    [
      [{ text: "Fix all", callbackData: "fix_all" }],
      [{ text: "Fix critical only", callbackData: "fix_critical" }],
      [{ text: "Skip", callbackData: "skip" }]
    ]
  );

  // This blocks until user responds (Telegram OR terminal)
  const response = await Promise.race([
    telegram.awaitCallback(msgId),
    terminalInput.await()
  ]);
}
```

**2. Task completion notifications:**

```typescript
// At end of /oss:build, /oss:ship, etc:
if (telegram.isEnabled()) {
  await telegram.notify(
    "✅ /oss:ship complete!\n" +
    "PR #54 merged to main\n" +
    "https://github.com/org/repo/pull/54"
  );
}
```

### No External Dependencies Required

- **No ngrok** - Long polling works fine
- **No MCP server** - Direct HTTP calls to Telegram API
- **No npm packages** - Telegram API is simple REST

```typescript
// Raw API call example
const response = await fetch(
  `https://api.telegram.org/bot${token}/sendMessage`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      reply_markup: { inline_keyboard: buttons }
    })
  }
);
```

## Message Templates

### Decision Required

```
🤔 Input Needed

[Context about what's happening]

[Question]

┌────────────┐ ┌────────────┐ ┌────────────┐
│  Option 1  │ │  Option 2  │ │  Option 3  │
└────────────┘ └────────────┘ └────────────┘
```

### Task Complete

```
✅ Task Complete: /oss:build

• Tests: 47/47 passing
• Build: Success
• Duration: 2m 34s

Ready for /oss:ship when you are.
```

### Error/Blocker

```
🚨 Blocked: /oss:build

Error: Cannot find module 'lodash'

Waiting for resolution...
```

## File Locations

```
one-shot-ship-plugin/
├── watcher/src/services/
│   └── telegram.ts           # Core Telegram API client
├── watcher/src/commands/
│   └── telegram.ts           # /oss:telegram command handler
├── hooks/
│   └── oss-telegram.sh       # Shell hook for notifications
└── commands/
    └── telegram.md           # Command prompt
```

## Security Considerations

1. **Bot token stays local** - Only in ~/.oss/config.json
2. **One bot per user** - No shared infrastructure
3. **Chat ID validation** - Only send to configured chat
4. **No webhook exposure** - Long polling, no public endpoints

## Acceptance Criteria

- [ ] `/oss:telegram` shows status and setup instructions
- [ ] `/oss:telegram on` enables notifications
- [ ] `/oss:telegram off` disables notifications (default state)
- [ ] `/oss:telegram setup` walks through bot creation and config
- [ ] When ON, Claude sends Telegram message when input needed
- [ ] Inline buttons work and relay callback to Claude
- [ ] Claude blocks until response from Telegram OR terminal
- [ ] Task completion sends notification (no buttons)
- [ ] Multi-turn works (follow-up questions loop correctly)
- [ ] No notifications sent when OFF
