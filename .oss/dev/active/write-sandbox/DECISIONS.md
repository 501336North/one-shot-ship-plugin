# Decisions: OS write-sandbox

Numbering continues from least-privilege-tools (ADR-069).

## ADR-070: OS write-deny sandbox for main-agent and builder Bash, plugin-controlled

**Date:** 2026-11-18
**Status:** Accepted (user picks Q1, Q3, Q4, 2026-11-18)

### Context
The tool gate decides whether a Bash call writes a protected path by reading shell text. Since round 15, every new shell trick has been filed instead of fixed (ADR-048, ADR-066). Review agents already run under an allowlist Seatbelt profile (`sandbox.ts`, ADR-022 and its successors). The main agent and builders don't, and they need to write freely in the project, temp and caches.

### Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Our Seatbelt write-deny wrap via `updatedInput`, plus detection of Claude Code's sandbox | Plugin-controlled. Reuses the review wrap's machinery. No user settings touched. | macOS only. Seatbelt can't nest under Claude Code's sandbox. `sandbox-exec` is deprecated. | Best |
| Configure Claude Code's sandbox (`denyWrite`, `allowUnsandboxedCommands:false`) from /oss:login | Covers Linux (bwrap). Built-in. | A plugin can't ship settings, so it would mean editing customers' settings. It also changes network rules and prompts for everything. | Poor |
| Document Claude Code's sandbox, don't wrap | Least code | No guarantee for customers who don't opt in | Poor |

Evidence: the Claude Code docs (sandboxing, settings-reference, hooks), via the claude-code-guide agent on 2026-11-18. Hooks run unsandboxed. `updatedInput` replaces the tool input. The sandbox covers Bash only, not Edit or Write.

### Decision
On macOS, the gate wraps each main-agent and builder Bash call in an inline Seatbelt profile. The profile allows writes everywhere except the OS deny set (ADR-071), matched by case-insensitive regex on resolved paths, firmlink spelling included, with link creation into or out of a denied path refused.

If Claude Code's sandbox is on, covers the deny set and has `allowUnsandboxedCommands: false`, it counts as the OS layer. Every other case runs today's text rules and shows one notice per session:
- Linux or WSL2;
- a failed self-test;
- a missing `sandbox-exec`;
- the session turning the sandbox off;
- Claude Code's sandbox on but not covering the deny set.

Linux bubblewrap is a separate card.

### Consequences
- **Positive:** the OS closes the shell-trick class for code-run and gate-config paths.
- **Positive:** a sandbox failure never bricks Bash.
- **Negative:** Linux and Windows keep the text-only gate.
- **Negative:** each wrapped call costs a little time (cap: p95 under 50 ms).
- **Negative:** the design depends on `sandbox-exec`, as the review sandbox already does.
- **Accepted limit:** hard links made before the session.

## ADR-071: The OS deny set, with git-only calls left unwrapped

**Date:** 2026-11-18
**Status:** Accepted (user picks Q5, Q7, 2026-11-18)

### Context
`git commit` writes refs, HEAD and packed-refs. OSS's own scripts write `.oss/workflow-state.json`. `git push -u`, `remote add` and `worktree add` write `.git/config`. The OS can't tell those programs apart from a disguised write.

### Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| OS denies code-run and gate-config paths. Git-only calls run unwrapped. | Git and OSS scripts keep working. `core.hooksPath` tricks are closed in mixed calls. | husky's npm setup (`git config core.hooksPath`) is refused inside a non-git call | Best |
| OS denies the whole protected list | Strongest | Breaks `git commit` and 243 of 702 served blocks that call OSS state scripts | Poor |
| Leave git config to the text gate | Nothing new refused | The `core.hooksPath` hole stays open | Decent |

### Decision
The OS deny set:
- `.git/hooks/**` and every git config file;
- `.claude/settings*.json`, `~/.claude/settings*.json` and `~/.claude/plugins/**`;
- `~/.oss/hooks/**`, `.oss/tool-gates*`, `~/.oss/gate-state/**` and `~/.oss/node-path`;
- the phase-results folder and the ledger.

Refs, HEAD, packed-refs, commondir, gitdir and `workflow-state.json` stay with the text gate. A call made only of git commands (plus `cd`) runs unwrapped under the text rules, where the git reader vets it.

### Consequences
- **Negative:** a new allowed→refused case, accepted by the user: `git config` inside a non-git call (husky setup). The refusal message says to run it as its own call. The served-command BEFORE/AFTER run must show no other new refusal.

## ADR-072: A narrowed text-gate loosening inside the wrap

**Date:** 2026-11-18
**Status:** Accepted (user pick Q2, refined by Q9 after a heads-up, 2026-11-18)

### Context
Q2 let the OS decide protected paths, so the text gate would stop refusing write targets it can't read. A heads-up during requirements showed the gap: refs, HEAD and `workflow-state.json` aren't OS-denied (ADR-071), so a disguised write to `.git/refs/heads/main` would pass both layers.

### Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Narrow: allow an unreadable target only when its readable last part rules out the text-only files | Fixes the `mktemp` fallback over-refusal and keeps refs and HEAD guarded | Array writes (fully unreadable targets) stay refused. The rule needs a security review. | Best |
| No loosening | No gap | Every filed over-refusal stays | Decent |
| OS-deny refs, HEAD and workflow-state too | Strongest | The 16 served ship blocks that mix git writes with other programs need rewriting. OSS-script calls would need routing. | Poor |

### Decision
Inside the wrap, an UNKNOWN write target is allowed only when its readable last part is not `HEAD`, `packed-refs`, `commondir`, `gitdir`, `workflow-state.json` or a protected branch name (`main`, `master`, from `protectedBranches`). A fully unreadable target stays refused. Every other text rule is unchanged.

### Consequences
- **Positive:** the `mktemp` fallback and `((` over-refusals go away.
- **Negative:** ADR-069's array-write refusal stays.
- **Negative:** a protected-branch list change must flow into this rule. Read it from config, never hard-code it.
- **Required:** a one-shot security review before merge (the ADR-067/068 pattern: revert on a hole).

## ADR-073: OSS-only calls unwrapped, so results/ and the ledger can be OS-denied

**Date:** 2026-11-18
**Status:** Accepted (user pick Q10 during /oss:plan, 2026-11-18)

### Context
R-257 writes `.oss/dev/active/<feature>/results/` and `~/.oss/ledger/` from `oss-phase-result.sh assemble`, which the main agent runs through Bash. `oss-node.sh` writes `~/.oss/node-path`, and the gate scripts write gate-state. Wrapping those calls with an OS deny on these paths would break them.

### Research
| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| OSS-only calls run unwrapped, and results/ and the ledger are OS-denied for every other call | The OS protects results from disguised writes. OSS's scripts keep working. The text rules already vet these calls (oss-hook-env). | About 17 mixed served blocks need the BEFORE/AFTER check | Best |
| Keep results/ and the ledger off the OS list | Simplest | results/ has no OS protection. Only the ledger is text-protected (D22). | Decent |

### Decision
A call made only of `~/.oss/hooks/*` and `~/.oss/bin/*` scripts (plus `cd`, `unset` and plain assignments) runs unwrapped under the text rules. The OS deny set gains `**/.oss/dev/active/*/results/**` and `~/.oss/ledger/**`.

### Consequences
- The router has two unwrapped shapes: git-only calls and OSS-only calls.
- Any new refusal among the mixed served blocks stops the build for the user's call.
- This depends on R-257 merging into Sprint D, which brings the results and ledger code.

## Related
ADR-048, ADR-066, ADR-067, ADR-068, ADR-069 (least-privilege-tools), and R-257 D22 (results/ protection).

## ADR-074: Plan pre-gate decisions (supersedes the unwrapped shapes of ADR-071 and ADR-073)
**Status:** Accepted (user picks D1-D6, 2026-11-18) · **Source:** PLAN_GATE.md
**Context:** one round of the four ship gates over the plan found that unwrapped git-only and OSS-only calls, renames of parent folders, files run later outside the wrap, out-of-sandbox helper processes and a writable toolchain each defeat the OS layer.
**Decision:** wrap every main-agent and builder call (git-only and OSS-only get small, named write allowances); widen the deny set (D2, D6); deny launchd/LaunchServices/mount/tmux escapes (D5); keep Claude Code's permission checks (D3); count only managed Claude Code sandbox settings, with no loosening under it (D4); plan fixes F1-F14.
**Consequences:** more customer calls run inside the sandbox; Task 9's BEFORE/AFTER now runs blocks, and any new failure STOPs for the user. Ship gates read PLAN_GATE.md.
