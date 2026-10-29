# One Shot Ship Plugin - Development Guide

> **⚠️ INTERNAL DOCUMENTATION - NOT FOR END USERS**

---

## 🔴 CRITICAL: MULTI-REPOSITORY CODEBASE

**The OSS Dev Workflow solution spans THREE repositories. ALWAYS check all three when investigating issues or answering questions.**

| Repository | Path | Purpose |
|------------|------|---------|
| **AgenticDevWorkflow** | `/Users/ysl/dev/AgenticDevWorkflow` | API server, web dashboard, database, `.claude-plugin/` integration |
| **one-shot-ship-plugin** | `/Users/ysl/dev/one-shot-ship-plugin` | Plugin source, watcher supervisor, PR monitor, agents, commands |

### Before Answering ANY Question

```
CROSS-REPO CHECK:
1. [ ] Searched AgenticDevWorkflow
2. [ ] Searched one-shot-ship-plugin
```

---

## This Repository: one-shot-ship-plugin

**Purpose:** Core plugin source code, watcher system, and all slash commands.

### Directory Structure

```
one-shot-ship-plugin/
├── .claude-plugin/       # Plugin manifest and configuration
├── agents/               # Specialized agents (40+ agents)
├── commands/             # Slash command implementations (/oss:*)
├── daemon/               # Background services
├── hooks/                # Git and workflow hooks
└── watcher/              # 🔥 Supervisor agent system
    ├── src/
    │   ├── agents/       # Background agents including PR monitor
    │   │   └── pr-monitor.ts  # GitHub PR change-request monitoring
    │   ├── cli/          # Watcher CLI
    │   ├── healthchecks/ # Agent health monitoring
    │   ├── monitors/     # Log and workflow monitors
    │   ├── queue/        # Task queue management
    │   └── supervisor/   # Watcher supervisor coordination
    └── test/             # 1284 tests (100% pass rate)
```

### Key Components

| Component | Description | Tests |
|-----------|-------------|-------|
| `watcher/` | Supervisor agent system | 1284 |
| `watcher/src/agents/pr-monitor.ts` | GitHub PR change-request monitoring | ✅ |
| `commands/` | All `/oss:*` slash commands | ✅ |
| `agents/` | Specialized development agents | ✅ |

### PR Monitor Agent

The PR Monitor watches GitHub PRs for review comments and queues remediation tasks:

```typescript
// Key features:
- Polls GitHub for open PRs
- Detects "change request" comments (not approvals)
- Queues tasks with suggested agent delegation
- Replies with acknowledgment
- Tracks processed comments to avoid duplicates
```

### Per-Prompt Model Routing

Route specific prompts to different AI models (OpenRouter, Ollama, OpenAI, Gemini):

**Configuration Precedence** (highest to lowest):
1. CLI Override: `--model gemini/gemini-2.0-flash`
2. User Settings: `~/.oss/settings.json`
3. Project Config: `.oss/config.json`
4. Frontmatter: `model:` in prompt file
5. Default: Claude (native)

**Supported Providers:**
| Provider | Models | Requires |
|----------|--------|----------|
| OpenRouter | 100+ models | `OPENROUTER_API_KEY` |
| Ollama | Local models | Ollama installed |
| OpenAI | GPT-4o, o1 | `OPENAI_API_KEY` |
| Gemini | Gemini 2.0 | `GEMINI_API_KEY` |

**Example Config** (`.oss/config.json`):
```json
{
  "models": {
    "default": "claude",
    "agents": {
      "oss:code-reviewer": "ollama/qwen2.5-coder"
    },
    "commands": {
      "oss:ship": "gemini/gemini-2.0-flash"
    }
  }
}
```

**Key Files:**
- `watcher/src/services/model-router.ts` - Model resolution
- `watcher/src/services/model-proxy.ts` - HTTP proxy server
- `watcher/src/services/api-transformer.ts` - Request/response transforms
- `watcher/src/cli/models.ts` - `/oss:models` CLI command
- `commands/models.md` - Command prompt file

**Tests:** 237 tests covering all model routing functionality

---

## Related Repositories

- **AgenticDevWorkflow**: API server, prompts served to plugin

---

*Part of the OSS Dev Workflow solution*

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

**Dev-docs symlink guard (every command):** Write and Edit follow symlinks, and a repo can commit `.oss`, a folder under it or a file such as `PROGRESS.md` as a symlink that points outside the repo. Run this command once at the start of every command, again after any `git checkout`, `git switch`, `git pull`, `git merge` or `git rebase`, and again right before archiving to `.oss/dev/completed/`. It takes no arguments; run it exactly as written:

```bash
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES; top=$(git rev-parse --show-toplevel) && cd "$top" && test ! -L .oss && test ! -L .oss/dev && test ! -L .oss/dev/active && test ! -L .oss/dev/completed && mkdir -p ./.oss/dev/active && l=$(find .oss/dev -type l -print -quit) && test -z "$l" && d=$(CDPATH= cd -- ./.oss/dev >/dev/null && pwd -P) && case "$d" in "$(pwd -P)/"*) echo DEV_DOCS_SAFE ;; *) false ;; esac
```

If it does not print `DEV_DOCS_SAFE`, STOP: do not write or edit anything under `.oss/dev/`, and tell the user that `.oss` or something under `.oss/dev` is a symlink or resolves outside the repo, so the dev docs were not written.

Never put a value you choose or write (a feature name, a number, a date or any free text) into a shell command, not even inside single quotes: a `'` in the value ends the quotes and the rest runs before any check in the command can see it. Write the value to a file with the Write tool and run a command that reads the file and checks the value, as the archive and create commands do. The one exception is a directory printed by an OSS command: it may be pasted into a command inside single quotes, exactly as printed, because those commands refuse any path containing `'`. Before writing a feature name, check that it matches `^[A-Za-z0-9._-]+$` and does not start with `.`; if it does not match, do not write it and tell the user.

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

## Decisions

- Mark the recommended option in an AskUserQuestion picker by ending its label with `(Recommended)`.
- Whenever the person changes an earlier answer in chat, ask the same question again with the AskUserQuestion picker, in the same wording, so a hook records the change.
- A hook records each pick in `decisions.ndjson`. You never write a decision record, or a person's name on one, yourself; `DECISIONS.md` and `IDEATE_QA.md` are still yours to write.

---

## Enforcement

Before every `/oss:*` command, verify all six laws hold (tests green & no `.skip`/`.todo`;
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
