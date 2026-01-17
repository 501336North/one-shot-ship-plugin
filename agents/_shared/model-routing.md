# Model Routing Pre-Check

**This section enables per-prompt model routing. Include at the START of agent execution.**

## Step 1: Check for Custom Model Configuration

Before proceeding with the main task, check if a custom model is configured for this agent:

```bash
AGENT_NAME="$AGENT_ID"  # Set by the agent (e.g., "oss:code-reviewer")
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"
MODEL_CHECK="$PLUGIN_ROOT/watcher/dist/cli/agent-model-check.js"

if [[ -f "$MODEL_CHECK" ]]; then
    ROUTING=$(node "$MODEL_CHECK" --agent "$AGENT_NAME" 2>/dev/null)
    USE_PROXY=$(echo "$ROUTING" | jq -r '.useProxy // false')

    if [[ "$USE_PROXY" == "true" ]]; then
        MODEL=$(echo "$ROUTING" | jq -r '.model')
        PROVIDER=$(echo "$ROUTING" | jq -r '.provider')
        PROXY_URL=$(echo "$ROUTING" | jq -r '.proxyUrl')

        echo "Using custom model: $MODEL via $PROVIDER"
        # Route execution through proxy (see Step 2)
    fi
fi
```

## Step 2: Proxy Execution (When Custom Model Configured)

If `useProxy` is `true`, route the request through our model proxy:

1. **Start the proxy** (if not running):
   ```bash
   # Check if proxy is already running
   if ! curl -s "http://localhost:3456/health" > /dev/null 2>&1; then
       node "$PLUGIN_ROOT/watcher/dist/cli/start-proxy.js" --model "$MODEL" --port 3456 --background
   fi
   ```

2. **Execute via proxy** using WebFetch:
   - URL: `http://localhost:3456/v1/messages`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Body: Standard Anthropic API format

   Example request body:
   ```json
   {
     "model": "claude-3-opus-20240229",
     "max_tokens": 4096,
     "messages": [
       {"role": "user", "content": "Your task here"}
     ]
   }
   ```

3. **Parse response** and continue with results
   - Response is in standard Anthropic format
   - Extract `content[0].text` for the response text
   - Usage data (`input_tokens`, `output_tokens`) included for cost tracking

## Step 3: Native Execution (Default)

If `useProxy` is `false` or the check is unavailable:
- Proceed with normal Claude Code execution
- This uses the user's Claude Code monthly plan
- No additional configuration needed

## Configuration Reference

Users configure models in `~/.oss/config.json` or `.oss/config.json`:

**Per-Command Configuration:**
```json
{
  "models": {
    "default": "claude",
    "fallbackEnabled": true,
    "commands": {
      "oss:build": "ollama/qwen2.5-coder:7b",
      "oss:code-reviewer": "ollama/codellama"
    }
  }
}
```

**Per-Agent Configuration:**
```json
{
  "models": {
    "agents": {
      "oss:code-reviewer": "ollama/codellama",
      "oss:test-engineer": "openrouter/deepseek/deepseek-coder"
    }
  }
}
```

**Precedence**: CLI Override > Project Config > User Config > Frontmatter > Default (Claude)

## Supported Providers

| Provider | Example Model | Requires |
|----------|--------------|----------|
| Ollama | `ollama/codellama` | Ollama running locally |
| OpenRouter | `openrouter/deepseek/chat` | `OPENROUTER_API_KEY` or `--api-key` |
| Claude | `default` or `claude` | Claude Code subscription |

## Proxy Health Check

The proxy exposes a health endpoint to verify it's running:

```bash
curl http://localhost:3456/health
```

Response:
```json
{
  "healthy": true,
  "provider": "ollama",
  "model": "codellama"
}
```

## Proxy Shutdown

When the agent completes, stop the proxy:

```bash
# Find and stop the proxy process
PID_FILE="$HOME/.oss/proxy.pid"
if [[ -f "$PID_FILE" ]]; then
    kill $(cat "$PID_FILE") 2>/dev/null || true
fi
```

Or send SIGTERM/SIGINT to the proxy process for graceful shutdown.

## Error Handling

If the proxy fails to start or becomes unhealthy:
1. Log the error for debugging
2. If `fallbackEnabled` is true, fall back to Claude
3. If `fallbackEnabled` is false, report the error

## Cost Tracking

Usage data flows through the proxy response:
```json
{
  "usage": {
    "input_tokens": 150,
    "output_tokens": 500
  }
}
```

For Ollama models, this counts as $0 since they run locally.
For OpenRouter, the usage contributes to your OpenRouter bill.
