---
description: Manage Telegram notifications for OSS Dev Workflow
---

# /oss:telegram - Telegram Notifications

Receive notifications on your phone when Claude Code needs input or completes tasks.

## Usage

```bash
/oss:telegram              # Show status and configuration
/oss:telegram on           # Enable notifications
/oss:telegram off          # Disable notifications
/oss:telegram setup        # Configure bot token and chat ID
```

## How It Works

When enabled, you'll receive Telegram messages:
- **Decision prompts** with inline buttons when Claude needs your input
- **Completion notifications** when workflows finish

You can respond via Telegram buttons OR from your terminal - whichever comes first.

## Status Check

Run the status CLI to check configuration:

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-status.js"
```

**Output states:**
- `NOT_CONFIGURED` - Bot token or chat ID missing
- `OFF` - Configured but disabled
- `ON` - Enabled and ready

## Toggle On/Off

```bash
# Enable
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-toggle.js" on

# Disable
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-toggle.js" off
```

## Setup Instructions

### Step 1: Create Your Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g., "My OSS Notifications")
4. Choose a username (must end in `bot`, e.g., `my_oss_bot`)
5. Copy the **bot token** (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### Step 2: Get Your Chat ID

1. Open your new bot in Telegram
2. Send any message to it (e.g., "hello")
3. Run the setup CLI:

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-setup.js" --fetch-chat
```

### Step 3: Save Configuration

```bash
# Save bot token
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-setup.js" --token "YOUR_BOT_TOKEN"

# Validate configuration
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-setup.js" --validate
```

### Step 4: Enable Notifications

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-toggle.js" on
```

## Configuration File

Settings are stored in `~/.oss/settings.json`:

```json
{
  "telegram": {
    "enabled": false,
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
    "chatId": "987654321"
  }
}
```

## Security Notes

- Your bot token stays local (only in `~/.oss/settings.json`)
- Each user creates their own bot (no shared infrastructure)
- No webhook exposure - uses long polling
- Chat ID ensures messages only go to you

## Troubleshooting

### "NOT_CONFIGURED" Status

Missing bot token or chat ID. Run:
```bash
/oss:telegram setup
```

### "Cannot send to chat" Error

1. Make sure you've messaged your bot at least once
2. Re-run `--fetch-chat` to get the correct chat ID
3. Verify with `--validate`

### Messages Not Arriving

1. Check that notifications are enabled: `/oss:telegram`
2. Verify your bot is running (send a test message)
3. Check Telegram app notification settings
