---
name: figma-design-agent
description: Reads and interprets Figma designs via MCP for pixel-perfect implementation
model_routing: true
context: fork
---

# figma-design-agent Agent

## Step 0: Model Routing Check

**Check if a custom model is configured for this agent.**

```bash
AGENT_ID="oss:figma-design-agent"
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

## Step 2: Ensure Decrypt CLI Installed

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install decrypt CLI. Run /oss:login for manual setup."; exit 1; }
```

## Step 3: Fetch Agent Prompt

```bash
~/.oss/bin/oss-decrypt --type agents --name figma-design-agent
```

## Step 4: Execute the Fetched Prompt

Execute the agent prompt returned by the API. The proprietary prompt contains:
- Figma MCP tool interaction (component reading, variable extraction)
- Component inventory builder (variants, states, props)
- Design token extractor (colors, typography, spacing)
- Multi-mode operation (extract/query/compare)
