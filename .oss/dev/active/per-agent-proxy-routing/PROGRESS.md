# Progress: Per-Agent Model Routing via Launcher + Smart Proxy

## RESUME (fresh /oss:build): branch `feat/per-agent-proxy-routing/build`, baseline = latest wip commit on this branch (HEAD)
First action: `cd watcher && npx vitest run test/cli/oss-launch.test.ts test/cli/oss-launch-run.test.ts test/services/agent-route-resolver.test.ts test/services/anthropic-passthrough.test.ts test/services/proxy-router.test.ts test/services/routing-log.test.ts test/agents/agent-markers.test.ts test/cli/agent-model-check.test.ts`
→ expect 62/62 (baseline). Then do the "REMAINING = INTEGRATION GLUE" list below. Keep router
mode ADDITIVE/gated so non-router behavior is byte-identical; re-run existing model-proxy/
offload suites as regression guard before ship. Plugin-only; bump plugin.json at ship.

## Current Phase: build (4 of 7 phases GREEN — HTTP phases remain)

## Build status 2026-06-27 — LOGIC LAYER COMPLETE (62 tests across 8 files, all GREEN)
- Phase 1 — `anthropic-passthrough.ts` `forwardToAnthropic`: OAuth bearer + anthropic-* forwarded
  UNCHANGED, no model override, catch-all path. ✅
- Phase 2 — `agent-route-resolver.ts` `resolveRoute`: marker→route, safe Anthropic default. ✅
- Phase 2/4 — `proxy-router.ts` `routeMessages`: per-agent dispatch + fallback (ollama err →
  Anthropic when fallbackEnabled) + loud log entry. ✅
- Phase 4 — `routing-log.ts` (always-on JSON line, best-effort) + `node-guard.ts` `checkNode`. ✅
- Phase 5 — `oss-launch.ts` `resolveLaunch` (opt-in; no agents → env UNCHANGED) + `runLaunch`
  exec wrapper (ensure proxy + exec real claude; injected deps). ✅
- Phase 3 — inert `<!-- OSS-ROUTE-AGENT: oss:<id> -->` in all 13 routable agents + self-maintaining
  completeness test. ✅
- Phase 6 — `agent-model-check` self-disables under OSS_PROXY_ROUTING=1. ✅

REMAINING = INTEGRATION GLUE (wiring on top of the tested logic; lower logic-risk):
- [ ] model-proxy.ts router-mode HTTP adapter: in routerMode, handleRequest streams via
  routeMessages — ollamaHandle (existing ollama handler + fake-SSE) + passthrough
  (forwardToAnthropic piped to res); keep HEAD `/` + `/health` local; catch-all → passthrough.
  Fallback safety: call ollama backend BEFORE writing res so a throw can still fall back.
- [ ] start-proxy.ts: `--router` mode start (no single model required).
- [ ] oss-launch real deps: ensureProxy (GET /health; spawn start-proxy --router if down) +
  resolveClaudeBin (PATH scan skipping self) + `bin/oss-launch` entry; compile to dist/.
- [ ] dist build for all new src files (plugin runs dist/).
- [ ] Phase 7: plugin version bump, DRAIN_SH_INTEGRATION.md (point drain.sh at oss-launch),
  fix stale 3456 refs in agents/_shared/model-routing.md.

## Test status (local): 62/62 (logic layer) — see TESTING.md

## Current Phase line (legacy)

## Acceptance (no-impact guarantee, RED)
- [x] oss-launch resolveLaunch: no models.agents → no proxy/env (Anthropic-only unaffected)
- [x] resolveRoute: default = Anthropic pass-through; unmarked/no-agents never hits Ollama
- [!] Build-phase guard: agent markers MUST be inert HTML comments (T8) — protects all users' prompts

## Tasks
### Phase 1 — Proxy Anthropic pass-through (OAuth-safe)
- [ ] T1: forwardToAnthropic forwards inbound auth/anthropic-* unchanged, no model override
- [ ] T2: streaming pass-through (SSE bytes piped)
- [ ] T3: catch-all forwarding for any Anthropic path
### Phase 2 — Proxy per-agent dispatch
- [ ] T4: resolveRoute(request, config) marker→{ollama,model}|{anthropic}
- [ ] T5: wire handleMessagesRequest; per-request model; drop model-force on anthropic path
- [ ] T6: marker extraction edge cases
### Phase 3 — Agent markers
- [ ] T7: completeness test (every routable agent marked) — RED first
- [ ] T8: add OSS-ROUTE-AGENT:<id> to ~13 agent .md
- [ ] T9: e2e extraction (code-reviewer→ollama, test-engineer→anthropic)
### Phase 4 — Fallback + loud logging + node guard
- [ ] T10: ollama error + fallbackEnabled → retry Anthropic
- [ ] T11: always-on routing log (JSON line per decision)
- [ ] T12: Node preflight guard (loud)
### Phase 5 — Launcher (approach A)
- [ ] T13: oss-launch core (env at launch; default users untouched)
- [ ] T14: resolve real claude, no self-recursion
- [ ] T15: proxy reuse + port resolution
### Phase 6 — Legacy reconcile
- [ ] T16: agent-model-check self-disables under OSS_PROXY_ROUTING=1
### Phase 7 — Ship
- [ ] T17: TESTING.md cmds + drain.sh integration doc + fix stale 3456 refs
- [ ] T18: plugin version bump
- [ ] T19: ADR copy (repo convention)

## Blockers
- DeepBlue acceptance run requires the other session (ssh) — they wire drain.sh + re-run.

## Notes
- Foundation = PR #62 (claudish-style, 2026-01-12); layers #173/#174/#175 on top.
- Root cause Mode 1 (headless Step-2.5 never fires) confirmed on DeepBlue; mechanism + Node OK.
- Design corrected vs other session's "PreToolUse:Task hook": that can't substitute Task
  results / can't change base URL at runtime. Deterministic lever = launch-through-proxy +
  proxy per-agent dispatch (subagents inherit parent base URL). See DECISIONS ADR-001.
- OAuth: DeepBlue uses CLAUDE_CODE_OAUTH_TOKEN → proxy must forward Authorization unchanged.

## Last Updated: 2026-06-27 by /oss:plan
