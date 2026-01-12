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
   node "$PLUGIN_ROOT/watcher/dist/cli/start-proxy.js" --port 3456 --model "$MODEL"
   ```

2. **Execute via proxy** using WebFetch:
   - URL: `http://localhost:3456/v1/messages`
   - Method: POST
   - Headers: `Content-Type: application/json`
   - Body: Standard Anthropic API format with task

3. **Parse response** and continue with results

## Step 3: Native Execution (Default)

If `useProxy` is `false` or the check is unavailable:
- Proceed with normal Claude Code execution
- This uses the user's Claude Code monthly plan
- No additional configuration needed

## Configuration Reference

Users configure models in `~/.oss/config.json` or `.oss/config.json`:

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
| OpenRouter | `openrouter/deepseek/chat` | `OPENROUTER_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |
| Gemini | `gemini/gemini-2.0-flash` | `GEMINI_API_KEY` |
| Claude | `default` or `claude` | Claude Code subscription |
