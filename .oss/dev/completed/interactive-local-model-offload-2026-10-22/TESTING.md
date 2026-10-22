# Testing: Interactive Local-Model Offload

## Strategy (London TDD)
Outside-in. The system boundary is **the agent invoking `agent-offload.js`**. Mock the
collaborators (`agent-model-check`, `child_process.spawn`, `fs`, proxy health probe); keep
pure helpers (`buildOffloadInvocation`, `classifyResult`) real; use ONE real-proxy
integration test for the proof-of-routing path.

## Test inventory (planned)
| ID | Type | Behavior verified | Mocks |
|----|------|-------------------|-------|
| T1.1 | unit | `OSS_OFFLOAD_ACTIVE=1` ⇒ `useProxy:false` (no infinite nesting) | env |
| T2.1 | unit | `useProxy:false` ⇒ `{offloaded:false}`, nothing spawned | model-check |
| T2.3 | unit | nested prompt assembled from `--prompt-file` onto stdin | fs |
| T2.5 | unit | `buildOffloadInvocation` returns correct cmd/args/env/stdin (pure) | — |
| T3.1 | unit | spawns `claude -p --model X --dangerously-skip-permissions`, env has BASE_URL/OFFLOAD_ACTIVE/PROXY_LOG | spawn |
| T3.3 | unit | exit 0 + stdout ⇒ `{offloaded:true, output}` | spawn |
| T3.5 | unit | failure + `fallbackEnabled:true` ⇒ native fallback | spawn |
| T3.6 | unit | failure + `fallbackEnabled:false` ⇒ fallback, NEVER throws | spawn |
| T4.1 | unit | proxy unreachable ⇒ `{offloaded:false, reason:'proxy_down'}` | health probe |
| T4.3 | integration | full run writes a request line to `OSS_PROXY_LOG` (fake local server) | — (real proxy) |
| T5.1 | content | code-reviewer.md invokes agent-offload; no banner-only path | — |
| T6.1 | content | all 13 agents carry canonical Step 0.5 + correct `--agent` id | — |

## Manual / live proofs
- **T5.3** review: `oss:code-reviewer` on a diff-with-issues, mapping ON → `OSS_PROXY_LOG`
  shows `:3456` hit + findings; mapping OFF → no hit, native Claude.
- **T6.4** generative: `oss:typescript-pro` small task → nested gpt-oss edits a file; proxy
  log confirms; edit lands.
- **T7.1** E2E: `/oss:ship` spawns code-reviewer against deepblue gpt-oss (pre-warmed).

## The load-bearing assertion
`OSS_PROXY_LOG` containing a `:3456` request line is the ONLY proof the local model actually
reasoned (vs Claude silently doing it). Every "it offloaded" claim must cite this artifact.

## Acceptance test (written FIRST — outside-in)
`watcher/test/acceptance/interactive-local-model-offload.acceptance.test.ts` — boundary =
`runAgentOffload` (the function each agent's Step 0.5 invokes). Collaborators injected/mocked
(`checkAgentModel`, `isProxyReachable`, `readPrompt`, `spawnFn`) per the repo's `_testSpawn`
DI idiom. Covers:
- **AC-OFFLOAD.1** mapped → spawns nested `claude -p --model ollama/gpt-oss:120b
  --dangerously-skip-permissions` with `env.ANTHROPIC_BASE_URL=:3456` + `OSS_OFFLOAD_ACTIVE=1`;
  returns `{offloaded:true, output}`.
- **AC-OFFLOAD.2** no mapping → `{offloaded:false}`, spawns nothing (default-OFF guarantee).
- **AC-OFFLOAD.3** nested failure / proxy down → `{offloaded:false, fallback:true, reason}`,
  never throws (safety net).

**RED confirmed 2026-06-20:** suite fails to load `../../src/cli/agent-offload` (module absent)
— meaningful outside-in failure. Drives the build to create the runner + DI seams.

> Note: AC-OFFLOAD.4 (recursion guard, `OSS_OFFLOAD_ACTIVE=1 ⇒ useProxy:false`) lives at the
> `agent-model-check` unit level (PLAN T1), not the acceptance boundary.

## Results
_(unit/integration results populated during build)_

## Last Updated: 2026-06-20 by /oss:plan
