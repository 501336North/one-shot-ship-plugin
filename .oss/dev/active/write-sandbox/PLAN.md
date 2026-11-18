# Implementation Plan: OS write-sandbox for main-agent and builder Bash

## Summary
On macOS, the tool gate wraps each main-agent and builder Bash call in an inline Seatbelt write-deny profile, so the OS refuses writes to code-run, gate-config and phase-results paths, whatever the shell text says.
- Git-only and OSS-only calls stay unwrapped under today's text rules.
- Inside the wrap, the text gate allows unreadable targets whose readable last part can't name a text-only file.
- Every other platform or failure case falls back to the text rules, with one notice.

## Design Reference
`DESIGN.md` (COMMITTED), `REQUIREMENTS.md`, and `DECISIONS.md` ADR-070 to ADR-073. Card: FOLLOWUPS line 359 (pulled 2026-11-18).

## Preconditions
- **R-257 merged into plugin `feat/determinism-sprint/build`.** It brings `~/.oss/ledger/**` in `protectedPaths`, the results store and `oss-phase-result.sh`. Rebase this branch onto it before Task 1. Until then, build only Tasks 1–3, which don't need R-257's paths.
- Branch for the build: `feat/write-sandbox/build`, from `origin/feat/determinism-sprint/build`. The PR goes into that branch, never `main`.
- **Test rules:** never run the full watcher suite. Run targeted `npx vitest run <files>` from `watcher/`. macOS-only rows follow the existing `sandbox*.integration.test.ts` pattern for platform guards; no `.skip`, `.only` or `.todo`.

## TDD Implementation Tasks

### Phase A: The profile (no gate changes)

#### Task 1: Write-deny profile
**Objective:** a pure function that renders the builder profile from the deny set (US-001, AC-001.3).
**RED** (`watcher/test/tool-gate/write-sandbox-profile.test.ts`):
- should allow writes by default and deny each deny-set path, as a case-insensitive regex
- should deny the `/System/Volumes/Data` spelling of every home and repo path
- should refuse creating a link (`file-link`/hard link) into or out of a denied path
- should leave network, reads and process rules as Seatbelt's defaults (no `deny network*`, no read rules)
- should escape regex metacharacters in a home or repo path (`.`, `+`, `(`, `[`)

**GREEN:** `builderSandboxProfile(places: { homes: string[]; repos: string[] }): string` in `sandbox.ts`. The deny set is a constant in a new `watcher/src/tool-gate/write-deny-set.ts`, read once.
**REFACTOR:** share `sbString`/escaping with `reviewSandboxProfile`.

#### Task 2: Hermetic OS rows (macOS)
**Objective:** prove the OS refuses the filed tricks and allows normal writes (AC-001.1, AC-001.2, edge cases).
**RED** (`watcher/test/tool-gate/write-sandbox.integration.test.ts`), each run as `sandbox-exec -p <profile> bash -c …` in a scratch HOME and scratch repo:
- refuses, for each deny-set path, a plain write, round-20 IFS, `${TMPDIR:-.git/hooks}`, `${X-…}`, an array, `printf -v`, mixed case `.GIT/HOOKS`, `/System/Volumes/Data/…`, a symlink in the project pointing into a denied folder, and `ln`/`ln -s` into a denied folder
- allows writes to the repo, temp, `~/.npm`-style caches and `node_modules`
- `git commit` inside the wrap works (refs and HEAD aren't OS-denied); `git config x.y z` inside the wrap is refused
- a nested repo's `.git/modules/x/config` is refused

**GREEN:** fix the profile until every row passes.

#### Task 3: Self-test and containment
**Objective:** a trusted wrap or an explicit reason why not (US-004).
**RED** (`write-sandbox-containment.test.ts`, with the runner injected as a collaborator mock):
- should be `ok` when a denied probe write fails and an allowed probe write succeeds
- should be `unavailable` with reason `linux` / `windows` / `no-sandbox-exec` / `self-test-failed` / `session-off`
- should run the self-test once per session (cached by session id) and re-run in a new session
- should treat a planted or tampered probe folder as `self-test-failed`

**GREEN:** `builderContainment(opts, run = realRunner)`, modelled on `reviewContainment`.

### Phase B: Gate integration (needs R-257 on Sprint D)

#### Task 4: Router
**Objective:** each call takes the right path (AC-003.1, ADR-071, ADR-073).
**RED** (`write-sandbox-router.test.ts`, gate-level with `GateDeps`):
- a review agent's call keeps today's review sandbox (byte-identical to before)
- a git-only call (`git …`, `cd x && git …`) as the main agent and as a builder is not rewritten
- an OSS-only call (`~/.oss/hooks/…`, `~/.oss/bin/…`, plus `cd`/`unset`/plain assignments) is not rewritten
- a mixed call as the main agent or a builder on macOS with an `ok` containment returns `updatedInput` with the wrapped command and `permissionDecision: allow`
- on Linux, or with `unavailable` containment, the call is not rewritten and the text rules decide

**GREEN:** a `writeContainment` branch in `gate.ts` next to the review branch, reusing `wrapCommand`.

#### Task 5: Claude Code sandbox detection
**Objective:** respect Claude Code's own sandbox (US-005).
**RED** (`write-sandbox-host.test.ts`, with settings files in a scratch HOME):
- sandbox on + `filesystem.denyWrite` covering every deny-set path + `allowUnsandboxedCommands: false` → no wrap, and the loosening (Task 7) applies
- sandbox on but not covering, or `allowUnsandboxedCommands` missing or true → no wrap, text rules, notice reason `host-sandbox-incomplete`
- sandbox off → our wrap
- managed settings win over user settings

**GREEN:** extend `hostSandboxOn` into `hostSandbox(): { on; coversDenySet; locked }`.

#### Task 6: One notice per session
**Objective:** the user learns, once, that the write sandbox is off and why (AC-004.2).
**RED:**
- the first fallback call in a session adds a notice line naming the reason
- later calls with the same reason add none
- a new session notices again; a different reason in the same session notices once more

**GREEN:** a notice marker in `~/.oss/gate-state/<session>/`, using the gate's existing message channel. No new output path.

#### Task 7: Narrowed loosening inside the wrap (ADR-072)
**Objective:** the over-refusals go away without opening refs, HEAD or workflow-state (AC-002.1, AC-002.2, AC-002.3).
**RED** (`write-sandbox-loosening.test.ts`, main agent and builder, wrapped context):
- allows `mktemp "${TMPDIR:-/tmp}/x.XXXXXX"`
- allows a `"x\((a|$)"` grep next to an `~/.oss/hooks` call
- refuses `files=(a b); rm $files` (fully unreadable)
- refuses `x=${R:-.git/refs/heads}; echo > "$x/main"`, and the same for `HEAD`, `packed-refs`, `commondir`, `gitdir` and `workflow-state.json`
- reads protected branch names from config (`protectedBranches`): a test config with `release` refuses `…/release`
- outside the wrap (text-only context), every case above is refused exactly as today

**GREEN:** a `wrapped: boolean` context flag passed into `protected-path.ts`. At the two `UNKNOWN` early returns (`unreadableFolder`), allow when wrapped and the readable last part passes the check.

#### Task 8: The git-config refusal message
**Objective:** a clear message for the accepted husky case (AC-003.2, Q7).
**RED:** a wrapped mixed call that hits a denied `.git/config` write shows the OS error, and the gate's post-message tells the agent to run `git config …` as its own call. Test the message text the gate adds for wrapped calls.
**GREEN:** a fixed hint line appended to a wrapped call's description.

### Phase C: Proof

#### Task 9: Served-command BEFORE/AFTER
**Objective:** no silent tightening for customers (US-006, Q10 mixed blocks).
**RED:** extend `served-commands.acceptance.test.ts`, with `OSS_API_REPO` set when the fixture changes. Every served block is run through the gate as the main agent and as a builder, in both modes, with and without the wrap. Assert the set of newly refused blocks is empty except the documented Q7 case. Any other new refusal fails the test, and the build stops for the user's call.
**GREEN:** fix the router or loosening only. Never add to `KNOWN_REFUSED` without the user.

#### Task 10: Timing cap
**Objective:** p95 added time under 50 ms (NFR).
**RED** (`write-sandbox.speed.test.ts`): 40 wrapped `true` calls against 40 unwrapped; assert p95 added time < 50 ms, with a 3× margin on a loaded machine documented in the test (zero tolerance for flakiness).
**GREEN:** cache the profile per session.

#### Task 11: Bundle, probe and docs
**Objective:** what ships is what was tested.
- `npm run build` rebuilds `watcher/dist/cli/tool-gate.cjs`. Run the scratchpad probe (`p19/probe.mjs`) for the main agent and `oss:typescript-pro` over the filed bypasses.
- Add the Linux bubblewrap card and the hard-link limit to `.oss/dev/FOLLOWUPS.md`.
- After the build, a separate pass, with the user's OK, marks which of the ~40 gate-limit follow-ups the OS now covers.
- Update the `sandbox.ts` header comment: "Builders and the main agent are never wrapped" is no longer true.

## Testing Strategy
- **Unit:** profile rendering, containment, router, host detection, notice, loosening.
- **Integration (macOS, real `sandbox-exec`):** the Task 2 rows, plus a live `git commit` and push to a local bare remote.
- **Acceptance:** served-command BEFORE/AFTER (Task 9).
- **Edge cases:** case-insensitive paths, firmlinks, symlinks, links, nested repos, background jobs (the reused process-group wrapper), a planted probe folder.
- **Never:** the full watcher suite (its setup pkills OSS processes machine-wide).

## Security Checklist
- [ ] The profile is inline (`-p`); there is no file to tamper with.
- [ ] The deny set is a code constant, plus the protected branch names from config (ADR-072).
- [ ] Fallback never runs a call with fewer protections than today.
- [ ] A one-shot security review of the profile, router and loosening before merge (ADR-067/068 pattern: revert on a hole). Security findings are never self-deferred.

## Performance Considerations
- [ ] The self-test runs once per session. The profile is cached. p95 added time is under 50 ms (Task 10).

## Rollout Strategy
- Ships inside Sprint D (plugin 2.3.0), and reaches customers only with the Sprint D→main merge.
- Kill switch: the existing session-off setting, which turns the wrap off. Fallback is today's text rules.
- Rollback: revert the PR on the Sprint D branch.

## Implementation Sequence
1. Phase A, Tasks 1–3: no dependency on R-257; can start right after plan approval.
2. Rebase onto Sprint D once R-257 merges.
3. Phase B, Tasks 4–8.
4. Phase C, Tasks 9–11, then /oss:ship with a security review.

## Estimated Tasks: 11
## Estimated Test Cases: ~70
