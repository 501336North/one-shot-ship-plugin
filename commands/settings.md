---
description: Manage OSS notification and preference settings
---

# /oss:settings - Manage OSS Settings

Display and modify OSS preferences including notifications, voices, and sounds.

## Usage

```bash
/oss:settings              # Show current settings interactively
/oss:settings show         # Display current settings
/oss:settings --help       # Display help and usage information
```

## Step 0: Check for --help Flag

If `--help` is passed, display usage information and exit:

```
/oss:settings - Manage OSS notification and preference settings

USAGE:
  /oss:settings              Show current settings interactively
  /oss:settings show         Display current settings (read-only)
  /oss:settings --help       Display this help message

OPTIONS:
  --help                     Show help and usage information

NOTIFICATION STYLES:
  visual     macOS Notification Center (terminal-notifier)
  audio      Spoken messages using text-to-speech
  sound      System sounds (Glass, Ping, etc.)
  telegram   Telegram notifications + local backup
  none       Silent mode - no notifications

VERBOSITY LEVELS:
  all          Every event (command start, agent spawn, etc.)
  important    Success and failure events only (recommended)
  errors-only  Only critical errors and failures

VOICES (when style=audio):
  Samantha   Female, American (default)
  Daniel     Male, British
  Karen      Female, Australian
  Moira      Female, Irish

SOUNDS (when style=sound):
  Glass      Clear chime (default)
  Ping       Simple ping
  Purr       Soft purr
  Pop        Pop sound

SETTINGS FILE:
  ~/.oss/settings.json

EXAMPLES:
  /oss:settings              # Interactive configuration wizard
  /oss:settings show         # View current settings without changing
  /oss:settings --help       # Show this help message
```

**If --help is detected, output the above and do not proceed with the interactive flow.**

## Implementation

When user runs `/oss:settings`:

### Step 1: Load Current Settings

Read settings from `~/.oss/settings.json`:

```bash
SETTINGS_FILE=~/.oss/settings.json
if [[ -f "$SETTINGS_FILE" ]]; then
    STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE")
    VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE")
    SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE")
    VERBOSITY=$(jq -r '.notifications.verbosity // "important"' "$SETTINGS_FILE")
else
    STYLE="visual"
    VOICE="Samantha"
    SOUND="Glass"
    VERBOSITY="important"
fi
```

### Step 2: Display Current Settings

Show current settings in a formatted table:

```
OSS Settings
============

Notifications:
  Style:     [visual/audio/sound/none]
  Voice:     [voice name] (used when style=audio)
  Sound:     [sound name] (used when style=sound)
  Verbosity: [all/important/errors-only]

To change settings, answer the questions below.
```

### Step 3: Prompt for Changes

Use `AskUserQuestion` tool to let user modify settings:

**Question 1: Notification Style**

First, check if Telegram is configured by reading `telegram.botToken` from settings:

```bash
TELEGRAM_CONFIGURED=$(jq -r '.telegram.botToken // empty' "$SETTINGS_FILE" 2>/dev/null)
```

```json
{
  "question": "How would you like to be notified?",
  "header": "Style",
  "options": [
    {"label": "Visual", "description": "macOS notification center (terminal-notifier)"},
    {"label": "Audio", "description": "Spoken messages using text-to-speech"},
    {"label": "Sound", "description": "System sounds (Glass, Ping, etc.)"},
    {"label": "Telegram", "description": "Mobile notifications - requires setup first via /oss:telegram"},
    {"label": "None", "description": "Silent mode - no notifications"}
  ],
  "multiSelect": false
}
```

**Question 2: Verbosity Level**
```json
{
  "question": "Which notifications do you want to receive?",
  "header": "Verbosity",
  "options": [
    {"label": "All", "description": "Every event (command start, agent spawn, etc.)"},
    {"label": "Important", "description": "Success/failure only (recommended)"},
    {"label": "Errors Only", "description": "Only critical errors and failures"}
  ],
  "multiSelect": false
}
```

**Question 3: Voice Selection** (if style=audio)
```json
{
  "question": "Which voice should I use?",
  "header": "Voice",
  "options": [
    {"label": "Samantha", "description": "Female, American (default)"},
    {"label": "Daniel", "description": "Male, British"},
    {"label": "Karen", "description": "Female, Australian"},
    {"label": "Moira", "description": "Female, Irish"}
  ],
  "multiSelect": false
}
```

**Question 4: Sound Selection** (if style=sound)
```json
{
  "question": "Which sound should I use?",
  "header": "Sound",
  "options": [
    {"label": "Glass", "description": "Clear chime (default)"},
    {"label": "Ping", "description": "Simple ping"},
    {"label": "Purr", "description": "Soft purr"},
    {"label": "Pop", "description": "Pop sound"}
  ],
  "multiSelect": false
}
```

### Step 3.5: Validate Telegram Selection

**If user selects "Telegram" but it's not configured:**

Check if `telegram.botToken` exists in settings. If NOT_CONFIGURED, show error and prompt to run setup:

```
Telegram is not configured yet.

To set up Telegram notifications:
1. Run: /oss:telegram setup
2. Follow the setup wizard
3. Then re-run /oss:settings to select Telegram

For now, falling back to 'visual' style.
```

Set `STYLE="visual"` and continue.

### Step 4: Save Settings

Write updated settings to `~/.oss/settings.json`.

**CRITICAL: When style changes, update telegram.enabled accordingly:**
- If style = "telegram" → set `telegram.enabled = true`
- If style != "telegram" → set `telegram.enabled = false`

This prevents the bug where changing style away from telegram still sends telegram notifications.

```bash
mkdir -p ~/.oss

# Determine telegram enabled state based on style
if [[ "$STYLE" == "telegram" ]]; then
    TELEGRAM_ENABLED="true"
else
    TELEGRAM_ENABLED="false"
fi

# Preserve existing telegram credentials if they exist
EXISTING_BOT_TOKEN=$(jq -r '.telegram.botToken // empty' "$SETTINGS_FILE" 2>/dev/null)
EXISTING_CHAT_ID=$(jq -r '.telegram.chatId // empty' "$SETTINGS_FILE" 2>/dev/null)
TELEGRAM_CONFIGURED=$([ -n "$EXISTING_BOT_TOKEN" ] && echo "true" || echo "false")

cat > ~/.oss/settings.json << EOF
{
  "notifications": {
    "style": "$STYLE",
    "voice": "$VOICE",
    "sound": "$SOUND",
    "verbosity": "$VERBOSITY",
    "telegram": {
      "configured": $TELEGRAM_CONFIGURED,
      "enabled": $TELEGRAM_ENABLED
    }
  },
  "version": 1,
  "telegram": {
    "enabled": $TELEGRAM_ENABLED,
    "botToken": "${EXISTING_BOT_TOKEN:-}",
    "chatId": "${EXISTING_CHAT_ID:-}"
  }
}
EOF
```

### Step 5: Test Notification

Send a test notification using the new settings:

```bash
# Based on style
case "$STYLE" in
    "visual")
        terminal-notifier -title "Settings Saved" -message "OSS notifications configured" -sound default
        ;;
    "audio")
        say -v "$VOICE" "OSS settings saved successfully"
        ;;
    "sound")
        afplay "/System/Library/Sounds/${SOUND}.aiff"
        ;;
    "telegram")
        node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/telegram-notify.js" --message "OSS settings saved successfully!"
        ;;
    "none")
        echo "Notifications disabled. Settings saved."
        ;;
esac
```

### Step 6: Confirm

Display confirmation message:

```
Settings saved to ~/.oss/settings.json

New Configuration:
  Style:     $STYLE
  Voice:     $VOICE
  Sound:     $SOUND
  Verbosity: $VERBOSITY

Your notifications are now configured!
```

## Migration from oss-audio

If `~/.oss/audio-config` exists but `settings.json` does not:

1. Parse the old config file
2. Map values to new format:
   - `OSS_AUDIO_ENABLED=true` + `OSS_USE_VOICE=true` → `style: "audio"`
   - `OSS_AUDIO_ENABLED=true` + `OSS_USE_VOICE=false` → `style: "sound"`
   - `OSS_AUDIO_ENABLED=false` → `style: "none"`
   - `OSS_VOICE` → `voice`
   - `OSS_SOUND_SUCCESS` → `sound`
3. Create `settings.json` with migrated values
4. Inform user of migration

## Settings Schema

```json
{
  "notifications": {
    "style": "visual" | "audio" | "sound" | "telegram" | "none",
    "voice": "Samantha" | "Daniel" | "Karen" | "Moira",
    "sound": "Glass" | "Ping" | "Purr" | "Pop",
    "verbosity": "all" | "important" | "errors-only"
  },
  "telegram": {
    "enabled": true | false,
    "botToken": "your-bot-token",
    "chatId": "your-chat-id"
  },
  "version": 1
}
```

## Available Options

### Notification Styles
| Style | Tool | Description |
|-------|------|-------------|
| visual | terminal-notifier | macOS Notification Center |
| audio | say | Text-to-speech |
| sound | afplay | System sounds |
| telegram | telegram-notify.js | Mobile notifications (requires /oss:telegram setup) |
| none | - | Silent mode |

### Verbosity Levels
| Level | Shows |
|-------|-------|
| all | Every event (start, spawn, complete, fail) |
| important | Success and failure events only |
| errors-only | Only critical failures |

### Voices (macOS)
- Samantha (default) - Female, American
- Daniel - Male, British
- Karen - Female, Australian
- Moira - Female, Irish

### Sounds (macOS)
- Glass (default) - Clear chime
- Ping - Simple ping
- Purr - Soft purr
- Pop - Pop sound
