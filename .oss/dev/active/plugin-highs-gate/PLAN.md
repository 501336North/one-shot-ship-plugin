# Plan: plugin-highs-gate

Fix round for the post-merge `/oss:ship` gate review of PR #193 (bac6c13, v2.0.86).
Branch: `fix/plugin-highs-gate/build` from origin/main. Ships as **2.0.88**, opened as an unmerged PR,
rebased onto 2.0.87 (the coordinating session's symlink hotfix) before the PR opens.

**Out of scope (owned by the coordinating session, do NOT edit):** hooks/oss-log.sh, hooks/oss-notify.sh,
watcher/src/services/workflow-state.ts, watcher/src/cli/update-workflow-state.ts, watcher/src/cli/oss-error.ts.
Also out of scope: the `complete` state check / condition evaluation (2.0.89), the oss-notify spawn timeout
(2.0.89), and the watcher vitest/tinypool npm audit (deps session).

Rules: every task RED first, then minimal GREEN. Never `pkill -f vitest`; never kill the live watcher.

## Tasks

### T1 (HIGH, pen-test) chain-trigger CHAIN-line injection
- File: `watcher/src/cli/chain-trigger.ts:117-140` (`executeChainForWorkflow`).
- RED: a `chains_to` step whose `command` or `condition` contains CR/LF, a control character, or the
  `---CHAIN_COMMANDS---` / `---END_CHAIN_COMMANDS---` delimiter produces no extra `CHAIN:` line and no text
  outside the block. Names outside `^(team:)?[a-z][a-z0-9-]{0,40}$` are skipped (and logged to stderr).
  `condition` outside `^[a-z0-9_-]{1,64}$` → skip the step.
- GREEN: validate each step before printing; skip invalid ones.
- Cap: `MAX_CHAIN_COMMANDS` counts printed lines (assert ≤10 `CHAIN:` lines when the config has >10 valid steps).
- After 2.0.87 is on main: route the name check through `watcher/src/utils/workflow-name.ts`
  (`isValidWorkflowName`) — IRON LAW #1b, one helper, no second copy. `team:` prefix stripped first.
- Provenance check: grep every other site that prints or parses `CHAIN:` lines (commands/*.md, agents/,
  watcher/src) and state findings in the commit body.

### T2 (MEDIUM, security + pen-test) workflow-config https / OSS_CONFIG_DIR split
- Files: `watcher/src/api/workflow-config.ts:41-49, 120-143`; `watcher/src/cli/chain-trigger.ts` `readApiCredentials` (54-79).
- RED: with HOME config = https and `OSS_CONFIG_DIR` config = `http://…`, `fetchWorkflowConfig` must refuse
  (no request sent with the Bearer key). The URL path segment is encoded / name validated.
- GREEN: one shared config reader + https check used by both sites; check enforced inside `fetchWorkflowConfig`.
  `encodeURIComponent(workflowName)` (and the shared name helper after rebase).

### T3 (LOW, perf) fetch timeout
- File: `watcher/src/api/workflow-config.ts:130`.
- RED: a stand-in server that never answers → `fetchWorkflowConfig` rejects/falls back well under 30s.
- GREEN: `signal: AbortSignal.timeout(8000)` (or injected timeout for the test).

### T4 (MEDIUM, code-review) ship.md --merge with a queued auto-merge
- File: `commands/ship.md` Step 7 / Step 8 (~:227-242).
- RED: extend `watcher/test/hooks/ship-wrapper-chain.test.ts` (or a doc-contract test) asserting ship.md says
  what to send when `gh pr merge --squash --auto` is queued but has not landed.
- GREEN: state that a queued auto-merge sends `complete` after `pr_created` + auto-merge enabled (no `merged`
  in this session); `failed` only when enabling auto-merge fails.
- Provenance (IRON LAW #1b): the same "Execute Chain Commands" parsing rules appear in commands/build.md,
  ideate.md, plan.md, ship.md, visual-qa.md, visual-test.md, xray.md. Tighten ALL of them, guarded by one test
  over every wrapper that has the section (not just ship.md).
- Also tighten "Execute Chain Commands": only lines matching the strict CHAIN shape are executed; anything
  else in the block is ignored and reported. Remove the false "Evaluate conditions" claim or say conditions
  are shown as text and not evaluated (state check lands in 2.0.89).

### T5 (LOW, pen-test) oss-custom.md name handling
- File: `commands/oss-custom.md:76, 95, 98, 129, 134`.
- RED: doc-contract test: oss-custom.md requires the name to match `^[a-z][a-z0-9-]{0,40}$` before any
  command uses it, and stops otherwise.
- GREEN: add the validation step.

### T6 (LOW, code-review) stale committed dist + guard
- File: `watcher/dist/cli/chain-trigger.cjs` (still lists `frontend-design`; src uses `ui-review` since #169).
- RED: guard test: building chain-trigger from src produces the committed dist (or: committed dist contains
  the src default agent list). Fails today.
- GREEN: rebuild and commit dist (the T1/T2 changes need it anyway, since ship-wrapper-chain.test.ts runs dist).

### T7 (INFO, perf) ship-wrapper-chain.test.ts teardown
- File: `watcher/test/hooks/ship-wrapper-chain.test.ts:120-123`.
- `server?.close(...)`, `if (tmp)` before `rmSync`. (Refactor-only; covered by the existing suite.)

### T8 (HIGH, pre-existing, code-review) commands/visual-test.md missing → main suite red (3 tests)
- `watcher/test/commands/model-frontmatter.test.ts:101` and `watcher/test/help-documentation.test.ts`
  expect 69 commands including visual-test. The build chain emits `CHAIN: /oss:visual-test (condition: has_ui_work)`,
  so customers hit a missing command.
- User decision (2026-10-19): ship the wrapper; suite expects 69.
- Source: untracked `/Users/ysl/dev/one-shot-ship-plugin/commands/visual-test.md` — READ ONLY, never modify
  or stage anything in that checkout. Write a fresh copy here, aligned with the current template:
  - ensure-decrypt failure text must match the current wrappers ("Failed to install the decrypt CLI (see the
    message above)…"), not the stale "Run /oss:login for manual setup".
  - same Step 1-6 layout as other wrappers; no `$CLAUDE_PLUGIN_ROOT`; no prompt content.
  - API has the prompt (AgenticDevWorkflow packages/api/test/prompts/visual-test.test.ts); check `--type`
    (`commands` vs `workflows`) against the API prompt registry.
- RED: the 3 currently failing tests are the RED. Also run the guard tests that scan commands/*.md
  (ensure-decrypt shape, referenced hooks tracked, help docs).

## Ship gate round 1 fix tasks (user-approved 2026-10-19: "small owned set" + "judge before running")

All four gates PASS (no CRITICAL/HIGH). These are the round-1 findings the user chose to fix now; everything
else goes to FOLLOWUPS.md + PR body. Same constraints as above, plus: vitest ONLY with
`--config /private/tmp/claude-501/-Users-ysl-dev-one-shot-ship-plugin-highs/71b984f4-23f7-4fad-adab-3d408c9422c1/scratchpad/vitest.nosetup.config.mjs`
(test/setup.ts runs machine-wide pkill), one invocation at a time, never the full suite until the final gate.
Any change to chain-trigger.ts or its imports → `node scripts/bundle-cli.js` from watcher/, commit only
dist/cli/chain-trigger.cjs (restore dist/cli/oss-launch.cjs).

### G1 (MEDIUM, code-review) team command names narrower than the API
- API accepts `team:[a-z0-9-]+` (AgenticDevWorkflow packages/api/src/schemas/workflow-config.ts:145, no length cap;
  sanitizer routes/custom-commands.ts:102). Plugin requires a leading letter, ≤41 → `team:2fa-audit` silently dropped
  by chain-trigger and refused by oss-custom.md Step 0.
- RED: chain-trigger prints `CHAIN: /oss:oss-custom 2fa-audit (always)` for `team:2fa-audit`, and for a 100-char
  `[a-z0-9-]` team name; still rejects >128, empty, uppercase, CR/LF etc. Contract tests: the wrappers' strict
  CHAIN regex and oss-custom.md Step 0 accept the same team-name set.
- GREEN: separate team-name rule `^[a-z0-9-]{1,128}$` (one helper, e.g. `isSafeTeamCommandName` beside
  isSafeChainName); non-team `/oss:` names keep `^[a-z][a-z0-9-]{0,40}$`. Update the strict regex in all 7
  wrappers' chain step and oss-custom.md Step 0 to match.

### G2 (MEDIUM, code-review; user choice "judge before running") conditions not evaluated
- chain-trigger: a step whose condition is `never` is not printed (RED test first).
- 7 chain-step wrappers: "If a line has a condition you can check from this session (for example `has_ui_work`:
  no UI files changed), skip it and log why; if you cannot tell, run it." Guard in chain-step-contract.test.ts
  (all 7, literal phrase). Replace "shown as text and are not evaluated" wording so it stays truthful.

### G3 (LOW, sec/CR/pen) step type confusion
- Skip (do not throw on) a step whose `command` is not a string, or whose `condition` is present and not a
  string; a non-array `chains_to` prints nothing without throwing; valid steps in the same config still print.
- `(always)` only when `step.always === true` (truthy strings like "false" no longer count).

### G4 (LOW, perf/sec/pen) unbounded iteration + log sanitising
- Cap total steps iterated (e.g. MAX_CHAIN_COMMANDS * 10) and logged skip lines (e.g. 5, then one summary line).
  RED: 1000 invalid steps → bounded stderr line count.
- `safeForLog`: replace everything outside printable ASCII `[^\x20-\x7e]` (C1, bidi, U+2028/2029).

### G5 (LOW, pen/sec) redirects
- `fetchWorkflowConfig`: `redirect: 'error'` so the Bearer header is never replayed. RED with a local server that 302s.

### G6 (INFO, pen) prototype-key lookup
- `Object.hasOwn(DEFAULT_WORKFLOW_CONFIGS, name)` (or name validation) before the defaults lookup;
  `__proto__`/`constructor` → `{}`.

### G7 (LOW, CR) flaky timing test (zero tolerance)
- watcher/test/api/workflow-config.test.ts ~362-382: wait for the server `connection` event before asserting
  sockets / raise the abort to ~1000ms. Must stay well under the 3000ms hang threshold.

### G8 (LOW, CR, IRON LAW #1b) two copies of the bundle options
- One exported options object used by scripts/bundle-cli.js and chain-trigger-dist.test.ts; add
  `absWorkingDir` to bundle-cli.js so running it from the repo root produces the same bytes.

### G9 (LOW, CR/sec) contract regex copies
- Export `CHAIN_LINE_PATTERN` (string or RegExp) from chain-trigger (or a small module) and have
  chain-trigger.test.ts and chain-step-contract.test.ts derive from it (the .md text must contain its source).

### G10 (LOW/INFO, sec/perf) visual-test.md key echo; timeout visibility
- commands/visual-test.md Step 1: check the apiKey exists without printing it (e.g. `grep -q '"apiKey"'` on
  `${OSS_CONFIG_DIR:-$HOME/.oss}/config.json` → "configured"). Only visual-test.md (others → follow-up).
- workflow-config: one stderr line when the fetch aborts on timeout ("workflow-config: API timeout, using defaults").

## Ship gate round 2 fixes (bugs in this branch's own new code; round 2 had no CRITICAL/HIGH)

### D1 (LOW, code-review) "judge" rule never says the condition must be false
- commands/{build,ideate,plan,ship,visual-qa,xray,visual-test}.md chain-step bullet + `JUDGE_CONDITION_RULE` in
  watcher/test/commands/chain-step-contract.test.ts. One sentence everywhere: "If a line's condition can be
  checked from this session and is false (for example `has_ui_work`: no UI files changed), skip it and log why;
  if it is true or you cannot tell, run it." Place it above the "Log each" bullet. RED: update the contract
  literal first (7 fail), then edit the 7 files.

### D2 (INFO→bug, pen-test) team-name cap disagrees with oss-decrypt
- oss-decrypt `validateName` rejects names over 100 (AgenticDevWorkflow packages/cli-decrypt/src/cache.ts:53).
  Change the team rule to `^[a-z0-9-]{1,100}$` in safe-chain-name.ts, CHAIN_LINE_PATTERN, the 7 wrappers
  (derived by the contract test) and oss-custom.md Step 0. RED: tests for 100 accepted / 101 rejected
  (replace the 128/129 boundary tests). Rebuild dist/cli/chain-trigger.cjs.

### D3 (LOW, code-review + pen-test) silent cut-off beyond 100 steps
- chain-trigger.ts: when `steps.length > MAX_STEPS_ITERATED`, write one fixed stderr line
  `chain-trigger: N steps beyond the 100-step read limit ignored`. RED test first. Rebuild dist.

## Post-rebase (on 2.0.87, 0ea1ce2) — branch fix/plugin-highs-gate/release

### T1b (resolved shape) one workflow/command name rule across bash and TS
- 2.0.87 shipped only the bash rule: `oss_valid_workflow_name` in hooks/oss-safe-path.sh (`^[a-z][a-z0-9-]{0,40}$`),
  used by oss-notify.sh and oss-log.sh. Its DECISIONS.md names `isValidWorkflowName` in
  watcher/src/utils/workflow-name.ts as the TS twin, owned by this session.
- RED: watcher/test/utils/workflow-name.test.ts — `isValidWorkflowName` accepts `build`, `visual-test`, a 41-char name;
  rejects `Build`, `build/../ship`, `1adr`, 42 chars, empty, LF; `assertValidWorkflowName` throws on the rejects;
  AND the TS regex source equals the regex literal in hooks/oss-safe-path.sh (read with grep -F / fs) so the two
  runtimes cannot drift (IRON LAW #1b).
- GREEN: create workflow-name.ts; route chain-trigger's non-team names and fetchWorkflowConfig's name check through
  it; delete `isSafeChainName` (no second copy; team rule `isSafeTeamCommandName` stays in safe-chain-name.ts).
  Remove the TODO(T1b). Rebuild dist/cli/chain-trigger.cjs only (never commit oss-launch.cjs or .d.ts maps).

### T9 Release
- Bump .claude-plugin/plugin.json to 2.0.88 (coordinator-assigned) — check origin/main is 2.0.87 first.
- Full watcher suite ONCE with the no-setup config, plus hooks/__tests__ and commands/__tests__ shell tests.

### T9 Release (original)
- After rebase onto 2.0.87: bump `.claude-plugin/plugin.json` to 2.0.88 (coordinator-assigned).
- Full watcher `npm test` green, `./node_modules/.bin/tsc --noEmit`, `npm run build`, hooks/__tests__.
