---
description: Configure API key for OSS Dev Workflow
---

# /oss:login - Authenticate

Configure your API key for OSS Dev Workflow access.

## API Configuration

**API Base URL:** `https://one-shot-ship-api.onrender.com`

## What This Command Does

1. **Prompts for API key** - Or accepts as argument
2. **Validates key** - Tests against API at `https://one-shot-ship-api.onrender.com/api/v1/subscription/status`
3. **Stores securely** - Saves to `~/.oss/config.json`
4. **Confirms access** - Shows subscription status

## Step 1: Get API Key

Get your API key from: https://www.oneshotship.com/dashboard

## Step 2: Configure

Enter your API key when prompted, or pass it directly:

```bash
/oss:login YOUR_API_KEY
```

## Step 3: Verification

The command will:
1. Create `~/.oss/` directory if needed
2. Store API key in `~/.oss/config.json` with format: `{"apiKey": "YOUR_KEY", "apiUrl": "https://one-shot-ship-api.onrender.com"}`
3. Verify key by calling: `curl -H "Authorization: Bearer YOUR_KEY" https://one-shot-ship-api.onrender.com/api/v1/subscription/status`
4. Display subscription status (trial, active, expired)

## Step 4: Sync CLAUDE.md (Automatic)

After successful authentication, the command automatically syncs project guidelines:

1. **Fetch template from API:**
   ```
   GET https://one-shot-ship-api.onrender.com/api/v1/prompts/claude-md
   Headers:
     Authorization: Bearer {apiKey}
   ```

2. **Check if CLAUDE.md exists in current directory:**
   ```bash
   test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
   ```

3. **If MISSING:** Create new CLAUDE.md with the fetched OSS Dev Workflow guidelines

4. **If EXISTS:**
   - Check if it contains `# OSS Dev Workflow` section
   - If no OSS section: Append the fetched content with a separator
   - If OSS section exists: Replace it with fresh version from API

**What gets synced:**
- London TDD methodology rules
- Agent delegation table (which agents to use for what)
- All available `/oss:` commands reference
- Git workflow (Agent Git Flow) guidelines
- Quality standards

**Note:** This only syncs guidelines, NOT proprietary prompts. The actual workflow logic stays on the API.

## Step 5: Install Modern Notification Tools (First Login Only)

After successful authentication, install tools if not already present:

1. **Check and install SwiftBar (menu bar status):**
   ```bash
   if ! command -v swiftbar &>/dev/null && ! [ -d "/Applications/SwiftBar.app" ]; then
       echo "Installing SwiftBar for workflow status display..."
       brew install --cask swiftbar
   fi
   ```

2. **Copy SwiftBar plugin:**
   ```bash
   SWIFTBAR_PLUGINS="${HOME}/Library/Application Support/SwiftBar/Plugins"
   mkdir -p "$SWIFTBAR_PLUGINS"
   cp "$CLAUDE_PLUGIN_ROOT/swiftbar/oss-workflow.1s.sh" "$SWIFTBAR_PLUGINS/"
   chmod +x "$SWIFTBAR_PLUGINS/oss-workflow.1s.sh"
   ```

3. **Check and install Jamf Notifier (modern notifications):**
   ```bash
   NOTIFIER_APP="/Applications/Utilities/Notifier.app"
   if [ ! -d "$NOTIFIER_APP" ]; then
       echo "Installing Jamf Notifier for modern macOS notifications..."
       # Download latest release
       NOTIFIER_URL="https://github.com/jamf/Notifier/releases/download/3.1/Notifier-3.1.pkg"
       NOTIFIER_PKG="/tmp/Notifier.pkg"
       curl -L -o "$NOTIFIER_PKG" "$NOTIFIER_URL"
       sudo installer -pkg "$NOTIFIER_PKG" -target /
       rm "$NOTIFIER_PKG"
   fi
   ```

4. **Initialize menu bar state:**
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/update-menubar.js" init
   ```

5. **Prompt to launch SwiftBar:**
   ```
   SwiftBar installed! Launch it to see workflow status in your menu bar.
   Open SwiftBar? [Y/n]
   ```
   If yes: `open -a SwiftBar`

**What gets installed:**
- **SwiftBar** - Shows 🤖✓ BUILD in menu bar with full chain dropdown
- **Jamf Notifier** - Modern native macOS notifications (UserNotifications framework)
- **OSS Plugin** - SwiftBar plugin that reads ~/.oss/workflow-state.json

**Skip this step** if both tools are already installed.

## Step 6: Configure Notifications (First Login Only)

After tools are installed, if `~/.oss/settings.json` does NOT exist:

1. **Prompt for notification preference:**
   ```json
   {
     "question": "How would you like to be notified about workflow progress?",
     "header": "Notifications",
     "options": [
       {"label": "Visual", "description": "macOS notification center (recommended)"},
       {"label": "Audio", "description": "Spoken messages using text-to-speech"},
       {"label": "Sound", "description": "System sounds (Glass, Ping, etc.)"},
       {"label": "None", "description": "Silent mode - no notifications"}
     ],
     "multiSelect": false
   }
   ```

2. **Save settings to `~/.oss/settings.json`:**
   ```bash
   mkdir -p ~/.oss
   cat > ~/.oss/settings.json << EOF
   {
     "notifications": {
       "style": "$STYLE",
       "voice": "Samantha",
       "sound": "Glass",
       "verbosity": "important"
     },
     "version": 1
   }
   EOF
   ```

3. **Show preview notification (respects user's choice):**
   ```bash
   case "$STYLE" in
       "visual")
           /Applications/Utilities/Notifier.app/Contents/MacOS/Notifier \
               --type banner \
               --title "Welcome to OSS!" \
               --message "Notifications configured"
           ;;
       "audio")
           say -v "$VOICE" "Welcome to OSS Dev Workflow!"
           ;;
       "sound")
           afplay "/System/Library/Sounds/$SOUND.aiff"
           ;;
       "none")
           echo "Notifications disabled. You can change this with /oss:settings"
           ;;
   esac
   ```
   Note: `$VOICE` and `$SOUND` come from saved settings (default: Samantha, Glass)

4. **Confirm:**
   ```
   Notifications configured: $STYLE
   Change anytime with /oss:settings
   ```

**Skip this step** if `~/.oss/settings.json` already exists (returning user).

## Example Usage

```bash
# Interactive login
/oss:login

# Direct login with API key
/oss:login ak_xxxxx

# Check current status
/oss:status
```

## Config File Format

After login, `~/.oss/config.json` will contain:
```json
{
  "apiKey": "ak_xxxxx",
  "apiUrl": "https://one-shot-ship-api.onrender.com"
}
```

## Troubleshooting

### Invalid API Key
```
Get a valid key from https://www.oneshotship.com/dashboard
```

### Network Error
```
Check internet connection and try again
API endpoint: https://one-shot-ship-api.onrender.com/api/v1/subscription/status
```
