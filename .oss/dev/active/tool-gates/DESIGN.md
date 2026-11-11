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
| Edit, Write, or Bash redirect / `rm` / `mv` / `cp` onto a protected path (the rule files, the gate's state in `.oss/tool-gates/**`, `~/.oss/hooks/**`, `.claude/settings*.json`) | always |
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
  "protectedPaths": [".oss/tool-gates.json", ".oss/tool-gates/**", "~/.oss/hooks/**", ".claude/settings*.json", "~/.claude/settings*.json", "~/.claude/plugins/**"],
  "productionHosts": [],
  "tagsAllowed": true
}
```

- **Plugin file:** base values.
- **Repo file `.oss/tool-gates.json`:** may only add to lists (`protectedPaths`, `productionHosts`, `sourceExtensions`, `protectedBranches`; never `testFilePatterns` or `testCommandPatterns`, which only the plugin sets) or tighten (`tagsAllowed: false`). It can never remove a value or loosen a setting. A repo file that is malformed or tries to loosen is ignored as a whole and reported (one line to the agent and a `rule-file-rejected` event); the base rules apply.
- The rule values exist only in the rule files: no list is duplicated in hook code.

## RED rule (per cycle)

State in `.oss/tool-gates/cycle.json`: the last test result and the source files edited since the last red run.

- Test files (match `testFilePatterns`) can always be edited.
- Only **source files** (`sourceExtensions`, outside test patterns) are covered. `.oss/dev/**`, Markdown, JSON and YAML are never covered.
- After a **red** run, any source file may be edited (GREEN step); each edited file joins the cycle.
- After a **green** run, only source files already in the cycle may be edited (REFACTOR step). A new source file is refused until a test goes red.
- No recorded run yet in this build: source edits are refused until a test goes red. The refusal says how to get a run recorded (fix part K13; a piped run hides the test's exit code, so it is never recorded): "No failing test recorded in this build. Write a failing test and run it on its own with a test command, unpiped (for example `npx vitest run <file>` or `pytest <file>`). Another command that names a test file or has the word test, spec or check in it, and fails, is taken as this build's test command."
- **No lockout: adopt the runner (user, 2026-11-09).** During a build, an unlisted Bash command that names a test file (matches `testFilePatterns`) or contains the word `test`, `spec` or `check`, and exits non-zero, is taken as this build's test command: it is stored in `cycle.json`, logged once as `runner-adopted`, and from then on its runs count red/green like a listed command (this first failing run counts red). An agent that runs no tests is never unlocked. A runner with no such hint stays refused; the refusal says to run the tests with a listed test command or one that names a test file. R-267 counts `runner-adopted`. History: a first heads-up flagged that a build with an unlisted runner would have every code edit refused; the first fix (rule off after 3 refused edits) was replaced the same day after a second heads-up showed it also freed an agent that runs no tests at all.
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

- [x] Every rule in the table refuses its bad case (exit 2 + reason) and passes its positive control. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses a push from main and names the branch (AC-001.1)", "refuses a force push even from a feature branch (AC-002.1)", "refuses writing a test file that focuses one test with .only (AC-003.1)", "refuses a source edit during a build when no test run is recorded (AC-004.1, AC-004.8)", "refuses writing the repo rule file (AC-006.1)", "refuses calling a production host the repo lists (AC-007.1)", "refuses creating a tag when the repo turns tags off (AC-008.1)"; positive controls: `watcher/test/cli/tool-gate.acceptance.test.ts`: "allows a push from a feature branch without saying anything (AC-001.2)"; `watcher/test/tool-gate/rules/force-push.test.ts`: "should allow git push --no-force, which turns force off"; `watcher/test/tool-gate/rules/focused-tests.test.ts`: "should allow the same focused test text in a file that is not a test file"; `watcher/test/tool-gate/rules/production-host.test.ts`: "should allow an unlisted host and a host that only shares a suffix (notapi.example.com)"; `watcher/test/tool-gate/rules/red-cycle.test.ts`: "should allow any source edit after red and add the file to the cycle"; `watcher/test/tool-gate/rules/tags.test.ts`: "should allow %s" (describe "tags rule: a repo that allows tags (the default)"); `watcher/test/tool-gate/rules/protected-path.test.ts`: "should allow an ordinary path that climbs with .. to an ordinary file"
- [x] Red/green is recorded from `PostToolUse` / `PostToolUseFailure`; piped, `|| true` and interrupted runs are unknown and count as neither. — proven by `watcher/test/tool-gate/recorder.test.ts`: "should record green for a listed test command on PostToolUse", "should record unknown for piped, || true, || : and is_interrupt runs, and leave the cycle unchanged"; `watcher/test/cli/tool-gate.acceptance.test.ts`: "records a failing test run, then allows the source edit (AC-004.2, AC-005.2)"
- [x] Edit/Write and Bash redirect/`rm`/`mv`/`cp` onto a protected path are refused. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses writing the repo rule file (AC-006.1)" (Edit and Write); `watcher/test/tool-gate/rules/protected-path.test.ts`: "should refuse: echo x > .oss/tool-gates.json", "should refuse: rm ~/.oss/hooks/x.sh", "should refuse: mv x .oss/tool-gates.json", "should refuse: cp x ~/.claude/settings.json"
- [x] A repo file can add and tighten; a loosening or malformed repo file is ignored and reported, base rules still apply. — proven by `watcher/test/tool-gate/rule-file.test.ts`: "should add a repo protectedPath, productionHost and pattern together", "should apply tagsAllowed false from the repo file", "should reject the whole repo file when it omits a base value from a list it sets", "should reject tagsAllowed true over a base false", "should reject %s and keep the base settings" (malformed cases); `watcher/test/cli/tool-gate.acceptance.test.ts`: "ignores and reports a repo rule file that drops main from the protected branches (AC-009.3)"
- [x] A crash or timeout allows the call, logs `gate-error` and tells the agent. — proven by `watcher/test/tool-gate/failure.test.ts`: "should allow, log gate-error and print the tell line when a collaborator throws", "should allow, log gate-error and tell when the decision takes over 2 s"; `watcher/test/hooks/oss-tool-gate.test.ts`: "should allow, log gate-error and tell when the CLI exits 1, is missing, or node is missing from PATH"
- [x] Rule values exist only in the rule files (provenance check: no list duplicated in code). — proven by `watcher/test/tool-gate/provenance.test.ts`: "should find none of the base file's list values as literals in watcher/src/tool-gate/**"
- [x] Under 100 ms per call in the test environment. — proven by `watcher/test/cli/tool-gate.speed.test.ts`: "should decide a Bash call in under 100 ms in-process (median of 20 calls)" (asserts median under 100 ms and max under 1000 ms; see TESTING.md)

## TDD Test Plan

Hermetic: hook JSON fed to `tool-gate` on stdin in a throwaway git repo; no real Claude session, no network.

- [x] `git push` on `main` → refused; same push on a feature branch → allowed. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses a push from main and names the branch (AC-001.1)", "allows a push from a feature branch without saying anything (AC-001.2)"
- [x] `cd sub && git push` with `sub` on `main` → refused; `git -C sub push` → refused. — proven by `watcher/test/tool-gate/rules/protected-branch.test.ts`: "should use the branch of the directory the command really runs in: cd sub && git push", "should use the branch of the directory the command really runs in: git -C sub push"
- [x] `git push origin HEAD:main` from a feature branch → refused. — proven by `watcher/test/tool-gate/rules/protected-branch.test.ts`: "should refuse git push origin HEAD:main from a feature branch"
- [x] `git commit -m "stop push to main"` on a feature branch → allowed (quotes respected). — proven by `watcher/test/tool-gate/rules/protected-branch.test.ts`: "should allow a commit whose message mentions pushing to main on a feature branch"
- [x] `git push --force` / `-f` / `--force-with-lease` → refused. — proven by `watcher/test/tool-gate/rules/force-push.test.ts`: "should refuse git push --force on any branch, naming --force", "should refuse git push -f on any branch, naming -f", "should refuse git push --force-with-lease on any branch, naming --force-with-lease"
- [x] `.only(` written into `foo.test.ts` → refused; into `foo.ts` → allowed. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses writing a test file that focuses one test with .only (AC-003.1)"; `watcher/test/tool-gate/rules/focused-tests.test.ts`: "should allow the same focused test text in a file that is not a test file"
- [x] RED cycle: no run → source edit refused; red → allowed; green → cycle file allowed, new file refused; test file always allowed; Markdown / `.oss/dev/**` never covered; outside `/oss:build` → not applied. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses a source edit during a build when no test run is recorded (AC-004.1, AC-004.8)", "records a failing test run, then allows the source edit (AC-004.2, AC-005.2)"; `watcher/test/tool-gate/rules/red-cycle.test.ts`: "should allow a cycle file and refuse a new file after green", "should never cover test files, .md, .json, .yml/.yaml or .oss/dev/**", "should not apply when currentCommand is not build or workflow-state.json is missing"
- [x] `npm test | tail` and `npm test || true` → unknown; interrupted → unknown. — proven by `watcher/test/tool-gate/recorder.test.ts`: "should record unknown for piped, || true, || : and is_interrupt runs, and leave the cycle unchanged"
- [x] `pnpm test`, `npm run test:unit`, `make test`, `swift test` → recognized as test runs. — proven by `watcher/test/tool-gate/recorder.test.ts`: "should recognize pnpm test, npm run test:unit, make test, swift test, ./gradlew test, dotnet test"
- [x] Unlisted `./run-tests.sh` exits non-zero during build → adopted (`runner-adopted`, counts red), later runs count red/green; unlisted `make` → not adopted; agent that runs no tests → source edits stay refused however many times it tries. — proven by `watcher/test/tool-gate/runner-adoption.test.ts`: "should adopt ./run-tests.sh that exits non-zero during build, log runner-adopted once and count red", "should count later runs of the adopted command red or green", "should not adopt plain make, git checkout, or npm run typecheck", "should keep source edits refused for an agent that runs no test-like command, after 20 attempts"
- [x] Edit of `.oss/tool-gates.json` → refused; `echo x > .oss/tool-gates.json` → refused; `rm ~/.oss/hooks/x.sh` → refused. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses writing the repo rule file (AC-006.1)" (Edit of `.oss/tool-gates.json`); `watcher/test/tool-gate/rules/protected-path.test.ts`: "should refuse: echo x > .oss/tool-gates.json", "should refuse: rm ~/.oss/hooks/x.sh"
- [x] `curl https://<listed prod host>/…` → refused; unlisted host → allowed. — proven by `watcher/test/tool-gate/rules/production-host.test.ts`: "should refuse curl https://api.example.com/x when listed, naming the host", "should allow an unlisted host and a host that only shares a suffix (notapi.example.com)"
- [x] `git tag v1` with `tagsAllowed: false` → refused; default → allowed. — proven by `watcher/test/cli/tool-gate.acceptance.test.ts`: "refuses creating a tag when the repo turns tags off (AC-008.1)"; `watcher/test/tool-gate/rules/tags.test.ts`: "should allow %s" (describe "tags rule: a repo that allows tags (the default)")
- [x] Repo file adding a protected path → applied; repo file removing `main` from `protectedBranches` → whole file ignored, reported, base applies; malformed JSON → same. — proven by `watcher/test/tool-gate/rule-file.test.ts`: "should add a repo protectedPath, productionHost and pattern together", "should reject the whole repo file when it omits a base value from a list it sets", "should reject %s and keep the base settings" (malformed cases); `watcher/test/cli/tool-gate.acceptance.test.ts`: "ignores and reports a repo rule file that drops main from the protected branches (AC-009.3)"
- [x] Simulated crash / timeout → allowed, `gate-error` logged, agent told. — proven by `watcher/test/tool-gate/failure.test.ts`: "should allow, log gate-error and print the tell line when a collaborator throws", "should allow, log gate-error and tell when the decision takes over 2 s"
- [x] Speed: under 100 ms per call (generous threshold, not a tight timing assertion). — proven by `watcher/test/cli/tool-gate.speed.test.ts`: "should decide a Bash call in under 100 ms in-process (median of 20 calls)"

## Out of Scope

- Warn mode (user decision, 2026-11-09).
- Per-task RED records (R-257), the state machine (R-254), agent tool lists (R-266), chain enforcement (R-265).
- Removing duplicated IRON LAW wording from the served prompts: those come from the API and need an API sprint-branch change later in Sprint D. The text stays as guidance meanwhile.
- A real-session check on this Mac: `--plugin-dir` overwrites the shared `~/.oss/hooks` copies for every OSS session. The real-session proof is the R-267 run on deepblue.
- Catching writes through interpreters (`python -c`, `node -e`) to protected paths.

## Known Limits (accepted)

- The RED rule trusts `currentCommand`, which the model sets via `oss-notify.sh`; if that never runs, the rule never applies. R-254 makes it code-owned.
- An agent could run a test it knows fails to unlock edits. R-257's per-task results close this.
- An agent could run a failing command named like a test to get it adopted. Same class as the deliberately failing test above; every adoption is logged, counted by R-267, and closed by R-257.
- A runner whose command has no test hint (e.g. plain `make`) is never adopted; run the tests with a listed runner or name the test file (a repo rule file can't add `testCommandPatterns`).
- A recursive write (`rm -r`, `chmod -R`, `chown -R`, `find … -delete`) to a folder named by a variable or command output (`rm -rf "$d"`) is refused, since the gate can't search it for a nested `.git` (fix part K13, its own reason, not "too complex"); name the folder literally.
- Two sessions in the same folder share `cycle.json`: no corruption (atomic writes), but one session's red can unlock the other's edits. Rare; OSS works per worktree.
- Protected-path checks on Bash cover redirects, `rm`/`mv`/`cp`, and (T11b, user pick) `tee`, `sed -i`/`perl -i`, `dd of=`, `truncate`, `touch`, `ln`, `install`, `chmod`/`chown`, `git checkout --`/`git restore`. Since F3b, `protected-path-mention` refuses any other program that is not read-only when a word names a protected path or a folder holding one, and interpreter scripts (`python -c`, `node -e` …) whose string literals do. Still open:
  - a symlink swapped in after the check (a time-of-check race);
  - a path built in a script without a literal naming it (`perl -e 'unlink q(.oss/x)'`, `os.path.join('.oss', 'tool-gates')`, or a folder literal joined to the rest: `HOME + '/.claude'`);
  - a word whose known start is not already inside a protected folder (`.oss/$X`, `$DIR/.oss/tool-gates.json`, `.oss/tool-gates.$EXT`);
  - a script file the agent wrote earlier and then runs (`python3 fix.py`);
  - **deferred by the user 2026-11-10:** after a `cd` the gate can't follow, a single-file relative write whose name only a protected folder's `/**` covers (`cd "$X" && rm cycle.json`) is allowed. Wildcard writes, recursive deletes and recursive `chmod`/`chown` there are refused since fix round 4 (K3), and so is any name a protected path ends with (`rm workflow-state.json`, `rm ../workflow-state.json`);
  - **deferred by the user 2026-11-10:** dotglob/globdots set in the user's shell rc files is not visible; the gate assumes the default. (`shopt -s dotglob`, `setopt globdots` and the like earlier in the same call are read since fix round 4, K2.)
  - reading a protected file with a program not on the read-only list (`xxd`, `sort`) is refused too (over-refusal; the reason suggests the Read tool or `cat … |`). Since R2c the list holds `jq`, `[[`, `git ls-files`, and `sed` / `awk` without in-place editing; `cp` only reads its sources (the file it writes is checked), `echo` / `printf` only print (their redirect is checked), `mkdir` only counts a word that is itself a protected path, and `git clean` is refused only when git's own dry run lists an untracked protected path (since fix round 4: a clean holding a word only known when it runs, one whose dry run would list over 2048 paths, or one in a repo found through a `.git` file below the project root is not dry-run; it falls back to refusing when it can reach a folder holding protected paths, an unknown pathspec counting as the repo root, so `git clean -f` at the root of a repo with over 2048 untracked files is refused and `git clean -f -- big/` is not).
- Push setup (F3b): a push is refused when the same call first ran `git checkout`, `switch`, `branch -m|-u`, `remote set-url` and the like. Since R2c, a plain `git checkout -b X [start]` / `git switch -c X [start]` in the same folder is not: the push and any commit after it are checked as running on `X`. `GIT_AUTHOR_*`, `GIT_COMMITTER_*` (name, email, date) and `GIT_TRACE*` are allowed on a commit or push; `cd "$(git rev-parse --show-toplevel)"` is read as a move to the top of the repo holding the current folder. Run in an earlier call, these stay allowed. Switching the branch that way is harmless, since the gate reads the branch at push time. But an upstream or remote URL changed by `git branch -u` or `git remote set-url` in an earlier call is not refused; only `git config` writes to push keys are.
- A Bash call with more than 2048 words (each part counts at least once, and an interpreter script's string literals count), or more than 64 KB of words after expansion, is refused as too complex to check (each word is looked up on disk, and the gate allows a call it can't decide in time). So is a call over any other reading limit (ADR-010). Since fix round 4 a call is also refused as too complex when it needs more than 8 different git questions (each folder's branch and each dry run is asked once per call), more than 1.2 s of git in all, more than 20000 paths looked up on disk or more than 200000 path names walked (links' names included). Since K3 a recursive delete or `chmod -R`/`chown -R` searches the folders it names for a nested `.git` (any name a `**/` protected pattern starts with); searching more than 10000 folders, or for over 1 s, refuses the call as too complex (so `rm -rf node_modules` in a project whose `node_modules` holds over 10000 folders is refused). A word, script literal or write target over 4096 characters or 512 folders is refused before any lookup. A repo rule file may add at most 64 values to each list.
- **Shell reading has limits** (user, 2026-11-09, T3b review). The gate guards against an agent drifting from the laws; it is not a sandbox against a determined adversary. These forms are not read:
  - variables as the program or a git argument (`G=git; $G push -f`, `git $SUB -f`)
  - a script file a shell runs (`bash script.sh`, `source`); heredoc and here-string bodies are read since R2b, and since fix round 4 a literal `echo` / `printf` / `cat <<EOF` piped into a shell or interpreter is read too (any other piped or `<` file script is unreadable, so refused). Since fix round 4 (K3) a script only known when it runs (`python3 "$S"`, `sh $X`, `bash <(curl …)`, `python3 -c "$C"`, `node -e "$C"`) is unreadable, so refused (the call runs an interpreter), and so is a sed script holding a variable or substitution next to anything risky (ADR-010)
  - long-tail wrappers (`ssh host cmd`, `find -exec`, `chroot`, `watch`, `parallel`, `python -c`, `node -e`, `npx`, `make` targets)
  - git aliases already defined in the user's or the repo's git config (`git p -f` for an existing `alias.p=push`); a `git -c alias.*` on the command line is refused since fix round 4 (K4)
  - arguments that `xargs` reads from stdin

  Dynamic `-c` / `eval` scripts are unreadable (ADR-010): the rest of the call is still read and checked, and the call is refused when it also runs git that writes, names a protected path or runs an interpreter or shell; otherwise it is allowed and logged `unreadable`, and R-267 counts them. Also left open after T3c, all low risk:
  - `coproc git push`
  - a test result hidden behind `if … fi || true` or `while … done | tail` (it can only record a wrong green, which restricts edits)
  - `for ((…))` headers, and `;&` / `;;&` case fall-through (these over-report, never hide)

  Closed in T2b, T3b and T3c: ANSI-C quoting, literal `-c` / `eval` scripts, wrappers, shell keywords, positional parameters, option clusters, and `command cd` / `pushd`.

## Stress Test (2026-11-09)

All five concerns were accepted by the user and folded into the design above:
1. Quoted text read as a command → real shell tokenizer.
2. RED rule blocking non-code files → covers `sourceExtensions` only; `.oss/dev/**`, Markdown, JSON, YAML never covered.
3. Bash writes to protected paths → redirects and `rm`/`mv`/`cp` refused; interpreter writes are a known gap.
4. `currentCommand` set by the model → known limit, R-254.
5. Shared `cycle.json` → atomic writes; cross-session unlock accepted as rare.

No dissent records: the user overrode no concern.

## Plan amendment (2026-11-09, `/oss:plan`)

- `.oss/tool-gates/**` added to the base `protectedPaths` (user pick): otherwise an agent could write `cycle.json` to fake a red run or rewrite the events R-267 counts.
- Shell tokenizer: our own (ADR-007).
- "This build" = `currentCommandStartedAt` written by `update-workflow-state` (ADR-008).

## Build amendment (2026-11-09, `/oss:build`, user pick)

- **Nested shells are read.** A `bash`/`sh`/`zsh -c` script that is a plain literal (no `$(`, no backticks) is tokenized and checked like a top-level command, recursively.
- **Wrappers are looked through.** Known wrappers (`env`, `sudo`, `command`, `nice`, `nohup`, `time`, `xargs`; since fix round 4 (K6, K7) `script`, `unbuffer`, `faketime`, `caffeinate`, `ionice`, `chrt`, `flock`, with `script -c` / `flock -c` read as `sh -c`, and `expect` spawns from `-c` text or a script file) are skipped to find the real program.
- **Still unreadable:** only truly dynamic scripts, which are allowed and logged as `unreadable`.
- **Why:** without this, `bash -c 'git push --force'` or `env git push origin main` bypassed every git rule.
- **User-level Claude settings and the installed plugin are protected** (user pick, before T11): `~/.claude/settings*.json` and `~/.claude/plugins/**` are added to the base `protectedPaths`. Either one could switch every gate off: `disableAllHooks`, or editing the cached `hooks.json` / `tool-gate.cjs`. The user changes them with `!`. This plugin repo's own `hooks.json` is a repo path and stays editable.
- **ANSI-C quoting** (`$'…'`) is decoded by the tokenizer, so `$'HEAD:main'` is read as `HEAD:main`.

## Last Updated: 2026-11-10 15:15 CST by /oss:ship (fix round 4, K7)
