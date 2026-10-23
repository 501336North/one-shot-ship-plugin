---
description: Manage OSS notification and preference settings
model: haiku
---

## Help

**Command:** `/oss:settings`

**Description:** Manage OSS notification and preference settings

**Workflow Position:** any time - **SETTINGS** preferences

**Usage:**
```bash
/oss:settings [SUBCOMMAND] [OPTIONS]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | show (default: interactive configuration) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Interactive configuration wizard
/oss:settings

# Display current settings (read-only)
/oss:settings show

# Show help
/oss:settings --help
```

**Related Commands:**
- `/oss:telegram` - Configure Telegram notifications
- `/oss:login` - Configure API key
- `/oss:models` - Configure model routing

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

#> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

## Step 3: Prompt for Changes

Use `AskUserQuestion` tool to let user modify settings:

**Question 1: Notification Style**

First, check if Telegram is linked via API:

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)

if [[ -n "$API_KEY" ]] && API_URL=$(oss_api_url); then
    TELEGRAM_STATUS=$(oss_api_curl "$API_KEY" -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
        -H "Content-Type: application/json")
    TELEGRAM_LINKED=$(echo "$TELEGRAM_STATUS" | jq -r '.linked // false')
else
    TELEGRAM_LINKED="false"
fi
```

```json
{
  "question": "How would you like to be notified?",
  "header": "Style",
  "options": [
    {"label": "Visual", "description": "macOS notification center (terminal-notifier)"},
    {"label": "Audio", "description": "Spoken messages using text-to-speech"},
    {"label": "Sound", "description": "System sounds (Glass, Ping, etc.)"},
    {"label": "Telegram", "description": "Mobile notifications - link account first via /oss:telegram link"},
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

### Step 3.5: Hand Over the Choices

The answers reach the shell through the value folder, never typed into a command. Run:

```bash
~/.oss/hooks/oss-value.sh dir
```

Use the Write tool to write each answer alone, in the spelling shown, to its file in the directory it printed:
- `notify_style.txt`: `visual`, `audio`, `sound`, `telegram` or `none`
- `verbosity.txt`: `all`, `important` or `errors-only`
- `voice.txt` (only when the style is `audio`): `Samantha`, `Daniel`, `Karen` or `Moira`
- `sound.txt` (only when the style is `sound`): `Glass`, `Ping`, `Purr` or `Pop`

If `dir` prints nothing, tell the user the settings were not changed and show its error.

### Step 4: Save, Sync and Test (one Bash call)

Run this block exactly as written. It reads and checks each answer (a value outside its list is refused and nothing is saved), keeps the current voice or sound when that question was not asked, checks the Telegram link itself, and:
- if the user selected Telegram but it is not linked, prints how to link it and falls back to `visual`;
- syncs `telegram.enabled` with the API when Telegram is linked (enabled only when the style is `telegram`), so the server-side state matches local settings;
- writes `~/.oss/settings.json`, sends a test notification in the new style and prints the new configuration.

```bash
V=~/.oss/hooks/oss-value.sh
SETTINGS_FILE="$HOME/.oss/settings.json"
STYLE=$("$V" read notify_style) || exit 1
VERBOSITY=$("$V" read verbosity) || exit 1
VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null) || VOICE="Samantha"
SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null) || SOUND="Glass"
if [[ "$STYLE" == "audio" ]]; then VOICE=$("$V" read voice) || exit 1; fi
if [[ "$STYLE" == "sound" ]]; then SOUND=$("$V" read sound) || exit 1; fi

# Check the Telegram link (true only when the API says exactly true)
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
TELEGRAM_LINKED="false"
if [[ -n "$API_KEY" ]] && API_URL=$(oss_api_url); then
    LINKED=$(oss_api_curl "$API_KEY" -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
        -H "Content-Type: application/json" | jq -r '.linked // false' 2>/dev/null)
    [[ "$LINKED" == "true" ]] && TELEGRAM_LINKED="true"
fi

if [[ "$STYLE" == "telegram" && "$TELEGRAM_LINKED" != "true" ]]; then
    echo ""
    echo "Telegram is not linked yet."
    echo ""
    echo "To link your Telegram account:"
    echo "1. Run: /oss:telegram link"
    echo "2. Click the magic link on your phone"
    echo "3. Press START in Telegram"
    echo "4. Then re-run /oss:settings to select Telegram"
    echo ""
    echo "For now, falling back to 'visual' style."
    STYLE="visual"
fi

# Determine telegram enabled state based on style
if [[ "$STYLE" == "telegram" ]]; then
    TELEGRAM_ENABLED="true"
else
    TELEGRAM_ENABLED="false"
fi

# Sync with API if authenticated and telegram is linked
if [[ -n "$API_KEY" && "$TELEGRAM_LINKED" == "true" ]]; then
    oss_api_curl "$API_KEY" -s --http1.1 -X PATCH "$API_URL/api/v1/telegram/notifications" \
        -H "Content-Type: application/json" \
        -d "{\"enabled\": $TELEGRAM_ENABLED}" > /dev/null
fi

mkdir -p ~/.oss
jq -n --arg style "$STYLE" --arg voice "$VOICE" --arg sound "$SOUND" --arg verbosity "$VERBOSITY" \
    --argjson linked "$TELEGRAM_LINKED" --argjson enabled "$TELEGRAM_ENABLED" \
    '{notifications: {style: $style, voice: $voice, sound: $sound, verbosity: $verbosity, telegram: {linked: $linked, enabled: $enabled}}, version: 2}' \
    > "$SETTINGS_FILE" || exit 1

# Test notification, based on style
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
        # Telegram test is handled by the API - just confirm
        echo "📱 Telegram notifications enabled - you'll receive messages when Claude needs input"
        ;;
    "none")
        echo "Notifications disabled. Settings saved."
        ;;
esac

echo ""
echo "Settings saved to ~/.oss/settings.json"
echo ""
echo "New Configuration:"
echo "  Style:     $STYLE"
echo "  Voice:     $VOICE"
echo "  Sound:     $SOUND"
echo "  Verbosity: $VERBOSITY"
echo ""
echo "Your notifications are now configured!"
```

### Step 5: Confirm

Show the user the block's output (the new configuration). If a read refused a value, nothing was saved: tell the user which answer was not valid.

## Settings Schema

```json
{
  "notifications": {
    "style": "visual" | "audio" | "sound" | "telegram" | "none",
    "voice": "Samantha" | "Daniel" | "Karen" | "Moira",
    "sound": "Glass" | "Ping" | "Purr" | "Pop",
    "verbosity": "all" | "important" | "errors-only",
    "telegram": {
      "linked": true | false,
      "enabled": true | false
    }
  },
  "version": 2
}
```

**Note:** Telegram credentials (chatId) are stored server-side, not locally. Use `/oss:telegram` to manage linking.

## Available Options

### Notification Styles
| Style | Tool | Description |
|-------|------|-------------|
| visual | terminal-notifier | macOS Notification Center |
| audio | say | Text-to-speech |
| sound | afplay | System sounds |
| telegram | API + @OSSDevWorkflowBot | Mobile notifications (link via /oss:telegram link) |
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
