# Fix round 4, part K8: the LAST fix part (the user decided this on 2026-11-10)

These are the round-4 re-check findings at CRITICAL or HIGH, plus the fail-safe. Everything else is deferred by name; the orchestrator writes FOLLOWUPS. Follow `ship/fix-rules.md`.
- **Strict TDD.** Write each acceptance test first, in `watcher/test/cli/tool-gate.acceptance.test.ts` under the describe "tool-gate acceptance: fix round 4, K8". Run it through the real gate and watch it FAIL. Record the reason, then write the code.
- Put a "still allowed" case next to each refusal, and add unit tests.

Every repro below was confirmed through the real gate by a reviewer. File:line references come from their reports; verify them yourself.

## A. Fail-safe: no input may push the decision past the worker hard limit (CRITICAL)
Today a call whose decision runs past about 2.5 s is ALLOWED, with gate-error, and every rule is skipped (ADR-005). Close the whole class:
1. **A per-call deadline** (well under the hard limit, for example 1.5 s from the start of the call), checked inside every synchronous hot loop: the tokenizer, the command reader, the glob/pattern matchers, the path resolver and `tree-finder`.
   - Check it every N iterations (for example every 1024).
   - Going past the deadline throws the existing OverBudget, and the call is REFUSED as too complex.
   - Tests must be deterministic: inject a clock or a step counter. No wall-clock assertions.
2. **tree-finder** (`tree-finder.ts:45-48`). Read folders with `fs.opendirSync` and check the deadline and an entry budget every N entries. A folder it cannot read (EACCES) is unknown, which means refused, not empty (`:49`).
   - Repro: a folder with about 900k files plus `sub/.git`, then `rm -rf big; git push --force origin main`.
3. **expect script files** (`command-reader.ts:680-700`).
   - Read and tokenize each file once per call (cache by absolute path).
   - Count the bytes read from files, and the separator tokens, against one per-call scan budget.
   - Repro: `w.exp` holding 63 KB of newlines, then 400 × `expect w.exp;` then a push.
4. **repoTrust** (`repo-finder.ts:133`, `gate.ts:240`).
   - Cache the result per folder for the call.
   - Apply the existing path-length limit (4096 characters / 512 folders) to the folder git runs in. Over the limit, refuse as too complex.
   - Repro: `cd g/g/…(20000) && git commit;` × 8, then a push.

## B. Protected branches (HIGH)
5. **Case.** Match protected branch names case-insensitively whenever `ctx.caseInsensitive` is true (macOS). This applies in commit/push, `checkBranchRefs`, `checkHistoryMove` and `checkBranchSwitch` (`protected-branch.ts:61/217/350`).
   - Repro: `git symbolic-ref HEAD refs/heads/MAIN && git commit`, `git update-ref refs/heads/MAIN x`, `git branch -f MAIN feat`.
6. **Moves that reset a protected branch.** Refuse:
   - `git checkout -B <protected>` and `switch -C`/`--force-create <protected>`, from any branch;
   - `git fetch` with a refspec whose destination is a protected branch: `+x:main`, `x:refs/heads/main`, `-u`. The destination is matched case-insensitively per item 5;
   - `filter-branch`, `filter-repo`, `fast-import`, `subtree merge`/`pull`, `replace` and `reflog delete|expire` while on, or naming, a protected branch.

   Still allowed: `git fetch origin`, `git fetch origin main` (no destination), `git fetch origin main:refs/remotes/origin/main`, and `checkout -B feat/x`.
7. **pull.** The user decided this on 2026-11-10: on a protected branch, allow only `git pull` / `git pull --ff-only` / `--rebase` with no repository argument, or naming main's own upstream (the remote plus the same branch name, for example `origin main`). Refuse pulling `.`, a local path or `file://`, or another branch into a protected branch.

## C. Command reading (HIGH)
8. **`script -F`** (and `-T`, `-E`, `-I`, `-O`, `-B`, `-m`): fix `command-reader.ts:192-195`.
   - macOS script options are `[-aeFkqr] [-t time]`, so `-F` takes no value.
   - util-linux options take a value (`-t[file]` attached only; `-T`, `-I`, `-O`, `-B`, `-m`, `-E` with a value).
   - When the platform matters, choose the reading that refuses: read both ways and refuse if either sees a refused command.
   - Repro: `script -F /dev/null git push origin HEAD:main`, `script -t -c 'git push origin HEAD:main' log`.
9. **awk piping into a shell or interpreter** (`sed-awk.ts:373-383`). `print | "sh"`, `"bash -s"`, `"python3"` and the like have a script that is awk's output. Mark the part unreadable and risky.
   - Repro: `awk 'BEGIN{print "git push --force origin main" | "sh"}'`.
10. **expect.**
    - (a) `expect` with no script operand reads its script from stdin (a pipe, `<`, `<<<` or a heredoc). Mark it unreadable and risky, as for `-`.
    - (b) Tcl text: the gate's shell tokenizer treats `'` as a quote, but Tcl doesn't. Read expect text with Tcl word rules: only `"…"` and `{…}` quote, and `;` or a newline separates commands. If that's hard, make any expect text holding `'` unreadable.
    - Repro: `echo 'spawn git push --force origin main' | expect`, `expect -c "send 'x;exec git push --force origin main;'"`.
11. **echo escapes** (`command-reader.ts:964` `printedText`). zsh and macOS `/bin/sh` `echo` decode backslash escapes without `-e`. When a piped literal holds a backslash, read it as unreadable unless the escape is decoded exactly.
    - Repro: `echo 'git push origin HEAD:ma\0151n' | sh`.
12. **credential.helper without `!`** (`push-setup.ts:492`). git runs `git credential-<value>` through a shell, so refuse any shell metacharacter in the value (`;`, `&`, `|`, `$`, a backquote, `<`, `>`, a newline, parentheses).
    - Repro: `git -c credential.helper='store;python3 x.py' fetch`.
13. **CDPATH.** After `CDPATH=…` or `cdpath=(…)` (set for the cd, assigned earlier in the call, or exported) or when `CDPATH` is in the environment the gate sees, a `cd` to a relative name that doesn't start with `./` or `../` counts as a cd the gate can't follow (lost).
    - Repro: `CDPATH=.git cd hooks && echo x > pre-commit`.
14. **dotglob through a shell's own options** (`command-reader.ts:341-397` `dotGlobAfter`).
    - Read `bash -O dotglob`/`-Odotglob`/`+O`, `BASHOPTS=…dotglob…` (set for the shell or exported), `zsh -o globdots`/`--globdots`/`+o noglobdots` in any case, and `setopt dotglob` (zsh's name for GLOB_DOTS).
    - Look through `builtin`, `command` and `eval` (an `eval` with text the gate can't read means dotglob may be on).
    - Repro: `bash -O dotglob -c 'rm -rf *'` at the project root.
15. **awk and sed script files on protected operands** (`protected-path-mention.ts` `isReadOnly`). `gawk -f x.awk <protected>`, `-E`, `--exec` and `sed -f s.sed <protected>`: a script file can `@include "inplace"` (gawk) and edit the operand in place, so they are not read-only on a protected operand. Treat them like `python3 x.py <protected>`, which is refused.
    - `gawk -f x.awk data.csv` stays allowed.

## Hard rules
- **No silent security deferrals.** If closing an item would refuse ordinary commands, STOP on that item and report it as "needs the user's decision". Report new gaps; don't fix them.
- **Cleanup:** remove ONLY the exact `mktemp -d` paths you stored, after checking that each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob. A reviewer wiped part of `$TMPDIR` this way.
- Run the dev-docs symlink guard before writing under `.oss/dev`. Add a NOTES.md entry "Fix round 4 (K8, <date from date cmd>)". Never touch CLAUDE.md or any ndjson file. Never switch branches. Never use `git -C`.
- Ordinary calls must stay around 100 ms.
- When done:
  1. Run the scoped tests and tsc.
  2. Rebuild the bundle with `npm run build:cli-bundle`, then restore `watcher/dist/cli/oss-launch.cjs` with `git checkout --`.
  3. Run the full suite. Only model-frontmatter, offload-step-safety and chain-step-contract may fail.
  4. Run `pgrep -fl tool-gate.cjs; pgrep -fl vitest` and leave nothing of yours running.

## Report
- Each item: closed or "needs the user's decision", its RED reason, tests and files.
- New gaps.
- Existing tests changed, with the reason.
- The suite counts and the tsc result.
- Timing for ordinary calls.
- The pgrep output.
