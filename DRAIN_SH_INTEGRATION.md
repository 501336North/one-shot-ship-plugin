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

## No system Node? (self-contained binary + Node preflight)

`bin/oss-launch` no longer requires a system Node. On first use it fetches a **self-contained
`oss-launch` binary** (bundled Node, verified by SHA-256) for the box's OS/arch and caches it at
`~/.oss/bin/oss-launch-<arch>`. That binary brings its own Node, so local routing works with **zero
system Node**. Selection + degrade behavior:

| Situation | Behavior |
|-----------|----------|
| Bundled binary present for the arch | exec it — routing works, no system Node needed |
| No bundled binary, **system Node ≥ 20** | run via system Node, route normally |
| No bundled binary, system Node **too old (<20)** | **loud** warning → run **all-cloud** (exit 0) |
| No bundled binary, **no Node at all** | **loud** warning → exec real `claude` all-cloud (exit 0) |

The degrade is always **loud** (stderr banner) and **never blocks** the run — but it is never
silent, so a customer can't unknowingly lose local routing. (Min Node for the fallback path: **20**;
the bundled binary ships Node 18 and is trusted as self-contained.)

> `oss-launch` requires `watcher/dist/` to be built (`cd watcher && npm run build`). The plugin
> ships the built `dist/`, so a `claude plugin update` to **≥ 2.0.77** is sufficient. Self-contained
> binaries are published by the `Build oss-launch` workflow (tag `oss-launch-v*`).

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
