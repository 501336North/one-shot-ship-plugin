# PLAN — Model-Routing Productionization (TDD)

## Summary
Ship two productionization fixes from the model-routing eval, as **3 PRs across 2 repos**:
- **PR-A** (plugin/watcher): remote ollama base-URL routing + per-request routing log. *(AC1, AC2)*
- **PR-B-plugin** (plugin/agents): routed-subagent model banner in output. *(AC3)*
- **PR-B-api-or-hook** (plugin hook, recommended): session-model banner for non-terminal users. *(AC4)*

## Design Reference
See `DESIGN.md` (acceptance criteria AC1–AC5) and `DECISIONS.md` (DR-001…DR-004). DR-004 is an OPEN
design point to confirm at build (hook vs API-prompt for AC4).

## TDD Implementation Tasks

### Phase 1 — PR-A: Remote base-URL routing (plugin/watcher)  [branch: feat/ollama-remote-baseurl/build]
> Status: tests already written + **RED-validated** (4 failing against stock). Source patch ready.

**Task 1 — `--base-url` CLI arg + `loadOllamaBaseUrlFromConfig()`**
- RED: `start-proxy.test.ts` — "accept --base-url argument", "load ollama baseUrl from config apiKeys.ollama",
  "returns undefined when apiKeys.ollama absent". (Confirmed failing.)
- GREEN: add `--base-url` parse + `loadOllamaBaseUrlFromConfig()` reading `apiKeys.ollama` from user config.
- REFACTOR: share config-read path with `loadApiKeyFromConfig`.

**Task 2 — Thread `baseUrl` through `startProxy → ModelProxy → ollama-handler`**
- RED: assert ModelProxy constructed with `baseUrl` reaches the ollama handler (handler hits remote, not localhost).
- GREEN: pass `baseUrl` option fg + bg; default `http://localhost:11434` preserved.
- REFACTOR: single source of the default.

**Task 3 — Per-request `OSS_PROXY_LOG` logging**
- RED: `model-proxy.test.ts` — "logs each /v1/messages request to OSS_PROXY_LOG". (Confirmed failing.)
- GREEN: `logRequest(model)` appends `{ts,provider,model,baseUrl}` JSON line when `OSS_PROXY_LOG` set.
- REFACTOR: guard + cheap no-op when unset.

**Task 4 — Build + integration**
- `npm run build` (tsc + bundle-cli) so `dist/` ships. Full watcher suite GREEN + tsc clean.
- Stage ONLY: `watcher/src/cli/start-proxy.ts`, `watcher/src/services/model-proxy.ts`, the 2 test files,
  rebuilt `dist` for those, README note. Do NOT stage pre-existing unrelated working-tree noise.

### Phase 2 — PR-B-plugin: routed-agent model banner (plugin/agents)  [branch: feat/model-banner-agents/build]
**Task 5 — `agent-model-check` emits a `banner` field**
- RED: `agent-model-check` test — for a routed agent returns `banner:"🤖 OSS model: gpt-oss:120b (ollama)"`;
  for an unrouted agent returns `banner:"🤖 OSS model: <session default>"` (or empty per DR).
- GREEN: compute banner from model+provider. REFACTOR: format helper.

**Task 6 — Step-0 echoes the banner**
- RED: a `no-stale-agents` style test asserting every routable agent file's Step-0 prints `$BANNER`
  at the top of output, and `agents/_shared/model-routing.md` documents it.
- GREEN: update `_shared/model-routing.md` + the routable agent files to echo the banner first.
- REFACTOR: ensure a single canonical snippet (sync-checked).

### Phase 3 — PR-B AC4: session-model banner for non-terminal users  [branch: feat/model-banner-session/build]
> **GATED on DR-004 confirmation.** Planned as a plugin hook (recommended).
**Task 7 — Hook prints session-model banner**
- RED: hook test — given stdin JSON with `.model.display_name`, the hook emits one line
  `🤖 OSS model: <display_name>` (and nothing when already shown by an agent banner, to avoid dupes).
- GREEN: implement the hook (UserPromptSubmit or equivalent that receives the model); register in hooks JSON.
- REFACTOR: dedupe vs the agent banner; respect a quiet/off toggle.
- *(If DR-004 rejected → re-plan for API-served command-prompt directive in AgenticDevWorkflow.)*

## Testing Strategy
### Unit
- start-proxy: arg parsing (`--base-url`), `loadOllamaBaseUrlFromConfig` present/absent.
- model-proxy: baseUrl reaches handler; `OSS_PROXY_LOG` line shape; no-op when unset.
- agent-model-check: banner string for routed/unrouted.
- hook: banner from `.model.display_name`; dedupe; off-toggle.
### Integration
- start-proxy → ModelProxy → ollama-handler hits the configured remote base URL (mock fetch).
- Agent-file sync test: all routable agents carry the banner echo.
### Edge cases
- `apiKeys.ollama` absent → localhost default (no regression).
- `OSS_PROXY_LOG` unset → no file writes.
- No `models` config → no routing, minimal/zero banner noise (AC5).
- Non-terminal surface (no statusline) → banner still appears.

## Security Checklist
- `--base-url` / `apiKeys.ollama` is a URL only; no secret logged. `OSS_PROXY_LOG` records model+host, not payloads.
- Routing code to a user-configured host is the user's explicit choice; default unchanged.

## Performance
- `logRequest` is a guarded append (no-op when unset). Banner is a single echo. Negligible.

## Rollout Strategy
- 3 independent PRs, each green CI, human review, **no auto-merge** (no `--merge` given).
- Order: PR-A → PR-B-plugin → Phase 3 (after DR-004 confirm). Bump plugin version per PR for auto-update.

## Estimated Tasks: 7
## Estimated Test Cases: ~14 (4 already RED)

## After the plan
HARD STOP. Per OSS workflow, wait for the user to run `/oss:build`. Phase 1 is ready (RED achieved);
Phase 3 needs DR-004 confirmation before its build.
