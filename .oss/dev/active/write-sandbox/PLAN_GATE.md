# Plan pre-gate: write-sandbox (round 1 of 1, 2026-11-18)

One round of the four ship gates (code review, security, pen test, performance) over the PLAN, before any code.
**Ship gates must read this file.** Items under "Accepted" are user-accepted risks: ship gates let them through and do not re-raise them. Items under "Fixed in plan" must be built as written: a ship gate flags any that the code doesn't honour.

## Raw counts
| Gate | Findings |
|---|---|
| Code review | 4 HIGH, 5 MEDIUM, 1 LOW |
| Security | 1 CRITICAL, 6 HIGH, 2 MEDIUM |
| Pen test | 3 CRITICAL, 4 HIGH, 3 MEDIUM (2 verified with sandbox-exec) |
| Performance | 2 HIGH, 3 MEDIUM, 1 LOW, 2 INFO |

## Fixed in plan (no choice needed: bugs in the plan)
- F1 **Rename past the deny (pen CRIT, verified; sec HIGH).** Deny `file-write*` (incl. unlink and rename) on each denied folder and every folder above it inside the repo/HOME: `.git`, `.git/hooks`, `.oss`, `~/.oss`, `~/.claude`, `~/.config/git`, `results`. Task 2 rows: `mv .git g; …; mv g .git`, `mv ~/.oss/hooks h.old`.
- F2 **No `(?i)` in Seatbelt (perf HIGH, pen verified).** Render letter classes (`[gG][iI][tT]`). Task 1 compiles every rendered profile with real sandbox-exec.
- F3 **Git config deny breaks `git init`/clone elsewhere (perf HIGH).** Deny git config and hooks only in the session's repos, their worktrees and modules, and HOME. Task 2 controls: `git init` in TMPDIR, an npm git dependency.
- F4 **`.git` file / `gitdir` / `commondir` (sec HIGH).** OS-deny creating, replacing or unlinking a `.git` entry in a project repo and its `commondir`/`gitdir`.
- F5 **Builder wrapper ≠ review wrapper (CR HIGH).** New wrapper: no `env -i`, the user's shell and env, background jobs survive, cwd carries over, no `oss-review` label. Live rows for cwd, an env var, a background job. Golden byte-identical test of today's review profile and wrap before Task 1's refactor.
- F6 **Self-test (perf MED, pen HIGH, CR MED).** Probe in a fresh `mkdtemp`. Cache only a clean `ok`, in `~/.oss/gate-state/<session>/` (OS-denied), keyed by session, profile hash and OS build. Never cache a failure; a timeout means text rules for that call plus a retry, no notice.
- F7 **Loosening (pen HIGH, sec MED, CR LOW).** Only single-file redirect targets; never recursive or folder destinations (`rm -r`, `cp -R`, `mv`, `tar -C`, `unzip -d`). Case-insensitive name compare. Refuse when any readable part is under `.git` or `.oss`, or when UNKNOWN is in the last part. Rows: `MAIN`, `HE${x}AD`, `rm -rf "$d/refs"`, branch names with slashes.
- F8 **A loosened allow must carry the wrap (sec MED).** If the wrapped `updatedInput` can't be built, refuse.
- F9 **Task 9 runs blocks, not just decisions (CR HIGH).** The 16 git-write and 17 OSS-mixed served blocks run wrapped in a scratch repo.
- F10 **Speed test (perf, CR MED).** Warm up, interleave paired runs, assert median of paired differences < 50 ms; p95 is reported only. Time the hook's own work in-process; exclude a session's first call.
- F11 **Platform guards (CR MED).** Only real sandbox-exec rows use `runIf(ON_MAC)`; router, host, notice and loosening tests inject platform and runner.
- F12 **R-257 split (CR MED).** Results and ledger rows come after the rebase. A test asserts every OS-denied entry is in `protectedPaths` or a listed exception.
- F13 **AC gaps (CR MED).** Live `git commit`, `push -u`, `remote add`, `worktree add` through the gate; session-off and `dangerouslyDisableSandbox` reasons; Task 8's hint is a fixed note added before the call runs.
- F14 **Profile size (perf LOW).** Unanchored patterns (`/\.git/hooks(/|$)`), cap under 32 KB, compile under 15 ms with 2 homes × 5 repos.

## Decisions for the user (picker, 2026-11-18)
- D1 Unwrapped shapes → **Wrap them too, small allowance.** Git-only calls get a profile that also allows the project repo's `.git/config` writes (push -u, remote add, worktree add); OSS-only calls one that allows only the OSS state files they write. Supersedes the unwrapped parts of ADR-071/073 (ADR-074).
- D2 Deny set → **Widen to all:** `~/.claude/**`, `~/.claude.json`, `.mcp.json`, project `.claude/**`, `~/Library/LaunchAgents/**`, shell rc files (`~/.zshenv`, `~/.zshrc`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`), `~/.oss/**` except the listed state files, `.oss/dev/completed/*/results/**`.
- D3 Permissions → **Keep Claude Code's checks.** `updatedInput` without `allow`; Task 4 starts with a live probe. If Claude Code needs `allow` to apply it, check the user's rules against the original command, and STOP to ask before going on.
- D4 CC sandbox → **Managed settings only, no loosening.** `excludedCommands` empty and `allowUnsandboxedCommands: false` required; text rules unchanged under it.
- D5 Escapes → **Deny them, test what breaks:** launchd submit, LaunchServices, DiskArbitration/mounts, tmux/screen sockets. STOP on any served command that breaks.
- D6 Toolchain → **Deny real paths of node (node-path), git, bash**, resolved once per session.
- Out of this plan (user picks, same round): the existing `${R:-.git/refs/heads}` gap and an env allowlist on OSS hook calls go in the plugin-root fix PR now.

- Heads-up (2026-11-18): Task 9 also runs an everyday-commands set (npm/npx/cargo/pip/brew/open/tmux/~/.zshrc/code/docker/make/git clone/gh), STOP on any new failure.

## Accepted
- None. Every finding was fixed in the plan or by a decision above.

## Last Updated: 2026-11-18 by plan pre-gate
