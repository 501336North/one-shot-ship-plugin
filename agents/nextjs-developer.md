---
name: nextjs-developer
description: Expert Next.js developer mastering Next.js 14+ with App Router and full-stack features. Specializes in server components, server actions, performance optimization, and production deployment with focus on building fast, SEO-friendly applications.
model_routing: true
---
<!-- OSS-ROUTE-AGENT: oss:nextjs-developer -->

# nextjs-developer Agent

## Step 0: Model Routing Check

**Check if a custom model is configured for this agent.**

```bash
AGENT_ID="oss:nextjs-developer"
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
test -f "$HOME/.oss/config.json" && grep -qE '"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]' "$HOME/.oss/config.json" && echo "API key configured"
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch and Decrypt Agent Prompt

Ensure the decrypt CLI is installed:

Run this step with a Bash timeout of 600000 ms (10 minutes): a first install downloads about 60 MB. Exit 0: continue. Exit 75: the download is still in progress or another session is downloading it, so run the same step again (also when Claude Code stopped the step at its time limit), at most 3 more times; if it still has not exited 0, stop and tell the user to run the command again later. Any other exit: stop and show the user the hook's message (it says what to check).

```bash
~/.oss/hooks/ensure-decrypt-cli.sh --long-step
```

Fetch and decrypt the prompt:

```bash
~/.oss/bin/oss-decrypt --type agents --name nextjs-developer
```

If this command fails for any reason (it prints an `Error:` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file.

The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.

## Step 2.5: Local-Model Offload (opt-in, user setting)

**Run this step only when Step 0 set `USE_PROXY` to true** (its banner then names a non-Claude
model, e.g. `🤖 OSS model: ollama/gpt-oss:120b (ollama)`). Otherwise (the default) this step is a
no-op: skip to Step 3 and run natively. Decide from Step 0's output alone; do not open any settings
or credentials file to check. The offloader checks the customer's own setting again and does
nothing if this agent is not mapped.

When it runs, the agent's work runs on THAT model instead of here on Claude:

1. Make a private directory (mode 700) for the prompt file:

   ```bash
   umask 077; d="$(mktemp -d -t oss-offload.XXXXXX)" && echo "$d/prompt.md"
   ```

   Then use the Write tool to create the printed path (it does not exist yet; only you can open the
   directory, so the file is as private as a 600 file), and write nowhere else: the **expert prompt
   fetched in Step 2**, a separator (`\n\n---\n\n`), then the **exact task you were given** (the
   code/diff/files to act on).

2. Run the offloader, pasting the path printed in step 1 between the single quotes. The command
   opens the prompt, deletes the file and its directory, and only then starts the offloader, which
   reads the prompt on stdin, so nothing is left on disk whatever happens next. If you stop after
   step 1 without running this command, still delete the file and its directory (`rm -f --` the
   path, then `rmdir --` its directory). The offloader runs a nested Claude session on your local
   model via the :8473 proxy; it can read and edit files in the current repo, but cannot run
   commands, use the web or use MCP tools.

   ```bash
   AGENT_ID="oss:nextjs-developer"
   PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}"
   OFFLOAD="$PLUGIN_ROOT/watcher/dist/cli/agent-offload.js"
   PROMPT_FILE='<path printed in step 1>'
   case "$PROMPT_FILE" in
     */oss-offload.*/prompt.md)
       { rm -f -- "$PROMPT_FILE"; rmdir -- "${PROMPT_FILE%/prompt.md}"
         if [[ -f "$OFFLOAD" ]]; then
           node "$OFFLOAD" --agent "$AGENT_ID" --prompt-file /dev/stdin --project-dir "$(pwd)"
         else
           echo '{"offloaded":false,"reason":"native"}'
         fi; } < "$PROMPT_FILE" ;;
     *) echo '{"offloaded":false,"reason":"native"}' ;;
   esac
   ```

3. Parse the JSON result:
   - **`offloaded: true`** → the local model did the work (generative agents: file edits already
     landed in the repo; run any tests or commands the task needs yourself). Present its `output`
     as your result. **STOP — do NOT re-run the work on Claude in Step 3.**
   - **`offloaded: false` with `reason: "cli_too_old"`** → show the user the result's `notice` line
     once, word for word, then run natively: proceed to Step 3.
   - **`offloaded: false`** → run natively: proceed to Step 3. (Covers the default
     no-model-configured case and any `fallback` after a local failure — your workflow never breaks.)

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the decrypt CLI. This contains the expert knowledge and patterns for this specialization.

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
