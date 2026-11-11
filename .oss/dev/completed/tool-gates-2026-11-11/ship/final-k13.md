# /oss:ship K13: fix final-review findings 1-3 (tool-gates, R-253)

User decision (2026-11-11): a small K13 for findings 1-3, then the PR. Findings 4-7 go to FOLLOWUPS (Claude appends them). No other changes: no refactors, no new rules, nothing outside these three items.

Repo `/Users/ysl/dev/oss-plugin-tool-gates`, branch `feat/tool-gates/build`, uncommitted working tree (all ship rounds). Do NOT stage, commit or push. No `git -C`. No bare `git stash`.

TDD: for each item, write the failing test first (acceptance tests through the real gate in `watcher/test/cli/tool-gate.acceptance.test.ts`, new describe "K13"; unit tests next to the module where useful), see it fail, then minimal code. Tests must use realistic input: no frozen clocks, no mocks that differ from real tool output.

## Item 1: the "No failing test recorded" refusal gives advice that can't work
- `watcher/src/tool-gate/rules/red-cycle.ts:16` `NO_RUN` tells the agent to ask the user to add the command to `.oss/tool-gates.json`. But `rule-file.ts:104` rejects `testCommandPatterns` in a repo file, and a rejected repo file is dropped whole (its other added protections stop applying).
- Fix the message only. Do not loosen `merge()`. New text, in plain words:
  "Refused: No failing test recorded in this build. Write a failing test and run it with a test command, unpiped (for example `npx vitest run <file>` or `pytest <file>`). A command that names a test file or has the word test, spec or check in it, and fails, is taken as this build's test command."
  Adjust it so it is true for the code as it stands (check `recorder.ts` adoption rules: what exactly counts, and whether a pipe stops recording). Do not mention `.oss/tool-gates.json`.
- Update DESIGN.md (RED rule bullet "No recorded run yet…" and the "No lockout" bullet's last sentence) so they match the new text and no longer tell anyone to add a test command to the repo file. Keep the rule-file bullet (line ~53) as is.
- Grep for the old text elsewhere (tests, docs, commands/*.md) and update matches.

## Item 2: common test runners aren't recorded
- `config/tool-gates.json` `testCommandPatterns` misses: `python3 -m pytest`, `python -m unittest`, `python3 -m unittest`, `uv run pytest`, `poetry run pytest`, `pnpm vitest`, `pnpm exec vitest`, `pnpm exec jest`, `pnpm jest`, `yarn vitest`, `yarn jest`, `npx --no vitest`?? (skip unusual ones), `./node_modules/.bin/vitest`, `./node_modules/.bin/jest`, `bunx vitest`.
  Add the plain, common ones. Read how patterns match (prefix? glob? args after?) in `recorder.ts`/`patterns.ts`, and add exactly what is needed for `<runner> run <file>` and `<runner> <file>` forms to record.
- Piped runs: `npx vitest run 2>&1 | tail -20` is recorded as unknown. Decide from the code which is safer:
  (a) record it when the pipe's later commands are plain readers (`tail`, `head`, `grep`, `cat`, `tee <file>`, `less`), using `PIPESTATUS`-free reasoning: the hook's exit code is the LAST command's, so a pipe hides the test's exit code. Therefore do NOT record a piped run as red or green.
  So the fix is: keep not recording it, but make the refusal say "run tests unpiped" (item 1's text covers this). If the post hook can tell a piped test run was skipped, no extra work is needed beyond the message.
- Do not widen adoption (`TEST_WORDS`) beyond what the tests need.
- Tests: each added runner form records red on a failing run (through the real gate pre+post), and a piped run stays unrecorded.

## Item 3: `rm -rf "$d"` is refused by accident with advice that can't help
- `tree-finder.ts:~67` `entriesOf` gets a path with the `\0DYN\0` placeholder (from `protected-path.ts:~260`); `readdir` throws `ERR_INVALID_ARG_VALUE`, which becomes OverBudget "the gate can't list …" and the reason says the command is too complex, split it.
- Behaviour decision (user): KEEP refusing a recursive write whose target the gate can't read (a variable), but give it its own clear reason, e.g.
  "Refused: `rm -rf` on a path the gate can't read (`$d`). A recursive delete must name its folder literally, so the gate can check it holds no .git or protected file. Write the path out, for example `rm -rf /tmp/tmp.abc123`."
  Detect the placeholder before any disk access (do not let it reach `readdir`), for every recursive writer that goes through this path (`rm -r`, `chmod -R`, `chown -R`, `find … -delete`, and whichever others share the code). Same rule for an unreadable target that is NOT recursive must not change.
- Tests: `d=$(mktemp -d) && rm -rf "$d"`, `chmod -R u+w "$X"` and `find "$X" -delete` are refused with the new reason (not "too complex"); `rm -rf /literal/tmp/dir` still allowed as before; `rm "$f"` (non-recursive) unchanged.
- Add a Known Limits line in DESIGN.md: a recursive write to a variable path is refused; name the folder literally.

## Finish
- `cd watcher && npx vitest run test/tool-gate test/cli test/hooks` all green; `./node_modules/.bin/tsc --noEmit -p .` clean.
- Rebuild the bundle: `npm run build:cli-bundle`, then `git checkout -- watcher/dist/cli/oss-launch.cjs` (run from the repo root for the checkout). The dist test `test/hooks/tool-gate-dist.test.ts` must pass.
- Append a "Fix part K13" entry to `.oss/dev/active/tool-gates/NOTES.md` (what changed, files, tests).
- No `any`, no `console.log`, no `.skip`/`.only`.
- Leave no processes: `pgrep -fl tool-gate.cjs; pgrep -fl vitest` before you finish (vitest runs under other folders belong to other sessions; leave them alone).
- Cleanup rule: remove ONLY exact `mktemp -d` paths you stored, after checking each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob.
- If anything needs a refusal-behaviour choice not covered here (an over-refusal you'd keep or a loosening), STOP and report it instead of choosing.

Report: per item, what changed (file:line), the tests added, the final test/tsc counts.
