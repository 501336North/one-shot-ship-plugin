# Feature: tool-gates (R-253, Sprint D #1)

Status: COMMITTED
Date: 2026-11-09
Card: oss-lab ROADMAP R-253 (Sprint D, umbrella R-252)
Branch: work lands on `feat/determinism-sprint/build` (Sprint D's trunk), never `main`. The sprint branch merges to `main` only after the R-267 deepblue benchmark passes and the user gives the go.

## Problem

The IRON LAWS live in prompt text. A session-start banner prints ❌ (for example "on protected branch main") and the agent carries on. Nothing the plugin registers can refuse a tool call: plugin `hooks.json` has no `PreToolUse`. Measured costs: 8 of 9 ship fixes unguarded (2026-09-06); `/oss:build` imitated for 4 rounds (2026-09-16). A law the agent can read and walk past is a preference.

## Solution

A small Node program, `tool-gate`, called by plugin hooks:

- **Before a tool call** (`PreToolUse` on Bash, Edit, Write, MultiEdit, NotebookEdit): check the call against the rules; allow it, or refuse it with exit 2 and a one-line reason the agent sees (e.g. "Refused: `git push` while on `main`. Use a feature branch.").
- **After a Bash call** (`PostToolUse` = exit 0, `PostToolUseFailure` = non-zero exit): if the command is a test run, record red or green. It runs no tests itself.

Rules refuse for real (block mode). **No warn mode** (user, 2026-11-09): nothing reaches customers before the R-267 benchmark, which counts wrong refusals.

## Rules (base rules, shipped with the plugin)

| Rule | Applies |
|---|---|
| `git commit` / `git push` while on a protected branch (`main`, `master`), including `git push <remote> <x>:main` from any branch | always |
| `git push --force` / `-f` / `--force-with-lease` | always |
| `.skip` / `.only` / `.todo` written into a test file | always |
| Source file edited with no red run in the current cycle (RED rule, below) | only while `/oss:build` runs |
| Edit, Write, or Bash redirect / `rm` / `mv` / `cp` onto a protected path (the rule files, `~/.oss/hooks/**`, `.claude/settings*.json`) | always |
| Bash call to a host listed as production in the repo file | always |
| `git tag` / `git push --tags` in a repo whose file sets `tagsAllowed: false` | always |

**Escape hatch:** the user runs the action themselves with `!` in the prompt. That runs in the user's shell, outside the hooks. No override mechanism is built.

## Rule file

Settings, not a rule language: the rules are code; the file turns them on and gives their values.

```json
{
  "version": 1,
  "protectedBranches": ["main", "master"],
  "testFilePatterns": ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/test_*.sh", "**/*_test.go"],
  "testCommandPatterns": ["npm test", "npm run test*", "pnpm test", "pnpm run test*", "yarn test", "yarn run test*", "bun test", "npx vitest", "npx jest", "vitest", "jest", "pytest", "python -m pytest", "go test", "cargo test", "swift test", "make test", "make check", "./gradlew test", "gradle test", "mvn test", "dotnet test", "rspec", "bundle exec rspec", "phpunit", "bash *test*.sh"],
  "sourceExtensions": [".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".py", ".go", ".rs", ".swift"],
  "protectedPaths": [".oss/tool-gates.json", "~/.oss/hooks/**", ".claude/settings*.json"],
  "productionHosts": [],
  "tagsAllowed": true
}
```

- **Plugin file:** base values.
- **Repo file `.oss/tool-gates.json`:** may only add to lists (`protectedPaths`, `productionHosts`, patterns, `sourceExtensions`, `protectedBranches`) or tighten (`tagsAllowed: false`). It can never remove a value or loosen a setting. A repo file that is malformed or tries to loosen is ignored as a whole and reported (one line to the agent and a `rule-file-rejected` event); the base rules apply.
- The rule values exist only in the rule files: no list is duplicated in hook code.

## RED rule (per cycle)

State in `.oss/tool-gates/cycle.json`: the last test result and the source files edited since the last red run.

- Test files (match `testFilePatterns`) can always be edited.
- Only **source files** (`sourceExtensions`, outside test patterns) are covered. `.oss/dev/**`, Markdown, JSON and YAML are never covered.
- After a **red** run, any source file may be edited (GREEN step); each edited file joins the cycle.
- After a **green** run, only source files already in the cycle may be edited (REFACTOR step). A new source file is refused until a test goes red.
- No recorded run yet in this build: source edits are refused until a test goes red. The refusal says how to fix a runner the gate doesn't know: "No failing test recorded. If your tests run with a command not in testCommandPatterns, add it to .oss/tool-gates.json (the user, with `!`)."
- **No lockout (user, 2026-11-09):** if 3 source edits have been refused in this build and no test run has been recognized at all, the RED rule switches off for the rest of the build, logs one `red-rule-unarmed` event (with the Bash commands run so far, so the missing pattern can be found), and tells the agent once. A heads-up flagged that a build whose tests run with an unlisted command would otherwise have every code edit refused, and the agent can't add the pattern itself (the rule file is protected). R-267 counts `red-rule-unarmed`.
- A red run starts a new cycle (the file list resets).
- "`/oss:build` is running" = `currentCommand` is `build` in the project's `.oss/workflow-state.json`.

## Test-run record

- A Bash command is a test run when one of its parts matches `testCommandPatterns`.
- `PostToolUse` → green; `PostToolUseFailure` (its `error` starts "Exit code N") → red. Checked in a real session, Claude Code 2.1.319, 2026-11-09.
- **Unknown, counts as neither:** a test command piped into another command (`npm test | tail`), followed by `|| true` / `|| :`, or interrupted (`is_interrupt`).
- Each run and each refusal is one line in `.oss/tool-gates/events.ndjson` (time, tool, rule id or test command, result). Lines carry the command text, never file contents.

## Reading shell commands

- A real shell tokenizer that respects quotes, so `git commit -m "stop push to main"` is not a push. (Choice between a small established npm package and our own tokenizer is a plan decision; bundled into the single `.cjs` either way.)
- Compound commands are split on `&&`, `||`, `;`, `|` and newlines; each part is checked.
- `git -C <dir>` and `cd <dir> && git …` use that directory's branch.
- A command the tokenizer can't read (`eval`, `bash -c "$(…)"`) is allowed and logged as `unreadable`.

## Failure handling

- `tool-gate` crashes or exceeds 2 s: the call is **allowed**, a `gate-error` event is logged, and the agent sees one line: "tool-gate failed, rules not checked." (User, 2026-11-09: a broken gate that refuses everything would block every OSS session; R-267 counts gate errors.)
- Writes to `cycle.json` are atomic (temp file + rename).
- Speed: one bundled file, no network; under 100 ms per call, tested with a generous margin.

## Scope

Active in every Claude Code session with the plugin installed, not only during `/oss:*` commands. Subagents' tool calls go through the same hooks. The RED rule alone is limited to `/oss:build`.

## Components

- `watcher/src/cli/tool-gate.ts`: reads hook JSON on stdin; `pre` mode decides allow/refuse; `post` mode records test runs. Bundled to `watcher/dist/cli/tool-gate.cjs`.
- Rule-file loader: base + repo merge with add-only validation.
- Shell command reader: tokenize, split, find git subcommand / branch / redirects / hosts / test commands.
- Base rule file shipped in the plugin.
- `hooks.json` entries: `PreToolUse` (Bash|Edit|Write|MultiEdit|NotebookEdit), `PostToolUse` (Bash), `PostToolUseFailure` (Bash).

## Success Criteria

- [ ] Every rule in the table refuses its bad case (exit 2 + reason) and passes its positive control.
- [ ] Red/green is recorded from `PostToolUse` / `PostToolUseFailure`; piped, `|| true` and interrupted runs are unknown and count as neither.
- [ ] Edit/Write and Bash redirect/`rm`/`mv`/`cp` onto a protected path are refused.
- [ ] A repo file can add and tighten; a loosening or malformed repo file is ignored and reported, base rules still apply.
- [ ] A crash or timeout allows the call, logs `gate-error` and tells the agent.
- [ ] Rule values exist only in the rule files (provenance check: no list duplicated in code).
- [ ] Under 100 ms per call in the test environment.

## TDD Test Plan

Hermetic: hook JSON fed to `tool-gate` on stdin in a throwaway git repo; no real Claude session, no network.

- [ ] `git push` on `main` → refused; same push on a feature branch → allowed.
- [ ] `cd sub && git push` with `sub` on `main` → refused; `git -C sub push` → refused.
- [ ] `git push origin HEAD:main` from a feature branch → refused.
- [ ] `git commit -m "stop push to main"` on a feature branch → allowed (quotes respected).
- [ ] `git push --force` / `-f` / `--force-with-lease` → refused.
- [ ] `.only(` written into `foo.test.ts` → refused; into `foo.ts` → allowed.
- [ ] RED cycle: no run → source edit refused; red → allowed; green → cycle file allowed, new file refused; test file always allowed; Markdown / `.oss/dev/**` never covered; outside `/oss:build` → not applied.
- [ ] `npm test | tail` and `npm test || true` → unknown; interrupted → unknown.
- [ ] `pnpm test`, `npm run test:unit`, `make test`, `swift test` → recognized as test runs.
- [ ] Build with no recognized test run: 3 refused source edits → rule switches off for the build, one `red-rule-unarmed` event, agent told once; a recognized run before that → no switch-off.
- [ ] Edit of `.oss/tool-gates.json` → refused; `echo x > .oss/tool-gates.json` → refused; `rm ~/.oss/hooks/x.sh` → refused.
- [ ] `curl https://<listed prod host>/…` → refused; unlisted host → allowed.
- [ ] `git tag v1` with `tagsAllowed: false` → refused; default → allowed.
- [ ] Repo file adding a protected path → applied; repo file removing `main` from `protectedBranches` → whole file ignored, reported, base applies; malformed JSON → same.
- [ ] Simulated crash / timeout → allowed, `gate-error` logged, agent told.
- [ ] Speed: under 100 ms per call (generous threshold, not a tight timing assertion).

## Out of Scope

- Warn mode (user decision, 2026-11-09).
- Per-task RED records (R-257), the state machine (R-254), agent tool lists (R-266), chain enforcement (R-265).
- Removing duplicated IRON LAW wording from the served prompts: those come from the API and need an API sprint-branch change later in Sprint D. The text stays as guidance meanwhile.
- A real-session check on this Mac: `--plugin-dir` overwrites the shared `~/.oss/hooks` copies for every OSS session. The real-session proof is the R-267 run on deepblue.
- Catching writes through interpreters (`python -c`, `node -e`) to protected paths.

## Known Limits (accepted)

- The RED rule trusts `currentCommand`, which the model sets via `oss-notify.sh`; if that never runs, the rule never applies. R-254 makes it code-owned.
- An agent could run a test it knows fails to unlock edits. R-257's per-task results close this.
- An agent could avoid recognized test commands to reach the 3-refusal switch-off. Every switch-off is logged and counted by R-267; R-257 closes it.
- Two sessions in the same folder share `cycle.json`: no corruption (atomic writes), but one session's red can unlock the other's edits. Rare; OSS works per worktree.
- Protected-path checks on Bash cover redirects and `rm`/`mv`/`cp`, not every possible write.

## Stress Test (2026-11-09)

All five concerns were accepted by the user and folded into the design above:
1. Quoted text read as a command → real shell tokenizer.
2. RED rule blocking non-code files → covers `sourceExtensions` only; `.oss/dev/**`, Markdown, JSON, YAML never covered.
3. Bash writes to protected paths → redirects and `rm`/`mv`/`cp` refused; interpreter writes are a known gap.
4. `currentCommand` set by the model → known limit, R-254.
5. Shared `cycle.json` → atomic writes; cross-session unlock accepted as rare.

No dissent records: the user overrode no concern.
