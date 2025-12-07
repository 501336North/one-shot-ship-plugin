---
name: settings
description: Manage OSS notification and preference settings
---

# /oss:settings - Manage OSS Settings

Display and modify OSS preferences including notifications, voices, and sounds.

## Usage

```bash
/oss:settings              # Show current settings interactively
/oss:settings show         # Display current settings
```

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
```json
{
  "question": "How would you like to be notified?",
  "header": "Style",
  "options": [
    {"label": "Visual", "description": "macOS notification center (terminal-notifier)"},
    {"label": "Audio", "description": "Spoken messages using text-to-speech"},
    {"label": "Sound", "description": "System sounds (Glass, Ping, etc.)"},
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

### Step 4: Save Settings

Write updated settings to `~/.oss/settings.json`:

```bash
mkdir -p ~/.oss
cat > ~/.oss/settings.json << EOF
{
  "notifications": {
    "style": "$STYLE",
    "voice": "$VOICE",
    "sound": "$SOUND",
    "verbosity": "$VERBOSITY"
  },
  "version": 1
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
    "style": "visual" | "audio" | "sound" | "none",
    "voice": "Samantha" | "Daniel" | "Karen" | "Moira",
    "sound": "Glass" | "Ping" | "Purr" | "Pop",
    "verbosity": "all" | "important" | "errors-only"
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
