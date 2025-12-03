---
description: Incident response protocol for production emergencies
---

# /oss:incident - Incident Response

Incident response protocol for production emergencies with blameless postmortem.

## What This Command Does

1. **Incident triage** - Severity assessment
2. **Communication** - Stakeholder notification
3. **Resolution tracking** - Action items
4. **Postmortem** - Blameless analysis

## Step 1: Check Authentication

```bash
cat ~/.oss/config.json 2>/dev/null | grep apiKey
```

## Step 2: Fetch Prompt from API

```
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/workflows/incident
Method: GET
Headers:
  Authorization: Bearer {apiKey}
```

## Step 3: Execute the Fetched Prompt

The prompt guides:
- Incident declaration
- Impact assessment
- Mitigation steps
- Communication templates
- Postmortem creation

## Example Usage

```bash
/oss:incident
/oss:incident --severity critical
```
