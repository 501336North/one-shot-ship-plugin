# Requirements: OS write-sandbox for main-agent and builder Bash

From DESIGN.md (COMMITTED 2026-11-18).

## Actors
| Actor | Description |
|-------|-------------|
| Customer | Runs OSS commands in Claude Code. Their session's main agent and builders run Bash. |
| Main agent / builder | Claude, or a builder subagent (typescript-pro and others), running Bash calls the gate checks. |
| Review agent | Gate and review agents. They keep today's allowlist sandbox and are unchanged. |
| Attacker text | A prompt, a repo file or a tool output that steers an agent to write a protected path with a shell trick. |

## User Stories

### US-001: The OS refuses protected-path writes (Must, Large)
**As a** customer
**I want** main-agent and builder Bash writes to code-run and gate-config paths refused by macOS itself
**So that** no shell trick can plant a git hook, change the gate's rules or alter my Claude Code settings.

- **AC-001.1:** Given macOS, Claude Code's sandbox off and a passing self-test, when a main-agent or builder Bash call writes any OS deny-set path through any filed trick (the round-15+ bypasses, round-20 IFS, `${X-…}`/`${X:-…}` fallbacks, arrays, `printf -v`, mixed case, `/System/Volumes/Data/…`, a symlink, `ln` into a denied folder), then the write fails with an OS error and the file is unchanged.
- **AC-001.2:** Given the same, when the call writes anywhere else (project files, temp, tool caches), then the write succeeds.
- **AC-001.3:** The deny set is: `.git/hooks/**`, every git config file (`.git/config`, `config.worktree`, `worktrees/*/config.worktree`, `modules/**/config`, `~/.gitconfig`, `~/.config/git/config`), `.claude/settings*.json`, `~/.claude/settings*.json`, `~/.claude/plugins/**`, `~/.oss/hooks/**`, `.oss/tool-gates.json`, `.oss/tool-gates/**`, `~/.oss/gate-state/**`, `~/.oss/node-path`, and the phase-results folder and ledger.

### US-002: No over-refusals inside the sandbox (Must, Medium)
**As a** customer
**I want** ordinary commands whose write targets the gate can't read to run when the OS sandbox guards them
**So that** my agents aren't stopped by safe commands.

- **AC-002.1:** Inside the wrap, `mktemp "${TMPDIR:-/tmp}/x.XXXXXX"` and a `"x\((a|$)"` grep next to an `~/.oss/hooks` call are allowed.
- **AC-002.3 (Q9):** Inside the wrap, an unreadable target is allowed only when its readable last part isn't `HEAD`, `packed-refs`, `commondir`, `gitdir`, `workflow-state.json` or a protected branch name. A fully unreadable target (`files=(a b); rm $files`) stays refused. `x=${R:-.git/refs/heads}; echo > "$x/main"` is refused.
- **AC-002.2:** Inside the wrap, every other rule still refuses as today: protected branches, test files, git refs, HEAD, packed-refs and `workflow-state.json` writes, and Edit/Write rules.

### US-003: Git keeps working (Must, Small)
**As a** customer running /oss:ship
**I want** `git commit`, `git push -u`, `git remote add` and `git worktree add` to work
**So that** shipping isn't broken by the sandbox.

- **AC-003.1:** A call made only of git commands (plus `cd`) runs unwrapped under today's text rules.
- **AC-003.2:** A call that mixes git with other programs is wrapped. A `git config` write inside it is refused by the OS, and the message says to run `git config` as its own command.

### US-004: Safe fallback with one notice (Must, Small)
**As a** customer on Linux, WSL2 or a Mac where the sandbox can't run
**I want** my agents' Bash to keep working under today's rules, with one notice telling me the write sandbox is off and why
**So that** a sandbox problem never stops my session.

- **AC-004.1:** Linux, Windows, a failed self-test, a missing `/usr/bin/sandbox-exec`, or the session turning it off: the call runs under today's text rules.
- **AC-004.2:** Exactly one notice per session per reason.

### US-005: Respect Claude Code's own sandbox (Should, Small)
- **AC-005.1:** Claude Code's sandbox is on, its `filesystem.denyWrite` covers the deny set and `allowUnsandboxedCommands` is false: the call is not wrapped (Seatbelt can't nest), and US-002 applies.
- **AC-005.2:** Claude Code's sandbox is on but doesn't cover the deny set: today's text rules apply, with one notice.

### US-006: No new refusals for customers (Must, Small)
- **AC-006.1:** Served-command BEFORE/AFTER, over the full fixture, for the main agent and a builder: no new allowed→refused, except the accepted Q6 case (`git config` inside a non-git call).

## Edge Cases
| Scenario | Expected Behavior |
|----------|-------------------|
| Case-insensitive APFS: `.GIT/HOOKS/x` | Denied (case-insensitive regex) |
| `/System/Volumes/Data/Users/…/.git/hooks/x` | Denied |
| A symlink in the project pointing into `~/.oss/hooks` | The write through it is denied (the resolved path is checked) |
| A hard link to a protected file made before the session | Not caught (accepted limit). A new link into or out of a denied path is denied. |
| A background job outliving the call | Ended with the call's process group (reused wrapper) |
| A nested repo or submodule `.git/modules/x/config` | Denied |
| `git -C sub config …` in a git-only call | Text rules (git reader), as today |
| The self-test planted or tampered with | Treated as failed, so fallback plus notice |

## Non-Functional Requirements
- **Performance:** p95 added time per wrapped call under 50 ms. The self-test runs once per session.
- **Security:** the profile is inline (`-p`), with no file the agent can change. It gets a one-shot security review before merge (ADR-067/068 pattern: revert on a hole).
- **Reliability:** no flaky tests. Timing assertions use generous margins.

## Out of Scope
- Linux bubblewrap (its own card), Edit/Write tools, network and read limits for the main agent and builders, changes to review agents' sandbox.

## Dependencies
- `watcher/src/tool-gate/sandbox.ts` (the existing review wrap and the Claude Code settings read), `gate.ts` (the router), `config/tool-gates.json` (protected paths).
- The R-257 phase-results folder and ledger paths, which reach Sprint D through R-257's merge.

## Open Questions
- [ ] The exact phase-results folder and ledger paths. Take them from R-257's merged code at plan time.
