# DESIGN: Per-Agent Model Routing via Launcher + Smart Proxy

**Repo:** `one-shot-ship-plugin` (watcher/ proxy + launcher CLI, agents/*.md, hooks)
**Status:** Planned
**Created:** 2026-06-27

## Problem

`~/.oss/config.json → models.agents` maps OSS subagents to local models
(`ollama/gpt-oss:120b`) with `models.default="claude"`, `fallbackEnabled=true`,
`models.apiKeys.ollama="http://deepblue…:11434"`. **It's inert.** Proven on DeepBlue
2026-06-27: a headless `/oss:build` dispatched local-mapped subagents (code-reviewer,
code-simplifier); they produced output but **Ollama saw zero calls** — everything ran on
cloud Claude.

### Root cause (diagnosed, not theorized)
- **Mode 1 confirmed:** headless Task subagents never execute their voluntary "Step 2.5"
  offload preamble, so the nested-`claude -p` offload never fires.
- **Mode 2 ruled out:** the offloader works end-to-end on aarch64 — gpt-oss:120b did a real
  1m57s review when invoked directly. (The only env gap, missing Node, is fixed on DeepBlue.)

### Why the "obvious" fixes don't work (verified against Claude Code semantics)
- A `PreToolUse:Task` hook **cannot substitute a subagent's result** (it can read input,
  deny, or rewrite input — not return the offloaded output as the tool result).
- `ANTHROPIC_BASE_URL` is **read once at process startup**; it cannot be changed per-subagent
  at runtime.
- Subagents are **separate processes that inherit the parent session's startup env** —
  including `ANTHROPIC_BASE_URL`.

→ The only deterministic lever is: **launch the parent session through the proxy; subagents
inherit it; the proxy does the per-agent dispatch.** This is the same claudish model already
integrated since PR #62 (translating proxy + `ANTHROPIC_BASE_URL`); we move the per-agent
decision *into* the proxy because Claude Code gives exactly one base-URL lever per session.

## Goal

With `models.agents` configured, a normal headless `/oss:build` or `/oss:review` (no manual
proxy start, no env exports) routes each subagent to its mapped model — local-mapped agents
hit Ollama, claude-mapped agents and the orchestrator hit real Anthropic — with automatic
cloud fallback and zero silent failures. Works headless on aarch64 (DeepBlue drain.sh).

## Architecture

```
drain.sh ──► oss-launch ──(models.agents set?)──► start/reuse proxy
                                                  set ANTHROPIC_BASE_URL=127.0.0.1:8473
                                                  exec real `claude -p …`
                         ──(not set)────────────► exec real `claude` unchanged

claude session (parent + all inherited subagents) ──► PROXY :8473
   per request:
     • extract OSS-ROUTE-AGENT:<id> from system prompt
     • models.agents[id] = ollama/<model>  → translate → Ollama baseUrl
     • else (claude / unmarked / orchestrator) → PASS-THROUGH → api.anthropic.com
                                                  (forward Authorization + anthropic-* UNCHANGED)
     • Ollama error/timeout & fallbackEnabled  → retry via PASS-THROUGH
     • log every decision + every fallback (loud, always on)
```

### Components
1. **Launcher `oss-launch` (new CLI)** — approach (A). If `models.agents` configured:
   ensure proxy (reuse if `/health` ok, else start), `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`,
   set `OSS_PROXY_ROUTING=1`, then `exec` the real `claude` (native-installer binary on PATH,
   resolved to avoid self-recursion) with all passed args. Otherwise exec claude unchanged so
   **default users are unaffected**. drain.sh changes one line to call `oss-launch` instead of
   `claude`. Also fixes interactive Mac.
2. **Proxy pass-through (new)** — forward any non-diverted request to `api.anthropic.com`,
   copying inbound `authorization` (OAuth bearer `CLAUDE_CODE_OAUTH_TOKEN`), `anthropic-version`,
   `anthropic-beta`, `x-api-key` **unchanged**. Today's proxy assumes an API key and overrides
   the model — both wrong for pass-through. Must be a faithful reverse proxy for ALL Anthropic
   paths (not just `/v1/messages` — also token counting etc.), streaming and non-streaming.
3. **Proxy per-agent dispatch (new)** — `resolveRoute(request, config)`: read marker → look up
   `models.agents` → `{ollama, model}` or `{anthropic}`. Per-request model (the proxy is no
   longer pinned to one model).
4. **Agent markers** — each routable agent's system prompt carries `OSS-ROUTE-AGENT:<id>`
   (~13 agent .md). Load-bearing; explicit completeness + extraction tests.
5. **Fallback + loud logging + Node guard** — fallback retries Anthropic; every route/fallback
   logged unconditionally; launcher loudly fails if Node missing (no silent cloud).
6. **Legacy reconcile** — when `OSS_PROXY_ROUTING=1`, `agent-model-check` returns `useProxy:false`
   so the old Step-2.5 nested offload doesn't double-fire.

## Out of scope
- Re-architecting model selection config (keep `models.agents` / `models.apiKeys.ollama`).
- OpenRouter/OpenAI paths beyond what already exists (focus: ollama + anthropic pass-through).
- Removing the legacy offload entirely (neutralize under launcher; leave for non-launcher use).

## Key risks
- **OAuth pass-through**: must forward the bearer unchanged or the orchestrator/claude agents 401.
- **Marker reliability**: if an agent's system prompt doesn't carry the marker, it silently
  passes through to cloud → explicit completeness test + loud "unmarked→anthropic" log.
- **Proxy as critical path**: whole opted-in session flows through it → must be a robust
  transparent reverse proxy (catch-all forward) + never crash on logging.
- **Self-recursion**: launcher must exec the REAL claude, not itself.
