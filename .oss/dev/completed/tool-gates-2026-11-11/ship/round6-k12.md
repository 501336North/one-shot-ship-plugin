# Fix part K12: the last fix part (the user decided this on 2026-11-11)

These findings come from the round-6 re-check of K11. The user chose: both K11 regressions, the two K11 items that don't close their class, the three K11 over-refusals, the flaky test, and a tighter deadline. The low dotglob and cdpath spellings are deferred by name; the orchestrator writes FOLLOWUPS for them. Follow `ship/fix-rules.md`.
- **Strict TDD.** Write each acceptance test first, in `watcher/test/cli/tool-gate.acceptance.test.ts` under the describe "tool-gate acceptance: fix part K12". Run it through the real gate and watch it FAIL. Record the reason, then write the code.
- Put a "still allowed" case next to each refusal, and add unit tests.
- **Lesson from round 6:** both regressions were in inputs the K11 tests never tried: an apostrophe in a comment, and many `+=` appends. So for each item, also add tests for ordinary, realistic inputs (scripts with comments and contractions, long real-world scripts), not only adversarial ones. Unit mocks must match real tool output: git's `./name` without a trailing slash.
- Keep each change as small as possible, and touch nothing outside these items.

## 1. Regression: `CDPATH+=` makes the gate run past its time limit (HIGH)
- **Where:** `command-reader.ts` `cdpathAfter`, ~1425-1441. The append does a join and split once per assignment, with no `tick()`. It is called twice for an assignment-only segment (~:594, ~:599).
- **Repro:** `CDPATH=` + 44 000 colons + ` ` + 2000 × `CDPATH+=:` + `; git push origin HEAD:main` (64 KB). Under load the call is ALLOWED with gate-error. Repro inputs: `/private/tmp/claude-501/-Users-ysl-dev-oss-plugin-tool-gates/ac0a5463-1408-4cbc-a165-5ef79dd9a6bc/scratchpad/perf6/g_b6.txt` and `f_b1.txt`.
- **Fix:**
  - Make the append linear: keep a list and push, or keep only a "set / one folder / several folders" summary, which is all the reader needs.
  - Tick per assignment, and compute once per segment.
- **Test:** deterministic with a step counter or injected clock, plus a real-bundle check that the repro is refused quickly.

## 2. Regression: an apostrophe or backtick hides later string literals (HIGH)
- **Where:** `rules/protected-path-mention.ts:296-305` `stringLiterals`. A quote with no closing match makes the rest of the script one literal, so every later literal such as `".git/config"` is never looked up.
- **Repros**, which the pre-K11 bundle refused and the current bundle allows:
  - `python3 <<'EOF'\n# don't worry\nopen(".git/config", "a").write("x")\nEOF`
  - `node <<'EOF'\n// it's fine\nrequire("fs").writeFileSync(".claude/settings.local.json","{}")\nEOF`
  - `python3 -c '# dont`t\nopen(".git/hooks/pre-commit","w")…'`
- **Same cause, over-refusal:** an ordinary script over about 4 KB with one apostrophe is refused as "writes a path too long".
- **Fix:**
  - A quote with no closing match is an ordinary character: continue from the next character.
  - Keep the scan linear. Once a quote kind has been found unclosed, no later quote of that kind can close, so mark that kind exhausted and don't search for it again.
  - Tick per character.
- **Tests:**
  - every repro above, refused, with an apostrophe or backtick in a comment before a protected literal;
  - an 8 KB python heredoc and a 6.6 KB node heredoc with apostrophes in comments and no protected path, allowed;
  - the round-5 `"\"\"…` 100 KB repro, still refused quickly.

## 3. Item 8 not closed: `git clean -ff` run from a subfolder (MEDIUM)
- **Where:** `rules/git-clean.ts:211` `folder: p.endsWith('/')`.
- **Failure:** when the cwd is inside an untracked or ignored folder, or `-C` or `cd` points at a subfolder, the dry run lists `./sub` with no trailing slash. So neither `isRepo` nor `nestedBelow` runs.
  - Allowed today: `cd t7 && git clean -ffd`, `git -C t7 clean -ffd`, `cd deep/a && git clean -ffd .`, `cd u2/w && git clean -ffd` (nested repo below).
- **Fix:** decide "folder" from the disk (lstat on the joined path; no links followed) rather than from the trailing slash.
- **Unit mocks:** add a dry-run output with `./name` lines.
- **Still allowed:** `git clean -fd`, `git clean -ffd build` with no nested repo, and `-ff untracked.txt`.

## 4. Item 9 not closed: `git config` option parsing (MEDIUM)
- **Where:** `rules/push-setup.ts:61` `CONFIG_VALUE_OPTIONS` (exact names only) and `:182`.
- **Failure:** short and abbreviated value options shift the key and value by one word. Confirmed with git 2.54:
  - `-t bool-or-str`, `-zt bool-or-str`, `--ty bool-or-str`, `--comm x`;
  - `set --val x`, `set --comm x`, `set --ty bool`.
  - So `credential.helper '!sh …'`, `core.hooksPath`, `alias.*` and `core.sshCommand` writes are allowed.
- **Fix:** read `git config` options the way parse-options does:
  - short clusters, with a value letter anywhere in a cluster;
  - unambiguous long prefixes, for both the legacy form and the `set`/`get`/`unset` subcommand forms.
  - Reuse K11's `readOptions` / `OptionSpec` from `protected-branch.ts` if it fits; move it to a shared module rather than copy it.
  - When an option is ambiguous or unknown, treat the call as unreadable (risky), not as a key.
- **Still allowed:** `git config --type bool core.x true`, `-t bool …`, `git config --get …`, and `git config user.name x`.

## 5. K11 over-refusals (LOW)
- (a) `rules/protected-branch.ts:391` `worktreeBranch` checks every option value. Only `-b`/`-B` values name a branch.
  - Allowed after the fix: `git worktree add --reason main ../wt`, `git worktree add --lock --reason main ../wt feat/x`.
- (b) `rules/push-setup.ts:200` → `helperRuns:500`. A `/` anywhere in a non-`!` helper value counts as "runs".
  - Allowed after the fix: `git config credential.helper 'store --file ~/.git-credentials'` and `cache --timeout=3600` (from git's docs).
  - Keep refusing a first word that is a path (`./x`, `/tmp/x`) and every shell metacharacter (K8 item 12).
- (c) `rules/git-clean.ts` `nestedBelow` with `gate.ts:90` `TREE_LIMITS.timeMs = 1000`. The time the git dry run takes is charged to the same tree budget.
  - So `git clean -ffd t` over about 9000 untracked folders with no nested repo is refused at about 1.08 s.
  - Fix: start the tree budget when the search starts, but keep it inside the per-call deadline (item 7). A search that hits the per-call deadline is still refused.

## 6. Flaky test (IRON LAW: fix the cause or delete)
- **Test:** `watcher/test/cli/tool-gate.cli.test.ts:186`, "should end the whole process group of a git the decision asked for, when the decision hangs (fix round 4, K2)".
- **Failure:** `started` file missing. It fails whenever the whole file runs under load, and passes alone.
- **Likely cause:** the same as the git-reader test fixed earlier this round. On macOS, the first run of a newly written script is held for a policy check, so the fake git hadn't started its child before the kill. That fix:
  - ran the fake git once, untimed (a `warm` argument), before the timed call;
  - wrote the pid file whole (`> pid.tmp && mv`);
  - asserted the pid is above 0;
  - used generous bounds.
- Apply the same fix, or delete the test if it can't be made reliable.
- Prove it: the whole file 10 times, plus a scoped run.

## 7. Tighter per-call deadline (user decision)
- Lower the per-call deadline from 1.5 s to **1.0 s**, and check it every **256** steps instead of every 1024 (`deadline.ts`, and wherever the constants live).
- Ordinary calls must not be affected.
- Update the tests that assert these values, and the DECISIONS.md ADR-011 text ("1.5 s" → "1.0 s, checked every 256 steps").

## Hard rules
- **No silent security deferrals.** If closing an item would refuse ordinary commands, STOP on that item and report it as "needs the user's decision". Report new gaps; don't fix them.
- **Cleanup:** remove ONLY the exact `mktemp -d` paths you stored, after checking that each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob.
- Run the dev-docs symlink guard before writing under `.oss/dev`. Add a NOTES.md entry "Fix part K12 (<date from date cmd>)". Never touch CLAUDE.md or any ndjson file. Never switch branches, stage, commit or push. Never use `git -C` in your own commands; using it inside a hook-JSON test input is fine.
- Ordinary calls must stay around 100 ms.
- When done:
  1. Run the scoped tests and tsc.
  2. Rebuild the bundle with `npm run build:cli-bundle`, then restore `watcher/dist/cli/oss-launch.cjs` with `git checkout --`.
  3. Re-run the scoped tests and name every failure.
  4. Run the full suite. Only model-frontmatter, offload-step-safety and chain-step-contract may fail.
  5. Run `pgrep -fl tool-gate.cjs; pgrep -fl vitest` and leave nothing of yours running.

## Report
- Each item: closed or "needs the user's decision", its RED reason, tests and files.
- New gaps.
- Existing tests changed, with the reason.
- The suite counts (naming any failures) and the tsc result.
- Timing for ordinary calls.
- The pgrep output.
