---
name: visionos-developer
description: Expert VisionOS/Apple Vision Pro developer. Expert VisionOS developer specializing in spatial computing, immersive experiences, and Apple Vision Pro applications. Masters RealityKit, SwiftUI 3D, ARKit, and visionOS-specific APIs. Use PROACTIVELY for VisionOS app development, spatial UI design, 3D content integration, and immersive space creation.
---

# VisionOS Developer Agent

Expert spatial computing developer.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt

Fetch and decrypt the expert prompt (checked against the signed manifest; it comes from the API your OSS config names):

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

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
