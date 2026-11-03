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
| `decisions off\|on\|status` | No | Turn the decision push off or on for you on this machine (and for your team if you are its owner or admin), or show both |

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

# Turn the decision push off for you on this machine (and your team, if you are its owner or admin), back on, or show it
/oss:settings decisions off
/oss:settings decisions on
/oss:settings decisions status

# Show help
/oss:settings --help
```

**Related Commands:**
- `/oss:login` - Configure API key
- `/oss:models` - Configure model routing

---

# /oss:settings - Manage OSS Settings

Display and modify OSS preferences including notifications, voices, and sounds.

## Usage

```bash
/oss:settings              # Show current settings interactively
/oss:settings show         # Display current settings
/oss:settings decisions off|on|status   # The decision push: yours, and your team's (owner or admin)
/oss:settings --help       # Display help and usage information
```

## Step 0: Check for --help Flag

If `--help` is passed, display usage information and exit:

```
/oss:settings - Manage OSS notification and preference settings

USAGE:
  /oss:settings              Show current settings interactively
  /oss:settings show         Display current settings (read-only)
  /oss:settings decisions off      Stop sending your picker answers on this machine
                                   (and your team's, if you are its owner or admin)
  /oss:settings decisions on       Send them again
  /oss:settings decisions status   Show your setting and your team's
  /oss:settings --help       Display this help message

OPTIONS:
  --help                     Show help and usage information

NOTIFICATION STYLES:
  visual     macOS Notification Center (terminal-notifier)
  audio      Spoken messages using text-to-speech
  sound      System sounds (Glass, Ping, etc.)
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

DECISION RECORD:
  Each picker answer (the question, its options, your pick and your note,
  never code) is sent to your OSS account to build your team's decision
  record. It is redacted (secrets and tokens removed) and capped in length.
  Only answers you gave on this machine are sent, under your account.
  On by default. Anyone can turn it off for themselves on this machine;
  a team owner or admin also turns it off for the whole team.
  Answers given while the push is off are never sent, even later.
  If ~/.oss/settings.json cannot be read, the push stays off.

SETTINGS FILE:
  ~/.oss/settings.json

EXAMPLES:
  /oss:settings              # Interactive configuration wizard
  /oss:settings show         # View current settings without changing
  /oss:settings --help       # Show this help message
```

**If --help is detected, output the above and do not proceed with the interactive flow.**

## Step 0.5: The Decision Push (`decisions off|on|status`)

If the argument starts with `decisions`, look at the rest of the argument and run EXACTLY ONE of these three
fixed Bash commands, copied as written. Never put anything the person typed into the command.

| The rest of the argument is exactly | Run |
|---|---|
| `off` | the first command below |
| `on` | the second command below |
| `status` | the third command below |

```bash
~/.oss/hooks/oss-decisions-policy.sh off
```

```bash
~/.oss/hooks/oss-decisions-policy.sh on
```

```bash
~/.oss/hooks/oss-decisions-policy.sh status
```

For anything else (no word, another word, more than one word), run nothing and print this line:

```
Usage: /oss:settings decisions off|on|status
```

Print the command's one line to the person exactly as it comes, and STOP: no settings file edits, no
questions, no interactive flow. (`off` turns the push off for this person on this machine, and for their team
too when they are its owner or admin; `on` reverses both; `status` shows both. `status` prints one more line
first when the decision record last refused to write an answer through a symlink; print it too.)

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

### Step 3.5: Hand Over the Choices

The answers reach the shell through the value folder, never typed into a command. Run:

```bash
~/.oss/hooks/oss-value.sh dir
```

Use the Write tool to write each answer alone, in the spelling shown, to its file in the directory it printed:
- `notify_style.txt`: `visual`, `audio`, `sound` or `none`
- `verbosity.txt`: `all`, `important` or `errors-only`
- `voice.txt` (only when the style is `audio`): `Samantha`, `Daniel`, `Karen` or `Moira`
- `sound.txt` (only when the style is `sound`): `Glass`, `Ping`, `Purr` or `Pop`

If `dir` prints nothing, tell the user the settings were not changed and show its error.

### Step 4: Save and Test (one Bash call)

Run this block exactly as written. It reads and checks each answer (a value outside its list is refused and nothing is saved), keeps the current voice or sound when that question was not asked, merges the choices into `~/.oss/settings.json` (every other setting is kept, except the retired Telegram settings, which are removed; a symlink is followed to the file it leads to, which is updated in its place; a link to nothing, a link loop, a folder, a FIFO, a file that is not yours or is not exactly one JSON object is refused and left as it is, and the file is saved owner-only (600): the same rule as every other settings.json writer), sends a test notification in the new style and prints the new configuration.

```bash
V=~/.oss/hooks/oss-value.sh
SETTINGS_FILE="$HOME/.oss/settings.json"
STYLE=$("$V" read notify_style) || exit 1
VERBOSITY=$("$V" read verbosity) || exit 1
mkdir -p ~/.oss
# a link is followed to its file; a link to nothing, a loop or no plain file is refused (and never read) with why
source ~/.oss/hooks/oss-api-curl.sh || exit 1
WHY=$(oss_settings_why); [[ -z "$WHY" ]] || { echo "Not saved: $WHY." >&2; exit 1; }
oss_settings_writable \
    || { echo "Not saved: ~/.oss/settings.json is not valid JSON (exactly one object) or is not yours; it was left as it is. Fix or remove it, then run /oss:settings again." >&2; exit 1; }
VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null) || VOICE="Samantha"
SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null) || SOUND="Glass"
if [[ "$STYLE" == "audio" ]]; then VOICE=$("$V" read voice) || exit 1; fi
if [[ "$STYLE" == "sound" ]]; then SOUND=$("$V" read sound) || exit 1; fi

# Merge: only notifications.{style,voice,sound,verbosity} and version change and the retired telegram keys are removed; every other key is kept
oss_settings_update --arg s "$STYLE" --arg v "$VOICE" --arg so "$SOUND" --arg vb "$VERBOSITY" \
    '.notifications = ((.notifications // {}) + {style: $s, voice: $v, sound: $so, verbosity: $vb}) | .version = 2 | del(.telegram, .notifications.telegram)' \
    || { echo "Not saved: ~/.oss/settings.json could not be written; it was left as it is." >&2; exit 1; }

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

Show the user the block's output (the new configuration). If a read refused a value, nothing was saved: tell the user which answer was not valid. If it printed "Not saved", show that line: settings.json was left as it is.

## Settings Schema

```json
{
  "notifications": {
    "style": "visual" | "audio" | "sound" | "none",
    "voice": "Samantha" | "Daniel" | "Karen" | "Moira",
    "sound": "Glass" | "Ping" | "Purr" | "Pop",
    "verbosity": "all" | "important" | "errors-only"
  },
  "version": 2
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
