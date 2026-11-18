# Feature: OS write-sandbox for main-agent and builder Bash

Status: COMMITTED (2026-11-18 12:14 CST)

Card: plugin `.oss/dev/FOLLOWUPS.md` "OS write-sandbox for main-agent and builder Bash" (R-266 follow-up, ADR-048, ADR-066), plus the "OS write-sandbox card" addition blocks. Lands on `feat/determinism-sprint/build` via PR, never `main`.

## Problem
The tool gate decides whether a main-agent or builder Bash call writes a protected path by reading the shell text. Shell has endless ways to hide a write target (computed IFS names, `${X-…}` fallbacks, arrays, `printf -v`), so since round 15 every newly found trick has been filed instead of fixed (ADR-048, ADR-066). The same text-reading also over-refuses ordinary commands whose targets it can't read: the `mktemp "${TMPDIR:-/tmp}/x.XXXXXX"` fallback (ADR-068), array writes (ADR-069), `((` inside double quotes next to an `~/.oss/hooks` call. Review agents already run under an OS sandbox (`watcher/src/tool-gate/sandbox.ts`, allowlist Seatbelt). The main agent and builders don't.

## Solution
On macOS, the gate rewrites each main-agent and builder Bash call (via PreToolUse `updatedInput`, as it already does for review agents) to run under a new inline Seatbelt **write-deny** profile. The OS then refuses writes to the paths that could run code or change the gate, whatever the shell text says. Inside the wrap, the text gate stops refusing write targets it can't read, which ends the over-refusals.

## Approach (user picks, 2026-11-18)
- **Q1, Approach:** our own Seatbelt wrap, plus detection of Claude Code's own sandbox. The plugin can't set Claude Code's sandbox settings. Seatbelt can't nest.
- **Q2, Text gate inside the wrap:** the OS decides protected paths. All other rules stay.
  - **Refined after the stress test (Q9, "Narrow the loosening"):** inside the wrap, an UNKNOWN write target is allowed only when its readable last part rules out the text-only files: not `HEAD`, `packed-refs`, `commondir`, `gitdir`, `workflow-state.json`, or a protected branch name (`main`, `master`).
  - A fully unreadable target, such as array `rm $files`, stays refused.
  - The reason: refs, HEAD and workflow-state aren't OS-denied, so an unrestricted loosening would let a disguised write to `.git/refs/heads/main` pass both layers.
- **Q3, Fallback:** if the wrap can't be trusted (self-test fails, `sandbox-exec` missing, the session turned it off), the call runs under today's text rules with one notice per session. It never refuses all Bash.
- **Q4, Linux and WSL2:** text gate plus the notice. The bubblewrap version (read-only binds over the deny set) is its own card.
- **Q5, Deny set:** the OS denies code-run and gate-config paths. The text gate keeps refs, HEAD, packed-refs, commondir, gitdir and `.oss/workflow-state.json`, because git and OSS's own scripts write them legitimately.
- **Q6, Git config:** a call made only of git commands (plus `cd`) runs unwrapped under today's text rules, where the git reader vets each git command. Every other call is wrapped with git config denied.

## Components
- **`sandbox.ts`:** a new write-deny profile builder for main agent and builders, next to the review allowlist profile. Writes are allowed everywhere except the OS deny set. Network, reads and env are unchanged. The process-group wrapper is reused.
- **OS deny set**, matched by case-insensitive regex on the resolved path, including the `/System/Volumes/Data` firmlink spelling. Creating a link into or out of a denied path is refused:
  - `**/.git/hooks/**`, `**/.git/config`, `**/.git/config.worktree`, `**/.git/worktrees/*/config.worktree`, `**/.git/modules/**/config`, `~/.gitconfig`, `~/.config/git/config`;
  - `.claude/settings*.json`, `~/.claude/settings*.json`, `~/.claude/plugins/**`;
  - `~/.oss/hooks/**`, `.oss/tool-gates.json`, `.oss/tool-gates/**`, `~/.oss/gate-state/**`, `~/.oss/node-path`;
  - the phase-results folders `**/.oss/dev/active/*/results/**` and the ledger `~/.oss/ledger/**` (R-257 D22).
- **OSS-only calls (plan pick Q10):** a call made only of `~/.oss/hooks/*` and `~/.oss/bin/*` scripts, plus `cd`, `unset` and plain assignments, runs unwrapped under today's text rules. Those rules already pin HOME and PATH for these scripts (`oss-hook-env`).
  - This is needed because OSS's own scripts write results, the ledger, `node-path` and gate-state: `oss-phase-result.sh assemble` runs through Bash.
  - About 306 of the 323 served blocks that call OSS scripts are OSS-only. The roughly 17 mixed ones are checked by the served-command BEFORE/AFTER run.
- **Router in `gate.ts`:**
  - review agent → unchanged;
  - git-only call → unwrapped, text rules;
  - main agent or builder on macOS with a trusted wrap → wrapped, and the UNKNOWN write-target refusals are skipped for the deny set;
  - anything else → text rules plus the notice.
- **Claude Code sandbox detection:** extends today's `sandbox.ts` settings read. If Claude Code's sandbox is on, its `filesystem.denyWrite` covers the OS deny set and `allowUnsandboxedCommands` is false, it counts as the OS layer. Otherwise the text rules apply, with the notice.
- **Self-test:** once per session, cached. Proves that a denied write fails and an allowed write succeeds.
- **Notice:** one line per session, saying the write sandbox is off and why.

## Success Criteria
- [ ] Every bypass filed since round 15 is refused by the OS when run as the main agent and as a builder (hermetic rows).
- [ ] The filed over-refusals pass inside the wrap: the `mktemp` fallback and `((` in double quotes. Array writes with a fully unreadable target stay refused (Q9).
- [ ] Inside the wrap, a disguised write whose target could be `.git/refs/heads/main`, `HEAD`, `packed-refs` or `workflow-state.json` is still refused by the text gate (Q9).
- [ ] `git commit`, `git push -u`, `git remote add` and `git worktree add` still work.
- [ ] Served-command BEFORE/AFTER, for the main agent and a builder: no new allowed→refused except husky-style `git config core.hooksPath` inside a non-git call (accepted, Q6). The refusal says to run `git config` as its own command.
- [ ] The fallback paths each give text rules plus exactly one notice per session: Linux, a failed self-test, Claude Code's sandbox on but not covering.
- [ ] Added time per call: p95 under 50 ms.

## TDD Test Plan
- [ ] Profile unit tests: the deny set renders as case-insensitive regexes, including the firmlink spelling; no allow rule opens a denied path.
- [ ] Hermetic macOS rows (scratch HOME and repo): each deny-set path is written by shell tricks, including round-20 IFS, `${TMPDIR:-.git/hooks}`, arrays, `printf -v`, mixed case, `/System/Volumes/Data/…`, a symlink, and `ln` into a denied folder. Every one is refused by the OS.
- [ ] Controls: writes to the project, temp, `~/.npm` and other caches succeed; the over-refusal commands pass.
- [ ] Router: review agent unchanged; git-only call unwrapped; mixed call wrapped; Linux and a failed self-test fall back with one notice.
- [ ] Claude Code sandbox detection: on and covering → OS layer; on and not covering → text rules plus notice; off → our wrap.
- [ ] Served commands acceptance: BEFORE/AFTER over the whole fixture for the main agent and a builder.
- [ ] Timing test: p95 added time under 50 ms, with a generous margin so it isn't flaky.

## Accepted limits (stress test, user 2026-11-18)
- **Hard links made before the session**, outside a denied folder, aren't caught by path rules. Making a new link into or out of a denied path is refused.
- **Apple deprecates `sandbox-exec`.** Review agents already depend on it, so the exposure is the same as today. A break becomes the text-gate fallback, never a bricked session.
- **Per-call cost:** the self-test runs once per session, with a measured cap.

## Out of Scope
- The Linux bubblewrap wrap (its own card).
- Edit and Write tools, which keep the gate's rules.
- Network and read limits for the main agent and builders.
- Git refs, HEAD, packed-refs, commondir, gitdir and `workflow-state.json`, which stay with the text gate.
- Changing review agents' sandbox.

## Dissent Records
None. Every stress-test concern was resolved by a user pick (Q6) or accepted as proposed.
