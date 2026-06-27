# Progress: Per-Agent Model Routing via Launcher + Smart Proxy

## RESUME — INTEGRATION GLUE COMPLETE (2026-06-27 16:36 EDT). Ready for `/oss:ship`.
All glue wired + verified on Mac (155/155 regression, tsc clean, dist smoke green). The ONLY
remaining item is the **DeepBlue aarch64 acceptance run** (other session; see DRAIN_SH_INTEGRATION.md
+ TESTING.md VERIFY commands) — not runnable from this Mac session.

## Current Phase: build COMPLETE (7 of 7 phases GREEN) → next: /oss:ship

## Integration glue done (2026-06-27, TDD RED→GREEN→REFACTOR each):
- [x] **model-proxy.ts router-mode HTTP adapter** (additive/gated). New `ModelProxyConfigRouter`
  + `isRouterConfig`; `handleRouterMessages` dispatches via `routeMessages` (ollama→`emitResolvedSse`,
  anthropic→`pipeUpstream`); catch-all path forwarded; HEAD `/`+`/health` stay local. Writes
  nothing to `res` until routeMessages resolves → ollama-throw falls back. REFACTOR: extracted
  shared `emitResponseBlocks`. Non-router byte-identical (model-proxy.test.ts 45/45). +5 tests.
- [x] **start-proxy.ts `--router`** — `--model` not required in router mode; `buildRouterConfig`
  + `loadRouterConfigFromFile`; `startRouterProxy`; background spawn via `--router`; main() wired. +7.
- [x] **oss-launch real deps** — `resolveClaudeBin` (PATH scan, never self-execs) + `ensureProxy`
  (reuse-or-start + loud throw); `main()` composition root (real config/health/spawn); +6 tests.
- [x] **bin/oss-launch** shim → `node watcher/dist/cli/oss-launch.js`.
- [x] **dist build** — `npm run build` (tsc + cli-bundle); new src compiled to dist/.
- [x] **Phase 7 docs** — plugin.json 2.0.75→**2.0.76**; `DRAIN_SH_INTEGRATION.md` created; stale
  port 3456→**8473** across `agents/_shared/model-routing.md` + 13 agent `.md`; proxy-layer note added.

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

REMAINING = INTEGRATION GLUE — ✅ ALL DONE 2026-06-27 (see "Integration glue done" above):
- [x] model-proxy.ts router-mode HTTP adapter (additive/gated; fallback-safe; byte-identical non-router)
- [x] start-proxy.ts `--router` mode start (no single model required)
- [x] oss-launch real deps: ensureProxy + resolveClaudeBin + `bin/oss-launch` entry; compiled to dist/
- [x] dist build for all new src files
- [x] Phase 7: version bump 2.0.76, DRAIN_SH_INTEGRATION.md, 3456→8473 refs fixed

## Test status (local): 155/155 (regression guard, 14 files) — tsc clean — see TESTING.md
## Remaining gate: DeepBlue aarch64 acceptance run (other session) — NOT runnable from Mac.

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

## Last Updated: 2026-06-27 16:36 EDT by /oss:build
