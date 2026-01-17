---
description: Configure API key for OSS Dev Workflow
---

## Help

**Command:** `/oss:login`

**Description:** Configure API key for OSS Dev Workflow

**Workflow Position:** **LOGIN** -> [any command]

**Usage:**
```bash
/oss:login [API_KEY]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `API_KEY` | No | Your OSS API key (prompts if not provided) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Interactive login (prompts for API key)
/oss:login

# Direct login with API key
/oss:login ak_xxxxx
```

**Related Commands:**
- `/oss:status` - Check subscription status
- `/oss:settings` - Configure notification preferences
- `/oss:telegram` - Set up Telegram notifications

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
   ```bash
   ~/.oss/hooks/fetch-iron-laws.sh
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
   # Map architecture: x86_64 -> x64, arm64 stays arm64
   [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
   CLI_URL="https://github.com/501336North/AgenticDevWorkflow/releases/latest/download/oss-decrypt-${PLATFORM}-${ARCH}"

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

3. **Configure Claude Code status line:**
   ```bash
   # Copy status line script
   cp "~/.oss/hooks/oss-statusline.sh" "$HOME/.oss/"
   chmod +x "$HOME/.oss/oss-statusline.sh"

   # Configure Claude Code to use it (user must do this manually via UI or settings)
   echo "Status line script installed at ~/.oss/oss-statusline.sh"
   echo "To enable: Claude Code Settings > Status Line > Command: ~/.oss/oss-statusline.sh"
   ```

4. **Initialize workflow state:**
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js" init
   ```

5. **Verify status line script exists:**
   ```bash
   if [ -x "$HOME/.oss/oss-statusline.sh" ]; then
       echo "Status line script installed successfully!"
   else
       echo "Note: Status line script not found. Workflow status will not be displayed."
   fi
   ```

**What gets installed:**
- **terminal-notifier** - Reliable macOS notifications with custom icon support
- **Status line script** - Shows workflow phase, progress, and supervisor status in Claude Code

**Skip this step** if tools are already installed and running.

## Step 7: Install Supervisor Daemon (First Login Only)

After tools are installed, set up the supervisor daemon for process monitoring.

**First, check if daemon is included in this plugin version:**
```bash
if [ ! -d "$CLAUDE_PLUGIN_ROOT/daemon" ]; then
    echo "Daemon not included in current plugin version. Skipping daemon setup."
    # Skip to Step 8
fi
```

**If daemon directory exists, proceed with setup:**

1. **Build daemon package (if needed):**
   ```bash
   cd "$CLAUDE_PLUGIN_ROOT/daemon"
   if [ ! -d "dist" ]; then
       npm run build
   fi
   ```

2. **Create launchd plist for daemon:**
   ```bash
   OSS_DIR="${HOME}/.oss"
   PLIST_PATH="${HOME}/Library/LaunchAgents/com.oneshotship.daemon.plist"

   if [ ! -f "$PLIST_PATH" ]; then
       mkdir -p "$(dirname "$PLIST_PATH")"

       cat > "$PLIST_PATH" << EOF
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.oneshotship.daemon</string>
       <key>ProgramArguments</key>
       <array>
           <string>node</string>
           <string>${CLAUDE_PLUGIN_ROOT}/daemon/bin/oss-daemon.js</string>
           <string>start</string>
       </array>
       <key>WorkingDirectory</key>
       <string>${OSS_DIR}</string>
       <key>RunAtLoad</key>
       <true/>
       <key>KeepAlive</key>
       <true/>
       <key>StandardOutPath</key>
       <string>${OSS_DIR}/daemon.log</string>
       <key>StandardErrorPath</key>
       <string>${OSS_DIR}/daemon.error.log</string>
   </dict>
   </plist>
   EOF
       echo "Created launchd plist at $PLIST_PATH"
   fi
   ```

3. **Load daemon service:**
   ```bash
   if ! launchctl list | grep -q "com.oneshotship.daemon"; then
       launchctl load "$PLIST_PATH"
       echo "OSS Daemon started"
   fi
   ```

4. **Verify daemon is running:**
   ```bash
   if launchctl list | grep -q "com.oneshotship.daemon"; then
       echo "Supervisor daemon is running"
   else
       echo "Note: Daemon didn't start. You can start it manually with: launchctl load $PLIST_PATH"
   fi
   ```

**What the daemon does:**
- Monitors for hung test processes (vitest, npm test, jest)
- Kills processes that exceed timeout thresholds
- Tracks system resource usage
- Runs periodic health checks
- Logs activity to ~/.oss/daemon.log

**Skip this step** if daemon is already installed and running.

## Step 8: Configure Claude Code Status Line (First Login Only)

Set up the status line script to show TDD phase in Claude Code's terminal:

1. **Create status line script:**
   ```bash
   STATUSLINE_SCRIPT="${HOME}/.oss/oss-statusline.sh"
   if [ ! -f "$STATUSLINE_SCRIPT" ]; then
       cp "~/.oss/hooks/oss-statusline.sh" "$STATUSLINE_SCRIPT"
       chmod +x "$STATUSLINE_SCRIPT"
       echo "Created status line script at $STATUSLINE_SCRIPT"
   fi
   ```

2. **Initialize workflow state (if not exists):**
   ```bash
   WORKFLOW_FILE="${HOME}/.oss/workflow-state.json"
   if [ ! -f "$WORKFLOW_FILE" ]; then
       echo '{"supervisor": "idle", "currentCommand": null, "tddPhase": null}' > "$WORKFLOW_FILE"
   fi
   ```

3. **Configure Claude Code settings (automatic):**
   ```bash
   CLAUDE_SETTINGS="${HOME}/.claude/settings.json"

   # Read existing settings or create empty object
   if [ -f "$CLAUDE_SETTINGS" ]; then
       SETTINGS=$(cat "$CLAUDE_SETTINGS")
   else
       mkdir -p "${HOME}/.claude"
       SETTINGS='{}'
   fi

   # Add statusLine configuration using jq
   UPDATED=$(echo "$SETTINGS" | jq '. + {
       "statusLine": {
           "type": "command",
           "command": "~/.oss/oss-statusline.sh",
           "padding": 0
       }
   }')

   echo "$UPDATED" > "$CLAUDE_SETTINGS"
   echo "Configured Claude Code status line"
   ```

4. **Verify status line:**
   ```bash
   if [ -x "$STATUSLINE_SCRIPT" ]; then
       echo "Status line script ready"
       echo "When TDD phase is active, you'll see: [Claude] 🔴 RED 3/8"
   fi
   ```

**What the status line shows:**
```
[Opus] ProjectName | 🌿 feat/my-feature | 🔴 RED ✓
```
- **[Model]** - Current Claude model
- **ProjectName** - Current directory name
- **🌿 branch** - Feature branch (main shown without emoji)
- **🔴 RED / 🟢 GREEN / 🔵 REFACTOR** - TDD phase
- **🤖 command** - Active workflow command (when no TDD phase)
- **✓** - Supervisor watching
- **⚡** - Supervisor intervening

**Skip this step** if status line is already configured.

## Step 9: Configure Notifications (First Login Only)

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
