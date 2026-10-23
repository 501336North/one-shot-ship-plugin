# TESTING — Model-Routing Productionization

## Strategy
TDD (London/outside-in). Each task: failing test → minimal code → refactor. Watcher uses vitest.
Agent-file changes are guarded by a sync/completeness test so banners can't silently drift.

## Test Inventory
| # | Test | Asserts | Status |
|---|------|---------|--------|
| 1 | start-proxy: accept `--base-url` | parsed into options | RED ✓ |
| 2 | start-proxy: `loadOllamaBaseUrlFromConfig` reads `apiKeys.ollama` | returns the URL | RED ✓ |
| 3 | start-proxy: absent `apiKeys.ollama` | returns undefined | RED ✓ |
| 4 | model-proxy: logs each `/v1/messages` to `OSS_PROXY_LOG` | JSON line w/ model+ts | RED ✓ |
| 5 | model-proxy: baseUrl reaches ollama handler | remote host hit, not localhost | TODO |
| 6 | model-proxy: `OSS_PROXY_LOG` unset | no file write | TODO |
| 7 | agent-model-check: routed agent | `banner` = "🤖 OSS model: gpt-oss:120b (ollama)" | TODO |
| 8 | agent-model-check: unrouted agent | banner per DR (session/default) | TODO |
| 9 | agents sync: every routable agent Step-0 echoes the banner | present in all | TODO |
| 10 | hook: emits banner from `.model.display_name` | one line, accurate | TODO (Phase 3) |
| 11 | hook: dedupe vs agent banner / off-toggle | no double banner | TODO (Phase 3) |

## Results
- 2026-06-18: Phase-1 tests 1–4 authored and confirmed RED against stock source (55 pass / 4 fail). GREEN pending /oss:build.

## Last Updated: 2026-06-18 by /oss:plan
