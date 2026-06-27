# PLAN: Per-Agent Model Routing via Launcher + Smart Proxy

**Repo:** `one-shot-ship-plugin`
**Branch:** `feat/per-agent-proxy-routing/build` (cut from `origin/main`)
**Methodology:** London TDD — RED → GREEN → REFACTOR per task. Vitest (watcher) + bash harness.
**Created:** 2026-06-27

> ⛔ IRON LAW #4: branch off main; plugin repo, not AgenticDevWorkflow.
> ⚠️ Vitest-overload rule: run TARGETED test files, never the full suite in agents.

---

## Phase 1 — Proxy: transparent Anthropic pass-through (OAuth-safe)

The proxy must faithfully forward non-diverted traffic to `api.anthropic.com`. Today it
assumes an API key and force-overrides the model (`model-proxy.ts:486-488`) — both wrong here.

- **T1 — RED/GREEN: `forwardToAnthropic(path, method, headers, body)`** forwards to
  `https://api.anthropic.com<path>`, copying inbound `authorization`, `anthropic-version`,
  `anthropic-beta`, `x-api-key` UNCHANGED; returns status+headers+body. Mock upstream (no real
  network). Assert OAuth bearer is forwarded verbatim; model NOT overridden.
- **T2 — RED/GREEN: streaming pass-through** — `stream:true` pipes the upstream SSE bytes back
  unmodified. Mock chunked upstream.
- **T3 — RED/GREEN: catch-all forwarding** — any path the proxy doesn't special-case (e.g.
  `/v1/messages/count_tokens`) is forwarded to Anthropic (faithful reverse proxy), not 404'd.
- **Files:** `watcher/src/services/anthropic-passthrough.ts` (new) + `model-proxy.ts`; tests in
  `watcher/test/services/anthropic-passthrough.test.ts`.

## Phase 2 — Proxy: per-agent dispatch

- **T4 — RED/GREEN: `resolveRoute(requestBody, config)`** → extracts `OSS-ROUTE-AGENT:<id>` from
  `system` (string OR array form); looks up `models.agents[id]`; returns
  `{route:'ollama', model}` for `ollama/*`, else `{route:'anthropic'}`. Unmarked / `claude` /
  `default` / empty → `anthropic`. Pure function, fully unit-tested.
- **T5 — RED/GREEN: wire `handleMessagesRequest` to `resolveRoute`** — ollama route → ollama
  handler built PER-REQUEST from the resolved model (proxy no longer pinned to one construct-time
  model); anthropic route → `forwardToAnthropic`. Remove the unconditional model-force for the
  anthropic path; keep model-rewrite only on the ollama path (Ollama needs the bare model name).
- **T6 — RED/GREEN: marker extraction edge cases** — marker absent → anthropic; multiple system
  blocks → first matching marker; case/whitespace tolerance; malformed config → anthropic + log.
- **Files:** `watcher/src/services/agent-route-resolver.ts` (new) + `model-proxy.ts`; tests.

## Phase 3 — Agent markers in prompts

- **T7 — RED/GREEN: completeness test** — for every routable agent (the set carrying a Step-0
  model-routing block today), assert its `.md` system prompt contains exactly one
  `OSS-ROUTE-AGENT:<id>` whose id matches the agent/file. Test FIRST (RED: none present).
- **T8 — GREEN: add the marker** to each routable agent `.md` (~13: code-reviewer, test-engineer,
  security-auditor, performance-engineer, debugger, backend-architect, typescript-pro, python-pro,
  refactoring-specialist, code-simplifier, frontend-developer, react-specialist, nextjs-developer,
  figma-design-agent — reconcile exact list with `agents/_shared/model-routing.md`).
- **T9 — RED/GREEN: end-to-end extraction** — feed a captured code-reviewer-shaped request through
  `resolveRoute` → routes to the configured ollama model; a test-engineer-shaped request mapped to
  `claude` → anthropic.
- **Files:** `agents/*.md`, `agents/_shared/model-routing.md`; tests in
  `watcher/test/agents/agent-markers.test.ts`.

## Phase 4 — Fallback + loud logging + Node guard

- **T10 — RED/GREEN: fallback** — ollama route throws/times out & `fallbackEnabled` → retry via
  `forwardToAnthropic`; `fallbackEnabled:false` → return the error. Assert the request still
  completes on cloud when fallback on.
- **T11 — RED/GREEN: always-on routing log** — every decision writes one JSON line
  `{ts, agent, model, route, fallback?, reason?}` to `~/.oss/logs/.../model-routing.log` (or the
  session log). Logging never throws into the request path. (Distinct from the opt-in `OSS_PROXY_LOG`.)
- **T12 — RED/GREEN: Node preflight** — a `requireNode()` helper the launcher calls; if `node`
  absent/too old, exit non-zero with a loud message (never silently continue all-cloud).
- **Files:** `model-proxy.ts`, `watcher/src/services/routing-log.ts` (new), launcher; tests.

## Phase 5 — Launcher entrypoint (approach A)

- **T13 — RED/GREEN: `oss-launch` core** — read merged config; if `models.agents` non-empty →
  ensure proxy (GET `/health`; if down, start it and wait for bind), set
  `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` + `OSS_PROXY_ROUTING=1`, then exec real `claude`
  with passed argv. If `models.agents` empty/absent → exec claude unchanged (no proxy, no env).
- **T14 — RED/GREEN: resolve real claude without self-recursion** — find the claude binary that
  is NOT this launcher (PATH scan / configured path); error clearly if not found.
- **T15 — RED/GREEN: proxy reuse + port** — reuse a healthy proxy (don't double-start); port from
  `OSS_PROXY_PORT` > `models.proxyPort` > 8473.
- **Files:** `watcher/src/cli/oss-launch.ts` → `dist/cli/oss-launch.js`; tests mock spawn/exec/fetch.

## Phase 6 — Reconcile legacy Step-2.5 offload

- **T16 — RED/GREEN: self-disable under launcher** — `agent-model-check` returns `useProxy:false`
  when `OSS_PROXY_ROUTING=1` (already routed at the proxy layer) → no double-offload. Keep the
  nested-offload path working when the launcher is NOT used (interactive without launcher).
- **Files:** `watcher/src/cli/agent-model-check.ts` + test.

## Phase 7 — Ship

- **T17 — Docs:** TESTING.md DeepBlue verification commands (below); a `DRAIN_SH_INTEGRATION.md`
  one-liner for the other session (point drain.sh at `oss-launch`); update
  `agents/_shared/model-routing.md` (stale port 3456 → 8473, note proxy-layer routing).
- **T18 — Version bump:** `.claude-plugin/plugin.json` patch bump so DeepBlue `claude plugin update`.
- **T19 — ADR copy** into `docs/architecture/decisions/` if required by repo convention.

---

## Task → file → verified-by (summary)

| Phase | Tasks | Core file(s) | Verified by |
|-------|-------|-------------|-------------|
| 1 | T1-T3 | anthropic-passthrough.ts, model-proxy.ts | OAuth forwarded verbatim; SSE + catch-all forward |
| 2 | T4-T6 | agent-route-resolver.ts, model-proxy.ts | marker→route decisions; per-request model |
| 3 | T7-T9 | agents/*.md | every routable agent marked; e2e route |
| 4 | T10-T12 | model-proxy.ts, routing-log.ts | fallback retries cloud; loud log; node guard |
| 5 | T13-T15 | cli/oss-launch.ts | env set at launch; default users untouched; reuse |
| 6 | T16 | cli/agent-model-check.ts | no double-offload under launcher |
| 7 | T17-T19 | docs, plugin.json | TESTING.md cmds; version bump |

## Sequencing
Phase 1 → 2 → (3 ∥ 4) → 5 → 6 → 7. Phase 5 launcher can be built in parallel with 1-4 (it only
needs the proxy `/health` contract, which exists). Phase 3 markers depend on Phase 2's resolver
contract (the marker format).

## Acceptance (DeepBlue aarch64 — the real gate; see TESTING.md)
drain.sh → `oss-launch -p "/oss:build …" --dangerously-skip-permissions`. During the run:
`gpt-oss:120b` appears in `curl $OLLAMA/api/ps`; `journalctl --user -u ollama` shows `POST /api/chat`
for the code-reviewer agent; test-engineer still hits Anthropic; routing log shows
`route=ollama agent=code-reviewer` and `route=anthropic agent=test-engineer`. Zero Ollama = FAIL.

## Definition of done
- Headless `/oss:build` via launcher routes code-reviewer→Ollama, test-engineer→Anthropic, no
  manual proxy/env. Fallback verified. Loud log present. Default (no models.agents) users unaffected.
- All targeted suites green; plugin version bumped; drain.sh integration documented.
