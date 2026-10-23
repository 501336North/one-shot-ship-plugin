# DESIGN — Model-Routing Productionization

**Origin:** 2026-06-18 model-routing eval (`~/dev/oss-model-eval/research/`). The eval proved per-agent
local routing works, but surfaced two productionization gaps. This feature ships the fixes.

## Problem
1. **Remote local box unreachable by config.** The stock plugin proxy always points ollama at
   `localhost:11434` — `start-proxy` only maps `openrouter` API keys and never passes a `baseUrl`.
   So a team that shares one GPU box over the network (e.g. Tailscale) cannot route there via config.
2. **The model used per prompt is invisible** except in the terminal statusline (which only shows the
   **session** model). VS Code / web / non-terminal users get no model indication, and a subagent routed
   to a *different* model (the whole point of routing) is never surfaced.

## Goals / Acceptance Criteria
- **AC1** — A user can set `models.apiKeys.ollama` (or pass `--base-url`) and the proxy routes ollama
  traffic to that remote endpoint. Absent config → unchanged default (`localhost:11434`).
- **AC2** — Each proxied `/v1/messages` request is logged (model + provider + timestamp) for verifiable routing.
- **AC3** — When a subagent runs on a non-session (routed) model, its output begins with a clear banner:
  `🤖 OSS model: <model> (<provider>)`.
- **AC4** — The effective model is visible to **non-terminal** users for ordinary command runs too
  (not only the statusline).
- **AC5** — Zero behavior change when no `models` config is present (default = Claude, no banner noise beyond
  a minimal session-model line — see DECISIONS).

## Non-Goals
- Changing the eval's model recommendations. - Server-enforced per-team model config (future).
- Auto-starting a remote tunnel.

## Design summary
- **AC1/AC2 (PR-A, plugin/watcher):** add `--base-url` + `loadOllamaBaseUrlFromConfig()` (reads
  `apiKeys.ollama`); thread `baseUrl` through `startProxy → ModelProxy → ollama-handler`; add per-request
  `OSS_PROXY_LOG` JSON-line logging. (Patch already written + RED-validated.)
- **AC3 (PR-B-plugin):** `agent-model-check` emits a ready-to-print `banner`; `agents/_shared/model-routing.md`
  Step-0 and the routable agent files echo it at the top of output.
- **AC4 (PR-B-api or plugin hook — see DECISIONS):** surface the **session** model for command runs to
  non-terminal users. Open design point: a served-prompt directive cannot *accurately* know the session
  model string; a hook (which receives `.model.display_name`, like the statusline) can. Recommended: hook.
