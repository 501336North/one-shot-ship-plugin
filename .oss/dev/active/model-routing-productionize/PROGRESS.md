# Progress: Model-Routing Productionization

## Current Phase: plan → (ready for build)

## Tasks
- [x] Phase 1 / Task 1: `--base-url` + `loadOllamaBaseUrlFromConfig` (GREEN 2026-06-18)
- [x] Phase 1 / Task 2: thread baseUrl → ModelProxy → ollama-handler (GREEN)
- [x] Phase 1 / Task 3: `OSS_PROXY_LOG` per-request logging (GREEN)
- [x] Phase 1 / Task 3.5: **fix 6 pre-existing watcher-suite failures** (unplanned; suite now 3251/3251)
- [x] Phase 1 / dist built (`npm run build` rc=0)
- [ ] Phase 1 / Task 4: stage + PR-A  ← /oss:ship
- [ ] Phase 2 / Task 5: `agent-model-check` banner field
- [ ] Phase 2 / Task 6: Step-0 echoes banner across routable agents + PR-B-plugin
- [ ] Phase 3 / Task 7: session-model banner hook (GATED on DR-004 confirm) + PR

## Pre-existing failures fixed (Task 3.5 — proven failing on stock, unrelated to feature)
- `model-frontmatter.test.ts`: added `auto`→opus, new `SONNET_COMMANDS=['queue']` tier (per #170),
  `ui-ux`/`visual-test`/`xray`→inherit; completeness now spans 4 tiers (69 cmds).
- `help-documentation.test.ts`: command-count baseline 64 → 69.
- `integration/ollama-real.test.ts` + `proxy-integration.test.ts`: health checks made **model-aware**
  (skip cleanly when the required model — qwen2.5-coder:7b / llama3.2 — isn't pulled, instead of failing).

## Blockers
- DR-004 (Phase 3): confirm hook (recommended) vs API-prompt for the session-model banner before building Phase 3.
- Git hygiene: Task 3.5 fixes are unrelated to the base-url feature → consider a separate PR (decide at ship).

## Notes
- Branch `feat/ollama-remote-baseurl/build`. Suite 3251/3251, tsc clean, dist rebuilt. Version still 2.0.70 (bump at ship).

## Last Updated: 2026-06-18 by /oss:build
