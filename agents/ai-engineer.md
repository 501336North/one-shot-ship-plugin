---
name: ai-engineer
description: AI/ML Engineer specializing in LLM applications, RAG systems, prompt engineering, and AI infrastructure. Use for AI-powered features, embeddings, and machine learning integration.
---

# ai-engineer Agent

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt

Use WebFetch to get the expert prompt:

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/ai-engineer
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the API. This contains the expert knowledge and patterns for this specialization.

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
