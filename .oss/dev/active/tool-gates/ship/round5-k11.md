# Fix part K11: the last fix part (the user decided this on 2026-11-10)

These findings come from the round-5 re-check of K8-K10. The user chose to fix three groups and then ship. Every other round-5 finding is deferred by name; the orchestrator writes FOLLOWUPS for them. Follow `ship/fix-rules.md`.
- **Strict TDD.** Write each acceptance test first, in `watcher/test/cli/tool-gate.acceptance.test.ts` under the describe "tool-gate acceptance: fix part K11". Run it through the real gate and watch it FAIL. Record the reason, then write the code.
- Put a "still allowed" case next to each refusal, and add unit tests.
- **Fix the class, not the input.** Round 5 showed that K8 fixes which matched only the reported spelling were beaten by grouped flags, abbreviations, `+=` and case. For each item, read options the way the real program parses them: getopt clusters, unambiguous long-option prefixes, attached values and case where the platform folds it. Test several spellings.

## Group A: the gate must not allow a call because it ran out of time (HIGH)
1. **`STRING_LITERAL` regex** (`watcher/src/tool-gate/rules/protected-path-mention.ts:124`, used at `:285` `literalsOf` and `:327` `literalCount`). The regex is quadratic on an unclosed `"\"\"\"…` body.
   - Repro: a 100 KB heredoc to `python3` whose body is `"\"\"…` and is never closed, then `git push origin HEAD:main`. Today the decision runs past the 2.5 s hard limit and the call is ALLOWED with gate-error.
   - Fix:
     - Make the scan linear: a hand scanner that calls `tick()`, or let an unclosed string run to the end, e.g. `"((?:[^"\\]|\\[\s\S])*)(?:"|$)`.
     - Scan the literals once rather than twice.
     - Count heredoc and stdin script bodies toward the per-call text cap.
   - Then check every other regex run on agent text (command, heredoc and script bodies, file contents) for the same nested-quantifier shape, and fix any you find.
   - The test is deterministic: use the injected clock or step counter, plus one real-bundle check that the 100 KB repro is refused in well under 1.5 s.
2. **Info, cheap:** `repo-finder.ts:105-108` `findRepo` catches the `OverBudget` that `tick()` throws and turns it into `unsure`. Let OverBudget through so the reason reads "too complex".

## Group B: near-misses in K8's own fixes (HIGH)
3. **Force-create of a protected branch** (`rules/protected-branch.ts`, `forceCreated` / `FORCE_CREATE_ATTACHED` ~:291).
   - Read `-B`/`-C` anywhere in a short cluster (`-qB main`, `-fB main`, `-qfB main`, `-tB main origin/main`, `-Bmain`).
   - Read `--force-create` and its unambiguous prefixes on switch (`--force-c`, `--force-cr=main`).
   - Still allowed: `checkout -qB feat/x`, `switch -fC feat/x`.
4. **Tcl backslash escapes in expect text** (`command-reader.ts`, `tclCommands` / `TCL_UNREAD_QUOTED`). `"HEAD:ma\151n"`, `\x69` and `i` decode in Tcl. Either decode Tcl escapes exactly, or treat any backslash inside a quoted or bare Tcl word as unreadable (risky).
   - Still allowed: an expect script with no backslashes.
5. **CDPATH, every form** (`command-reader.ts`, `cdpathAfter`). Cover:
   - `CDPATH+=…`;
   - zsh `cdpath+=(…)`, `cdpath[1]=…`, `typeset -a cdpath=(…)`, `typeset cdpath=…`, `declare`/`export`/`local` with these;
   - a `CDPATH` holding a variable or `$PWD`, which counts as set.
6. **dotglob, every form** (`command-reader.ts`, `shellDots` / `dotGlobAfter`).
   - Read option clusters as getopt does: `bash -eO dotglob`, `bash -xO dotglob`, `zsh -eo globdots`, `zsh -fo globdots`, `zsh -Go globdots`, `zsh -4c`. Each `o`/`O` in a cluster takes the next word; zsh `-4` means globdots.
   - Skip value options before the setting, e.g. `bash --rcfile x -O dotglob -c`.
   - Read the zsh forms `options[globdots]=on` and `emulate … -o globdots`.
   - Read `GLOBIGNORE=…` as a prefix of a shell command, the same as the assigned form; bash turns dotglob on whenever GLOBIGNORE is set and not empty.

## Group C: shortcuts an agent could plausibly take
7. **Rebase or worktree that switches to a protected branch and rewrites it.** Refuse these from ANY branch:
   - `git rebase <upstream> <protected>`, `git rebase --onto x y <protected>` and `git rebase -i --root <protected>`, where the branch operand is a protected name (case-insensitive per K8);
   - `git worktree add -B <protected> …`, and the `-b` form when the name is protected.
   - Still allowed: `git rebase main` on a feature branch (the operand is the upstream), and `git rebase main feat/x`.
8. **`git clean -ff` over a nested repo** (`git-reader.ts:161-173` `wouldClean` and the git-clean protected-path check). With `-f` given twice (`-ff`, `-f -f`, `--force --force`), git deletes nested repositories, but the dry run only prints the top folder (`Would remove t7/`). For each folder the dry run lists, search below it with the same tree-finder used for `rm -rf` (budgeted, refuse on a nested `.git`).
   - Still allowed: `git clean -fd build` with no nested repo, and a single `-f` (git keeps nested repos).
9. **`git config` writes of `credential.helper`** (`rules/push-setup.ts:36-48`, `PUSH_KEYS` leaves out `credential.*`). Apply the same helper checks (K5, K8 item 12, K9, K10) to every write form:
   - `git config [--local|--global|--system|--file f|--worktree] [--add|--replace-all] credential[.<url>].helper <value>`;
   - `git config set …`.
   - Also confirm that `git config --global …` (any key) writing `~/.gitconfig` is handled as a protected-path write, if `~/.gitconfig` is protected. Report what you find; don't change that rule.
   - Still allowed: `git config credential.helper osxkeychain`, `'!gh auth git-credential'`, `store`.

## Hard rules
- **No silent security deferrals.** If closing an item would refuse ordinary commands, STOP on that item and report it as "needs the user's decision". Report new gaps; don't fix them.
- **Cleanup:** remove ONLY the exact `mktemp -d` paths you stored, after checking that each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob.
- Run the dev-docs symlink guard before writing under `.oss/dev`. Add a NOTES.md entry "Fix part K11 (<date from date cmd>)". Never touch CLAUDE.md or any ndjson file. Never switch branches, stage, commit or push. Never use `git -C` or `git stash`.
- Ordinary calls must stay around 100 ms.
- When done:
  1. Run the scoped tests (`cd watcher && npx vitest run test/tool-gate test/cli test/hooks`) and tsc (`./node_modules/.bin/tsc --noEmit -p .`).
  2. Rebuild the bundle with `npm run build:cli-bundle`, then restore `watcher/dist/cli/oss-launch.cjs` with `git checkout --`.
  3. Re-run the scoped tests after the rebuild, and name every failing test. The round-5 auditor saw one unnamed scoped failure.
  4. Run the full suite (`npx vitest run`). Only model-frontmatter, offload-step-safety and chain-step-contract may fail.
  5. Run `pgrep -fl tool-gate.cjs; pgrep -fl vitest` and leave nothing of yours running. vitest under AgenticDevWorkflow-ship-followups belongs to another session; leave it alone.

## Report
- Each item: closed or "needs the user's decision", its RED reason, tests and files.
- New gaps.
- Existing tests changed, with the reason.
- The suite counts (with the names of any failures) and the tsc result.
- Timing for ordinary calls.
- The pgrep output.
