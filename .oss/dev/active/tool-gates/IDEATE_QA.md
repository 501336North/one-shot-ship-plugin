# Ideation Q&A Transcript: tool-gates (R-253)
Date: 2026-11-09
Original prompt: `/oss:ideate R-253 (Sprint D #1, oss-lab ROADMAP): IRON LAWS become PreToolUse gates driven by one declarative rule file, first release in warn mode (log the would-be refusal, never exit 2). First rules: git commit/push on main/master; push --force; .skip/.only/.todo written into a test file; production-file edit in a build phase whose current task has no recorded RED; writes to the protected-path/tamper-floor set; Bash calls to production hosts listed per repo (gate/perf agents); git tag / push --tags in repos that don't tag. Plus a PostToolUse recorder that parses the agent's own test command results into red/green events (runs no tests itself). Feature slug: tool-gates. This work lands on the sprint branch feat/determinism-sprint/build, never main; it merges to main only after the R-267 deepblue benchmark.`

## Q1: Warn mode: when a rule matches, should the agent be told, or should it only be logged silently?
**Choices offered:**
- A) Log only, agent not told (Recommended)
- B) Log and tell the agent
- C) Configurable per rule

**Not answered.** The user asked to clarify instead: "While we are working on the entire Sprint D (the DETERMINISTIC changes) we want to keep everything solely on the deterministic sprint branch... (you can see it as main... it's this Sprint D's main if you want) but other than that I'm not sure to understand what R-235 is about. and what is warn mode." (R-235 was a typo for R-253.)

## Q1 (reformulated): With the sprint branch, is warn mode still needed?
**Choices offered:**
- A) Rules refuse for real on the sprint branch; no warn mode built unless the benchmark shows wrong refusals (Recommended)
- B) Also build a single warn/block switch now, so the first customer release could start in warn mode

**Selected: A** — "yeah A"

## Q2: The "no code edit without a failing test first" rule during /oss:build: how strict?
**Choices offered:**
- A) Per cycle (Recommended)
- B) Simpler: any red since the phase began
- C) Leave this rule to R-257

**Selected: A** — Per cycle

## Q3: Where do the rules live, and can a repo change them?
**Choices offered:**
- A) Plugin rules + repo can only add (Recommended)
- B) Plugin rules only
- C) Repo file can override anything

**Selected: A** — Plugin rules + repo can only add

## Q4: Design section 1 (what gets built: Node `tool-gate` CLI, hooks, seven rules, `!` escape hatch; bash+jq and built-in deny rules rejected). Look right?
**Answer:** "yes"

## Q5: Design section 2 (rule file holds settings not a rule language; add-only repo file; red/green record; per-cycle rule details; PostToolUseFailure check pending). Look right?
**Answer:** "yes"

## Q6: Design section 3 (shell parsing edge cases, unknown test results, subagents, crash = allow + log + tell agent, speed target, applies in every session). Look right, including "allow and log when the gate crashes"?
**Answer:** "yes"

## Q7: Design section 4 (tests, success criteria, out of scope incl. served-prompt cleanup deferred to an API change and no real-session check on this Mac). Look right?
**Answer:** "yes"

## Q8: Stress test: agree with all five concerns, especially #2 (RED rule covers source files only)?
**Answer:** "yes"

## Design Decisions Summary
- **Block mode on the sprint branch, no warn mode** (Q1): the sprint branch is Sprint D's trunk and reaches no customer before R-267, which counts wrong refusals.
- **Per-cycle RED rule** (Q2): red unlocks source edits; after green only the cycle's files may change; works without task ids.
- **Add-only repo rule file** (Q3): a law can't be switched off by a repo file or an agent editing it.
- **Node CLI, settings-only rule file** (Q4, Q5): jq isn't guaranteed on customer machines; fixed rules in code stay testable.
- **Crash = allow + log + tell** (Q6): a broken gate must not block every session; R-267 counts gate errors.
- **Served-prompt cleanup and real-session check deferred** (Q7): need the API sprint branch / R-267 respectively.
- **RED rule covers source files only** (Q8): dev docs, Markdown, JSON and YAML stay editable during build.
