# Implementation Plan: tool-gates (R-253, Sprint D #1)

## Summary
A bundled Node CLI, `tool-gate`, called from plugin hooks on `PreToolUse` (Bash, Edit, Write, MultiEdit, NotebookEdit) and on `PostToolUse` / `PostToolUseFailure` (Bash). It refuses calls that break the IRON LAWS (exit 2 + one-line reason) and records test runs as red, green or unknown, which drives a per-cycle RED rule during `/oss:build`.

## Design Reference
- `.oss/dev/active/tool-gates/DESIGN.md` (COMMITTED 2026-11-09, as of cf8ba37, plus the 2026-11-09 plan amendment below)
- `docs/requirements/tool-gates.md` (US-001 … US-011)
- `.oss/dev/active/tool-gates/DECISIONS.md` (ADR-001 … ADR-008)

## Branch & delivery (Sprint D rule)
- Every PR targets `feat/determinism-sprint/build`, **never `main`** (`gh pr create --base feat/determinism-sprint/build`). The sprint branch reaches `main` only after R-267 and the user's go.
- Plan docs: `feat/tool-gates/plan`, branched from `origin/feat/tool-gates/ideate` (based on the sprint branch, and it carries the ideate docs).
- Build: `feat/tool-gates/build` (or `feat/tool-gates/build-t{N}-t{M}` ranges), branched from the sprint branch once plan is merged there.
- No plugin version bump or release in R-253: nothing reaches customers before R-267.

## Plan-level decisions (made in /oss:plan, 2026-11-09)
1. **Own shell tokenizer** (user pick; ADR-007). `watcher/` keeps zero runtime dependencies.
2. **`.oss/tool-gates/**` is a base protected path** (user pick; DESIGN.md amended). Without it an agent could write `cycle.json` to fake a red run, or rewrite `events.ndjson`, which R-267 counts.
3. **"This build" = the build's start stamp** (ADR-008). `update-workflow-state` writes `currentCommandStartedAt` when `currentCommand` changes. `cycle.json` stores the stamp it was made under, and a stamp that doesn't match counts as "no run yet". Session ids aren't used because subagents' hook payloads may not share the parent's id.
4. **"Contains test/spec/check"** (runner adoption) means one of the command's words, split on non-alphanumerics, is `test`, `tests`, `spec`, `specs`, `check` or `checks` (case-insensitive), or a word matches `testFilePatterns`. So `./run-tests.sh` counts and `git checkout` / `npm run typecheck` don't.
5. **Hook output contract:**
   - Allow: exit 0 with **no stdout**. Never `permissionDecision: "allow"`, which would skip the user's permission prompt.
   - Refuse: exit 2 with the reason on stderr.
   - Allow-and-tell (gate error, rejected rule file): exit 0 with a stdout JSON `hookSpecificOutput.additionalContext` line and no `permissionDecision`.
   - Task 17 checks the field name against the Claude Code hooks reference (via `claude-code-guide`) before GREEN.
6. **Rule file locations:**
   - Plugin base: `config/tool-gates.json` at the plugin root.
   - Repo: `.oss/tool-gates.json`.
   - State: `.oss/tool-gates/cycle.json` and `.oss/tool-gates/events.ndjson`, at the git top-level of the hook's `cwd` (or `cwd` when outside a repo).

## Module layout
```
watcher/src/tool-gate/
  tokenize.ts        # shell tokenizer (pure)
  command-reader.ts  # parts, cwd tracking, git/redirect/rm-mv-cp/host/test-run facts (pure)
  patterns.ts        # path glob + command-pattern matchers (pure)
  rule-file.ts       # load + add-only merge (fs reader injected)
  rules/*.ts         # one module per rule, pure over (call facts, settings, collaborators)
  state-store.ts     # cycle.json (atomic) + events.ndjson (append)    ← collaborator
  git-reader.ts      # current branch of a dir                         ← collaborator
  workflow-state.ts  # currentCommand + currentCommandStartedAt reader  ← collaborator
  gate.ts            # runToolGate({mode, input, env}, deps) → {exitCode, stdout, stderr}
watcher/src/cli/tool-gate.ts   # stdin → runToolGate → exit; 2 s timer; top-level catch
config/tool-gates.json         # base settings (the only place rule values live)
hooks/oss-tool-gate.sh         # wrapper: resolve .cjs, map any exit ∉ {0,2} to allow+tell+log
```
Collaborators (git, fs state, workflow state) are mocked at their interface in unit tests. Tokenizer, reader, matchers and rules are pure and tested for real. Integration tests use a throwaway git repo and temp dirs: hermetic, no network, no real Claude session.

---

## TDD Implementation Tasks

### Phase 1 — Outside-in boundary

### Task 1: Acceptance tests at the gate boundary
**Objective:** Pin the user-visible contract before any internals exist (US-001 … US-011, one scenario each).

**Tests to Write (RED):** `watcher/test/cli/tool-gate.acceptance.test.ts`. Each test feeds hook JSON to `runToolGate` in a throwaway git repo with a temp HOME.
- [ ] `should refuse git push with exit 2 and name the branch when on main` (AC-001.1)
- [ ] `should allow git push when on a feature branch` (AC-001.2), with no stdout (contract 5)
- [ ] `should refuse git push --force on any branch` (AC-002.1)
- [ ] `should refuse writing .only( into a test file` (AC-003.1)
- [ ] `should refuse a source edit during build when no test run is recorded` (AC-004.1)
- [ ] `should record red then allow the source edit` (AC-004.2, AC-005.2)
- [ ] `should refuse Write to .oss/tool-gates.json and to .oss/tool-gates/cycle.json` (AC-006.1, decision 2)
- [ ] `should refuse curl to a listed production host` (AC-007.1)
- [ ] `should refuse git tag when the repo sets tagsAllowed false` (AC-008.1)
- [ ] `should ignore and report a repo file that removes main from protectedBranches` (AC-009.3)
- [ ] `should allow and say "tool-gate failed, rules not checked." when a collaborator throws` (AC-010.1)
- [ ] `should write one events.ndjson line per refusal, with no written content` (AC-011.1/2)

**Implementation (GREEN):** none here. These stay red until Task 17. Only a `runToolGate` stub that throws "not implemented" so the file compiles.

**Acceptance Criteria:** file compiles; every test fails for the stated reason.

### Phase 2 — Foundation (pure)

### Task 2: Shell tokenizer
**Objective:** Read shell text the way the shell would, for the parts the rules need.

**Tests (RED):** `watcher/test/tool-gate/tokenize.test.ts`
- [ ] `should keep "stop push to main" as one word inside double quotes`
- [ ] `should keep single-quoted text literal, including $ and \`
- [ ] `should honour backslash escapes outside quotes`
- [ ] `should emit && || ; | and newline as operators`
- [ ] `should emit > >> 2> &> < as redirect operators with their target word`
- [ ] `should skip a heredoc body but keep the redirect after <<EOF` (`cat <<EOF > f`)
- [ ] `should mark the command unreadable when it contains $( or backticks or eval or bash/sh -c with a substitution`
- [ ] `should mark an unterminated quote unreadable`

**Implementation (GREEN):** `tokenize(cmd: string): { tokens: Token[] } | { unreadable: true }`, where `Token = {kind:'word', value} | {kind:'op', value}`.

**Refactor:** keep one state-machine loop; no regex soup.

### Task 3: Command reader
**Objective:** Turn tokens into per-part facts the rules check.

**Tests (RED):** `watcher/test/tool-gate/command-reader.test.ts`
- [ ] `should split a compound command into parts on && || ; | newline`
- [ ] `should apply cd <dir> to later parts in the same command` (AC-001.3)
- [ ] `should read git -C <dir> as that part's directory`
- [ ] `should find the git subcommand after global options (-C, -c k=v, --no-pager)`
- [ ] `should strip leading VAR=value assignments before the program name`
- [ ] `should list redirect targets and rm/mv/cp operands` (cp: destination only; mv: source and destination)
- [ ] `should list hosts from URLs and user@host / bare host arguments`
- [ ] `should flag a part as piped when its output goes into |`
- [ ] `should flag a part followed by || true or || :` (AC-005.3)

**Implementation (GREEN):** `readCommand(cmd, cwd): CommandFacts | {unreadable:true}`.

### Task 2b: ANSI-C quoting in the tokenizer (added in build, ADR-009)
- [ ] `$'HEAD:main'` → `HEAD:main`; escapes decoded (`\xHH`, octal, `\u`, `\c`); unterminated → unreadable; literal inside double quotes; `$"…"` = double-quoted.

### Task 3b: Nested shells and wrappers (added in build, ADR-009)
**Tests (RED):** `watcher/test/tool-gate/command-reader.test.ts` (new describe)
- [ ] `should read bash -c 'git push --force' as a git push part` (also `sh -c`, `zsh -c`, `bash -lc`, `/bin/bash -c`), recursively (`bash -c "sh -c 'git push'"`)
- [ ] `should stay unreadable when the -c script contains $( or backticks`
- [ ] `should find git behind env, sudo, command, nice, nohup, time, xargs (with their options and env VAR=value)`
- [ ] `should keep the outer cwd for a nested script`, and apply `cd` inside the script only within it
- The tokenizer's command-position `eval` / `-c` unreadable flag moves to the reader: the tokenizer returns tokens, and the reader decides.

### Task 3c: Keywords, special parameters, option clusters, cd variants (added in build, user pick)
- [ ] Shell keywords in command position (`if`/`then`/`while`/`do`/`for`/`case`/`{ }`/`!`/`time`/functions) are looked through.
- [ ] `$@`, `$1` and the other special parameters make a `-c` script dynamic (unreadable).
- [ ] Value-taking options inside a cluster are read (`sudo -Eu root`, `bash -eo pipefail -c`).
- [ ] `command cd`, `builtin cd`, `time cd`, `pushd` and `popd` change the directory like `cd`.

### Task 4: Pattern matchers
**Objective:** One matcher for path globs and one for command patterns. Both read their patterns from settings only.

**Tests (RED):** `watcher/test/tool-gate/patterns.test.ts`
- [ ] `should match **/*.test.* against src/a/foo.test.ts and not foo.ts`
- [ ] `should match **/__tests__/** at any depth`
- [ ] `should match ~/.oss/hooks/** after ~ expansion against an absolute path`
- [ ] `should match command pattern "npm run test*" against "npm run test:unit"` (AC-005.6)
- [ ] `should match "bash *test*.sh" against "bash ./run-tests.sh"`
- [ ] `should not match "jest" against "jester"` (whole-word per pattern word)

**Implementation (GREEN):** `matchPath(glob, absPath, {home, root})` and `matchCommand(pattern, words)`.

### Task 5: Rule file loader with add-only merge
**Objective:** Base settings from the plugin, plus a repo file that can only add or tighten (US-009, ADR-003).

**Tests (RED):** `watcher/test/tool-gate/rule-file.test.ts`. The fs reader is mocked; the merge is real.
- [ ] `should use the base file when there is no repo file`
- [ ] `should add a repo protectedPath, productionHost and pattern` (AC-009.1)
- [ ] `should apply tagsAllowed false from the repo file` (AC-009.2)
- [ ] `should reject the whole repo file when it omits a base value from a list it sets`, and report it (AC-009.3). Rule: a repo list must include every base value, or omit the key.
- [ ] `should reject tagsAllowed true over a base false`
- [ ] `should reject malformed JSON, a wrong version, unknown keys and non-string list entries` (AC-009.4)
- [ ] `should report rejection as a rule-file-rejected result with a one-line reason`

**Provenance test:** `watcher/test/tool-gate/provenance.test.ts`
- [ ] `should find none of the base file's list values as literals in watcher/src/tool-gate/**` (no list duplicated in code)

**Implementation (GREEN):**
- `config/tool-gates.json`: the design's values, plus `.oss/tool-gates/**` in `protectedPaths`.
- `loadSettings(readFile, pluginRoot, repoRoot): {settings, rejected?: string}`.

### Phase 3 — Pre-call rules

### Task 6: Git reader and protected-branch rule (US-001)
**Tests (RED):**
- `watcher/test/tool-gate/rules/protected-branch.test.ts`, with `GitReader` mocked:
  - [ ] `should refuse git commit / git push when the part's dir is on main` (AC-001.1, AC-001.6)
  - [ ] `should allow on a feature branch` (AC-001.2)
  - [ ] `should refuse a push refspec whose destination is main` (`origin HEAD:main`, `origin x:refs/heads/main`, `origin :main`) (AC-001.4)
  - [ ] `should allow git commit -m "stop push to main" on a feature branch` (AC-001.5)
  - [ ] `should allow commit on a detached HEAD and still check push refspecs`
  - [ ] `should not apply outside a git repo`
- `watcher/test/tool-gate/git-reader.integration.test.ts`, with a real temp repo:
  - [ ] `should return the branch, detached, or not-a-repo for a directory`

**Implementation (GREEN):**
- `GitReader.currentBranch(dir)` uses `execFileSync('git', ['-C', dir, 'symbolic-ref', '--short', '-q', 'HEAD'])`, never a shell.
- `rules/protected-branch.ts`.

### Task 7: Force-push rule (US-002)
**Tests (RED):** `rules/force-push.test.ts`
- [ ] `should refuse --force, -f, --force-with-lease, combined short flags like -fu, and a +refspec`
- [ ] `should allow a plain push on a feature branch` (AC-002.2)

### Task 7b: Abbreviated push options (added in build)
- [ ] `readPushWords` expands unambiguous prefixes of git push long options (`--forc` → `--force`, `--mir` → `--mirror`, `--del` → `--delete`, `--tag` → `--tags`). An ambiguous prefix is left as written.

### Task 8: Tags rule (US-008)
**Tests (RED):** `rules/tags.test.ts`
- [ ] `should refuse git tag v1 and git push --tags when tagsAllowed is false` (AC-008.1)
- [ ] `should allow both by default` (AC-008.2)
- [ ] `should allow git tag -l (listing) when tagsAllowed is false`

### Task 9: Production-host rule (US-007)
**Tests (RED):** `rules/production-host.test.ts`
- [ ] `should refuse curl https://api.example.com/x when listed` (AC-007.1)
- [ ] `should allow an unlisted host and a host that only shares a suffix (notapi.example.com)` (AC-007.2)
- [ ] `should refuse nothing with the default empty list` (AC-007.3)

### Task 10: Skip/only/todo rule (US-003)
**Tests (RED):** `rules/focused-tests.test.ts`
- [ ] `should refuse Edit adding .only( to foo.test.ts` (AC-003.1); same for Write, MultiEdit and NotebookEdit
- [ ] `should allow the same text in foo.ts` (AC-003.2)
- [ ] `should allow an edit that keeps an existing .skip( without adding one` (AC-003.3). It compares counts in old vs new text; for Write, the file on disk vs new content, read through the injected fs.
- [ ] `should name the file and the marker in the reason, never echo the content`

### Task 11: Protected-path rule (US-006)
**Tests (RED):** `rules/protected-path.test.ts`
- [ ] `should refuse Edit/Write/MultiEdit/NotebookEdit on .oss/tool-gates.json, .oss/tool-gates/cycle.json, ~/.oss/hooks/x.sh, .claude/settings.local.json` (AC-006.1)
- [ ] `should resolve .., relative paths, ~ and a symlinked parent before matching`
- [ ] `should refuse echo x > .oss/tool-gates.json, rm ~/.oss/hooks/x.sh, mv/cp onto a protected path, and a heredoc redirect` (AC-006.2)
- [ ] `should allow cat .oss/tool-gates.json and cp from a protected path to elsewhere` (AC-006.3)

### Task 11b: Raw paths through symlinks, and common Bash writers (added in build, user pick)
- [x] Edit and Bash paths keep their raw form. `..` is resolved through the filesystem, not as text, so `link/../tool-gates.json` is caught when `link` → `.oss/tool-gates`.
- [x] `writeTargets` also lists: `tee` (and `-a`), `sed -i` / `perl -i`, `dd of=`, `truncate`, `touch`, `ln` (link name), `install` (destination), `chmod` / `chown`, and `git checkout -- <file>` / `git restore <file>`.
- [x] Interpreter writes (`python -c`, `node -e`) stay a known limit.

### Phase 4 — Test-run record and RED rule

### Task 12: Build start stamp in workflow state (ADR-008)
**Tests (RED):** `watcher/test/cli/update-workflow-state-command-started.test.ts` (new file; existing tests untouched)
- [x] `should set currentCommandStartedAt when currentCommand changes`
- [x] `should keep currentCommandStartedAt when currentCommand is set to the same value`

**Implementation (GREEN):** `watcher/src/cli/update-workflow-state.ts`, adding the field only alongside `currentCommand`.

### Task 13: State store and events (US-011)
**Tests (RED):** `watcher/test/tool-gate/state-store.integration.test.ts` (temp dir)
- [x] `should write cycle.json atomically (temp + rename) and read it back`
- [x] `should treat a missing or corrupt cycle.json as no run yet`
- [x] `should append one JSON line per event with ts, tool, kind, rule|command, result` (AC-011.1)
- [x] `should create .oss/tool-gates/ when missing, and refuse to write through a symlinked .oss or .oss/tool-gates`

### Task 14: Post-call recorder (US-005)
**Tests (RED):** `watcher/test/tool-gate/recorder.test.ts`, with `StateStore` mocked:
- [x] `should record green for a listed test command on PostToolUse` (AC-005.1)
- [x] `should record red on PostToolUseFailure with "Exit code N"` (AC-005.2), starting a new cycle (AC-004.7)
- [x] `should record unknown for piped, || true, || : and is_interrupt runs, and leave the cycle unchanged` (AC-005.3)
- [x] `should record nothing for a non-test command` (AC-005.4)
- [x] `should recognize pnpm test, npm run test:unit, make test, swift test, ./gradlew test, dotnet test` (AC-005.6)
- [x] `should stamp the cycle with the current build's currentCommandStartedAt`

AC-005.5 (runs no tests) is held by design: the recorder has no process-spawning collaborator. A test asserts that `runToolGate` deps expose none.

### Task 15: RED rule (US-004)
**Tests (RED):** `watcher/test/tool-gate/rules/red-cycle.test.ts`, with `WorkflowState` and `StateStore` mocked:
- [x] `should refuse a source edit in build with no recorded run, with the "No failing test recorded…" text` (AC-004.1, AC-004.8)
- [x] `should allow any source edit after red and add the file to the cycle` (AC-004.2)
- [x] `should allow a cycle file and refuse a new file after green` (AC-004.3, AC-004.4)
- [x] `should never cover test files, .md, .json, .yml/.yaml or .oss/dev/**` (AC-004.5)
- [x] `should not apply when currentCommand is not build or workflow-state.json is missing` (AC-004.6)
- [x] `should treat a cycle stamped with another build's start as no run yet` (ADR-008)
Not covered: Bash writes onto source files. The design applies the RED rule to Edit/Write/MultiEdit/NotebookEdit only (see NOTES.md).

### Task 16: Runner adoption (US-004 amendment, ADR-002)
**Tests (RED):** `watcher/test/tool-gate/runner-adoption.test.ts`, with `StateStore` mocked:
- [x] `should adopt ./run-tests.sh that exits non-zero during build, log runner-adopted once and count red` (AC-004.9)
- [x] `should count later runs of the adopted command red or green`
- [x] `should adopt a command that names a test file (node foo.test.js)`
- [x] `should not adopt plain make, git checkout, or npm run typecheck` (AC-004.11, decision 4)
- [x] `should not adopt outside build or from a piped / || true run`
- [x] `should keep source edits refused for an agent that runs no test-like command, after 20 attempts` (AC-004.10)

### Phase 5 — Boundary, failure, wiring

### Task 17: `runToolGate` + CLI entry + failure handling (US-010)
**Tests (RED):** Task 1's acceptance file goes green, plus `watcher/test/tool-gate/failure.test.ts`:
- [ ] `should allow, log gate-error and print the tell line when a collaborator throws` (AC-010.1)
- [ ] `should allow, log gate-error and tell when the decision takes over 2 s` (AC-010.2), using a mocked GitReader that never resolves (fake timers, no real 2 s wait)
- [ ] `should allow and log unreadable for eval / $( … ) commands`
- [ ] `should print rule-file-rejected's one line once per call and still apply base rules`
- [ ] `should emit no stdout on allow and never a permissionDecision` (contract 5)

**Implementation (GREEN):**
- `watcher/src/tool-gate/gate.ts` and `watcher/src/cli/tool-gate.ts`: read stdin, pick `pre`/`post` from argv, run under a 2 s timer and a top-level catch.
- First confirm the allow-and-tell JSON field with `claude-code-guide` and record it in NOTES.md.

### Task 18: Bundle, dist guard, speed
**Tests (RED):**
- `watcher/test/hooks/tool-gate-dist.test.ts`, mirroring `chain-trigger-dist.test.ts`:
  - [ ] `should match the committed dist/cli/tool-gate.cjs to a fresh bundle`
- `watcher/test/cli/tool-gate.speed.test.ts`:
  - [ ] `should decide a Bash call in under 100 ms in-process (max of 20 calls)`. This is the design's target for the gate's own work.
  - [ ] `should answer end-to-end through node tool-gate.cjs with a median under 300 ms over 10 spawns`. The generous threshold covers Node start-up, per the flakiness law. The measured median goes in TESTING.md.

**Implementation (GREEN):**
- `watcher/scripts/tool-gate-bundle-options.mjs`.
- `bundle-cli.js` builds the `.cjs`.
- Commit `watcher/dist/cli/tool-gate.cjs`.

### Task 19: Hook wrapper and hooks.json
**Tests (RED):**
- `watcher/test/hooks/oss-tool-gate.test.ts`, which runs the real `hooks/oss-tool-gate.sh` with `CLAUDE_PLUGIN_ROOT` pointed at a temp plugin root:
  - [ ] `should pass stdin through and return the CLI's exit 0 / exit 2 + stderr`
  - [ ] `should allow, log gate-error and tell when the CLI exits 1, is missing, or node is missing from PATH` (AC-010.1)
  - [ ] `should run with CLAUDE_PROJECT_DIR unset` (hermetic hooks rule)
- `watcher/test/hooks/hooks-json-tool-gate.test.ts`:
  - [ ] `should register PreToolUse Bash|Edit|Write|MultiEdit|NotebookEdit → oss-tool-gate.sh pre, and PostToolUse / PostToolUseFailure Bash → post, with a timeout`
  - [ ] `should keep every existing hooks.json entry unchanged`

**Implementation (GREEN):**
- `hooks/oss-tool-gate.sh`: resolve the CLI the way `resolve_cli` does, `exec`-free so it can map exit codes, with a fixed-string gate-error line.
- The `hooks.json` entries.

### Task 20: Full-suite run and dev-docs close-out
- [ ] Whole `watcher` suite green (including all of `test/hooks`, `CLAUDE_PROJECT_DIR` unset), with no `.skip`/`.only`/`.todo`.
- [ ] TESTING.md has results and the measured speed. PROGRESS.md updated.
- [ ] The DESIGN.md success criteria are each ticked, with the test name that proves them.

---

## Implementation Sequence
1. **Boundary:** T1. Its acceptance tests stay red until T17.
2. **Foundation** (pure, parallel-safe): T2 → T2b → T3 → T3b → T3c, and T4. T5 depends on T4.
3. **Pre-call rules** (depend on T3–T5): T6, T7, T8, T9, T10, T11. These are independent of each other.
4. **Record + RED** (depend on T3–T5): T12, then T13 → T14 → T15 → T16.
5. **Boundary + wiring** (depends on everything): T17 → T18 → T19 → T20.

Agents for `/oss:build`: `typescript-pro` (T2–T18), `test-engineer` (acceptance and integration review), `security-auditor` + `penetration-tester` on T11, T5, T13 and T19 (tamper paths), `code-reviewer` before ship.

## Testing Strategy
- **Unit (pure, no mocks):** tokenizer, command reader, matchers, rule-file merge, each rule's decision.
- **Unit (London, mocked collaborators):** GitReader, StateStore and WorkflowState at their interfaces, for the rules, the recorder and adoption.
- **Integration:** real temp git repo (GitReader), real temp dirs (StateStore, atomic write, symlink refusal), real wrapper script, real bundle subprocess.
- **Acceptance:** `runToolGate` boundary, one scenario per user story.
- **Edge cases** (from requirements):
  - Detached HEAD, not a repo, heredoc redirect.
  - `..` and symlinked paths.
  - Missing workflow state, corrupt `cycle.json`.
  - Unreadable commands, `!` escape hatch (no test needed: outside hooks).

## Security Checklist
- [ ] Hook input is untrusted JSON: validate shape; unknown tool → allow with no output.
- [ ] No shell: git via `execFileSync` with an argument array. Paths are never interpolated.
- [ ] Repo rule file can't loosen (T5); rule and state files protected (T5/T11).
- [ ] State writes refuse symlinked `.oss` / `.oss/tool-gates` (T13).
- [ ] Events carry command text and paths only, never Edit/Write content (AC-011.2).
- [ ] Never emit `permissionDecision: "allow"` (contract 5).

## Performance Considerations
- [ ] One bundled `.cjs`, no network, at most one `git` spawn per Bash part with git in it (and none for non-git calls).
- [ ] Under 100 ms in-process decision; 2 s self-timeout; hooks.json `timeout` as the outer bound.

## Rollout Strategy
- No feature flag and no warn mode (ADR-001). Block mode on `feat/determinism-sprint/build` only.
- Real-session proof is the R-267 deepblue benchmark (events log counts refusals, `runner-adopted` and `gate-error`).
- Rollback: revert the hooks.json entries (one commit) on the sprint branch.

## Estimated Tasks: 24
## Estimated Test Cases: ~110

## Last Updated: 2026-11-09 14:22 CST by /oss:plan
