# Notes: tool-gates (R-253)

## From /oss:plan (2026-11-09)
- **Base branch:** every R-253 PR targets `feat/determinism-sprint/build`, never `main` (Sprint D rule, confirmed by the OSS DETERMINISTIC session). Wherever `/oss:ship` says main, use the sprint branch.
- **Never emit `permissionDecision: "allow"`.** It skips the user's permission prompt. Allow = exit 0 with no stdout.
- **Verify before Task 17 GREEN:** the PreToolUse field that shows text to the agent without deciding (planned: `hookSpecificOutput.additionalContext`). Ask `claude-code-guide`, and record the answer here.
- **Verify in R-267:** `PostToolUseFailure` payload shape (`error: "Exit code N…"`, `is_interrupt`) was seen on Claude Code 2.1.319; a later version could change it.
- **Not covered by the RED rule:** Bash writes onto source files (`sed -i`, `>`, `cat <<EOF > src/x.ts`). The design limits the RED rule to the edit tools. If R-267 shows agents routing around it this way, raise it as a follow-up.
- **Push without a refspec** checks the current branch only. An upstream that points at `origin/main` from a feature branch is allowed (requirements edge case).
- **`watcher/` test config runs single-fork and sequential.** Temp repos must be unique per test (`mkdtemp`), never shared paths.
- **Ship gates for `hooks/*.sh`:** run all of `watcher/test/hooks` with `CLAUDE_PROJECT_DIR` unset (FOLLOWUPS #64 lesson).

## Last Updated: 2026-11-09 14:22 CST by /oss:plan
