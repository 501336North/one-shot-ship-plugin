---
name: figma-design-agent
description: Reads and interprets Figma designs via MCP for pixel-perfect implementation
model_routing: true
context: fork
---
<!-- OSS-ROUTE-AGENT: oss:figma-design-agent -->

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

    BANNER=$(echo "$ROUTING" | jq -r '.banner // empty' 2>/dev/null)
    # Surface the model at the top of output on EVERY surface (terminal, VS Code, web) — for BOTH
    # routed agents (custom/local model) and native agents (their Claude tier).
    [[ -n "$BANNER" ]] && echo "$BANNER"
    if [[ "$USE_PROXY" == "true" ]]; then
        MODEL=$(echo "$ROUTING" | jq -r '.model')
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

## Step 2.5: Local-Model Offload (opt-in, config-gated)

**If a custom/local model is configured for this agent, run the agent's work on THAT model
instead of reasoning here on Claude.** This fires ONLY when `~/.oss/config.json` maps this
agent to a non-Claude model (e.g. `ollama/gpt-oss:120b`). With no mapping (the default), this
is a no-op — skip to Step 3 and run natively.

1. Assemble the prompt — write the **expert prompt fetched in Step 2**, a separator, then the
   **exact task you were given** (the code/diff/files to act on) — to a temp file (use the Write tool):

   ```bash
   PROMPT_FILE="$(mktemp /tmp/oss-offload-figma-design-agent.XXXXXX.md)"
   # Write into $PROMPT_FILE:
   #   <expert prompt from Step 2>
   #   \n\n---\n\n
   #   <the task/context you received>
   ```

2. Run the offloader (it spawns a nested Claude session pointed at your local model via the
   :8473 proxy, with full tools in the current repo dir):

   ```bash
   AGENT_ID="oss:figma-design-agent"
   PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"
   OFFLOAD="$PLUGIN_ROOT/watcher/dist/cli/agent-offload.js"
   if [[ -f "$OFFLOAD" ]]; then
     node "$OFFLOAD" --agent "$AGENT_ID" --prompt-file "$PROMPT_FILE" --project-dir "$(pwd)"
   else
     echo '{"offloaded":false,"reason":"native"}'
   fi
   ```

3. Parse the JSON result:
   - **`offloaded: true`** → the local model did the work (generative agents: file edits already
     landed in the repo). Present its `output` as your result. **STOP — do NOT re-run the work
     on Claude in Step 3.**
   - **`offloaded: false`** → run natively: proceed to Step 3. (Covers the default
     no-model-configured case and any `fallback` after a local failure — your workflow never breaks.)

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
