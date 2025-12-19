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

## Step 4: Sync CLAUDE.md with IRON LAWS (Automatic)

After successful authentication, the command automatically syncs project guidelines AND injects the IRON LAWS:

### 4.1: Fetch Template and IRON LAWS from API

1. **Fetch CLAUDE.md template:**
   ```
   GET https://one-shot-ship-api.onrender.com/api/v1/prompts/claude-md
   Headers:
     Authorization: Bearer {apiKey}
   ```

2. **Fetch IRON LAWS (single source of truth):**
   ```
   GET https://one-shot-ship-api.onrender.com/api/v1/prompts/shared/iron-laws
   Headers:
     Authorization: Bearer {apiKey}
   ```

### 4.2: Merge IRON LAWS into Template

After fetching both:

1. **Find the IRON LAWS placeholder** in the template:
   ```markdown
   <!-- IRON LAWS will be injected here by /oss:login -->
   ```

2. **Replace the placeholder** with the full IRON LAWS content:
   ```markdown
   <!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->

   {IRON_LAWS_CONTENT}

   <!-- IRON LAWS END -->
   ```

### 4.3: Update or Create CLAUDE.md

1. **Check if CLAUDE.md exists in current directory:**
   ```bash
   test -f CLAUDE.md && echo "EXISTS" || echo "MISSING"
   ```

2. **If MISSING:** Create new CLAUDE.md with the merged content (template + IRON LAWS)

3. **If EXISTS:**
   - Check if it contains `# OSS Dev Workflow` section
   - If no OSS section: Append the merged content with a separator
   - If OSS section exists: Replace it with fresh version (template + IRON LAWS)

### 4.4: What Gets Synced

**From IRON LAWS (shared/iron-laws endpoint):**
- IRON LAW #1: TDD (with MINIMAL emphasis in GREEN phase)
- IRON LAW #2: Test Philosophy
- IRON LAW #3: Loop Detection Protocol
- IRON LAW #4: Agent Git Flow
- IRON LAW #5: Agent Delegation
- IRON LAW #6: Dev Docs Synchronization
- PROHIBITED section
- Pre-Command Check Summary

**From Template (claude-md endpoint):**
- London TDD methodology overview
- Agent delegation table (which agents to use for what)
- All available `/oss:` commands reference
- Git workflow guidelines
- Quality standards

**Note:** IRON LAWS are the single source of truth. Every `/oss:login` pulls the latest version from the API.

## Step 5: Install Decryption CLI (First Login Only)

After successful authentication, install the decryption CLI for secure prompt delivery:

1. **Create bin directory:**
   ```bash
   mkdir -p ~/.oss/bin
   ```

2. **Download CLI binary for your platform:**
   ```bash
   PLATFORM=$(uname -s)
   ARCH=$(uname -m)
   CLI_URL="https://github.com/oneshotship/oss-decrypt/releases/latest/download/oss-decrypt-${PLATFORM}-${ARCH}"

   echo "Downloading oss-decrypt CLI..."
   curl -sL "$CLI_URL" -o ~/.oss/bin/oss-decrypt
   chmod +x ~/.oss/bin/oss-decrypt
   ```

3. **Setup credentials (requires valid API key):**
   ```bash
   ~/.oss/bin/oss-decrypt --setup
   ```

   This fetches your encryption credentials from the API and stores them securely:
   - `userId` - Your user ID for key derivation
   - `hardwareId` - Device-specific identifier
   - `salt` - Unique salt for key derivation

4. **Verify installation:**
   ```bash
   if [ -x ~/.oss/bin/oss-decrypt ]; then
       echo "CLI installed successfully"
       ~/.oss/bin/oss-decrypt --version
   else
       echo "Warning: CLI installation failed. Prompts will fall back to direct API fetch."
   fi
   ```

**What gets installed:**
- **~/.oss/bin/oss-decrypt** - CLI binary for decrypting prompts locally
- **~/.oss/credentials.enc** - Encrypted credential storage

**Skip this step** if CLI is already installed and working.

## Step 6: Install Notification Tools (First Login Only)

After successful authentication, install tools if not already present:

1. **Check and install terminal-notifier (for macOS notifications):**
   ```bash
   if ! command -v terminal-notifier &>/dev/null; then
       echo "Installing terminal-notifier for macOS notifications..."
       brew install terminal-notifier
   fi
   ```

2. **Create OSS notification icon:**
   ```bash
   mkdir -p ~/.oss
   # Create a simple blue circle icon for OSS notifications
   OSS_ICON_PNG="$HOME/.oss/notification-icon.png"
   if [ ! -f "$OSS_ICON_PNG" ]; then
       # Download or create the OSS icon
       curl -sL "https://www.oneshotship.com/icon.png" -o "$OSS_ICON_PNG" 2>/dev/null || \
       sips -s format png "$CLAUDE_PLUGIN_ROOT/assets/icon.png" --out "$OSS_ICON_PNG" 2>/dev/null || \
       echo "Note: Could not create notification icon. Notifications will work without branding."
   fi
   ```

3. **Check and install SwiftBar (menu bar status):**
   ```bash
   if ! [ -d "/Applications/SwiftBar.app" ]; then
       echo "Installing SwiftBar for workflow status display..."
       brew install --cask swiftbar
   fi
   ```

4. **Configure SwiftBar plugins directory (before first launch):**
   ```bash
   SWIFTBAR_PLUGINS="${HOME}/Library/Application Support/SwiftBar/Plugins"
   mkdir -p "$SWIFTBAR_PLUGINS"

   # Pre-configure SwiftBar to use our plugins directory (avoids first-launch prompt)
   defaults write com.ameba.SwiftBar PluginDirectory -string "$SWIFTBAR_PLUGINS"
   ```

5. **Copy OSS SwiftBar plugin:**
   ```bash
   cp "$CLAUDE_PLUGIN_ROOT/swiftbar/oss-workflow.1s.sh" "$SWIFTBAR_PLUGINS/"
   chmod +x "$SWIFTBAR_PLUGINS/oss-workflow.1s.sh"
   ```

6. **Initialize menu bar state:**
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/update-menubar.js" init
   ```

7. **Launch SwiftBar (if not already running):**
   ```bash
   if ! pgrep -x "SwiftBar" > /dev/null; then
       echo "Starting SwiftBar..."
       open -a SwiftBar
       sleep 2  # Give it time to start and read the plugin
   fi
   ```

8. **Verify SwiftBar is running:**
   ```bash
   if pgrep -x "SwiftBar" > /dev/null; then
       echo "SwiftBar is running. Look for 🤖 in your menu bar!"
   else
       echo "Note: SwiftBar didn't start. You can launch it manually from Applications."
   fi
   ```

**What gets installed:**
- **terminal-notifier** - Reliable macOS notifications with custom icon support
- **SwiftBar** - Shows 🤖 idle / 🤖✓ BUILD / 🤖⚡ intervening in menu bar
- **OSS Plugin** - SwiftBar plugin that reads ~/.oss/workflow-state.json

**Skip this step** if tools are already installed and running.

## Step 7: Configure Notifications (First Login Only)

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
           terminal-notifier -title "Welcome to OSS!" \
               -message "Notifications configured" \
               -appIcon "$HOME/.oss/notification-icon.png"
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
