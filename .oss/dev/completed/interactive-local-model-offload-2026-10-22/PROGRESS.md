# Progress: Interactive Local-Model Offload

## Current Phase: plan (complete) → ready for build

## Two load-bearing guarantees (user-confirmed 2026-06-20)

1. **Default-OFF / config-gated.** The whole offload "dance" fires ONLY when the user's
   `~/.oss/config.json` has a `models.agents` entry mapping that specific agent to a
   non-Claude model (e.g. `"oss:code-reviewer": "ollama/gpt-oss:120b"`). With no `models`
   block (the default for every customer), `agent-model-check` returns `{useProxy:false}` →
   zero behavior change → pure native Claude. This is your personal setup (deepblue);
   customers are unaffected unless they opt in by editing their own config. Enforced by
   Phase 2 T2.1 (useProxy:false → spawn nothing).
2. **OSSMA untouched.** The managed/cloud path stays exactly as-is (runs on Anthropic infra).
   This work touches ONLY the interactive `agents/*.md` + a new `agent-offload.ts` CLI.
   Listed in PLAN "Out of scope."

## Tasks
- [x] Design captured (DESIGN.md) — 2026-06-20
- [x] claudish researched: confirms no per-subagent base-URL; nested-session is the mechanism — 2026-06-20
- [x] TDD plan written (PLAN.md, 7 phases, T1 recursion guard first) — 2026-06-20
- [x] Acceptance test written + RED-confirmed (boundary = runAgentOffload, AC-OFFLOAD.1-3) — 2026-06-20
- [x] Phase 0: branch `feat/interactive-local-model-offload/build` + baseline green — 2026-06-20
- [x] Phase 1: recursion guard (`OSS_OFFLOAD_ACTIVE=1 ⇒ useProxy:false`) — agent-model-check.ts; 21/21 — 2026-06-20
- [x] Phase 2-4: `agent-offload.ts` runner (routing resolve, proxy preflight, nested spawn, capture, fallback, never-throws) — acceptance 4/4 + unit 5/5; tsc 0 errors; routing suites 52/52 — 2026-06-20
- [x] Phase 5-6: **Step 2.5 offload block added to all 13 routable agents** (between Step 2 fetch
  and Step 3 execute); content-test gate `test/agents/local-model-offload.test.ts` 53/53 green;
  dist built (`watcher/dist/cli/agent-offload.js`); compiled CLI smoke-tested (guard path) — 2026-06-20
- [x] Choice 2 (proxy completeness for nested claude -p): HEAD / + query tolerance + SSE streaming
  (early-flush + keepalive) + force-model + ollama-prefix strip + content-array flatten (system &
  messages) + configurable port + ANTHROPIC_MODEL strip. All TDD. — 2026-06-20
- [x] **★ FULL E2E PROVEN (2026-06-20):** real `agent-offload.js` offloaded `oss:code-reviewer` to
  gpt-oss@deepblue via our own ModelProxy — `offloaded:true`, 1 call, no loop, real review output
  (SQL injection, missing types, empty-rows crash, raw-password leak all correctly found).
- [x] Phase 7 productionization (2026-06-20): runner **auto-starts the proxy** on a preflight miss
  (detached foreground start-proxy; NOT --background, which is broken) + waits ~15s for bind;
  `start-proxy` now reads the remote ollama URL from `models.apiKeys.ollama` (nested config path).
  **★ Turnkey E2E PROVEN:** with NO proxy running, the runner auto-started it → deepblue and
  offloaded code-reviewer to gpt-oss (real findings, proxy log confirms). All TDD.
- [x] Four follow-up fixes (2026-06-20, all TDD):
  - **Item-4 tool-use translation** — Anthropic tools→ollama; ollama tool_calls→tool_use (stop_reason
    tool_use); tool_use/tool_result history round-trip; SSE emits tool_use (input_json_delta).
    **★ PROVEN LIVE:** nested gpt-oss called the Read tool, got the file, returned the passphrase
    (2-turn loop).
  - **Default port 3456→8473** (off CCR's default) in start-proxy + agent-model-check.
  - **start-proxy `--background` fixed** — spawned child with a `file://` URL (node can't load it →
    never bound); now uses `fileURLToPath`. Verified binds + serves.
  - **ollama-handler listModels** defensive (`response?.models ?? []`) + test catches → unhandled
    rejection gone.
- [ ] Remaining: ADR + plugin version bump + `/oss:ship`.

## ★ FEATURE COMPLETE + PRODUCTIONIZED (2026-06-20)
Interactive per-agent local-model offload works turnkey: an agent's Step 2.5 calls agent-offload,
which auto-starts our ModelProxy (→ deepblue via config) and runs the agent on gpt-oss through a
nested claude -p. Affected suites 207/207, tsc 0. Ready to ship.

## ★ Choice 2 COMPLETE — interactive local-model offload works end-to-end (2026-06-20)
A nested `claude -p` now boots against our OSS ModelProxy and runs the agent's work on
gpt-oss@deepblue. Affected suites 183/183 green, tsc 0. Root-cause chain the live proof
uncovered+fixed (all invisible to the mocked tests): foreign --model → force-model; HEAD / 404 →
reachability; SSE format → streaming; SSE timing → early-flush+keepalive; **the real blocker:
ollama 500 on array-form `content`/`system` → flatten**. Remaining = productionization (proxy
lifecycle/auto-start, port agreement) + ship.

## Build checkpoint (2026-06-20): Phases 1-6 COMPLETE (option A)
The full offload path is built, tested, and wired end-to-end:
- Mechanism: `agent-model-check.ts` guard + `agent-offload.ts` runner (13 code tests).
- Integration: Step 2.5 block in all 13 agents, content-gated (53 tests).
- Compiled: `npm run build` ok; CLI smoke-tested via guard path.
- Regression: agents+cli suites **472/472**. tsc **0 errors**.
No commit (build does not auto-commit). Phase 7 (live proof needs deepblue gpt-oss warm;
ship needs explicit `/oss:ship`) is the only remaining work.

## Blockers
- None. (Live runs just need deepblue gpt-oss pre-warmed — ops, not a code blocker. gpt-oss coexists with other models; only minimax-m2.7 / qwen3-thinking:235B monopolize the box, so no serialization needed for this path.)

## Last Updated: 2026-06-20 by /oss:plan
