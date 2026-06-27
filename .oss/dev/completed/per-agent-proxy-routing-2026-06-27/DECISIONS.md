# DECISIONS: Per-Agent Model Routing via Launcher + Smart Proxy

## ADR-001: Launch parent through proxy; proxy does per-agent dispatch (not a Task hook)
**Date:** 2026-06-27 — **Status:** Accepted
**Context:** Headless Task subagents don't run their voluntary Step-2.5 offload (Mode 1).
Verified Claude Code constraints: PreToolUse:Task can't substitute a subagent result;
`ANTHROPIC_BASE_URL` is read once at startup; subagents inherit the parent's startup env.
**Decision:** Set `ANTHROPIC_BASE_URL` at parent launch (via launcher); subagents inherit it;
the proxy discriminates per-agent. **Rejected:** PreToolUse:Task interceptor (can't return a
result), per-subagent base URL (not possible), relying on Step-2.5 (the bug itself).

## ADR-002: Identify the agent via a system-prompt marker
**Date:** 2026-06-27 — **Status:** Accepted
**Context:** All requests hit one proxy; it must know which agent a request is for. Claude Code
exposes no agent id on the wire.
**Decision:** Embed `OSS-ROUTE-AGENT:<id>` in each routable agent's system prompt (.md body,
sent verbatim by the client). Proxy scans the request `system` field. Unmarked → pass-through.
**Why safe:** system prompts are client-sent verbatim (not model-generated), so the marker is
deterministically present. **Guard:** completeness test that every routable agent carries
exactly one correct marker; loud log when a request is unmarked → cloud.

## ADR-003: Proxy must PASS THROUGH to Anthropic, forwarding OAuth bearer unchanged
**Date:** 2026-06-27 — **Status:** Accepted
**Context:** DeepBlue authenticates with `CLAUDE_CODE_OAUTH_TOKEN` (subscription OAuth bearer),
not `ANTHROPIC_API_KEY`. The whole opted-in session flows through the proxy, so the orchestrator
and claude-mapped agents must reach real Anthropic.
**Decision:** For non-diverted requests, forward to `api.anthropic.com` copying inbound
`authorization`, `anthropic-version`, `anthropic-beta`, `x-api-key` **unchanged**, and do NOT
override the model. For Ollama-routed requests, strip `authorization`. The proxy becomes a
faithful transparent reverse proxy (catch-all for any Anthropic path), with selective Ollama
diversion. Today's proxy assumes an API key + force-overrides the model — both corrected.

## ADR-004: Launcher entrypoint (approach A), opt-in via models.agents
**Date:** 2026-06-27 — **Status:** Accepted
**Context:** Parent env must exist before `claude` starts; OSS can't set it from inside a command.
**Decision:** Ship `oss-launch` that the DeepBlue drain.sh (and interactive Mac) call instead of
`claude`. It execs the REAL claude (resolved to avoid self-recursion). When `models.agents` is
NOT configured, it execs claude unchanged — **default users never touch the proxy**. Sets
`OSS_PROXY_ROUTING=1` so the legacy Step-2.5 offload self-disables (no double-offload).

## ADR-005: Loud, always-on routing log + Node preflight guard
**Date:** 2026-06-27 — **Status:** Accepted
**Context:** The original failure was SILENT (fallbackEnabled degraded to cloud with no signal),
costing a full diagnosis cycle.
**Decision:** Log every route decision and every fallback unconditionally (agent, resolved model,
route, fallback reason) to a routing log. Launcher fails LOUDLY if Node is missing rather than
letting the session silently run all-cloud. "Zero Ollama traffic" must never again look like success.
