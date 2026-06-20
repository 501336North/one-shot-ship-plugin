# PLAN: Interactive Local-Model Offload (nested mini-claudish)

**Repo:** `one-shot-ship-plugin` · **Branch (build):** `feat/interactive-local-model-offload/build`
**Method:** London TDD (outside-in, mock collaborators) · **Lang:** TypeScript (Vitest)
**Goal:** Make the 13 routable interactive agents *actually reason on* their configured local
model (gpt-oss@deepblue via `:3456`) instead of only printing a banner. See `DESIGN.md`.

> Test runner: `npx vitest run <specific-file>` only — never the full suite in parallel agents.

---

## Phase 0 — Preflight (no code)
- [ ] T0.1 Branch from main: `git fetch origin main && git checkout -b feat/interactive-local-model-offload/build origin/main`.
- [ ] T0.2 Confirm baseline green for `watcher` suite touching `agent-model-check` + `model-proxy` (targeted run).
- [ ] T0.3 Confirm `start-proxy` + `model-proxy` already route to remote ollama (`apiKeys.ollama`) — prior art `model-routing-productionize` (PR #173). No change expected; just a read.

**Acceptance:** on feature branch, targeted baseline tests pass.

---

## Phase 1 — Recursion guard (DO FIRST — prevents infinite nesting)
The nested gpt-oss session must NOT re-trigger Step 0 offload.

- [ ] **T1.1 — RED** `agent-model-check.test.ts`: "returns `{useProxy:false}` when `OSS_OFFLOAD_ACTIVE=1`, even if config maps the agent to a local model."
  - Behavior: a nested offload session never offloads again.
  - Business rule: offload is depth-1 only.
- [ ] **T1.2 — GREEN** In `agent-model-check.ts`, short-circuit to `{useProxy:false}` at the top when `process.env.OSS_OFFLOAD_ACTIVE === '1'`. Minimal.
- [ ] **T1.3 — REFACTOR** Name the guard (`isInsideOffload()`); keep one early return.

**Acceptance:** with `OSS_OFFLOAD_ACTIVE=1`, a mapped agent reports native; without it, mapped agent reports `useProxy:true`.

---

## Phase 2 — Offload runner: routing + prompt assembly (`agent-offload.ts`)
New CLI `watcher/src/cli/agent-offload.ts`. Collaborators MOCKED: `agent-model-check`,
`fs`, `child_process`.

- [ ] **T2.1 — RED** `agent-offload.test.ts`: "when routing resolves `useProxy:false`, returns `{offloaded:false}` and spawns nothing." (mock model-check → false; assert child_process.spawn NOT called)
- [ ] **T2.2 — GREEN** Implement resolve step calling agent-model-check; early-return `{offloaded:false}`.
- [ ] **T2.3 — RED** "assembles the nested prompt from `--prompt-file` (expert prompt + task context) and passes it on stdin to the nested process." (mock fs.readFileSync; assert stdin payload)
- [ ] **T2.4 — GREEN** Read prompt file, build payload. Minimal.
- [ ] **T2.5 — REFACTOR** Extract `buildOffloadInvocation(routing, promptFile)` → pure, returns `{cmd,args,env,stdin}` (easy to unit-test, no side effects).

**Acceptance:** runner correctly decides offload-vs-native and constructs the invocation; no real process spawned in tests.

---

## Phase 3 — Nested spawn, capture, fallback semantics
`child_process.spawn` MOCKED (fake exit code + stdout/stderr).

- [ ] **T3.1 — RED** "spawns `claude -p --model <localModel> --dangerously-skip-permissions` with env `ANTHROPIC_BASE_URL=<proxyUrl>`, `OSS_OFFLOAD_ACTIVE=1`, `OSS_PROXY_LOG=<path>`." (assert argv + env)
- [ ] **T3.2 — GREEN** Wire spawn from `buildOffloadInvocation`.
- [ ] **T3.3 — RED** "on exit 0 with non-empty stdout → `{offloaded:true, output}`."
- [ ] **T3.4 — GREEN** Capture + return.
- [ ] **T3.5 — RED** "on non-zero exit OR empty stdout, with `fallbackEnabled:true` → `{offloaded:false, fallback:true}` (orchestrator runs natively)."
- [ ] **T3.6 — RED** "with `fallbackEnabled:false` and failure → `{offloaded:false, fallback:true, error}` but NEVER throws into the agent." (fail-safe: a broken local route must never break the agent)
- [ ] **T3.7 — GREEN** Implement fallback branch.
- [ ] **T3.8 — REFACTOR** Single `classifyResult(exit, stdout)` → `success|empty|error`.

**Acceptance:** every failure mode degrades to native Claude; success returns local output. Runner never throws.

---

## Phase 4 — Proxy preflight + proof-of-routing
- [ ] **T4.1 — RED** "before spawn, checks the proxy is reachable at `proxyUrl`; if unreachable and not auto-startable → `{offloaded:false, fallback:true, reason:'proxy_down'}`." (mock health probe)
- [ ] **T4.2 — GREEN** Add preflight (reuse existing `:3456` listener/health check; do NOT reimplement the proxy).
- [ ] **T4.3 — RED (integration)** `agent-offload.integration.test.ts`: with a **fake local model server** standing in for the proxy, a full run writes a request line to `OSS_PROXY_LOG`. Asserts the proof mechanism works end-to-end without Anthropic or deepblue.
- [ ] **T4.4 — GREEN** Ensure `OSS_PROXY_LOG` is honored end-to-end (it already exists in `model-proxy.ts` — verify wiring).

**Acceptance:** a successful offload always leaves a `:3456` request line in `OSS_PROXY_LOG`; a down proxy falls back cleanly.

---

## Phase 5 — Pilot agent markdown rewrite (code-reviewer)
- [ ] **T5.1 — RED** `agents-step0.test.sh` (or TS asserting file content): "`code-reviewer.md` invokes `agent-offload.js` and has NO bare banner-only path." (assert the new block present; old comment-only `# Execute via model proxy` removed)
- [ ] **T5.2 — GREEN** Replace code-reviewer Step 0 with uniform **Step 0.5** block:
  - run `agent-offload.js --agent oss:code-reviewer --prompt-file <expert+task>`
  - if `offloaded:true` → relay/act on output, then STOP (do not re-reason on Claude)
  - if `offloaded:false` → proceed with native Claude flow (existing Steps 1..n)
  - keep the banner (informational) BEFORE the offload attempt
- [ ] **T5.3 — Manual smoke (review-type)** Spawn `oss:code-reviewer` interactively on a diff-with-issues with the gpt-oss mapping ON → assert `OSS_PROXY_LOG` shows the hit AND findings returned. Mapping OFF → no hit, native runs.

**Acceptance:** pilot review agent genuinely offloads; fallback verified by toggling the proxy off.

---

## Phase 6 — Roll out to remaining 12 agents
Uniform block; one agent at a time. Generative agents validated for tool-use (file edits).

- [ ] **T6.1 — RED/GREEN** Parameterized content test asserting all 13 agents contain the canonical Step 0.5 block and the correct `--agent oss:<id>`.
- [ ] **T6.2** Apply block to: security-auditor, debugger, architecture-auditor, dependency-analyzer (review).
- [ ] **T6.3** Apply block to: typescript-pro, python-pro, backend-architect, refactoring-specialist, code-simplifier, test-engineer, frontend-developer, react-specialist, nextjs-developer (generative).
- [ ] **T6.4 — Manual smoke (generative-type)** Spawn one generative agent (typescript-pro) on a small task → nested gpt-oss session edits a file in the workdir; `OSS_PROXY_LOG` confirms routing; result applied.

**Acceptance:** all 13 carry the offload block; one review + one generative proven live.

---

## Phase 7 — Live E2E, docs, release
- [ ] **T7.1** Full live proof against deepblue (pre-warm gpt-oss): `/oss:ship` on a real branch spawns code-reviewer → proxy log proves gpt-oss did the review. (gpt-oss coexists with other models — no serialization needed; only avoid co-running `minimax-m2.7` / `qwen3-thinking:235B`.)
- [ ] **T7.2** Update `TESTING.md` (results), `PROGRESS.md` (status), `NOTES.md` (deepblue ops: pre-warm, one-big-model, tailscale IP).
- [ ] **T7.3** ADR via `/oss:adr`: "Interactive per-agent offload = nested mini-claudish; per-subagent base-URL impossible (claudish-confirmed)."
- [ ] **T7.4** Bump `.claude-plugin/plugin.json` patch version (triggers user auto-update).
- [ ] **T7.5** `/oss:ship` (no `--merge` unless you say so).

**Acceptance:** live gpt-oss review proven; docs synced; version bumped; PR opened for human review.

---

## Test strategy summary (LAW #2)
- **Mock:** `agent-model-check`, `child_process.spawn`, `fs`, proxy health probe (collaborators).
- **Don't mock:** `buildOffloadInvocation`, `classifyResult` (pure units), the real `model-proxy` in the Phase-4 integration test.
- **Behavior, not implementation:** every test names the user behavior ("a broken local route never breaks the agent"). Survives a rewrite of internals.
- **Proof-of-routing** (`OSS_PROXY_LOG`) is the load-bearing acceptance check — without it we can't claim the model actually ran locally.

## Out of scope
- Changing the ModelProxy / start-proxy internals (already shipped, PR #173).
- The managed/OSSMA path (correctly on Anthropic).
- Commands/skills routing (session tier only).
- deepblue ops/capacity (pre-warm gpt-oss). gpt-oss coexists with other models; only `minimax-m2.7` / `qwen3-thinking:235B` hog the box — not a concern for this gpt-oss path.

## Dependencies / ordering
T1 (recursion guard) **blocks everything** — without it the first live run could nest infinitely.
T2→T3→T4 build the runner. T5 pilots one agent. T6 fans out. T7 proves + ships.
```
T1 ──▶ T2 ──▶ T3 ──▶ T4 ──▶ T5 ──▶ T6 ──▶ T7
```
