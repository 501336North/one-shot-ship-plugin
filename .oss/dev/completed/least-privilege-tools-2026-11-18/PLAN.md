# Implementation Plan: least-privilege-tools (R-266)

## Summary
Every plugin agent gets an explicit `tools:` list. The four review agents (code-reviewer, security-auditor, penetration-tester, performance-auditor) lose Edit/MultiEdit/NotebookEdit. Three more checks stop them changing the repo another way: a tool-gate rule refuses their known writes, a before/after tree check catches any other change (scripts, offload), and their offload runs without edit tools. The shared snippet leaves `agents/`. The served delegation text and served agent headers change on the API's Sprint D branch.

## Design Reference
- `.oss/dev/active/least-privilege-tools/DESIGN.md` (COMMITTED 2026-11-11), ADR-001..008 in `DECISIONS.md`
- `docs/requirements/least-privilege-tools.md` (US-001..US-008)

## Branches and PRs (Sprint D rule)
- Plugin: `feat/least-privilege-tools/build` from `origin/feat/determinism-sprint/build`; PR into it. Tasks 1-13, 16.
- API: `feat/least-privilege-tools/build` in the API repo from its `feat/determinism-sprint/build`; PR into it. Tasks 14-15.
- oss-lab: ROADMAP update on its Sprint D branch; PR into it. Task 17.
- Never `main`. Nothing merges without the user.

## Test commands (targeted only)
- Shell: `bash agents/__tests__/<file>.test.sh`, `bash hooks/__tests__/<file>.test.sh`
- Watcher: `cd watcher && npx vitest run <path>` for the files a task touches. **Never the watcher full suite** (its setup kills every OSS process on the machine).
- API: `cd packages/api && npx vitest run <path>`

---

## Phase 0: Probes (blocking)

### Task 1: Probes P1-P4 in a real headless session
**Objective:** confirm the Claude Code behavior the design rests on (US-001).

**How:** a throwaway project with settings and plugins off, Claude Code `claude -p`, the same method as the 2026-11-09 check. Record each result, with the Claude Code version and the command used, in `NOTES.md`.
- P1: a PreToolUse hook that dumps its stdin, called from a subagent's Bash call. Does the input name the subagent? Field name?
- P2: an agent with `tools:` naming one MCP tool: can it reach it? Is `mcp__server__*` accepted?
- P3: does `tools:` accept an "all tools" value (`*` or similar)?
- P4: `claude -p --disallowedTools Edit Write MultiEdit NotebookEdit` asked to edit a file: refused?

**Stop rule:** if P1 finds no subagent name, STOP before Task 7 and ask the user (ADR-002). Tasks 2-6 and 10-17 don't depend on P1.

**Acceptance:** NOTES.md has all four results with evidence.

---

## Phase 1: Acceptance tests at the boundaries (RED)

### Task 2: Acceptance tests
**Objective:** outside-in tests at the three boundaries, all RED at first.
- [ ] `agents/__tests__/agent-tools.test.sh`
  - should fail when any `agents/**/*.md` has no frontmatter `name:` (AC-006.2)
  - should fail when any agent file has no `tools:` (AC-002.1)
  - should fail when a gate agent lists Edit, MultiEdit or NotebookEdit (AC-003.1)
  - should fail on a `tools:` entry that isn't a known tool name or `mcp__` name (AC-002.2)
- [ ] `watcher/test/cli/tool-gate.acceptance.test.ts` (new cases, hook JSON in, decision out)
  - should refuse a gate agent's Write into the repo (AC-004.1)
  - should allow a gate agent's Write into its private mktemp folder (AC-004.3)
  - should allow the same Write from a builder agent and from the main agent (AC-004.4, AC-004.5)
- [ ] `watcher/test/cli/gate-run-check.acceptance.test.ts` (real temp git repo)
  - should tell the main agent which files changed when a review agent's run changed the repo (AC-008.1)
  - should say nothing when a review agent's run changed nothing, and nothing for builder agents (AC-008.2, AC-008.3)

**Acceptance:** each test fails for the stated reason (`not implemented` / missing rule / missing list), not a setup error.

---

## Phase 2: Agent files

### Task 3: Gate set in one place
**Tests (RED):** `watcher/test/tool-gate/rule-file.test.ts`
- should read `gateAgents` from `config/tool-gates.json`
- should only add gate agents from a repo rule file, never remove one (add-only merge, as for other lists)

**GREEN:** `config/tool-gates.json` gets `"gateAgents": ["code-reviewer", "security-auditor", "penetration-tester", "performance-auditor"]`; `rule-file.ts` reads it.

### Task 4: Move the shared snippet out of `agents/`
**Tests (RED):** `agent-tools.test.sh` "every agents/**/*.md has `name:`" (from Task 2) fails on `agents/_shared/model-routing.md`.

**GREEN:** move to `docs/agents/model-routing.md`; update `watcher/test/integration/agent-model-routing.test.ts`, `watcher/test/agents/model-frontmatter.test.ts` (its `_shared` exclusion), `commands/__tests__/bash-allowlist-exempt.txt` (paths only). ⚠ changes existing tests' paths only, as AC-006.1 requires; no expectation changes.

### Task 5: Gate agents: tool lists and descriptions
**Tests (RED):** Task 2's gate check; plus `agent-tools.test.sh`
- should fail when the set of agents without Edit differs from `gateAgents` (AC-004.6)
- should fail when a gate description lacks "review" wording and the builder hand-off (AC-003.4)

**GREEN:** `tools: Read, Grep, Glob, Bash, Write` (plus WebFetch/WebSearch where the agent uses them today: penetration-tester); descriptions say the agent reviews and reports, and that fixes go to the stack's builder agent. security-auditor's "implement… fixes" wording goes.

### Task 6: Builder agents: tool lists
**Tests:** Task 2's "every agent has tools:" and known-names checks.

**GREEN:** 41 builder agents get either the "all tools" value (if P3 found one) or an explicit list of today's capabilities, naming MCP tools by P2's form (figma-design-agent, n8n-automation-specialist). Known tool names live in one list in the test.

---

## Phase 3: Gate rule (needs P1)

### Task 7: Read the calling agent from hook input
**Tests (RED):** `watcher/test/tool-gate/hook-input.test.ts`
- should read the subagent name from the field P1 found
- should treat a missing or non-string field as "main agent"
- should strip the `oss:` plugin prefix when comparing with `gateAgents`

**GREEN:** extend `GateRequest`/`HookCall` in `gate.ts` with `agent?: string`.

### Task 8: `gate-agent-write` rule
**Tests (RED):** `watcher/test/tool-gate/rules/gate-agent-write.test.ts`
- should refuse a gate agent's Write/Edit/MultiEdit/NotebookEdit to a path inside the repo (AC-004.1)
- should refuse a gate agent's Bash write the reader recognizes (redirect, rm, mv, cp, tee, sed -i) inside the repo (AC-004.2)
- should allow writes to the system temp folder and `mktemp` folders (AC-004.3)
- should refuse a temp-looking path that resolves into the repo through a symlink or `..` (AC-004.7)
- should not refuse builders, the main agent or unknown names (AC-004.4, AC-004.5)

**GREEN:** `watcher/src/tool-gate/rules/gate-agent-write.ts`, reusing `path-resolver.ts`, `edit-call.ts` and the command reader's write targets; wired into `gate.ts` after protected-path. Refusal text names the rule and says fixes go to a builder.

**Integration:** `watcher/test/tool-gate/rules/gate-agent-write.integration.test.ts` with real symlinks.

### Task 9: Speed
**Test:** extend the existing in-process speed test: the gate with the new rule stays within R-253's bound.

---

## Phase 4: Before/after tree check (US-008)

### Task 10: Snapshot when a review agent starts
**Tests (RED):** `watcher/test/gate-run/snapshot.integration.test.ts` (real temp git repo)
- should record a tree id for a PreToolUse `Agent`/`Task` call whose `subagent_type` is a gate agent, keyed by `tool_use_id`
- should record nothing for builder agents
- should include untracked, non-ignored files and leave the real index untouched
- should not follow a symlinked git dir (same guard as ship's `oss-gate` snapshot)

**GREEN:** `watcher/src/gate-run/snapshot.ts` (temporary index, `git add -A`, `write-tree`), state under the git dir.

### Task 11: Compare when it ends
**Tests (RED):** `watcher/test/gate-run/compare.integration.test.ts`
- should list the changed paths when the tree differs (AC-008.1)
- should be silent when the tree is the same (AC-008.2)
- should void every overlapping review run when two ran at once and the tree changed (record which)
- should tell the main agent: the review's report is void, which files changed, and to stop the ship and ask the user
- should follow the gate's crash policy on error: allow, log, tell (AC-008.4)

**GREEN:** `watcher/src/gate-run/compare.ts`; output through PostToolUse `additionalContext`; a timeline event.

### Task 12: Wire the hooks
**Tests (RED):** `hooks/__tests__/oss-gate-run.test.sh`
- PreToolUse and PostToolUse on `Agent|Task` call the new CLI with `pre`/`post`
- the CLI with `CLAUDE_PROJECT_DIR` unset still finds the repo
- a dist guard: `watcher/dist/cli/gate-run.cjs` is built from source

**GREEN:** `watcher/src/cli/gate-run.ts`, bundle `watcher/dist/cli/gate-run.cjs`, `hooks/oss-gate-run.sh`, `hooks.json` entries (timeout 10; snapshot cost noted in NOTES.md).

---

## Phase 5: Offload

### Task 13: Gate offload without edit tools
**Tests (RED):** `watcher/test/cli/agent-offload.test.ts`
- should pass `--disallowedTools` with Edit, Write, MultiEdit and NotebookEdit for a gate agent (AC-005.1)
- should leave builder agents' arguments unchanged

**GREEN:** `watcher/src/cli/agent-offload.ts` reads `gateAgents`. Bash stays available to the offloaded model; the tree check (Phase 4) covers its writes, since the offload runs inside the review agent's run. If P4 failed: gate agents skip offload instead (AC-005.2), with the matching test.

---

## Phase 6: API Sprint D branch (separate PR)

### Task 14: Split the security delegation row
**Tests (RED):** `packages/api/test/prompts.test.ts`
- iron-laws.md, commands/build.md and build.ts route "Security review" to security-auditor and "Security fixes" to the stack's builder agent (AC-007.1)

**GREEN:** the three files.

### Task 15: Drop `tools:` lines from served agent headers (FOLLOWUPS #168)
**Tests (RED):** new API prompt test
- no file in `packages/api/src/prompts/agents/` has a `tools:` header line

**GREEN:** remove the lines (18 files today; they name things that aren't tools, like `npm` or `vite`, and contradict the enforced local lists). The local agent file is the only tool list.

---

## Phase 7: Records and integration

### Task 16: Integration and dev docs
- Hermetic live row (`agents/__tests__/agent-tools.live.sh`, run by hand and recorded, needs Claude Code): a gate agent's Edit is refused, a builder's Edit applies (AC-003.2, AC-003.3).
- Every mock checked against reality: hook input fields (P1), `Agent` tool input `subagent_type`/`tool_use_id`, offload arguments.
- Targeted suites green; `tsc` clean; no `.skip`/`.only`/`.todo`; TESTING.md and PROGRESS.md updated.
- Plugin `CLAUDE.md`: its IRON LAWS block is refreshed from the live API, so it isn't hand-edited here; it follows Task 14 once the sprint merges (recorded in NOTES.md).

### Task 17: oss-lab ROADMAP (separate PR on oss-lab's Sprint D branch)
- R-266: probe results, the Write narrowing (ADR-002), the tree check (ADR-007).
- R-267: the candidate run serves the API Sprint D prompts; count refused security-fix delegations and voided review runs.

## Phase 8: Ship round 22, final regression fixes (user pick 2026-11-17 "Stop: ship + sandbox card", ADR-066)

**Scope:** fix only ordinary commands that round 21 newly refuses (the regressions), plus D-R22-2.
- **Out of scope:** every other main/builder finding from round 21 goes to the OS write-sandbox card (FOLLOWUPS).
- **No more gate rounds after this.** A final verify, then ship.

**Shared rules for every task in this phase:**
- strict TDD with RED evidence;
- targeted vitest only, never the full watcher suite;
- both tsc configs clean; served-commands.acceptance green (only the 5 R-272 blocks refused);
- a BEFORE/AFTER gate-decision table (tree f37331b vs head; main agent and builder; darwin and linux) over the ORDINARY SAMPLE in /private/tmp/claude-501/-Users-ysl-dev/223b2e2d-1a83-4cc9-9f06-b5c0dbafc9eb/scratchpad/r22-brief.md;
- any refused → allowed change other than the listed GREEN rows: STOP and report.

### Task 18: mktemp with a `${TMPDIR:-/tmp}` template (CR LOW-1 round 21)
- **RED:** these were allowed at tree 80f6cd1 and are refused now, for main and builder:
  - `tmp=$(mktemp "${TMPDIR:-/tmp}/x.XXXXXX")`
  - `tmp=$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX") && cd "$tmp"`
  - `tmp=$(mktemp "${TMPDIR:-/tmp}/x.XXXXXX"); echo hi > "$tmp"`
- **GREEN:** `mktempWrites` (watcher/src/tool-gate/command-reader.ts ~1132) treats a template already judged as temp (the `MKTEMP_IN_TMPDIR` shape, with no `..` after the temp head) as a temp write. Build note (2026-11-17): inside `$(…)` the template reaches `mktempWrites` as one unknown placeholder, so the raw template text is passed from `operandWrites` (~3747) as well.
- **Keep refused:** `mktemp -p .oss x`, `mktemp -t ../../.claude/plugins/p` in a trap, `mktemp .git/hooks/pre-commit`.
- Tests: watcher/test/tool-gate/round22-regressions.test.ts.

### Task 19: assignments with quoted or expanded values before `arr=(` (CR LOW-2 round 21)
- **RED:** these were allowed at tree 80f6cd1 and are refused now, for main and builder: `A="x y" arr=(a b)`, `A=$HOME arr=(a)`, `A=$(pwd) arr=(a)`.
- **GREEN:** `writtenPlainly` (watcher/src/tool-gate/tokenize.ts ~606): for an earlier assignment word, only the `name=` part must be written plainly.
- **Keep refused:** `\typeset x=(a|b)…`, `'A=1' x=(…)`, `A\=1 x=(…)`, `{A=1,B=2} x=(…)` and `{A=1} x=(…)`, as in round21a.
- Tests: the same file.

### Task 20: D-R22-2 "Folders only, single files free" (user pick 2026-11-17; CR LOW-3 round 21)
- **RED:** `rm -f .git/modules/sub/index.lock` is refused now and must be allowed, for main and builder.
- **GREEN:** the D-R21-1 folder heads (`holdsProtected`, watcher/src/tool-gate/rules/protected-path.ts ~174) apply only to writes that can affect a whole folder:
  - recursive deletes (`rm -r/-R`, `find … -delete`, `-exec rm -r`);
  - moving or renaming the folder;
  - `rsync --delete` into it;
  - `ln -sfn` onto it;
  - `git clean -d`.
  A single-file write is judged only against the protected file patterns.
- **Keep refused:**
  - `rm -rf .git/hooks`, `rm -rf .git/modules/sub`, `rm -rf .git/worktrees/foo`;
  - `find .git/hooks -delete`, `mv .git/hooks x`;
  - `rm -f .git/hooks/pre-commit`, which is a protected file itself.
- **Keep allowed:** `rm -f .git/index.lock`, `rm -rf .git/rebase-merge`, `mkdir -p .git/hooks`, `ls .git/hooks`.
- If needed, update the reference copy in protected-path-equivalence.test.ts the same way.
- Tests: the same file.

### Task 21: mktemp temp-folder template with `/` (CR MEDIUM-1 / SEC LOW-1 round 21; user pick 2026-11-17 "Add it to round 22")
- **RED:** these must be refused, for main and builder, darwin and linux:
  - `F=$(mktemp -u --tmpdir ../../../../../../../../<abs-repo>/.oss/tool-gates.json); echo x > "$F"`
  - the same with `-p "$TMPDIR"` instead of `--tmpdir`
  - `mktemp -d --tmpdir ../../…/.claude/plugins/p.XXX`
  - `trap 'cp -R src/. "$F"' EXIT; F=$(mktemp -d --tmpdir ../../x/.oss/p.XXX)`, which was refused at tree 80f6cd1 (the regression)
  - `mktemp --tmpdir "../../../../../../../../../../../../..$PWD/.git/hooks/pre-commit"`
- **GREEN:** `mktempPattern` / `mktempWrites` (command-reader.ts ~1112/~1132): when the folder is the temp folder (`--tmpdir` with no value, `-p "$TMPDIR"`, `-t`) and the template holds `/`, the value and mktemp's own write are unknown, and the call is refused.
- **Keep allowed:**
  - `mktemp --tmpdir x.XXXX`, `mktemp -p "$TMPDIR" x.XXXX`, `mktemp -d --tmpdir x.XXXX`;
  - `mktemp -d`, `mktemp`, `mktemp -t x`;
  - Task 18's `${TMPDIR:-/tmp}/x.XXXXXX` rows.
- Tests: the same file.

---

## Testing Strategy
- **Unit:** rule file, hook input, gate-agent-write rule, offload arguments.
- **Integration (real git, real symlinks):** gate-agent-write paths, snapshot/compare.
- **Acceptance:** agent-tools contract, tool-gate CLI, gate-run CLI.
- **Live (by hand, recorded):** headless gate vs builder Edit.

## Edge Cases
- Review agent's tests write coverage inside the repo: ignored files aren't in the snapshot; tracked or unignored outputs void the run (record which gate runs hit it and ask before widening).
- Two review agents run in parallel: a change voids both.
- A review agent edits a gitignored file: not caught by the tree check (accepted limit, recorded in NOTES.md and the card).
- Hook input from an older Claude Code without the P1 field: the rule treats calls as the main agent; the tree check still works.

## Security Checklist
- [ ] No value written by the model reaches a shell command (paths go through files or argv, never interpolated)
- [ ] Snapshot state lives in the git dir, refuses symlinks, never follows a symlinked `oss-gate`-style dir
- [ ] Rule failure follows R-253's crash policy (allow + log + tell), never a silent allow
- [ ] Repo rule files can only add gate agents

## Performance Considerations
- [ ] Gate rule within R-253's speed bound (Task 9)
- [ ] Snapshot cost on a large repo measured and recorded; hook timeout 10 s

## Rollout Strategy
- Sprint branch only; reaches customers when the whole sprint passes R-267 and the user gives the go.
- Rollback: revert the R-266 PR on the sprint branch.

## Estimated Tasks: 21 (17 planned + 4 ship round-22 tasks)
## Estimated Test Cases: ~55

## Last Updated: 2026-11-17 23:15 CST by /oss:ship (Phase 8: round-22 regression fixes via /oss:build)


### Task 22: Revert Task 20 (ADR-067 outcome, 2026-11-18)

The one-shot security review of `deletesSingleFile` FAILED (HIGH): the skip also applied to an `rm` part's redirect targets, so `touch "echo PWNED"; rm -v "echo PWNED" >> .git/modules/sub/hooks/pre-commit` and `rm -f x > .git/modules/sub/HEAD` were allowed. It also allowed `rm -f .git/modules/sub/hooks/pre-commit`, `.../HEAD` and `.../refs/heads/main`. Per ADR-067, Task 20 is reverted, not fixed.

- RED: in round22-regressions.test.ts, turn the Task 20 block into keep-refused rows. Add the reviewer's three redirect commands and the three submodule-file deletes. Move `rm -f .git/modules/sub/index.lock` and `rm .git/modules/sub/index.lock` to refused (accepted over-refusal, sandbox card). `rm -f .git/worktrees/foo/index.lock` keeps today's verdict. Keep all the other Task 20 rows as they are.
- GREEN: remove `deletesSingleFile`, `rmMayRemoveFolders` and `isPlainFile`, and their two call sites (protected-path.ts, protected-path-mention.ts), restoring the round-21 behaviour. No other change.
- Verify: before/after against f37331b shows no refused→allowed change outside Tasks 18/19, and the Task 20 rows are back to their round-21 verdicts.


### Task 23: Revert Task 18 (ADR-068 outcome, 2026-11-18)

The one-shot review of Tasks 18 and 19 FAILED Task 18 (HIGH): the `${TMPDIR:-…}` fallback is attacker text and `tmpdirSet` misses spelled-around TMPDIR changes, so `export TMP\DIR=; f=$(mktemp "${TMPDIR:-.git/hooks}/pre-commit"); echo PWNED > "$f"; chmod +x "$f"` and `mktemp "${TMPDIR-.git/hooks}/pre-push"` were allowed. Task 19 PASSED and stays.

- RED: in round22-regressions.test.ts, add the reviewer's commands as keep-refused rows (all forms: `TMP\DIR`, `unset ${X}DIR`, `-d`, `command`/`env`/`xargs`, `${TMPDIR-…}`), and flip Task 18's allowed rows to refused (accepted over-refusal, sandbox card).
- GREEN: remove `markTempHeads`, `MKTEMP_IN_TMPDIR`, the `tempHead`/`tempArgs`/`wordTokens` plumbing, `inTempFolder`/`writtenInTemp` where only Task 18 needs them, restoring round-21 mktemp behaviour, EXCEPT Task 21's refusal (temp-folder templates holding `/` → UNKNOWN), which stays.
- Verify: Task 21 and Task 19 rows unchanged; before/after vs f37331b shows no refused→allowed except Task 19.


### Task 24: Refuse writes through array variables (ADR-069, 2026-11-18)

- RED: keep-refused rows (main and builder, darwin and linux): `arr=(.git/hooks/pre-commit); echo hi > $arr`, `arr=(~/.claude/settings.json); cp /dev/null $arr`, `arr=(.git/hooks/pre-commit); echo hi > ${arr}`, `… > $arr[1]`, `… > ${arr[@]}`, `typeset -a arr=(.git/hooks/pre-commit); echo hi > $arr`, `arr+=(.git/hooks/pre-commit); echo hi > $arr`, and `cp x $arr` / `tee $arr` / `mv x $arr` forms. Keep-allowed: `arr=(a b); echo $arr`, `arr=(a b); for f in $arr; do cat $f; done`, `arr=(a b); ls $arr`.
- GREEN: minimal — where the reader records an array assignment, mark the name; a write target that expands a marked array name becomes UNKNOWN (refused like `${arr[1]}`).
- Before/after vs HEAD over the ORDINARY SAMPLE (r22-brief.md): only the new array-write rows go allowed→refused; any other allowed→refused STOPS for a user decision.

- Added to Task 24 (user pick "Add it to Task 24", 2026-11-18): writes through colon-less defaults. RED keep-refused: `echo hi > "${FOO-.git/hooks}/pre-commit"`, `cp x "${FOO-.git/hooks}/pre-commit"`, `echo hi > ${FOO-.git/hooks/pre-commit}`, `touch "${FOO=.git/hooks}/pre-commit"`, `touch "${FOO?x}.git/hooks/pre-commit"`, `mktemp "${TMPDIR-.git/hooks}/pre-push"`. GREEN: a write target holding `${NAME-…}`, `${NAME=…}` or `${NAME?…}` is UNKNOWN, as `${NAME:-…}` already is.
- Added to Task 24 (user pick "Close it in Task 24", 2026-11-18): `${NAME+…}` too. RED keep-refused: `FOO=1; echo hi > "${FOO+.git/hooks}/pre-commit"`, `echo hi > ${FOO+.git/hooks/pre-commit}`, `FOO=1; cp x "${FOO+.git/hooks}/pre-commit"`. Keep-allowed: `echo "${FOO+set}"`. GREEN: same UNKNOWN path as `${NAME:+…}`.
