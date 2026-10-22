# DESIGN: per-model `think` control in the OSS Ollama proxy

**Repo:** `one-shot-ship-plugin` (plugin-only; no API/prod-config change). **Created:** 2026-06-29.

## Problem
Verbose reasoning models (e.g. `qwen3.6:35b-a3b`) emit long thinking traces — ~32 s / ~5× the
tokens — which is wasteful for latency-sensitive agents. Ollama's native `/api/chat` accepts a
top-level `"think": true|false` that cleanly suppresses reasoning (verified: 0 thinking tokens on
qwen3.6). The OSS proxy assembles the `/api/chat` body in `transformToOllama()` but never sets `think`.

## Goal
Let the proxy send `think` **per request, decided by the routed model**, via an opt-in config map.
Models not listed are completely unaffected (no `think` key sent).

## Design (verified against code 2026-06-29)
Thread an optional `think` map (bare-model-name → boolean) through the existing config→handler chain,
exactly mirroring how `baseUrl` flows today:

```
~/.oss config  models.think:{ "qwen3.6:35b-a3b": false }
  └─ start-proxy buildRouterConfig → routerConfig.models.think
       └─ model-proxy ollamaHandle → createHandler({ provider:'ollama', baseUrl, think })   (mirrors :655)
            └─ handler-registry createHandler → new OllamaHandler({ baseUrl, think })         (mirrors :56)
                 └─ OllamaHandler stores think; transformToOllama() injects it
```

**Injection rule (the load-bearing detail):** in `transformToOllama()`, after building
`ollamaRequest`, compute the stripped model name (`request.model.replace(/^ollama\//,'')`, same as
the existing `model` field) and set `ollamaRequest.think` **only if that name is a KEY in the map**:
```ts
const m = request.model.replace(/^ollama\//, '');
if (this.think && m in this.think) ollamaRequest.think = this.think[m];
```
Use **key-existence (`in`), not truthiness** — the value can legitimately be `false`. Unlisted models
get no `think` key at all (sending `think` to a non-thinking model can 400 — the allowlist guard).

## Decisions
- **Allowlist, not default.** Absent map ⇒ unchanged behavior. Only listed models get a `think`.
- **Bare model name keys** (post `ollama/` strip), matching how `models.agents` values resolve.
- **Router path only.** The map lives in `routerConfig.models.think` (the launcher/router path). The
  legacy single-model offload (`ModelProxyConfigNew`, model-proxy:202) carries no think map → unchanged.
- **No `any`.** `think?: Record<string, boolean>` end to end.

## Scope
**In:** `OllamaHandlerConfig.think`, `HandlerConfig.think`, `createHandler` passthrough, `transformToOllama`
injection, `buildRouterConfig` think passthrough, `routerConfig.models.think` type, model-proxy wiring,
tests, dist build, version bump, docs.
**Out:** the no-think Modelfile bake (ollama 0.30.8 can't express it via PARAMETER/TEMPLATE — this proxy
param is the correct mechanism); the legacy non-router offload path; any API/server change.

## Acceptance
1. Configured model (`think:false`) → `/api/chat` body has `think:false`; `think:true` → `think:true`.
2. Unlisted model → no `think` key. No map → no `think` key. Existing behavior byte-identical.
3. Field (DeepBlue): route an agent to `qwen3.6:35b-a3b` with `think:false`, hit `/v1/messages`,
   confirm few output tokens (thinking suppressed) via `OSS_PROXY_LOG` / token counts.

## Last Updated: 2026-06-29 by /oss:plan
