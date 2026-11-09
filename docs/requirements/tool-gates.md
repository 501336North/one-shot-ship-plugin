# Feature: tool-gates (R-253)

## Overview

The IRON LAWS become refusals at the tool-call level. Before an agent's Bash, Edit, Write, MultiEdit or NotebookEdit call runs, `tool-gate` checks it against one settings-only rule file and refuses a forbidden call (exit 2, one-line reason). After a Bash test command, it records red or green, which a per-cycle RED rule uses during `/oss:build`. Source: `.oss/dev/active/tool-gates/DESIGN.md` (COMMITTED 2026-11-09).

## Actors

| Actor | Description |
|-------|-------------|
| Agent | Any Claude Code session or subagent with the plugin installed, making tool calls |
| User | The developer running the session; can act outside the hooks with `!` |
| Repo maintainer | Adds repo-specific facts in `.oss/tool-gates.json` |
| Benchmark (R-267) | Reads the event log to count refusals, wrong refusals and gate errors |

## User Stories

### US-001: No commits or pushes to a protected branch
**As a** user **I want** an agent's `git commit` / `git push` on `main`/`master` refused **so that** IRON LAW #4 holds even when the agent ignores the banner.
**Priority:** Must · **Estimate:** Medium

- **AC-001.1** Given the working directory is on `main`, when the agent runs `git push`, then the call is refused with exit 2 and a reason naming the branch.
- **AC-001.2** Given a feature branch, when the agent runs `git push`, then the call is allowed.
- **AC-001.3** Given `sub/` is on `main`, when the agent runs `cd sub && git push` or `git -C sub push`, then the call is refused.
- **AC-001.4** Given a feature branch, when the agent runs `git push origin HEAD:main`, then the call is refused.
- **AC-001.5** Given a feature branch, when the agent runs `git commit -m "stop push to main"`, then the call is allowed (quoted text is not a command).
- **AC-001.6** Given `main`, when the agent runs `git commit`, then the call is refused.

### US-002: No force pushes
**As a** user **I want** force pushes refused **so that** history is never rewritten.
**Priority:** Must · **Estimate:** Small

- **AC-002.1** `git push --force`, `git push -f` and `git push --force-with-lease` are refused on any branch.
- **AC-002.2** `git push` without a force flag on a feature branch is allowed.

### US-003: No skipped or focused tests
**As a** user **I want** `.skip` / `.only` / `.todo` writes to test files refused **so that** IRON LAW #1's "never skip tests" holds.
**Priority:** Must · **Estimate:** Small

- **AC-003.1** An Edit/Write/MultiEdit that puts `.skip(`, `.only(` or `.todo(` into a file matching `testFilePatterns` is refused.
- **AC-003.2** The same text written into a non-test file is allowed.
- **AC-003.3** An edit to a test file that already contained `.skip(` but does not add a new one is allowed (only newly added occurrences count).

### US-004: No source edit without a failing test (per cycle, `/oss:build` only)
**As a** user **I want** source edits during a build refused until a test has gone red **so that** every code change is guarded by a test.
**Priority:** Must · **Estimate:** Large

- **AC-004.1** Given `/oss:build` is running and no test run is recorded, when the agent edits a source file, then it is refused.
- **AC-004.2** Given the last recorded run is red, when the agent edits a source file, then it is allowed and the file joins the cycle.
- **AC-004.3** Given the last recorded run is green, when the agent edits a source file already in the cycle, then it is allowed.
- **AC-004.4** Given the last recorded run is green, when the agent edits a source file not in the cycle, then it is refused.
- **AC-004.5** Given any state, when the agent edits a test file, Markdown, JSON, YAML or anything under `.oss/dev/`, then the RED rule does not apply.
- **AC-004.6** Given `currentCommand` is not `build`, the RED rule does not apply.
- **AC-004.7** A red run starts a new cycle: the cycle's file list resets.
- **AC-004.8** Given no recorded run, the refusal tells the agent how to add an unlisted test command (the user adds it to `.oss/tool-gates.json` with `!`).
- **AC-004.9** Given a build where no test run has been recognized, when a 3rd source edit is refused, then the RED rule switches off for the rest of that build, one `red-rule-unarmed` event is logged with the Bash commands run so far, and the agent is told once.
- **AC-004.10** Given a recognized test run earlier in the build, the switch-off never happens.

### US-005: Test runs recorded as red, green or unknown
**As a** user **I want** each test run recorded from the hook events **so that** the RED rule and later cards (R-257, R-265, R-267) have a trustworthy record.
**Priority:** Must · **Estimate:** Medium

- **AC-005.1** A Bash command matching `testCommandPatterns` that fires `PostToolUse` is recorded green.
- **AC-005.2** One that fires `PostToolUseFailure` with an `Exit code N` error is recorded red.
- **AC-005.3** A test command piped into another command, followed by `|| true` / `|| :`, or interrupted is recorded unknown and does not change the cycle.
- **AC-005.4** A Bash command that is not a test run records nothing.
- **AC-005.5** `tool-gate` never runs tests itself.
- **AC-005.6** Common runners are recognized by default: `pnpm test`, `yarn test`, `bun test`, `npm run test*`, `make test`, `swift test`, `gradle`/`mvn`/`dotnet test`, `rspec`, `phpunit` and the rest of `testCommandPatterns`.

### US-006: Protected paths can't be changed by the agent
**As a** user **I want** agent writes to the rule files, OSS hook copies and Claude settings refused **so that** an agent can't switch a law off.
**Priority:** Must · **Estimate:** Medium

- **AC-006.1** Edit/Write/MultiEdit/NotebookEdit on a path matching `protectedPaths` (after `~` and relative-path resolution) is refused.
- **AC-006.2** A Bash redirect (`>`, `>>`) or `rm` / `mv` / `cp` targeting a protected path is refused.
- **AC-006.3** Reading a protected path (Read tool, `cat`) is allowed.

### US-007: No calls to production hosts
**As a** repo maintainer **I want** Bash calls to listed production hosts refused **so that** gate and perf agents never hit production.
**Priority:** Must · **Estimate:** Small

- **AC-007.1** Given `productionHosts` lists `api.example.com`, when the agent runs `curl https://api.example.com/x`, then it is refused.
- **AC-007.2** A host not listed is allowed.
- **AC-007.3** With an empty list (default), no host is refused.

### US-008: No tags in repos that don't tag
**As a** repo maintainer **I want** `git tag` / `git push --tags` refused when the repo sets `tagsAllowed: false` **so that** agents stop proposing tag pushes.
**Priority:** Must · **Estimate:** Small

- **AC-008.1** With `tagsAllowed: false`, `git tag v1` and `git push --tags` are refused.
- **AC-008.2** With the default (`true`), both are allowed (subject to the other rules).

### US-009: Repo rule file can only add
**As a** user **I want** the repo file limited to adding and tightening **so that** neither a repo nor an agent can loosen a base rule.
**Priority:** Must · **Estimate:** Medium

- **AC-009.1** A repo file adding a protected path, production host or pattern takes effect.
- **AC-009.2** A repo file setting `tagsAllowed: false` takes effect.
- **AC-009.3** A repo file that tries to remove a base value or loosen a setting is ignored as a whole, the agent is told in one line, a `rule-file-rejected` event is logged, and the base rules apply.
- **AC-009.4** A malformed repo file behaves like AC-009.3.

### US-010: A broken gate never blocks the session
**As a** user **I want** a crashed or slow gate to let the call through and say so **so that** a bug in `tool-gate` can't stop every OSS session.
**Priority:** Must · **Estimate:** Small

- **AC-010.1** When `tool-gate` crashes, the call is allowed, a `gate-error` event is logged, and the agent sees "tool-gate failed, rules not checked."
- **AC-010.2** When `tool-gate` exceeds 2 s, the same happens.

### US-011: Events for the benchmark
**As the** R-267 benchmark **I want** every refusal, test run, rejected rule file and gate error in one event log **so that** baseline and candidate runs can be compared.
**Priority:** Must · **Estimate:** Small

- **AC-011.1** Each event is one JSON line in `.oss/tool-gates/events.ndjson` with time, tool, event kind, rule id or test command, and result.
- **AC-011.2** Events never contain file contents written by Edit/Write.

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Unreadable command (`eval`, `bash -c "$(…)"`) | Allowed, `unreadable` event logged |
| Detached HEAD | Not a protected branch: commit allowed; pushes still checked by refspec |
| Not a git repo | Git rules don't apply; other rules do |
| `git push` with no branch name, upstream is `origin/main` from a feature branch | Allowed: the current branch is what's checked, plus explicit refspecs |
| Heredoc in a command (`cat <<EOF > file`) | Redirect target checked against protected paths |
| Path with `..` or a symlink into a protected path | Resolved before matching; refused |
| No `.oss/workflow-state.json` | RED rule doesn't apply |
| `cycle.json` missing or corrupt | Treated as "no run yet" during build |
| Two parallel sessions in one folder | Atomic writes; shared cycle (accepted limit) |
| Tests run with a command not in `testCommandPatterns` | After 3 refused source edits, RED rule off for the build + `red-rule-unarmed` (no lockout) |
| User runs `! git push` | Outside the hooks; not checked (intended escape hatch) |

## Non-Functional Requirements

### Performance
- Under 100 ms per hook call in the test environment (generous threshold); 2 s hard timeout.
- No network access.

### Security
- Rule values come only from the rule files; no list duplicated in code.
- The repo file can never loosen a base rule.
- Event lines carry command text and paths only, never written content.

### Reliability
- Crash or timeout → allow + log + tell (never a blanket refusal).
- Atomic writes for `cycle.json`.

## Out of Scope
- Warn mode (user decision, 2026-11-09).
- Per-task RED records (R-257), state machine (R-254), agent tool lists (R-266), chain enforcement (R-265).
- Removing duplicated IRON LAW text from served prompts (later API sprint-branch change).
- A real-session check on this Mac (R-267 on deepblue covers it).
- Writes to protected paths via interpreters (`python -c`, `node -e`).

## Dependencies
- Claude Code hook events `PreToolUse`, `PostToolUse`, `PostToolUseFailure` (checked on 2.1.319).
- Node, already required by the plugin; bundling via the existing watcher build.
- `currentCommand` in the project's `.oss/workflow-state.json` (set by `oss-notify.sh`).

## Open Questions
- [ ] Shell tokenizer: small established npm package vs our own (decide in `/oss:plan`).

## Traceability Matrix

| Requirement | User Story | Test (planned) |
|-------------|-----------|------|
| Protected-branch commit/push | US-001 | `watcher/test/cli/tool-gate.git.test.ts` |
| Force push | US-002 | `tool-gate.git.test.ts` |
| Skipped tests | US-003 | `tool-gate.edits.test.ts` |
| RED cycle | US-004 | `tool-gate.red-cycle.test.ts` |
| Test-run record | US-005 | `tool-gate.record.test.ts` |
| Protected paths | US-006 | `tool-gate.protected.test.ts` |
| Production hosts / tags | US-007, US-008 | `tool-gate.git.test.ts`, `tool-gate.hosts.test.ts` |
| Rule file merge | US-009 | `tool-gate.rule-file.test.ts` |
| Crash / timeout | US-010 | `tool-gate.failure.test.ts` |
| Events | US-011 | `tool-gate.events.test.ts` |
