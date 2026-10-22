# TESTING: per-model `think` control

## Strategy
Vitest unit tests at the handler boundary (where the `/api/chat` body is assembled) — the proxy
captures the outbound body via the mocked client request, so we assert on the exact JSON sent to
ollama. Plus config-loader unit tests and a router-mode wiring test. Box checks (V1, A1) need DeepBlue.

## Targeted vitest (NOT full suite)
```bash
cd watcher && npx vitest run \
  test/services/handlers/ollama-handler.test.ts \
  test/services/handler-registry.test.ts \
  test/cli/start-proxy-router.test.ts \
  test/services/proxy-router-mode.test.ts \
  test/services/model-proxy.test.ts
```

## Key behaviors asserted
- **think injection (T1):** captured `/api/chat` body —
  - configured `qwen3.6:35b-a3b → false`, request model `ollama/qwen3.6:35b-a3b` → `body.think === false`
    (proves: value `false` survives, NOT swallowed by truthiness; AND the `ollama/` strip+match works).
  - configured `true` → `body.think === true`.
  - unlisted model + non-empty map → `'think' in body === false`.
  - no map → `'think' in body === false`.
  - existing transform (model/messages/options/tools) unchanged.
- **registry (T2):** `createHandler({provider:'ollama', think})` → handler emits think for a listed model.
- **config (T3):** `buildRouterConfig({models:{think:{…}}}).models.think` deep-equals; absent → absent.
- **proxy (T4):** router `ollamaHandle` builds the handler with `routerConfig.models?.think` → backend
  body carries think for a routed, listed model.

## Box verification (DeepBlue / the box) — NOT runnable on Mac
- **V1 — allowlist necessity:** on the box,
  `curl $OLLAMA/api/chat -d '{"model":"qwen3-coder:30b","messages":[{"role":"user","content":"hi"}],"stream":false,"think":false}'`
  → record whether it 400s / errors / is ignored. Confirms why unlisted models must NOT receive `think`.
- **A1 — field acceptance:** config `models.think:{ "qwen3.6:35b-a3b": false }`, route an agent there,
  hit via `/v1/messages`; confirm suppressed reasoning by low output-token count in `OSS_PROXY_LOG`
  (≈4 s vs ≈32 s baseline). Negative: an unlisted thinking model still reasons.

## Results
_Filled during /oss:build._

## Last Updated: 2026-06-29 by /oss:plan
