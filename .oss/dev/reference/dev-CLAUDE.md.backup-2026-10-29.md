<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->

# IRON LAWS - NON-NEGOTIABLE

These laws are **NON-NEGOTIABLE**. Violating the spirit of these rules IS violating the letter.

**Enforcement Mode:** Announce + Auto-Correct (no user confirmation required)

---

## IRON LAW #1: Test-Driven Development (TDD)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

**The Cycle: RED-GREEN-REFACTOR**

| Phase | Action | Verification |
|-------|--------|--------------|
| RED | Write failing test | Test MUST fail |
| GREEN | Write **MINIMAL** code | Test MUST pass |
| REFACTOR | Clean up code | Tests STILL pass |

**GREEN Phase - MINIMAL Means MINIMAL:**

```
WRITE THE ABSOLUTE MINIMUM CODE TO MAKE THE TEST PASS
```

**MINIMAL is not a suggestion - it is a requirement:**
- Write ONLY enough code to satisfy the failing test
- No "while I'm here" additions
- No gold-plating or future-proofing
- No extra features, helpers, or abstractions
- If you can pass with 3 lines, don't write 10

**Signs you're NOT writing MINIMAL code:**
- Adding error handling the test doesn't require
- Creating abstractions for "reusability"
- Adding configuration options not under test
- Implementing edge cases not yet tested
- Writing helper functions not strictly needed

**TDD Red Flags - STOP and Start Over:**
- Code written before test
- Test passes immediately (didn't see it fail)
- "I'll add tests later"
- "This is too simple to test"
- **Writing more than MINIMAL code in GREEN phase**

**NEVER:** skip tests or mark them `.skip()` / `.todo()` / `.only()`; commit code with failing tests.

**Self-Correction:** If code exists without tests, DELETE IT and restart with TDD. If you wrote more than MINIMAL, delete the extras.

**EVERY code change goes through `/oss:build` — including fixes during `/oss:ship`.**

```
NO CODE ADD / EDIT / DELETE OUTSIDE A RED-GREEN-REFACTOR CYCLE
```

This is not a preference about tooling. It is the only mechanism that makes a fix **GUARDED** rather
than merely **VERIFIED**, and those are different properties:

| | verified | guarded |
|---|---|---|
| means | "I ran it and it behaved" | "a test goes red if it regresses" |
| survives | this session | the next person to touch the file |

**Measured, 2026-09-06 (oss-lab, R-002/R-003 ship).** A `/oss:ship` run failed its quality gates. The
findings were fixed by editing files directly and confirming each fix in the shell — code first, test
never — and the commit claimed "every fix verified by MUTATION against real code." An independent gate
then REVERTED those fixes one at a time and the suite stayed green at 270/4874/0 every time, including
the revert of the fix for the round's own headline defect (`OSS_REPO_TIER_DIR` defaulting, without which
the whole feature is inert). A second gate reverted three more with the same result: **8 of 9 fixes were
correct and completely unguarded.** The same round also silently DELETED an existing assertion, invisible
because the suite's test count happened to stay the same.

In that same session, three changes that DID go through a RED-first cycle each acquired a guard that
killed its own mutation. The correlation was total, with no counterexample in either direction. Writing
the fix first does not merely risk skipping the test — it reliably skips it, because a fix that already
passes produces no pressure to write one.

**Gate findings are TASKS, not errands.** `/oss:build` reads `.oss/dev/active/{feature}/PLAN.md`, so a
`/oss:ship` fix round MUST first append its findings there as tasks and then run `/oss:build`. "I will
just fix these quickly" is the exact move that produced the result above.

### RUNNING `/oss:build` MEANS INVOKING IT. IMITATING IT DOES NOT COUNT.

```
IF `build.log` HAS NO NEW `init` LINE, THE ROUND DID NOT GO THROUGH /oss:build
```

The command is not a synonym for its discipline. **Invoking it** means the Skill tool / slash command,
**once per fix round**. The following are NOT invoking it, however faithfully they follow RED-GREEN-REFACTOR:

| Substitution | Why it is not the command |
|---|---|
| Spawning an agent whose prompt opens *"You are executing /oss:build"* | the agent runs a paraphrase; nothing fetched, nothing logged |
| Re-using the prompt decrypted in an earlier round | the prompt is versioned server-side and its Step 0 changes |
| Performing RED-GREEN-REFACTOR by hand, correctly | the discipline is a PART of the command, not the whole of it |
| Appending findings to `PLAN.md` and then fixing them | that is the PRE-condition the law already states, not the act |

**What is lost by imitating it** — all of it silent: `oss-log.sh init build` (the supervisor goes blind);
`oss-notify.sh --workflow build …` (no status line, and the IRON LAW compliance checklist that auto-logs
on `complete` never runs); the CURRENT decrypted prompt (Step 0's gap analysis and dev-doc dream pass);
**`LEARNINGS.md` capture, which the prompt requires DURING the build**; and the `---CHAIN_COMMANDS---`
block, so any configured post-build chain never fires.

**THE OBSERVABLE — this law is checkable, and must be checked.** Every invocation writes a banner to
`.oss/logs/current-session/build.log`. Count the banners, count the fix rounds; they must be equal:

```bash
grep -c 'OSS Command: /oss:build' .oss/logs/current-session/build.log
```

**Use that exact spelling.** The first draft of this law said "count the `init` lines" — `oss-log.sh init
build` is the COMMAND, but the string it writes is the banner, so `grep -c init` returns **0 immediately
after a genuine invocation**. Verified 2026-09-16 against a real run: `OSS Command: /oss:build` = 1,
`^init` = 0. A check that cannot see a real invocation is the unverified claim this law exists to prevent,
written into the law itself — which is why the spelling is pinned here rather than described.

**Measured, 2026-09-16 (oss-lab, mutation-coverage rounds 1-5).** Four `/oss:ship` gate rounds produced
34 → 22 → 19 → 14 findings. Every finding was appended to `PLAN.md` as a task, every fix went through
RED-GREEN-REFACTOR with an anti-vacuity control, and every round was delegated to specialist agents — the
substance of this law was honoured throughout. **`/oss:build` was invoked exactly ONCE, in round 1.**
Measured at round 5: `build.log` held **1** init line, its last entry was round 1's Wave 4, and
**`LEARNINGS.md` had ZERO entries for the entire session** while `PLAN.md` — which is gitignored —
accumulated 90+ findings. Four rounds of the most expensive lessons this repo has produced went into a
file that does not survive the branch.

Nothing failed. Nothing reddened. The law said "run `/oss:build`" and something that *looked* like
`/oss:build` ran instead, for four rounds, in the repo whose own thesis is that **a comment is not a
guard**. That is why this section exists and why it ends in an observable rather than an instruction.

**Self-Correction:** if a fix round is complete and `build.log` gained no `init` line, say so plainly in
the report — the fixes may be correct but the workflow was NOT exercised, and on this repo that means the
product shipped untested by its own pipeline (IRON LAW #5b). Do not retro-fit the log. Invoke the command
for the next round and capture the missed `LEARNINGS.md` entries before shipping.

**Self-Correction:** if you have already edited code outside a `/oss:build` cycle, STOP. Write the
failing test for the change you made, revert the change, confirm the test goes RED, restore the change,
confirm it goes GREEN. If the test cannot be made to fail, the change is unguarded and must be reported
as unproven — never as "verified".

**Outside-In Workflow (London):**

```
1. Start at system boundary (API endpoint, UI)
2. Write acceptance test calling the boundary
3. Mock the first collaborator
4. Implement → discover next collaborator → mock it
5. Work inward until hitting external boundaries
6. Integration tests validate mocked interactions
```

---

---

## IRON LAW #1b: Provenance Check (TDD's blind spot)

```
BEFORE CHANGING WHERE A VALUE OR DECISION COMES FROM,
FIND EVERY OTHER SITE THAT COMPUTES OR ASSERTS IT
```

TDD forces a test for the change you made. It does **not** force you to discover that the same
question is answered in four other places. **One site changed out of N is a defect even when the test
passes** — and the test passing is exactly what makes it invisible.

**Triggers — run the check whenever a change:**

| Trigger | Example |
|---------|---------|
| Normalises, folds, trims, or parses an identifier | case-folding a repo name before comparing it |
| Changes provenance | copy → derive, inline → shared helper, one writer → two |
| Adds/edits a denylist, allowlist, or enum | a new rc in a classifier; a path in a tamper floor |
| Alters an early exit in a loop | a `break`/`continue` that forecloses a later observation |
| Changes an output contract | a message, an exit code, a field another site greps |

**The check itself is cheap — a grep and a sentence:**

1. `grep` the codebase for every other site that computes or asserts the same value.
2. State in the commit body what you found and why each other site is correct as-is, or change it too.
3. If two sites now answer the same question differently, that is the defect. Fix by extracting ONE
   shared helper — not by patching the site you happened to be looking at.

**Measured, 2026-09-07 (oss-lab, per-repo-tier-scope round 3).** A round that put **every** change
through `/oss:build` — 51 assertions, all RED-first, all verified non-vacuous by an independent gate —
still shipped two new defects, and both were this shape:

- The self-repo identity compare was normalised in `lib/tier-scope.sh` and in **none** of the three
  other places that decide the same question (`bin/lab-build` `_tier_self`, `_self_merge_kernel_paths`,
  `bin/drain-settings`). Before the change all four agreed because all four were naive; **the fix is
  what made them disagree.** Result: `owner/repo.git` — the ordinary clone spelling — read as "not the
  self repo", switching OFF `SELF_DENY`, so a caged build could author `lib/*.sh` that the host sources
  at startup. Host code execution, in the one repo with auto-merge to main. The RED-first test for the
  lib was correct and passed throughout.
- A retry cap added a `break` that foreclosed a third observation, silently breaking the
  order-independence property (`124,124,1` → 124 but `1,124,124` → 20) that three assertions elsewhere
  in the same file exist to enforce. Its own new test passed.

Both were caught by independent gates, not by the suite. The lesson is not "write more tests" — the
tests were written and were good. It is that **a test proves the site you changed; only a grep proves
the sites you didn't.**

**Self-Correction:** if a gate reports that two places disagree about the same value, do not patch the
one it named. Extract one helper, route every site through it, and add an assertion at the level where
the disagreement was observable — not only at the level you edited.

## IRON LAW #2: Test Philosophy - Behavior Over Implementation

**Before Writing ANY Test, Answer:**

| Question | Required Answer |
|----------|-----------------|
| What USER BEHAVIOR does this verify? | [Must document] |
| What BUSINESS RULE does this encode? | [Must document] |
| Would this survive a complete rewrite? | Must be YES |
| Is this readable to non-engineers? | Must be YES |

**Cannot answer these? DO NOT write the test.**

**Mock Policy (London TDD):**

| Mock This | Don't Mock This |
|-----------|-----------------|
| Service dependencies | Value objects |
| Repository interfaces | Simple data structures |
| External API clients | Pure functions |
| Collaborators | The unit under test |

**Self-Correction:** If tests mock internal modules or business logic, REMOVE the mocks and test real code.

❌ **NEVER** mock internal modules or business logic — mock collaborators (db, external services) at their interface, not the unit under test.

**No `any` Types - Including Pre-Existing:**
- Finding `any` types in the codebase does NOT excuse adding more
- Pre-existing `any` types MUST be fixed before shipping
- "It was already there" is NOT a valid excuse
- Delegate to `typescript-pro` agent to fix type violations
- If you see `any`, fix it NOW - no tech debt tickets, no "later"

**Flakiness = Zero Tolerance:**
- Flaky test = broken test
- DO NOT retry hoping it passes
- EITHER fix root cause OR delete the test
- **Deleted test > flaky test**

**Common Flaky Test Causes & Fixes:**

| Cause | Fix |
|-------|-----|
| Shared test data (e.g., `test@example.com`) | Use unique data per test: `\`test-${Date.now()}@example.com\`` |
| Timing/performance assertions | Use generous thresholds or test behavior not timing |
| Race conditions in parallel tests | Ensure test isolation, use unique identifiers |
| Database state pollution | Clear all tables including new ones (check schema) |
| External service dependencies | Mock external services, never rely on real APIs in tests |

**Self-Correction:** When a flaky test is found, STOP and fix it immediately. Do not proceed with other work until the test is solid.

---

## IRON LAW #3: Loop Detection Protocol

**Agents can get stuck. Watch for these patterns:**

- Same tool called 5+ times with no progress
- Polling same resource for >60 seconds
- Same error message 3+ times
- Build/test commands hanging

**Self-Correction:**
1. Kill stuck processes (`KillShell`)
2. Switch to synchronous commands
3. Add explicit timeout
4. Summarize and ask: "Should I proceed with this assumption?"

**Never:**
- Keep polling indefinitely
- Hope the next iteration will work
- Ignore signs of being stuck

---

## IRON LAW #4: Agent Git Flow (Trunk-Based Development)

```
⛔ AGENTS NEVER TOUCH MAIN BRANCH - NO EXCEPTIONS ⛔
```

**Core Principle: Humans own main. Agents NEVER push to main directly.** Every agent change must be **scoped**, **observable**, and **reversible**.

**MANDATORY before EVERY git write (`add`, `commit`, `push`, any write):** run `git branch --show-current`. If it returns `main` or `master` → **HARD STOP**, create a feature branch first. No exceptions, no "after this commit."

**Branch strategy:**
```bash
git fetch origin main
git checkout -b feat/{feature-slug}/{phase} origin/main   # always branch from origin/main
git branch --show-current                                 # verify: NOT main/master
```
- Naming: `feat/{slug}/{phase}`, `fix/{slug}/{phase}`, `chore/{slug}/{phase}`, build ranges `feat/{slug}/{phase}-t{N}-t{M}`.
- `{slug}` = basename of `.oss/dev/active/{slug}/`. NEVER reuse a branch from a previous phase.
- Sequence: verify branch → `git status` → `git add <files>` → commit (conventional) → `git push -u origin <feature-branch>`. Push to the feature branch ONLY.

**PROHIBITED ACTIONS (INSTANT VIOLATION):**

| Action | Why | Exception |
|--------|-----|-----------|
| `git push origin main` / `master` | Direct push to protected branch | NONE |
| `git push --force` / `-f` | Rewrites history | NONE |
| `git merge <branch> main` | Merge into main without PR | NONE |
| `git checkout main && git commit` | Committing on main | NONE |
| Skip `git branch --show-current` | No verification = no safety | NONE |
| `gh pr merge` without user flag | Auto-merge without permission | `/oss:ship --merge` |
| `git -C /path ...` | settings.local.json permission bloat | use `cd` / run from repo |
| `$(cat <<'EOF'...)` in commit/PR | Triggers CC approval prompt | use `git commit -F file` / `gh pr create --body-file file` |
| Commit secrets, credentials, or API keys | Leaks sensitive data into history | NONE |

**PR requirements:** `gh pr create --base main --head <feature-branch>`. Human review REQUIRED before merge. Auto-merge ONLY with explicit `--merge` flag (`gh pr merge --squash --auto`); the `--merge` flag is the user's consent.

**Commit format (Conventional Commits):**
```
<type>(<scope>): <subject>

<body explaining WHY and impact>

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Self-Correction (if you detect you are on main/master):** announce the violation, then `git stash` → `git checkout -b feat/{slug}/{phase} origin/main` → `git stash pop` → proceed. If you already pushed/committed to main: STOP all git ops, do NOT force-push, report to the user, and wait for human guidance.

---

## IRON LAW #5: Agent Delegation (MANDATORY)

**ALWAYS delegate specialized work to the appropriate agent using the Task tool.**

When working on code, NEVER do everything yourself. Use the right agent for the job:

| Technology/Task | Agent (`subagent_type`) |
|-----------------|-------------------------|
| React/Next.js | `nextjs-developer`, `react-specialist` |
| TypeScript | `typescript-pro` |
| Python | `python-pro` |
| Go | `golang-pro` |
| iOS/Swift | `ios-developer`, `swift-macos-expert` |
| visionOS | `visionos-developer` |
| Backend architecture | `backend-architect` |
| Database work | `database-optimizer` |
| Testing | `test-engineer`, `qa-expert` |
| Performance | `performance-engineer` |
| Security | `security-auditor` |
| DevOps/Deployment | `deployment-engineer` |
| Code review | `code-reviewer` |
| Debugging | `debugger` |
| Refactoring | `refactoring-specialist` |
| Documentation | `docs-architect` |
| Java | `java-pro` |
| Flutter | `flutter-expert` |
| AI/ML | `ai-engineer`, `ml-engineer` |
| GraphQL | `graphql-architect` |
| Mobile | `mobile-developer` |

**Self-Correction:** If writing specialized code without delegation, ANNOUNCE the violation and delegate to the appropriate agent.

**Red flags you're NOT delegating:**
- Writing complex framework-specific code yourself
- Not using Task tool for specialized work
- Doing everything in one long session without agents

**Use skills when they exist:**
- If a skill exists for the task (e.g., `/oss:acceptance`), USE IT
- Don't manually do what a skill automates

---

## IRON LAW #6: Dev Docs Synchronization (MANDATORY)

**Every agent MUST keep dev docs in sync with their work.**

The `.oss/dev/active/{feature}/` directory is the single source of truth for feature progress. Every agent is responsible for updating it.

**Required Updates by Command:**

| Command | Must Update |
|---------|-------------|
| `/oss:ideate` | Create `DESIGN.md` with approved design |
| `/oss:plan` | Create `PLAN.md` with TDD task breakdown |
| `/oss:build` | Update `PROGRESS.md` after each task, `TESTING.md` with test results |
| `/oss:ship` | Update `PROGRESS.md` with final status, archive to `.oss/dev/completed/` |

**Dev Docs Structure:**
```
.oss/dev/active/{feature}/
├── PLAN.md       # TDD implementation plan (tasks, tests, sequence)
├── PROGRESS.md   # Task completion tracking (checkboxes)
├── DESIGN.md     # Approved design from ideate phase
├── TESTING.md    # Test strategy & results
├── DECISIONS.md  # Technical decisions log (ADRs)
└── NOTES.md      # Implementation notes & gotchas
```

**PROGRESS.md Format:**
```markdown
# Progress: {Feature Name}

## Current Phase: {ideate|plan|build|ship}

## Tasks
- [x] Task 1: Description (completed YYYY-MM-DD)
- [ ] Task 2: Description (in progress)
- [ ] Task 3: Description (pending)

## Blockers
- None / [Blocker description]

## Last Updated: YYYY-MM-DD HH:MM by {agent/command}
```

**Self-Correction:**
- Before completing any command, verify dev docs are updated
- If docs don't exist, create them
- If docs are stale, update them with current state
- Add "Last Updated" timestamp on every change

**Red flags you're NOT syncing:**
- Completing tasks without updating `.oss/dev/active/{feature}/PROGRESS.md`
- Design changes without updating `.oss/dev/active/{feature}/DESIGN.md`
- Test additions without updating `.oss/dev/active/{feature}/TESTING.md`
- Stale timestamps (>1 hour old during active work)

---

## Enforcement

Before every `/oss:*` command, verify all seven laws hold (tests green & no `.skip`/`.todo`;
**every change RED-first, and the provenance check run on any change to where a value comes from**;
no `any`; no stuck processes; on a feature branch, NOT main/master — **BLOCKING**; delegating
to agents/skills; dev docs in sync). Any failure → **Announce + Auto-Correct** before proceeding,
using this format:

```
IRON LAW PRE-CHECK
├─ ❌ LAW #X: [Violation description]
├─ ✅ LAW #Y: [Passed check]
└─ ...
SELF-CORRECTING: [Action being taken]...
```

*These laws are the foundation of world-class software delivery. No exceptions.*

<!-- IRON LAWS END -->
