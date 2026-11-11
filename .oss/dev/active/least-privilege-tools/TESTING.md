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

## Results (2026-11-11, build)
- **Acceptance, RED first (8b40258):** agent-tools 4 of 7 failing for the stated reasons; tool-gate R-266 refusals 4 failing with exit 0 instead of 2; gate-run file failing on the missing module. All now pass.
- **Plugin, watcher targeted run** (test/tool-gate, test/gate-run, test/hooks, test/agents, tool-gate acceptance/cli/speed, gate-run acceptance, agent-offload, models-offload-warning, utils/gate-agents, integration/agent-model-routing): **109 files, 4,431 tests, all pass.** `tsc --noEmit` clean.
- **Plugin, shell:** agent-tools 7/7, agent-frontmatter 5/5, code-simplifier 6/6, agent-offload-step 5/5, bash-blocks-allowlisted 8/8, oss-gate-run 9/9, hooks-registration 33/33, referenced-hooks-tracked 50/50, watcher-dist-fresh PASS (122 tracked .js).
- **Speed (Task 9):** gate in-process median 16.4 ms (max 18.6; bound 100); end-to-end median 81.4 ms (max 92.5; bound 300). Tree check on this repo (1,814 files): start ~240 ms (545 ms cold), stop ~238 ms; hook timeout 10 s.
- **Three pinned tests updated (5d145b2)**, each keeping its purpose: hooks-json-tool-gate (pre-existing entries still pinned; gate-run entries pinned separately), offload-step-safety (identity kept apart from the review/builder sentence), provenance (gateAgents in base settings).
- **API (sprint branch worktree):** security-delegation-rows + agent-headers-no-tools 6/6; prompt tests reading these files (no DB) 145/145 after the manifest re-sign; `manifest:verify` 138 prompts match. DB-backed `test/prompts.test.ts` not run.
- **Live row (`agents/__tests__/agent-tools.live.sh`, Claude Code 2.1.322, this branch via `--plugin-dir`): 5/5.** Review agent's Edit refused; builder's Edit applied; review agent's `echo > target.txt` refused and the refusal names `gate-agent-write`; review agent's `python3 -c` write voided the review. Separately: the pen tester lists WebFetch and WebSearch with its narrow `tools:` (the fetch stopped only at the headless permission prompt).
- **No `.skip`/`.only`/`.todo`** added (the hits in tool-gate tests are test strings the focused-test rule checks).

## Last Updated: 2026-11-11 by /oss:build (Task 16)
