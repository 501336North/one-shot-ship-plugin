# PLAN: per-model `think` control in the OSS Ollama proxy

**Repo:** `one-shot-ship-plugin` (plugin-only). **Branch:** `feat/per-model-think-control/build` (off `origin/main`).
**Methodology:** London TDD — RED→GREEN→REFACTOR per task. Vitest (watcher). No `any`.
**Design:** see `DESIGN.md`. Thread an opt-in `think` map (bare-name→bool) config→handler; inject in
`transformToOllama` keyed by **existence** (`in`), value may be `false`.

> ⛔ IRON LAW #4: branch off main. ⚠️ Vitest-overload: run TARGETED files only.

---

## Phase 1 — Handler injection (the behavior; fully unit-testable) — CORE

- **T1 — `OllamaHandler` injects `think` per model.** RED in
  `watcher/test/services/handlers/ollama-handler.test.ts`:
  - (a) `new OllamaHandler({ think:{ 'qwen3.6:35b-a3b': false } })`, request model `ollama/qwen3.6:35b-a3b`
    → captured `/api/chat` body has `think === false`.
  - (b) think `true` configured → `body.think === true`.
  - (c) unlisted model (`gpt-oss:120b`) with a non-empty map → `'think' in body === false`.
  - (d) no map (`new OllamaHandler({})`) → `'think' in body === false`.
  - (e) regression: existing transform tests (model/messages/options/tools) unchanged.
  GREEN: `OllamaHandlerConfig.think?: Record<string, boolean>`; store `this.think`; in
  `transformToOllama`, `const m = request.model.replace(/^ollama\//,''); if (this.think && m in this.think)
  ollamaRequest.think = this.think[m];`. (`watcher/src/services/handlers/ollama-handler.ts`)

## Phase 2 — Wire through handler-registry

- **T2 — `createHandler` forwards `think` to `OllamaHandler`.** RED in
  `watcher/test/services/handler-registry.test.ts` (or ollama-handler test): `createHandler({
  provider:'ollama', think:{...} })` yields a handler that emits `think` for a listed model. GREEN:
  `HandlerConfig.think?: Record<string, boolean>`; `new OllamaHandler({ baseUrl, think: config.think })`.
  (`watcher/src/services/handler-registry.ts`)

## Phase 3 — Config loader + proxy wiring

- **T3 — `buildRouterConfig` carries `models.think`.** RED in
  `watcher/test/cli/start-proxy-router.test.ts`: `buildRouterConfig({ models:{ think:{ 'qwen3.6:35b-a3b':
  false } } }).models.think` deep-equals the map; absent → `undefined`/absent (no synthetic default).
  GREEN: add `think: models.think` to `buildRouterConfig`; extend `RouterProxyConfig.models` with
  `think?: Record<string, boolean>`. (`watcher/src/cli/start-proxy.ts`)
- **T4 — model-proxy passes `routerConfig.models?.think` into `createHandler`.** Extend
  `ModelProxyConfigRouter.routerConfig.models` with `think?: Record<string, boolean>`; at the router
  `ollamaHandle` createHandler call (~:655) add `think: routerConfig.models?.think`. RED: a router-mode
  test (extend `proxy-router-mode.test.ts` or a focused unit) asserting that when `routerConfig.models.think`
  maps the routed model, the ollama backend receives a body with `think` set. (`watcher/src/services/model-proxy.ts`)

## Phase 4 — Build + box verification

- **T5 — dist build** (`npm run build`) — plugin runs `dist/`.
- **V1 — allowlist necessity (on the box):** send `think:false` to a NON-thinking model
  (`qwen3-coder:30b`) via `/api/chat` and record the result (400 / error / ignored). Confirms the
  unlisted-model guard is required, not cosmetic. Record in `DECISIONS.md`.

## Phase 5 — Docs + ship prep

- **T6 — `.claude-plugin/plugin.json` patch bump** (re-embeds into the bundle on build).
- **T7 — Docs:** note `models.think` in the model-routing docs / DRAIN integration as appropriate;
  TESTING.md DeepBlue verification commands.

## Field acceptance (DeepBlue, other session)
- **A1 —** route an agent to `qwen3.6:35b-a3b` with `models.think:{ "qwen3.6:35b-a3b": false }`; hit it
  via `/v1/messages`; confirm suppressed reasoning via `OSS_PROXY_LOG` / low output-token count
  (≈4 s vs ≈32 s). Negative check: an unlisted thinking model still reasons normally.

---

## Task → file → verified-by
| Phase | Tasks | File(s) | Verified by |
|------|------|---------|-------------|
| 1 | T1 | ollama-handler.ts | think:false/true emitted; unlisted/no-map → absent (vitest) |
| 2 | T2 | handler-registry.ts | createHandler forwards think (vitest) |
| 3 | T3–T4 | start-proxy.ts, model-proxy.ts | buildRouterConfig carries think; proxy passes it (vitest) |
| 4 | T5, V1 | dist, box | build clean; non-thinking-model behavior recorded |
| 5 | T6–T7 | plugin.json, docs | bump; docs |

## Sequencing
T1 → T2 → T3 → T4 → T5 → (V1 ∥ docs) → T6/T7. T1 is the load-bearing behavior; everything else is wiring.

## Risks
- **R1 — `false` swallowed by truthiness.** Mitigated by the `in`/existence guard + test (a) asserting
  `think === false`. This is THE bug to avoid.
- **R2 — sending `think` to a non-thinking model 400s.** Mitigated by the allowlist (only listed models);
  V1 confirms the failure mode the guard prevents.
- **R3 — wrong key form.** Keys are BARE names (post `ollama/` strip); test (a) uses an `ollama/`-prefixed
  request model to prove the strip+match.

## Definition of done
Listed models get the configured `think`; unlisted/no-map are byte-identical; no `any`; targeted vitest
green; dist built; version bumped; box V1 recorded. DeepBlue A1 is the external field gate.

## Last Updated: 2026-06-29 by /oss:plan
