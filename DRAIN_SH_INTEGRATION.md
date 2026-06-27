# drain.sh → oss-launch integration

**Audience:** the DeepBlue/headless session that drives `/oss:build` runs via `drain.sh`.
**Goal:** route per-agent work to the local model (Ollama) without any manual proxy/env wiring.

---

## What changed

Per-agent model routing now happens **at the proxy layer**, driven by a launcher. Instead of
launching `claude` directly, launch it through **`oss-launch`**. The launcher:

1. Reads the merged OSS config (`~/.oss/config.json`, overridden by `$CLAUDE_PROJECT_DIR/.oss/config.json`).
2. **If `models.agents` is empty/absent** → execs the real `claude` with the environment
   **UNCHANGED**. Anthropic-only users are completely unaffected.
3. **If `models.agents` is configured** → ensures the router proxy is up (reuse if healthy, else
   start `start-proxy --router --background` and wait for `/health`), sets
   `ANTHROPIC_BASE_URL=http://127.0.0.1:8473` + `OSS_PROXY_ROUTING=1`, then execs the real `claude`.
   Subagents inherit the parent base URL, so each agent's request is dispatched by its
   `OSS-ROUTE-AGENT:<id>` marker against `models.agents` — local-mapped agents hit Ollama, the
   rest pass through to Anthropic verbatim.

The proxy listens on **port 8473** by default (NOT 3456 — that collides with claude-code-router).
Override with `OSS_PROXY_PORT`, or `models.proxyPort` in config.

---

## The one-line change in drain.sh

Replace the direct `claude` invocation:

```bash
# BEFORE
claude -p "/oss:build …" --dangerously-skip-permissions

# AFTER — route through the launcher
"$PLUGIN_ROOT/bin/oss-launch" -p "/oss:build …" --dangerously-skip-permissions
```

`$PLUGIN_ROOT` is the plugin checkout (the dir containing `bin/` and `watcher/`). If you prefer to
call node directly (no bin shim):

```bash
node "$PLUGIN_ROOT/watcher/dist/cli/oss-launch.js" -p "/oss:build …" --dangerously-skip-permissions
```

> `oss-launch` requires `watcher/dist/` to be built (`cd watcher && npm run build`). The plugin
> ships the built `dist/`, so a `claude plugin update` to **≥ 2.0.76** is sufficient.

---

## Verifying it routed (the real acceptance gate)

During a launched `/oss:build` run, confirm local routing actually happened:

- `curl "$OLLAMA/api/ps"` shows `gpt-oss:120b` loaded while the code-reviewer agent runs.
- `journalctl --user -u ollama` shows `POST /api/chat` for the code-reviewer agent.
- The always-on routing log records the decisions:
  ```
  cat ~/.oss/logs/model-routing.log
  # → {"ts":…,"agent":"oss:code-reviewer","model":"gpt-oss:120b","route":"ollama"}
  # → {"ts":…,"agent":"oss:test-engineer","route":"anthropic"}
  ```
- **Zero Ollama traffic = FAIL** (a silent degrade to all-cloud must never look like success).

If Ollama is unreachable and `models.fallbackEnabled` is true (default), requests fall back to
Anthropic and the fallback is logged loudly (`"fallback":true,"reason":…`).
