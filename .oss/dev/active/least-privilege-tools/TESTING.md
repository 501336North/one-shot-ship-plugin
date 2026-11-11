# Testing: least-privilege-tools (R-266)

## Strategy
- **Acceptance (Task 2):** `agents/__tests__/agent-tools.test.sh`; new cases in `watcher/test/cli/tool-gate.acceptance.test.ts`; `watcher/test/cli/gate-run-check.acceptance.test.ts`.
- **Unit:** rule file `gateAgents`, hook input agent field, `gate-agent-write` rule, offload arguments.
- **Integration (real git repos, real symlinks):** `gate-agent-write.integration.test.ts`, `gate-run/snapshot` and `gate-run/compare`.
- **API (sprint branch):** delegation rows, no `tools:` in served agent headers.
- **Live, by hand:** `agents/__tests__/agent-tools.live.sh` (gate Edit refused, builder Edit applies), result recorded below.

## How to run (targeted only)
- Never the watcher full suite: its setup kills every OSS process on the machine. Run `cd watcher && npx vitest run <files>`.
- Shell tests: `bash <path>.test.sh`.

## Results
- (none yet; build not started)

## Last Updated: 2026-11-11 by /oss:plan
