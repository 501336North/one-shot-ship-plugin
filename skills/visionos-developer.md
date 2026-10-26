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
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt

Fetch and decrypt the expert prompt (checked against the signed manifest; it comes from the API your OSS config names):

```bash
~/.oss/bin/oss-decrypt --type agents --name visionos-developer
```

## Step 3: Execute the Prompt

Execute the fetched prompt, which includes:
- Expert VisionOS development patterns
- Current API signatures and best practices

## What You Get

The visionos-developer agent provides:
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
