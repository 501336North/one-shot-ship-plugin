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
cat ~/.oss/config.json 2>/dev/null | grep apiKey
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

## Step 3: Fetch Agent Prompt with RAG

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/visionos-developer?context={user_context}
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

The API will:
1. Query Pinecone for relevant Apple documentation
2. Prepend the RAG context to the expert prompt
3. Return the enhanced prompt with current API references

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
