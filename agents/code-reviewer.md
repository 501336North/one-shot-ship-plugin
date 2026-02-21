---
name: code-reviewer
description: Expert code reviewer. Use for thorough code review, identifying bugs, security issues, and code quality improvements.
model_routing: true
context: fork
background: true
---

# code-reviewer Agent

## Step 0: Model Routing Check

**Check if a custom model is configured for this agent.**

```bash
AGENT_ID="oss:code-reviewer"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"
MODEL_CHECK="$PLUGIN_ROOT/watcher/dist/cli/agent-model-check.js"

if [[ -f "$MODEL_CHECK" ]]; then
    ROUTING=$(node "$MODEL_CHECK" --agent "$AGENT_ID" 2>/dev/null || echo '{"useProxy":false}')
    USE_PROXY=$(echo "$ROUTING" | jq -r '.useProxy // false' 2>/dev/null || echo "false")

    if [[ "$USE_PROXY" == "true" ]]; then
        MODEL=$(echo "$ROUTING" | jq -r '.model')
        echo "Routing to custom model: $MODEL"
        # Execute via model proxy instead of native Claude
        # The proxy handles API transformation and provider routing
    fi
fi
```

If `useProxy` is true, the task will be executed via the configured model (e.g., Ollama, OpenRouter).
If `useProxy` is false or check unavailable, proceed with native Claude execution below.

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
URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/code-reviewer
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
