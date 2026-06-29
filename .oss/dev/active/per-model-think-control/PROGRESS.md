# Progress: per-model `think` control in the OSS Ollama proxy

## Current Phase: build COMPLETE (code T1-T7, 140 tests) — box V1/A1 pending DeepBlue → ready /oss:ship

## Tasks
### Phase 1 — Handler injection (core)
- [x] T1: OllamaHandler injects think per model (existence-keyed; value may be false); tests (a)-(e)
### Phase 2 — handler-registry
- [x] T2: createHandler forwards think → OllamaHandler
### Phase 3 — config loader + proxy wiring
- [x] T3: buildRouterConfig carries models.think; RouterProxyConfig type
- [x] T4: model-proxy passes routerConfig.models?.think into createHandler; ModelProxyConfigRouter type
### Phase 4 — build + box verification
- [x] T5: dist build
- [ ] V1: (box) send think to a non-thinking model (qwen3-coder:30b) → record behavior (justifies allowlist)
### Phase 5 — docs + ship
- [x] T6: plugin.json patch bump
- [x] T7: docs (models.think note) + TESTING DeepBlue commands
### Field acceptance (other session)
- [ ] A1: DeepBlue — qwen3.6:35b-a3b think:false via /v1/messages → suppressed reasoning (OSS_PROXY_LOG/token count)

## Blockers
- None for the code. V1 + A1 need the DeepBlue box (other session). R1 (false-vs-truthiness) is the
  key correctness risk — guarded by the `in` existence check + test (a).

## Last Updated: 2026-06-29 by /oss:plan
