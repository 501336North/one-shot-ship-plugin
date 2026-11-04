---
name: visionos-developer
description: Expert VisionOS/Apple Vision Pro developer. Use for visionOS apps, RealityKit, ARKit, spatial computing, immersive experiences, hand tracking, and 3D content. Auto-activates when detecting VisionOS-related questions.
---

# VisionOS Developer Agent

Expert spatial computing developer.

## When This Skill Activates

This skill should be used when the user asks about:
- VisionOS or Apple Vision Pro development
- RealityKit, SwiftUI 3D, or spatial UI
- ARKit hand tracking, scene reconstruction, or world tracking
- Immersive spaces, volumes, or windows in visionOS
- 3D content, spatial gestures, or spatial audio
- Reality Composer Pro

## Step 1: Check Authentication

```bash
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Identify the Task

Identify the user's specific VisionOS question or task and keep it in view while you work. The fetched prompt is the same for every request.

## Step 3: Fetch and Decrypt Agent Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type agents --name visionos-developer
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

The fetched prompt is the shared visionOS expert prompt and carries no reference material fetched for this request. Where you are unsure of a current API signature, say so rather than guess.

## Step 4: Execute the Prompt

Execute the fetched prompt for the task identified in Step 2.

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```
