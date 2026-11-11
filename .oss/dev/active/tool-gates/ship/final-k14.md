# /oss:ship K14: variable inside a wildcard on a recursive write (tool-gates, R-253)

User decision (2026-11-11): a tiny K14 for this one gap only, then the PR. Nothing else: no refactors, no other writers, no runner changes.

Repo `/Users/ysl/dev/oss-plugin-tool-gates`, branch `feat/tool-gates/build`, uncommitted working tree. Do NOT stage, commit or push. No `git -C`. No bare `git stash`.

## The gap (reproduced by two reviewers through the real gate)
K13 refuses a recursive write whose target, or the fixed folder before a recursive glob, holds the variable placeholder (`watcher/src/tool-gate/rules/protected-path.ts` ~269/277, `unreadableFolder`). But when the variable sits in the wildcard part, `splitPattern` (~105-109) puts the placeholder in `rest`, not `prefix`, so the check never fires, and the tree search treats the placeholder as literal text and never matches `.git`. These are allowed (exit 0) and must be refused:
`rm -rf ${d}*`, `rm -rf "$d"*`, `rm -rf ./${d}*`, `rm -rf .${d}*`, `rm -rf ${d}.*`, `chmod -R 777 ${d}*`, `find ${d}* -delete`, `chmod -R u+w */"$d"`.
With `d=git`, `rm -rf .${d}*` deletes `.git`, while the literal `rm -rf .*` is refused.

## Fix
- Also refuse, with the same `unreadableFolder` reason (name the folder literally), when the glob's wildcard part (`rest`) holds the placeholder. Check before any disk search.
- Keep everything else: literal globs (`rm -rf build/*`, `rm -rf dist*`) behave as before; non-recursive `rm "$d"*` behaves as before (do not change it; if you find it is affected, STOP and report).
- DESIGN.md Known Limits line (~146) must stay true: a recursive write to a folder or glob named by a variable is refused.

## TDD
RED first: add the 8 commands above to the K13 acceptance describe in `watcher/test/cli/tool-gate.acceptance.test.ts` (refused with the new reason) and a unit case in `watcher/test/tool-gate/rules/protected-path.test.ts`; see them fail; then the minimal code. Pin tests: `rm -rf build/*`, `rm -rf dist*` and `rm "$d"*` keep their current result.

## Finish
- `cd watcher && npx vitest run test/tool-gate test/cli test/hooks` all green; `./node_modules/.bin/tsc --noEmit -p .` clean.
- `npm run build:cli-bundle` (from `watcher/`), then from the repo root `git checkout -- watcher/dist/cli/oss-launch.cjs`. `test/hooks/tool-gate-dist.test.ts` passes.
- Run the dev-docs symlink guard from CLAUDE.md BEFORE editing `.oss/dev/` files, then add a "Fix part K14" entry to `.oss/dev/active/tool-gates/NOTES.md`.
- No `any`, no `console.log`, no `.skip`/`.only`.
- Leave no processes: `pgrep -fl tool-gate.cjs; pgrep -fl vitest` (runs under other folders belong to other sessions; leave them alone).
- Cleanup rule: remove ONLY exact `mktemp -d` paths you stored, after checking each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob.
- Note: Claude Code's own rm-safety check may block Bash strings containing `rm -rf "$d"`; drive those cases through the vitest tests, not ad-hoc shell probes.

Report: what changed (file:line), tests added, RED evidence, final test/tsc counts.
