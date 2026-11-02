---
name: visionos-developer
description: Expert VisionOS/Apple Vision Pro developer with RAG-powered Apple documentation. Use for visionOS apps, RealityKit, ARKit, spatial computing, immersive experiences, hand tracking, and 3D content. Auto-activates when detecting VisionOS-related questions.
---

# VisionOS Developer Agent

Expert spatial computing developer powered by live Apple documentation via RAG.

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
grep -q '"apiKey"' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Extract User Context

Identify the user's specific VisionOS question or task. This will be used to fetch relevant Apple documentation via RAG.

**Example contexts:**
- "How do I track hands?" → context=hand+tracking+ARKit
- "Create an immersive space" → context=ImmersiveSpace+visionOS
- "Add 3D models" → context=RealityKit+ModelEntity

## Step 3: Fetch and Decrypt Agent Prompt

Ensure the decrypt CLI is installed:

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type agents --name visionos-developer
```

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

The decrypt CLI cannot send the user context, so the prompt comes without the RAG Apple documentation snippets. Use the context from Step 2 to focus the work.

## Step 4: Execute the Enhanced Prompt

Execute the fetched prompt which now includes:
- Relevant Apple documentation snippets
- Expert VisionOS development patterns
- Current API signatures and best practices

## What You Get

The RAG-enhanced visionos-developer agent provides:
- **Current API knowledge** from 6,500+ Apple docs
- **Correct API signatures** that compile against latest visionOS SDK
- **Best practices** for spatial computing UX
- **Production patterns** for ARKit, RealityKit, SwiftUI

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

### If RAG returns no context
The agent will still work using the base expert prompt - just without the supplementary documentation.
