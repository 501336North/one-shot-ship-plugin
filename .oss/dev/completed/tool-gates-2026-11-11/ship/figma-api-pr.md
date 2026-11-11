# API PR: move the Figma context out of `.oss/workflow-state.json` (follow-up of tool-gates R-253)

## Why
The plugin's new tool-gate (Sprint D, plugin repo, branch `feat/determinism-sprint/build`) protects `.oss/workflow-state.json` against writes by the agent (reads stay allowed). The served `/oss:ideate` Figma prompt writes the Figma context into that file, so once the gate ships the write is refused and the Figma carry-over to build/ship/visual-qa breaks. User decision (2026-11-09): keep the file protected and move the Figma data to its own file. FOLLOWUPS line (plugin repo): "protecting workflow-state.json blocks the Figma context write (ideate-figma.md:320) … move it to its own file (e.g. .oss/figma-context.json) and update the reads (ship.md:843, visual-qa.md:44, build.ts:659)". Line numbers are from 2026-11-10; find the real places.

## Repo and branch
- Repo: AgenticDevWorkflow (the API). Its main checkout `/Users/ysl/dev/AgenticDevWorkflow` is busy with another feature, and other worktrees belong to other sessions: do NOT touch them.
- Create your own worktree: from `/Users/ysl/dev/AgenticDevWorkflow` run `git fetch origin main` then `git worktree add /Users/ysl/dev/AgenticDevWorkflow-figma-context -b fix/figma-context-file/build origin/main`, and work only there. Never `git -C`; `cd` into it.
- Install deps there if needed (follow the repo's own README/package manager).
- Base for the PR: `main` (the API has no Sprint D branch).

## What to change
1. Find every place in the served prompts and server code that writes or reads the Figma context in `.oss/workflow-state.json` (grep for figma / workflow-state across prompts and src; the four places above are the known ones).
2. Write: the Figma prompt writes the context to its own file, `.oss/figma-context.json` (pick this name unless the repo already has a better convention; say so).
3. Reads (build, ship, visual-qa, and any others): read `.oss/figma-context.json` first; if it is missing, fall back to the old field in `.oss/workflow-state.json`, so features ideated before this change still work. API main serves every customer now, and most customers do not have the gate yet.
4. Nothing else: no other refactors, no version bumps beyond what the repo's release process requires for a prompt change (check the repo's CLAUDE.md / contributing docs and follow them).

## Rules
- Follow the repo's CLAUDE.md (TDD: failing test first, then minimal change; behaviour tests, no mocking internal logic; no `any`).
- Prompts may be encrypted/served: follow the repo's documented way to edit and test them.
- Never put chosen values into shell commands; commit and PR text go through files written with the Write tool (`git commit -F file`, `gh pr create --body-file file`). Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NxUFjToNxCUHgMeFipMS1f`. PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and the session link.
- Run `git branch --show-current` before every git write; never commit or push on main.
- Push the feature branch and open the PR: `gh pr create --base main --head fix/figma-context-file/build`. Do NOT merge it: API main deploys to production and the user merges it.
- Run the repo's full test suite and type check before pushing; report results honestly (pre-existing failures: say which and show they also fail on origin/main).
- Leave no processes running (`pgrep` for your test runners before you finish).
- Cleanup rule: remove ONLY exact `mktemp -d` paths you stored, after checking each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob. Keep the worktree.

## Report
The PR URL, every file changed (file:line) and why, the tests added, test/type-check results, and anything you were unsure about.
