# Decisions: least-privilege-tools (R-266)

Picks are recorded by the hook in `decisions.ndjson`; the full Q&A is in `IDEATE_QA.md`. Deciders: the project owner, via the ideation picker (2026-11-11).

---

## ADR-001: Gate agents review and report; builders fix

**Date:** 2026-11-11 · **Status:** Accepted (Q1)

**Context.** code-reviewer, security-auditor, penetration-tester and performance-auditor judge changes in `/oss:ship`. security-auditor's description also says it implements auth and fixes vulnerabilities, and IRON LAW #5 routes all security work to it. A gate that can edit what it judges is the unguarded-fix pattern (8 of 9 fixes unguarded, 2026-09-06).

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Gates review only | One clear rule; no new agent; ship already has the main agent fix findings | Security fixes need a different delegation target | Best |
| Split security (new security-engineer) | Keeps a security specialist for fixes | One more agent to maintain; more served-text change | Decent |
| security-auditor stays writable | No served-text change | The security gate can still edit what it reviews | Poor |

**Decision.** All four gates are read-only; their descriptions say review and report. Fixes go to the stack's builder agent.

**Consequences.** + No gate edits its subject. − The served delegation row must change (ADR-005). Neutral: the ship prompt needs no change (the main agent already fixes; gates only re-check).

---

## ADR-002: Two layers: `tools:` lists coarse, an agent-aware R-253 rule fine

**Date:** 2026-11-11 · **Status:** Accepted (Q2, Q6), depends on probe P1

**Context.** Gates need Bash (tests, `git diff`, exploits) and Write (offload `prompt.md` in a private mktemp folder). Both can write repo files. R-253's gate doesn't yet know which agent made a call.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| `tools:` drops Edit/MultiEdit/NotebookEdit; R-253 rule refuses a gate's Write/Edit/Bash writes inside the repo | Closes every write path; reuses R-253's resolver and Bash-writer detection | Needs the hook input to name the subagent (P1) | Best |
| Tool names only, Bash gap accepted | Smallest | Bash and Write remain a way around | Poor |
| No Bash/Write for gates | Strict | Breaks the pen tester and the offload step | Poor |

**Decision.** Coarse layer: gate `tools:` without Edit, MultiEdit, NotebookEdit. Fine layer: a new R-253 rule refuses a gate agent's Write, Edit or Bash write to a path inside the repo; private temp writes pass; main agent and unknown agents are not refused (no lockout). The rule reads the gate set from one source; a test checks agent lists and rule agree. **If P1 shows the hook input doesn't name the subagent, stop and ask.**

**Consequences.** + Every repo-write path is refused for gates. − Narrows the card's "no Edit or Write" wording: Write stays on the list, refusal moves to the rule. − Gate test runs that write inside the repo (coverage, build output) would be refused; record and ask before widening.

---

## ADR-003: Two tiers of tool lists

**Date:** 2026-11-11 · **Status:** Accepted (Q3), depends on probes P2, P3

**Context.** The card requires `tools:` on every agent. R-267 requires that nothing that works today breaks.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Two tiers: gates restricted, builders keep today's capabilities | Only 4 agents change behavior | Builder lists may freeze today's tools | Best |
| Three tiers (+ read-only advisors) | Tighter | More behavior change at once; docs-architect writes | Decent |
| Per-agent lists | Precise | Hard to keep consistent | Poor |

**Decision.** Two tiers. Builder lists name the MCP tools the agent uses. If P3 finds an "all tools" value, builders use it; otherwise explicit lists, with a test rejecting unknown tool names.

**Consequences.** + Builder behavior unchanged. − New Claude Code tools may need adding to builder lists (unless P3).

---

## ADR-004: Move `agents/_shared/model-routing.md` out of `agents/`

**Date:** 2026-11-11 · **Status:** Accepted (Q4)

**Context.** Claude Code loads it as the agent `oss:_shared:model-routing` with every tool.

**Decision.** Move it to a non-agent folder; update all references. A test fails on any `agents/**/*.md` without frontmatter `name:`.

**Alternatives rejected.** Exempting it in the test (stays spawnable with all tools); an empty tool list (stays listed as a useless agent).

---

## ADR-005: Served delegation text changes on the API Sprint D branch; R-267 serves it

**Date:** 2026-11-11 · **Status:** Accepted (Q5)

**Context.** "Security → security-auditor" is served from the API (`packages/api/src/prompts/shared/iron-laws.md`, `commands/build.md`, `build.ts`), with a copy in the plugin `CLAUDE.md`. The API serves prompts from `main`; Sprint D changes stay on `feat/determinism-sprint/build` until R-267 passes.

**Decision.** A PR into the API's Sprint D branch splits the row into "Security review → security-auditor" and "Security fixes → the stack's builder agent"; the plugin `CLAUDE.md` copy changes on the plugin sprint branch. The R-267 card records that the candidate run serves the API Sprint D prompts.

**Consequences.** − Until the sprint merges, live sessions still route security fixes to the read-only auditor: the Edit is refused and the main agent picks a builder. Accepted; R-267 counts it.

**Alternatives rejected.** Plugin-side override only (law and agent disagree all sprint); deferring security-auditor (narrows ADR-001).

---

## ADR-006: Gate offload runs read-only, or not at all

**Date:** 2026-11-11 · **Status:** Accepted (Q6), depends on probe P4

**Context.** The offloaded local model "can read and edit files in the current repo", outside `tools:` and the tool gate.

**Decision.** A gate agent's offload launch runs the local model read-only. If the runner can't enforce that (P4), gate agents skip offload and run on the frontier model.

**Consequences.** − If P4 fails, per-agent model routing stops applying to the four gates and gate runs cost more.

**Alternatives rejected.** No Write and no offload (always frontier, even when read-only offload works); a fixed Bash helper for the prompt file (more plumbing in the shared offload step).

**Plan note (2026-11-11).** `agent-offload.ts` already launches the nested session with `--permission-mode acceptEdits` and `--disallowedTools`, so the gate case adds Edit, Write, MultiEdit and NotebookEdit to `--disallowedTools` (P4 confirms). Bash stays; ADR-007 covers its writes.

---

## ADR-007: Before/after tree check around every review-agent run

**Date:** 2026-11-11 · **Status:** Accepted (plan, after the user's heads-up: "A script can still write files."). Errors rule ("allow, log, tell") partly superseded by ADR-016 for review agents.

**Context.** ADR-002's rule refuses only the Bash writes the command reader recognizes. `python -c`, `node -e`, a test that writes files or any script file gets past it.

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| Keep the rule, add a snapshot at the review agent's start and a compare at its end | Catches every non-ignored change, from any source (scripts, offload); needs only the `Agent` tool's `subagent_type`, not P1 | Detects after the write, doesn't prevent it; gitignored files unseen; snapshot cost on big repos | Best |
| Bash allowlist for reviewers | Prevents up front | Breaks the penetration tester; constant list upkeep | Poor |
| Accept the gap | No work | Rule is evadable on purpose | Poor |

**Decision.** Known-writer rule stays as the fast refusal. A PreToolUse hook on `Agent|Task` snapshots the tree (temporary index, `git add -A`, `write-tree`) for gate agents; the PostToolUse hook compares. A change voids the review, names the files, and tells the main agent to stop the ship and ask the user. Overlapping review runs are all voided by a change. Errors: allow, log, tell.

**Consequences.** + The script gap closes for tracked and untracked non-ignored files. − Gitignored files unseen (recorded limit). − Hook cost per review run (timeout 10 s, measured).

---

## ADR-008: Served agent headers carry no `tools:` lines

**Date:** 2026-11-11 · **Status:** Accepted (plan, FOLLOWUPS #168 pulled in)

**Context.** 18 served agent prompts in the API carry `tools:` header text, which Claude Code never enforces (only the local file's frontmatter counts), and much of it names things that aren't tools (`npm`, `vite`, `MCP_DOCKER`). After R-266 it would contradict the real lists.

**Decision.** Remove the lines on the API Sprint D branch, with a test that keeps them out. The local agent file is the only tool list.

**Alternative rejected.** Keeping served lists in sync with the local ones: two sources for one fact.

---

## ADR-009: The tree check hangs off SubagentStart/SubagentStop, not the `Agent` call

**Date:** 2026-11-11 · **Status:** Accepted (build, Task 1 probe finding; refines ADR-007's mechanism, not its promise)

**Context.** Probe (Claude Code 2.1.322): for an agent run with `run_in_background: true`, PostToolUse on `Agent` fires at launch (`status: "async_launched"`), before the agent does anything. A compare there would always pass. `SubagentStart` and `SubagentStop` fire at the run's real start and end, foreground and background, with `agent_id` and `agent_type`.

**Decision.** Snapshot on `SubagentStart` and compare on `SubagentStop` for gate agents, keyed by `agent_id`. For a foreground run, the main agent is told through the `Agent` PostToolUse (`additionalContext`), found by `tool_response.agentId`. For a background run, `SubagentStop` records the void (state + timeline) and tells the user (`systemMessage`). The message says the repo changed while the review ran, since the change may come from any writer during the run.

**Consequences.** + Background review runs are covered. + The plan's Task 10-12 tests stay the same in substance; their trigger events change. − Two more hook events in `hooks.json`.

---

## ADR-010: The review tree check leaves out the top-level `.oss/` folder

**Date:** 2026-11-11 · **Status:** Accepted (user pick at /oss:integration: "Ignore all of .oss/")

**Context.** A live background review run was voided although the review agent changed nothing: while it ran, OSS's own hooks wrote `.oss/dev/timeline-unfiled.ndjson` (they also write `.oss/logs/**`, `.oss/workflow-state.json`, `.oss/session-context.md`). Untracked, non-ignored, so the tree changed. Nearly every ship review would have been voided.

| Option | Pros | Cons |
|--------|------|------|
| Leave out all of top-level `.oss/` (chosen) | Simple; holds as hooks change | A review agent's edit to `.oss/dev` docs goes unseen by this check (the gate rule still refuses its known writes) |
| Leave out only OSS-written files | Tighter | List must track every hook writing under `.oss/`; a new one brings false voids back |

**Decision.** Start and stop trees both omit the top-level `.oss/` folder. `.oss` folders deeper in the tree and look-alikes (`.ossfoo/`) are still checked. The live row gets a control: a clean review run is not voided.

**Heads-up answered (2026-11-11):** "the before/after check may compare too early when review agents run in the background." Covered by ADR-009: the compare runs on SubagentStop, which fires at the end of a background run (probe: after the agent's command finished), not on the `Agent` PostToolUse that fires at launch.

**Superseded in part by ADR-011 (2026-11-12).**

---

## ADR-011: The review check leaves out only OSS's own run files under `.oss/`

**Date:** 2026-11-12 · **Status:** Accepted (user pick at /oss:ship round 1: "Ignore only OSS's run files"); narrows ADR-010

**Context.** Ship's security and pen-test gates showed that with all of `.oss/` left out, a review agent could forge `.oss/dev/active/<feature>/decisions.ndjson` (owner decision records), dev docs or `.oss/tool-gates.json` without voiding its review.

**Decision.** The tree leaves out only the files OSS's hooks write during any run (one exported constant, `OSS_RUN_FILES` in `watcher/src/gate-run/fingerprint.ts`, pinned by a test): `.oss/logs/**`, `.oss/workflow.log`, `.oss/sessions/**`, `.oss/locks/**`, `.oss/run/**`, `.oss/session-context.md`, `.oss/workflow-state.json`, `.oss/health-workflow-state.json`, `.oss/queue.json`, `.oss/current-project`, `.oss/timeline-outbox/**`, `.oss/tool-gates/**` (event log; `.oss/tool-gates.json` stays checked), `.oss/.iron-laws-*`, `.oss/dev/timeline-unfiled.ndjson`, `.oss/dev/{active,completed}/*/timeline.ndjson`. Everything else under `.oss/` voids a review when it changes.

**Consequences.** + Decision records, dev docs and the repo's gate rule file are covered. − A new hook that writes under `.oss/` during runs brings false voids back until it joins the list (the live row's clean-review control catches it). − `workflow-state.json` stays forgeable: OSS writes it during runs.

---

## ADR-012: The review check fails closed, tells the main agent, and sees git state and dependencies

**Date:** 2026-11-12 · **Status:** Accepted (user pick at /oss:ship round 1: "Fix the full set"; node_modules: "Check node_modules, skip build output")

**Context.** Ship round 1 (all four gates FAIL): a missing snapshot (deleted, or the start hook killed by its 10 s timeout) passed silently; the check guarded `CLAUDE_PROJECT_DIR` only, so a review in a sibling worktree went unchecked; only work-tree files were compared, so commits, ref moves, the stash, index flags, git config/hooks/info and dependency folders changed unseen; snapshots re-hashed every file (12-25 s on 100k files); background voids and "unverified" notices reached the user, never the model.

**Decision.**
- **Fail closed:** for a gate agent, any outcome other than "checked, no change" is a void or an "unverified" notice (no snapshot at stop, start failed, check error, not a git repo, out of time). Both say to stop the ship and ask the user. Non-gate agents are always silent (decided before any git call).
- **Told to the model too:** notices are kept at `~/.oss/run/gate-run/<session_id>/<agent_id>.notice.json`; the foreground `Agent` PostToolUse delivers its own, and a new PostToolUse for every main-agent call (`main-post`, no `agent_id`) delivers pending ones (background runs). The wrapper exits without node when nothing is pending. Live probe 2026-11-12: subagent and main-agent hook inputs carry the same `session_id`.
- **State out of the git dir:** snapshots live beside the notices; entries older than 2 days are swept.
- **Both repos:** every distinct repo of `CLAUDE_PROJECT_DIR` and the hook's `cwd`.
- **What is compared:** the work tree (temp index seeded from the real one, ~1 s on 100k files), a git-state digest (HEAD, every ref, index flags, config, config.worktree, hooks, info/, worktree list), nested repos (gitlinks), and every file under `node_modules` folders (path, size, mtime; caches such as `node_modules/.cache` and `.vite*` skipped). git runs with user/system config off; if config, hooks or info/ changed, the void is reported without running `git add` (a planted clean filter never runs).
- **Time budget:** 7 s per hook run (hook timeout 10 s); out of time = unverified. A killed hook still prints the unverified notice.
- **Message hygiene:** every Unicode control, format and line/paragraph separator in a path becomes `?`.

**Known limits (reported to the user, in the PR):** other gitignored output (`dist/`, coverage) is not compared, since review agents build and test; a process forked by an interpreter that writes after the run ends is not seen (launchers are refused, ADR-013); a change undone within the run is not seen (the code judged is unchanged); files pulled in by a repo config `include.path` are not hashed.

**Round 2 (2026-11-12, user pick "Raise the bar, record the limit").** Added: a per-run ledger (`started`, `start-failed`, `tamper`, `done`) so a replaced, replayed or second-started snapshot reads unverified; each notice in its own file, checked on its own (bad file → one generic "unverified" line, good ones still delivered; notices for runs the check never started dropped and reported; FIFOs never waited on); staged index entries in the git-state digest; node_modules keyed by size, mtime, ctime and inode, stored per folder as a 32-bit hash (~2.6 MB at 160k files); new ignored paths named; repo filters neutralised (`clean=cat`, empty `process`) during the check; the check's objects go to a private object store in the run folder, never `.git/objects`; user-level git config (`~/.gitconfig`, `~/.config/git/*`) digested; an Agent result whose end check never finished reads unverified; untracked files over 8 MB by stat; parallel node_modules walk (160k files ≈ 1.2 s); main-post fast path scoped to the session. Review agents may not write `~/.oss/run/**` (ADR-013).
**Round-2 known limits:** a review agent runs code as the user, so the ledger raises the bar but an interpreter can still forge state; a NEW ignored output created during the run (first `coverage/`, `*.tsbuildinfo`) voids the run (fails closed); content changes inside ignored paths that existed at start are not seen, except under `node_modules`; a 32-bit folder hash collision could hide one dependency change (~1 in 4×10⁹); a stop hook killed by its timeout tells the user only, not the model (a main-post time window can't tell it from a long background review); a killed hook's run folder stays until the 2-day sweep.

---

## ADR-013: For review agents the gate rule allows read-only git only and refuses launchers, installs and hard links

**Date:** 2026-11-12 · **Status:** Accepted (user pick at /oss:ship round 1: "Refuse git writes + background")

**Decision.** For gate agents only (builders and the main agent are unaffected), in the reviewed repos (project root and the hook `cwd`'s repo):
- git: an allowlist of read-only subcommands and list forms; anything else, git global options that set config or redirect the repo (`-c`, `--config-env`, `--exec-path`, `--git-dir`, `--work-tree`), `--output`, and `GIT_*` variables set earlier in the call are refused. Git outside the reviewed repos (a pen tester's sandbox) is not restricted.
- Anywhere: background launches (`&`, nohup, setsid, disown, at, screen, tmux, launchctl, `claude`, …) are refused.
- Package installs that change the reviewed repo's dependencies are refused (tests and builds stay allowed).
- `ln` with an operand in a reviewed repo is refused (hard links).
- The offloader run directly under another agent's name is refused.
- Agent names match on the part after the last `:`, case-insensitively.

**Consequences.** + The writes the tree check can't see (history, refs, late writes from launched processes) are stopped at the call. − A pen tester can no longer start background servers, and a sandbox folder only known at run time (`d=$(mktemp -d)`) is refused for git; it must write the path out.

**Round 2 (2026-11-12).** Also refused for review agents: a program word not written out in full (variable, `$( )`, backticks, wildcard) or an interpreter script given that way; `git-*`, `git-core` programs and `hub` in a reviewed repo; `gh` other than its read forms, anywhere; `git config --global/--system/--file` writes, anywhere; writes to `~/.oss/run/**`, `~/.gitconfig`, `~/.config/git/**`; running the review check's own entry points; the offloader with more than one `--agent` or under any name but the caller's own; `ssh -f`, `sudo -b`, detached containers, `emacs --daemon`; npm aliases and misspellings of install forms, `audit fix`, `pkg set`, `npx -p`; the Bash tool's `run_in_background: true` (counts as `&`). Every command-word lookup goes through a Map/Set (a `constructor` word crashed the gate open).
**Pen-tester background exception (user pick 2026-11-12, "Allow outside the repo").** The plugin-only setting `backgroundAgents: ["penetration-tester"]` in `config/tool-gates.json` lets that agent start background work (`&`, nohup, tmux, `run_in_background` …) only when the part runs entirely outside the reviewed repos (folder known, folder and every path operand outside). A repo's `.oss/tool-gates.json` cannot set it. Scheduled or system-launched work (`at`, `crontab`, `launchctl`, `open` …) and a nested `claude` stay refused for it.
**Round-2 known limits:** `make` runs whatever its Makefile says; a background process the pen tester starts in a sandbox could still write into the repo by absolute path after the run; a pen-tester server started with a variable operand (`"$PORT"`) is refused; work forked by a program the gate doesn't know (a self-forking script) is not seen; `curl -o`, `sqlite3`, `patch` writes are left to the review check; `.oss/tool-gates/**` and `.oss/workflow-state.json` can be forged through an interpreter (excluded from the check by ADR-011, protected only at the gate).

---

## ADR-014: Review agents' Bash moves from a denylist to an allowlist

**Date:** 2026-11-12 · **Status:** Accepted (user pick at /oss:ship round 3: "Keep fixing: allowlist"; new ignored output: "Skip new ignored output")

**Context.** Round 2 refused 8 shell forms; round 3 found ~15 more that need no interpreter (`xargs`/`find -exec` operands, `bash /dev/stdin <<<`, `trap … EXIT`, aliases, `HOME=` reassignment, option-value paths such as `npm --prefix=<repo> … &`). A denylist over shell does not converge.

**Decision.** For gate agents, every Bash part must be fully read by the command reader and its program must be on a plugin-only allowlist (`reviewPrograms` in `config/tool-gates.json`; a repo file cannot set or extend it): read/search tools, read-only git and gh, test runners, build/lint/typecheck, interpreters with a script file that exists or a parsed `-c`. Shell constructs that hide commands (eval, source, exec, trap, alias, shopt, xargs/parallel and `find -exec` except with a read-only inner program, shells fed from stdin) and assignments of HOME, PATH, IFS, BASH_ENV, LD_*/DYLD_*, NODE_OPTIONS, GIT_* … are refused. The pen tester keeps its sandbox exception (any program, background allowed) only for parts that run entirely outside the reviewed repos, with option values read as paths. Gate agents may not write `~/.oss/**` or `~/.claude/**`. The review check reports any forged `unverified` record, hashes untracked files without writing objects, no longer voids on new ignored output (back to ADR-012's "skip build output"), and covers extra repos the main agent names for the session (`oss-gate-run.sh add-repo`).

**Stack coverage (user pick 2026-11-12, "All stacks + user additions").** The shipped list covers every stack the plugin has agents for (Python, Java/Kotlin, Ruby, PHP, Go, Rust, Swift/iOS, Flutter/Dart, .NET, JS/TS) plus security/static tools and read-only infra commands, with subcommand limits where a tool also writes (`ruff check` yes, `--fix` no). A user can add programs in their own `~/.oss/config.json` (`toolGates.reviewPrograms`); review agents can't write it, and a repo's files can't add to the list. A refusal names the program and that setting.

**Consequences.** + Shell-level bypasses go away as a class; what remains is interpreter code (running tests runs repo code), already the accepted limit. − Review agents can no longer run arbitrary tools in the repo; a program they need must be added to the plugin's list. A planted self-ignoring `.gitignore` (through an interpreter) is a recorded limit again.

---

## ADR-015: OS sandbox for review-agent Bash on macOS

**Date:** 2026-11-13 · **Status:** Accepted (user picks 2026-11-13: "OS sandbox for reviewers", "Auto-allow inside sandbox", "Network on, credentials off"; "Monitor refused") · **Partly superseded by ADR-022** (the deny-list parts: writes, sockets, home and env; the rest stands)

**Context.** Ship rounds 4 to 7 showed that the allowlist (ADR-014) still leaves interpreter code free to write. Running tests runs repo code. A probe showed that a PreToolUse `updatedInput` rewrite works for subagents and background calls. On DeepBlue, bwrap is blocked by apparmor (unprivileged user namespaces), so Linux has no sandbox.

**Decision.**
- On macOS, a review agent's Bash call that passes the gate is rewritten to `/usr/bin/sandbox-exec` with an inline profile. The gate returns `permissionDecision: "allow"` with `updatedInput`. The profile self-tests on each call (about 10 ms).
- Writes are allowed only under temp. Denied: HOME, `/Users/<user>`, each reviewed repo (read-only even when inside temp), user preference writes, `lsopen`, Apple Events, signals to processes outside the sandbox, the docker socket, home sockets, and the launchd `Listeners` socket.
- Credentials are denied for both `$HOME` and the password-database home: `.config/gh`, `.ssh`, `.aws`, `.config/gcloud`, `.gnupg`, `.git-credentials`, `.netrc`, `.npmrc`, `.oss/config.json`, `.docker/config.json`, `.kube/config`, `.claude/.credentials`. Keychain mach services are denied.
- Network stays on.
- Calls that pass inside the sandbox are auto-allowed. This is customer-visible, so it goes in the release notes.
- Monitor is refused for review agents (by tool name, or a Bash input with `timeout_ms` or `ws`).
- Not wrapped: builders, the main agent, and a review agent's own setup steps (blocks copied byte for byte from its agent file).
- Fallback (Linux, Windows, sandbox-exec missing or failing its self-test, or `OSS_TOOL_GATE_SANDBOX=off` read from the hook's own environment): refuse `python -c`, `node -e/-p/--eval/--print`, `bash -c` and `sh -c`, and scripts outside the reviewed repo. `node --test` and the repo's own scripts stay allowed.

**Profile deviations found by probing on this Mac** (the first brief's profile did not hold):
- `(deny signal (target others))` does not stop signals to outside processes. It is replaced by `(deny signal)` plus `(allow signal (target same-sandbox))`, so an agent can still end its own jobs.
- `appleevent-send` alone was not enough. A `mach-lookup` deny on `com.apple.coreservices.appleevents` is added.
- Denying all Unix-socket outbound broke DNS. Socket denies are narrowed to sockets under the homes (Docker Desktop, OrbStack, colima, 1Password agent), the docker.sock literal, and the launchd `Listeners` socket.
- HOME and the reviewed repos get an explicit write deny after the temp allow, so they stay read-only when they sit inside temp.
- The gate's answer file moves to `~/.oss/run/tool-gate/` (mode 0700, symlinks refused). A sandboxed background job can write anywhere in temp, so it could have overwritten another hook call's answer file and injected an `updatedInput` into a builder's call.
- The hook scans the whole input for `agent_type`, not the first 1 KB. `agent_type` comes after `tool_input`, so a short window can miss it on long commands. (Found by part A; a hook detail, recorded here with the sandbox.)

**Consequences.**
- \+ Writes by interpreters and launched processes are kept to temp, on macOS.
- \− docker and kubectl fail inside the sandbox (socket denied, no `~/.kube/config`). The inner shell is bash, not zsh. Cargo needs a committed lockfile or `--locked`. The MEDIUM-1 cd rule is broad. Linux gets only the fallback.
- \− Auto-allow changes what users see: write it in the release notes.

---

## ADR-016: Review agents fail closed on a gate timeout or crash

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13: "review agents fail CLOSED on gate timeout/crash; builders and main keep fail-open"); supersedes the "allow, log, tell" error rule of ADR-007 for review agents; **timeouts for builders and main amended by ADR-025** (tool-gates ADR-005, timeouts only)

**Context.** ADR-007 let the gate allow a call when it errored. For a review agent that is a way around the gate: a slow or crashed gate lets the write through. The tree check already fails closed (ADR-012), but the tool gate did not.

**Decision.** For a review agent (`gateAgents`), any gate answer that is not a decision fails closed. That covers a timeout, a crash, a CLI failure, no node, and a changed node. The call is refused (exit 2) with a message. Builders and the main agent keep fail-open: allow, log, tell (ADR-007).

Note on numbering: the code comments cite "ADR-005" for fail-open. That is the tool-gates feature's ADR-005, "A crashed or slow gate allows the call and says so" (`.oss/dev/completed/tool-gates-2026-11-11/DECISIONS.md`), not this file's ADR-005. This ADR supersedes that rule for review agents only. Here, ADR-007 carries the same "allow, log, tell" rule for the tree check.

**Consequences.**
- \+ A slow or crashed gate cannot let a review agent write.
- \− A gate outage stops review agents until the gate is back. Builders are not stopped.

---

## ADR-017: Review agents write only to temp and their sandbox

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13); narrows ADR-013 and ADR-014

**Decision.** A review agent writes only under temp (and its sandbox temp folder). It does not write to HOME, to a reviewed repo, or to any other path. ADR-013 and ADR-014 already refused the known writers. This ADR makes the rule a whole: on macOS the sandbox enforces it, and on the fallback the gate rule enforces it.

Caches for npm, Go, Python, Cargo, ruff and mypy are redirected to temp (`<DARWIN_USER_TEMP_DIR>/oss-review-cache/<session>/`). GOMODCACHE stays the user's own, read-only.

**Consequences.**
- \+ No review run writes into the user's home or the repo.
- \− A test or build that writes output into the repo (coverage, `dist/`, `*.tsbuildinfo`) is refused for a review agent. The full verification run will show how often this bites.

---

## ADR-018: Hooks run node by a fixed path, recorded on first use

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13: "Record on first use"; "protect ~/.oss/node-path for ALL agents (just that path)"). Replaces the SessionStart re-adopt of a changed node.

**Context.** Round 6 security found that a PATH-shadowed `node` silenced both gate layers. Round 7 found that SessionStart re-adopted a swapped node.

**Decision.**
- `oss_node` records `type -P node` in `~/.oss/node-path` on first use. The record is written to a private temp file (mode 600), then moved over the record.
- Every link hop is followed physically. Each link and the final file must be owned by the user or root. Nothing may sit in temp, except that a version-manager link in temp (fnm multishell) records the real file it points to. The end must be an executable regular file.
- If a record exists and PATH's node differs, nothing is written. `oss_node` fails with `OSS_NODE_PROBLEM=changed`, `OSS_NODE_OLD` and `OSS_NODE_NEW`. SessionStart and the gate tell the user both paths and how to fix it: delete `~/.oss/node-path`.
- An empty or symlinked record counts as existing, so it fails closed.
- `~/.oss/node-path` is protected for all agents. Only that path is protected, not `~/.oss/**`.

**Consequences.**
- \+ No silent node swap, and no PATH-shadowed node.
- \− A user who changes node (for example a new version manager) must delete the record once. The message says so.

---

## ADR-019: Layer 2 covers the gate-steering user files and repo .claude settings

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13: "layer 2 covers the gate-steering user files and repo .claude settings"); narrows and extends the round-6 pick "Only what steers the gate"

**Context.** Layer 2 is the review check's fingerprint of files that can steer the gate. Round 6 found it too narrow.

**Decision.** The review check fingerprints, at start and stop:
- user files that steer the gate: `~/.oss/config.json` (toolGates and models keys), `~/.oss/hooks`, `~/.oss/bin`, `~/.oss/repos.json`, the installed OSS plugin and its running plugin root, and the node binary;
- user Claude settings keys that steer hooks and plugins: `disableAllHooks`, `env`, `enabledPlugins`, and the hooks key, in `~/.claude/settings.json`;
- every installed plugin;
- each reviewed repo's `.claude/settings.json` and `.claude/settings.local.json` (the `SETTINGS_KEYS`), tracked or ignored.

A change in any of these voids the review.

**Consequences.**
- \+ A review cannot be steered by a changed user or repo setting without the run being voided.
- \− A user who edits these files during a review run gets a void. That is intended.

---

## ADR-020: The survivor-process check is dropped

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13: "Drop survivors check"). Removes the round-6 survivor rule; no earlier numbered ADR held it.

**Context.** The round-6 pick made a review still running at stop "unverified". The check was flaky: it passed on one run and failed on the rerun, and it flagged a sibling review's test run in the same worktree.

**Decision.** Drop the check. Late writers from a review's shell are stopped by the sandbox on macOS (ADR-015). The integration tests cover a detached late writer. A clean review run is not made unverified by a process still running in the repo.

**Consequences.**
- \+ No false "unverified" from sibling runs.
- \− On macOS the sandbox carries the guarantee. On the Linux fallback, a process forked by an interpreter that writes after the run ends is still not seen (ADR-013 limit, now narrower because the fallback refuses inline interpreters).

---

## ADR-021: git and the core programs are pinned by fixed path

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13: "Every program pinned"); extends ADR-012's git-state digest

**Decision.**
- git is resolved once per process. On macOS it is `<xcode-select -p>/usr/bin/git`, run with an empty environment. This avoids the `/usr/bin/git` shim and its agent-writable xcrun cache. On Linux it is `/usr/bin/git`, else `/bin/git`. `xcrun --no-cache -f git` is dropped: it took 2.3 s per call, against about 4 ms for `xcode-select -p`.
- The core programs (`rm`, `mkdir`, `date`, `tr`, `head`, `cut`, `cat`, `mktemp`, `bash`) come from fixed `/bin` then `/usr/bin` paths. The hook scripts use `OSS_RM`, `OSS_MKDIR` and so on from `oss-node.sh`. `oss-value.sh` uses the same.
- The tool gate's git reader uses the same checked `gitBinary()`.
- The resolved git is fingerprinted as `git: <path>`.

**Consequences.**
- \+ A PATH-shadowed git or core program cannot change a review's answer.
- \− On macOS without the command-line tools, `xcode-select -p` fails and reviews read unverified. On Linux, git must sit at `/usr/bin` or `/bin`.

---

## ADR-022: The macOS review sandbox is an allowlist with a private temp folder

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R9-1); replaces the deny-list parts of ADR-015

**Context.** Round 8 found that the deny-list let a review agent write anywhere in temp (answer-file swap, scratchpad and task output, xcrun_db), reach temp Unix sockets that other programs planted (tmux, cc-socks, browser bridge), and read home files and the environment (SEC HIGH-1, HIGH-2, MEDIUM-3; CR HIGH-1, MEDIUM-4). A deny-list cannot close paths that other programs can plant.

**Decision.** On macOS the wrap is an allowlist profile.
- **Writes:** only to a private per-session folder `<DARWIN_USER_TEMP_DIR>/oss-review/<session>`, created 0700. A symlinked or foreign-owned folder is refused. TMPDIR points at it, and the cache variables (npm, Go, Python, Cargo, ruff, mypy, CLANG_MODULE_CACHE_PATH, PYTEST_ADDOPTS with `-p no:cacheprovider`) point inside it. Also `/dev/null`, `/dev/tty*`, `/dev/fd/*` and `/dev/dtracehelper`. Not `/private/tmp`, not all of temp.
- **Unix sockets:** `(deny network-outbound (remote unix-socket))`, then allow `/private/var/run/mDNSResponder` only. TCP and UDP stay on.
- **Home reads:** denied for `$HOME` and the password-database home, except each reviewed repo (as given and real path) and these toolchain folders, read-only (each one proven by a real command): `~/.gitconfig`, `~/.config/git`, `~/.nvm`, `~/.npm` (read-only; the cache moves to the private folder), `~/.cargo`, `~/.rustup`, `~/go`, `~/.pyenv`, `~/.local/bin`, `~/.local/lib`, `~/.local/share/uv`, `~/.deno`, `~/.bun`, `~/.volta`, `~/.asdf`, `~/.rbenv`, `~/.sdkman`, `~/miniconda3` (on evidence), `~/Library/Caches/pip`, `~/Library/pnpm`.
- **Never readable:** `~/.oss` (beyond what a hook needs), `~/.claude`, `~/.claude.json`, `~/.ssh`, `~/.config/gh`, `~/.codex`, `~/.aws`, `~/.docker`, `~/Library/Keychains`, `~/Library/Application Support`. Keychain mach-lookup denies stay.
- **Environment:** the inner shell starts with `/usr/bin/env -i` and an allowlist (PATH, HOME, USER, LOGNAME, SHELL, TERM, LANG, LC_*, the private TMPDIR, the cache variables, JAVA_HOME, GOPATH, GOROOT, CARGO_HOME, RUSTUP_HOME, NVM_DIR, PYENV_ROOT, VIRTUAL_ENV, CONDA_PREFIX, NODE_ENV, CI). Nothing else, and never CLAUDE_CODE_*, *KEY*, *TOKEN*, *SECRET*, *PASS* or *AUTH*. The inner shell is `bash --norc --noprofile`.
- **Protected paths inside a writable root:** a reviewed repo or HOME inside the private folder makes the wrap fail closed. Each ancestor between a writable root and a protected path gets `(deny file-write* (literal <dir>))`, so a parent rename cannot move it (SEC MEDIUM-2).
- **Claude Code's own sandbox on** (settings `sandbox.enabled`, or `SANDBOX_RUNTIME=1`): no wrap, because Seatbelt cannot nest. The fallback rules apply (CR MEDIUM-1).
- **Fail closed:** a failed self-test, or a planted or foreign-owned private folder, refuses the review agent's call. No silent fallback. Any use of the fallback is logged as `review-fallback` (SEC INFO-3).
- **gh** is refused inside the sandbox, because it cannot read its login there. The refusal says "ask the main agent". gh still works in the fallback (CR LOW-1).

**Consequences.**
- \+ Writes, sockets, home files and the environment are closed by default. A new toolchain needs a probe and a list entry.
- \− Tools that need a socket or a credential fail with a clear refusal (gh here; docker and kubectl in ADR-026). A reviewer cannot run gh.
- \− Excluded commands in Claude Code's own settings sit outside the wrap (a known limit).

**Alternatives rejected.** Keep the deny-list and add more paths (plantable temp paths stay open). Nest Seatbelt under Claude Code's sandbox (not possible).

---

## ADR-023: Read, Grep and Glob are gated for review agents

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R9-2)

**Context.** Read, Grep and Glob bypass the Bash gate and the sandbox. Round 8 found that a review agent could read credential files directly (SEC HIGH-2, PEN LOW, CR MEDIUM-4).

**Decision.**
- The PreToolUse matcher in `hooks.json` is `Bash|Edit|Write|MultiEdit|NotebookEdit|Monitor|Read|Grep|Glob`, with a 15 s timeout.
- For gate agents, a path (`file_path`, `path`, or a glob that resolves under one) in the credential set is refused. The set lives in one shared list, `watcher/src/tool-gate/credential-places.ts`, which the sandbox also uses. It covers both homes: `~/.ssh`, `~/.config/gh`, `~/.aws`, `~/.docker/config.json`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.oss/config.json*`, `~/.oss/credentials*`, `~/.codex`, `~/.claude.json`, `~/.claude/.credentials*`, `~/.kube`, `~/.gnupg`, `~/Library/Keychains`, `~/.config/stripe`.
- Builders and the main agent are unchanged.

**Consequences.**
- \+ Reviewers cannot read the credential set through any of the three tools, and the sandbox and the gate use one list.
- \− A glob that resolves under a credential place is refused even if it would match nothing else.

---

## ADR-024: Swift, JVM/Gradle and .NET build and test are refused for review agents on macOS

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R9-3)

**Context.** These stacks' build and test commands cannot run in the review sandbox. The user accepted that as a limit rather than widen the allowlist.

**Decision.** For review agents on macOS, these commands are refused: `swift build|test|run`, `mvn`, `mvnw`, `gradle`, `gradlew`, `dotnet build|test|run`, and `xcodebuild`. The exception is its list, version and settings queries. The refusal text is: "this stack's build and tests can't run in the review sandbox; review the code by reading it".

**Consequences.**
- \+ A reviewer gets a clear reason, not a sandbox error.
- \− No build or test evidence for these stacks in a review. A new card runs review checks in a temp copy of the repo (FOLLOWUPS).

---

## ADR-025: Builders and the main agent refuse a gate decision that times out

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R9-4); amends tool-gates ADR-005 (`.oss/dev/completed/tool-gates-2026-11-11/DECISIONS.md`) and ADR-016 for timeouts only

**Context.** A builder or the main agent was allowed through when the gate's decision ran out of time. A command that is slow to check (for example, a long `[[:` bracket run) could therefore skip the gate.

**Decision.** When the decision runs past its deadline (DECISION_MS, or the worker's hard limit), builders and the main agent are refused with: "Refused by the tool gate: this command is too complex to check in time; split it into simpler commands." A crash, a CLI failure, no node or a changed node still fail open for them, with a tell (ADR-007). Review agents already fail closed (ADR-016). The hook's own timeout is 15 s, so the hook's cap decides before the watchdog.

**Consequences.**
- \+ A slow check cannot let a command through unchecked.
- \− A legitimately complex command is refused and must be split. The message says so.

---

## ADR-026: docker, docker-compose, podman, kubectl, helm and k9s are refused for review agents on macOS

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R9-5, picked after the round started); replaces the round-8 limit that these programs fail inside the sandbox

**Decision.** For review agents on macOS, these programs are refused before any wrap, with: "docker/kubectl can't run in the review sandbox; review the files (Dockerfile, compose, manifests) instead". The message is customer-visible, so the release notes carry it (FOLLOWUPS).

**Consequences.**
- \+ Reviewers get the reason and a next step, not a socket or config error.
- \− No container or cluster checks in a review. The temp-copy card covers this later.

---

## ADR-027: Review agents' Read, Grep and Glob mirror the sandbox allowlist

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R10-1); supersedes ADR-023's deny-list

**Context.** Round 9 found that ADR-023's credential deny-list left the rest of the home readable through Read and Grep, and that the firmlink path `/System/Volumes/Data/...` bypassed it (SEC HIGH-1, HIGH-2; CR MEDIUM-3).

**Decision.**
- Under a home folder, review agents may Read, Grep or Glob only: the reviewed repos (real git toplevels), their own private folder (ADR-028), and the sandbox's read-only toolchain folders. Everything else under a home is refused, including other projects in ~/dev, `.zsh_history` and `Library/Application Support`.
- Outside home, temp and system paths stay readable, except Claude Code transcript folders (`/private/tmp/claude-*/**/tasks/**` and the same under `$TMPDIR`). Those are refused in Read, Grep and Glob, and denied for reads in the sandbox.
- One allowlist module, `watcher/src/tool-gate/review-places.ts`, serves both sandbox.ts and the read gate, so the layers cannot drift.
- Refused outright: firmlink forms (`/System/Volumes/Data/<home>`), `/.vol/...`, `~user/...`, and a Grep or Glob rooted at or above a home, `/tmp` or TMPDIR, a `claude-*` folder, or `/System/Volumes/Data`.

**Consequences.**
- \+ One list decides what a reviewer may read, in both layers.
- \− A reviewer cannot read a sibling project under ~/dev. It runs the review in its own repo.

---

## ADR-028: The review private folder is per agent, and Write/Edit go only there

**Date:** 2026-11-13 · **Status:** Accepted (user pick 2026-11-13, D-R10-2); customer-visible

**Context.** The private folder was per session, so review agents in one session shared it, and Write and Edit could reach any temp path (SEC MEDIUM-1, LOW-4; CR HIGH-1).

**Decision.**
- The private folder is `<T>/oss-review/<session>/<agent id>`. The agent id comes from the hook input and is validated like the session id; the session folder is used only when there is none. The Bash wrap's TMPDIR and cache variables point to the same folder.
- Review agents' Write, Edit, MultiEdit and NotebookEdit write only inside that folder. One exception: creating a NEW `<T>/oss-offload.XXXXXX/prompt.md` for the served offload step. The folder must sit directly in temp, be 0700, be owned by the user and not be a link, and prompt.md must not exist yet (create-only, never overwrite).
- Everything else in temp is refused, and the refusal names the folder to use instead.
- Release notes: customer-visible (FOLLOWUPS round 9 card).

**Consequences.**
- \+ A reviewer cannot plant or overwrite files in temp outside its own folder.
- \− A review agent that wrote into a shared temp path must use its own folder.

---

## ADR-029: Main agent and builders refuse relative writes after a cd the gate cannot follow

**Date:** 2026-11-14 · **Status:** Accepted (user pick 2026-11-14); customer-visible; narrowed by ADR-031

**Context.** After `cd` to a folder the gate cannot know (an outside variable, a CDPATH set), a relative write could land under a protected path, such as `dir/**`, that the gate checked only by its literal name (lost cd, RED 4/15).

**Decision.**
- For the main agent and builders, a write to any relative path is refused when it could land under a protected path, `dir/**` included, after such a `cd`.
- The refusal says to use the full path or to cd to a plain folder in the same command.
- `cd src && …` stays allowed.
- LIMIT: `D=src; cd "$D"` is refused too, because the gate does not track variables for cd. Following literal call variables is a LOW follow-up (FOLLOWUPS).

**Consequences.**
- \+ A relative write cannot escape the check through an unknown cd.
- \− Some harmless `cd "$VAR"` commands are refused and must be rewritten with a full path or a literal cd.

---

## ADR-030: Unwrapped review Bash gets one fixed allow note, and the hook refuses any other allow

**Date:** 2026-11-13 · **Status:** Accepted (round 10, part A)

**Decision.**
- A review agent's Bash call allowed without the sandbox rewrite (its own setup steps, host-sandbox fallback) gets exactly `additionalContext: "This command runs outside the review sandbox."`.
- On macOS, the hook refuses any other allow for a review agent's Bash that has no `updatedInput`. The check matches the whole answer, not a substring (SEC INFO-1).

**Consequences.**
- \+ A review Bash call cannot pass unwrapped without the note, and a stray allow is refused.
- \− Review setup steps that run outside the sandbox are visible to the main agent as such.

---

## ADR-031: After an unknown cd, only real writes are refused, and safe variables are followed

**Date:** 2026-11-14 · **Status:** Accepted (user pick D-R11-1, 2026-11-14: "Narrow + follow safe vars"); customer-visible. It narrows ADR-029.

**Context.** ADR-029 refused every relative write after a cd the gate could not follow. That also refused OSS's own served commands (`top=$(git rev-parse --show-toplevel) && cd "$top"`) and read-only arguments such as `cd "$d" && npx vitest run test/a.test.ts`.

**Decision.**
- After a cd the gate cannot follow, the gate refuses only real writes that could land under a protected path: redirect targets, known output options, and the targets of write programs (rm, mv, cp, touch, tee, sed -i, mkdir, ln, chmod, curl -o and the others the write rules already know). Read-only arguments to other programs are allowed.
- For the main agent and builders only, the gate follows a variable set earlier in the same command to either a plain literal (`D=src`) or exactly `$(git rev-parse --show-toplevel)`.
- The gate fails closed, so the cd stays unknown, if anything in the command could change that variable between the set and the use. The setters are: a second assignment, `read`, `printf -v`, `eval`, `declare`/`typeset`/`local`/`export` with a value, `unset`, namerefs, `mapfile`/`readarray`, arithmetic assignment, `getopts`, `for X in`, `select`, a function or alias definition, `source`/`.`, a subshell boundary between set and use, and an array variable.
- A folder whose value comes from `$(mktemp -d …)` set in the same command counts as temp, so it is not protected.
- Review agents never get variable following. An explicit follow flag in gate.ts enforces this.
- A regression test runs every served command bash block (plugin commands/*.md, plus the API's plan, ship, ship-team, build and ideate.md) as the main agent and as a builder, through the real `runToolGate`, and requires allow. It uses watcher/test/fixtures/served-command-blocks.json, generated by watcher/scripts/served-command-blocks.mjs, with a staleness check. The blocks refused before R-266 are listed in KNOWN_REFUSED (see FOLLOWUPS).

**Consequences.**
- \+ Served commands and read-only test runs after a `cd "$VAR"` are allowed again. Real writes under a protected path are still refused.
- \+ Literal and git-toplevel variables are followed, so the gate sees the real folder.
- \− Any other variable setter still makes the cd unknown, so `D=$(…); cd "$D"` is still refused. The literal-cd-variables follow-up stays open.

---

## ADR-032: Constructs that make the cwd or a write target unknown

**Date:** 2026-11-15 · **Status:** Accepted (round 11); customer-visible

**Decision.** These make the cwd or a value unknown, so the gate treats them as unknown and fails closed:
- `eval`;
- `alias`, or `shopt -s expand_aliases`;
- a reassigned HOME (then `~` is unknown);
- `$(…)` or backticks in a write target (an unknown path, refused when it could land under a protected path, for every agent);
- `source` and `.`, except ~/.oss/hooks/* and $CLAUDE_PLUGIN_ROOT/hooks/*;
- nested-index or plain-index CDPATH/cdpath assignments (bash `CDPATH[X[0]]=…`, `CDPATH[X[0]]+=…`, zsh `cdpath[X[1]]=…`, zsh `${(A)cdpath::=…}`, braced forms included), for main, builder and review fallback (CR HIGH-B).

Also: firmlink paths (`/System/Volumes/Data…`, any case) are stripped, case-folded, before protected-path matching. The helper is `withoutFirmlink` from review-places.ts, imported and not edited (SEC HIGH-1).

**Consequences.**
- \+ A write target or cwd hidden behind eval, an alias, a moved HOME, a substitution or a firmlink is still matched against the protected paths.
- \− Some rare shell forms are refused and need a plain spelling.

---

## ADR-033: Sandbox hardening for review agents

**Date:** 2026-11-15 · **Status:** Accepted (round 11); customer-visible

**Decision.**
- The profile denies `(deny file-write-create (vnode-type SYMLINK))`. This also covers `ln -s`, `symlink()` and rename-over-a-link (SEC CRITICAL-1).
- The Read, Grep, Glob and Write/Edit checks for private-folder paths lstat each path part and refuse any symlink.
- In sandbox mode, `node --test` file paths are limited to the reviewed repos, as the other runners already are.
- Other agents' `<T>/oss-review/**` folders are denied in both layers (review-places and the profile). The agent's own folder is the only exception (SEC LOW-3).
- Nested git repos inside a readable root are denied in both layers (nested-repos.ts). A readable root that contains other git toplevels or worktrees, which it did not name, is refused (SEC LOW-1).
- A worktree's or submodule's real gitdir and common dir are readable, read-only. For each readable repo, `realpath(git rev-parse --git-common-dir)` and `--absolute-git-dir` are added as read-only places and go through the readable-roots check (CR HIGH-A).
- The offload prompt.md exception is bound to the folder that this agent's own allowed `mktemp -d -t oss-offload.XXXXXX` call created. The gate records that folder in the per-agent state when it allows that own step (SEC LOW-2).
- `NODE_V8_COVERAGE` is allowed only when its path is in temp (SEC INFO-2).
- The homes are injectable, so the tests are hermetic and never read the real `~/.claude` (CR LOW-A).
- New read-only toolchain places: ~/.pub-cache, ~/.virtualenvs, ~/.cabal, ~/.ghcup, ~/.opam and ~/.composer. Each has a temp-HOME probe (CR LOW-B).
- Glob's joined `base/pattern` is capped with `tooLong`. A reviewed repo inside `/private/tmp/claude-*` can be searched when the search root is in that repo, unless the path is inside a `tasks/` transcript folder (PERF LOW-3, PERF INFO-2).

**Accepted limit.** A `setsid` or `setpgrp` child can outlive the call. No surviving child can create a symlink, because the profile denies it. The CRITICAL-1 exploit is checked end to end: a detached swapper child, then the gate check, then open.

**Consequences.**
- \+ A review agent cannot swap a symlink into its private folder or read another agent's review folder.
- \− A reviewer that runs toolchains from the new folders must use the read-only places named above.

---

## ADR-034: The /oss:login status line is written by a hook

**Date:** 2026-11-15 · **Status:** Accepted (user pick 2026-11-15: "Move write into hook"); customer-visible

**Context.** ADR-031 made the gate refuse login.md step 3's write to ~/.claude/settings.json. That write had only been allowed before because the gate could not resolve `$CLAUDE_SETTINGS`.

**Decision.**
- The write now lives in hooks/oss-statusline-settings.sh. It takes no arguments, writes atomically, keeps the file mode, and refuses symlinks, invalid JSON and a missing jq.
- oss-session-start.sh copies it, and oss-setup-permissions.sh allowlists it.
- login.md calls the hook.
- The protected-path rule is unchanged.

**Consequences.**
- \+ /oss:login works with the variable rules in ADR-031.
- \− The status line write depends on the hook being copied at session start.

---

## Round 10 hardening (recorded, no ADR number)

- Host-sandbox detection trusts only `SANDBOX_RUNTIME=1`, the user's `~/.claude/settings.json` and `settings.local.json` (both homes), and managed settings. Never a project file (SEC MEDIUM-3, PEN LOW-1).
- Inside the sandbox, the clipboard (pasteboard mach services) is denied (SEC MEDIUM-2).
- Binding OSS's proxy ports (8473 and the configured proxyPort) is denied in the sandbox (SEC LOW-3).
- The call's process group is killed on exit. A pen tester server must use run_in_background (SEC LOW-3).
- Readable roots must not be or contain a home, `~/.oss` or `~/.claude`; the gate fails closed (SEC HIGH-1).

---

## ADR-035: Variables in write and cd targets: follow or refuse

**Date:** 2026-11-15 · **Status:** Accepted (user pick D-R12-1, 2026-11-15: "Follow or refuse"); customer-visible. It supersedes the setter block list in ADR-031.

**Context.** ADR-031 followed a variable only when it was a literal or `$(git rev-parse --show-toplevel)`. A write could still hide a protected path behind a variable. Round 11 found this in pen test CRITICAL-1, SEC HIGH-A, CR H1 and CR M3.

**Decision.**
- For the main agent and builders, a variable set earlier in the same command is followed only when both hold:
  - its value is a literal, `$(git rev-parse --show-toplevel)`, or `$(mktemp …)` or `$(mktemp -d …)`. A mktemp value counts as temp.
  - only allowlisted plain commands stand between the set and the use. The list is HARMLESS_COMMANDS: cd, git, ls, echo and printf without -v, test and `[`, mkdir, cp, mv, rm, cat, grep, true, false, `:`, chmod, find and touch.
- Command words are matched after quote removal.
- These fail closed, so the variable is unknown: quoted or backslashed command words, `$'…'`, `$((`, `$[`, `[[`, `${…}` other than `${NAME}`, subshells and pipes.
- 34 shell-maintained names are never followed and never read from the environment. Examples are `_`, DIRSTACK, PIPESTATUS, OLDPWD and RANDOM. Each name has a test.
- A variable set in any other way is unknown. That covers another `$(…)`, read, printf -v, for and arithmetic.
- A variable not set in the command is read from the gate's process environment. That happens only while every command before its use is harmless.
- A write target with an unknown part is refused when its literal tail could match a protected glob. A bare unknown with no tail is refused unless it is followed to temp.
- `tailMayBeProtected` is fixed. It asks whether `<anything>/<tail>` can match a protected glob. Before the fix it always answered yes.
- This applies to the main agent and builders. Review agents never follow variables.
- The served-commands acceptance test stays green. Only the five R-272 KNOWN_REFUSED blocks stay refused.
- Accepted limit: `"$X/notes.txt"` is allowed, even though X could name a protected folder.

**Consequences.**
- \+ A write through a followed variable is checked against the real folder. `> "$X/notes.txt"` is allowed. `> "$X/config"` and `> "$X/.git/config"` are refused.
- \− Any other setter makes the variable unknown. A write that could land on a protected path is then refused.

---

## ADR-036: A bare unknown-variable write target stays allowed for main and builders

**Date:** 2026-11-16 · **Status:** Accepted (user pick 2026-11-16: "Allow, record as limit"); accepted limit.

**Context.** ADR-035 would refuse a bare unknown-variable write target, such as `X=$(…); rm "$X"` or `chmod 700 "$G"`. That would newly refuse 20 served blocks in /oss:login, /oss:plan, /oss:ship and /oss:ship-team.

**Decision.**
- For the main agent and builders, a bare unknown-variable write target stays allowed. This is how it worked before R-266.
- Review agents refuse it.
- A bare `$(…)` write target stays refused.
- write-variables.test.ts pins this with an "accepted limit" test.
- R-272 records this. The served steps should become readable later.

**Consequences.**
- \+ The 20 served steps keep working.
- \− For the main agent and builders, the text gate is a guardrail, not a wall. They can run any code.

---

## ADR-037: The nested-repo scan skips git-ignored folders

**Date:** 2026-11-15 · **Status:** Accepted (user pick D-R12-2, 2026-11-15: "Skip ignored folders").

**Context.** PERF MEDIUM-1: a large ignored folder, such as build/ with about 100k files, slowed the nested-repo scan.

**Decision.**
- The scan covers tracked places, untracked places that are not ignored, and submodules. It reads them from the index.
- It makes at most 2 git calls. The calls are `git ls-files --others --exclude-standard --directory` and the index, for gitlinks.
- The result is cached in `~/.oss/run/gate-run/<session>/`. The cache key is the index, HEAD, and the root folder's stat.
- A timeout has its own refusal text: "the nested-repo check timed out".

**Accepted limits.**
- A clone inside a git-ignored folder stays readable to reviewers.
- A clone added deeper, without an index change, stays unseen until the index changes.

**Consequences.**
- \+ Large ignored folders no longer slow the nested-repo check.
- \− The two accepted limits above.

---

## ADR-038: No mounting in the review sandbox

**Date:** 2026-11-16 · **Status:** Accepted (round 12).

**Context.** SEC CRITICAL-A: a review agent could mount a disk image over the repo.

**Decision.**
- The sandbox profile denies the `com.apple.DiskArbitration` mach lookup.
- It denies running `/usr/bin/hdiutil`, `/sbin/mount*` and `/System/Library/Filesystems/**`.
- Backstop: after a review Bash call, a new mount under a reviewed repo or the private folder voids the run.
- A Grep or Glob under the private folder does a bounded lstat walk of 5000 entries. It refuses any link.
- The transcript rule matches only the transcript depth.

**Consequences.**
- \+ A review agent cannot mount an image over a repo. The sandbox test runs hdiutil inside the real sandbox and checks that it fails.
- \− A reviewer cannot mount a disk image for its own work.

---

## ADR-039: Hardening the gate side and the login hook

**Date:** 2026-11-16 · **Status:** Accepted (round 12).

**Decision.**
- The login hook (hooks/oss-statusline-settings.sh) pins PATH at the top.
- It takes HOME from the password database. It refuses, and writes nothing, when `$HOME` differs from it.
- It reads the file mode with BSD stat, then GNU stat. An empty settings file counts as `{}`.
- The gate refuses `HOME=`, `PATH=` or an `env` wrapper on `~/.oss/hooks/*` calls, for every agent.
- A plugin's hooks are trusted for `source` only when the plugin folder is not inside the project or a reviewed repo.
- Output options match by name in any case, with one or two dashes. Values of `*dir` options count as folders.
- Tools' write options come from `reviewWriteOptions` in the settings file. That covers ruff --fix and biome --apply.
- `follow` defaults to false. There is no global grant.

**Consequences.**
- \+ The login hook writes only to the real home and keeps a fixed PATH.
- \+ A call that sets HOME, PATH or env on a hook call is refused for every agent.
- \− Such a call needs a plain spelling.

---

## ADR-040: The nested-repo cache is removed

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R13-1, 2026-11-16: "Drop cache, accept slow"). It amends ADR-037.

**Context.** ADR-037 cached the nested-repo result in `~/.oss/run/gate-run/<session>/`. Anything running as the user can write there. A builder's test code, for example, could forge a cache. A later review agent would then see nested repos it should not see. A cache can also go stale.

**Decision.**
- The cache is removed. No file is written under `~/.oss/run`, and there is no cache key.
- Git is asked fresh on every review call. The calls are the cheap ones from round 12: `ls-files --others --exclude-standard`, plus the gitlinks.
- Git output is streamed to a private temp file and read 1 MB at a time.
- Only folder entries and gitlink entries (mode 160000) are kept. A huge index no longer fails closed.

**Accepted limit.** In a repo with tens of thousands of untracked, not-ignored files, parallel review calls may be refused with "the nested-repo check timed out". No lock or cache is added to work around this.

**Consequences.**
- \+ No forged or stale nested-repo state.
- \+ A repo cloned into an untracked folder is seen on the next call.
- \− Slow cold scans on huge untracked folders.

---

## ADR-041: Only mounts that are new after the review starts void the run

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R13-2, 2026-11-16: "Void only new mounts"). It amends ADR-038.

**Context.** Dev containers and Codespaces mount the project folder itself. A backstop that voided on every mount at the root would void every review in those places.

**Decision.**
- A review agent's first pre call records the mount table once. The file is `~/.oss/run/gate-run/<session>/<agent>.mounts`. With no safe agent id, the file is `session.mounts`.
- The baseline is write-once. The writer writes a draft, then puts it in place with link(). The first writer wins.
- Every review pre call makes sure the baseline exists before it is allowed. An unreadable mount table, or a failed write, refuses the call.
- The post check reads the mount table first. It has its own 1.5 s cap, independent of the decision deadline. The post check runs no nested-repo git.
- The run is voided only for a mount at or under a protected place that is not in the baseline. The protected places are the project folder, the cwd's repo, the named repos, their git folders and the private folder.
- A missing or unreadable baseline voids the run. An unreadable mount table voids the run. So does a review post call that cannot finish.
- `/Library/Filesystems` is added to the sandbox exec deny.

**Consequences.**
- \+ Review agents keep working in dev containers and Codespaces.
- \+ A mount added during a review still voids it.
- \− A mount that exists before the first pre call is not voided.

---

## ADR-042: The gate's view of zsh and of other forms

**Date:** 2026-11-16 · **Status:** Accepted (round 13). Covers CR H-1, CR M-1, CR L-a, CR L-d and CR M1 leftovers.

**Context.** On macOS, Claude Code runs the main agent's and builders' Bash calls in zsh (`/bin/zsh -c`). Elsewhere it uses bash. The gate must be safe under both shells.

**Decision.**
- **Unknown variables and zsh forms.** An unknown or followed variable that is directly followed by a zsh modifier or subscript has no known tail. The forms are `$X:…`, `$X[…]`, `$~X`, `$=X`, `$^X`, `$+X` and `$#X`. In either shell, `${X:…}` and `${X[…]}` count too.
- As a write target, such a form is refused, like a bare `$(…)`.
- As a cd target, it makes the folder unknown. It is never followed.
- **Shell-maintained arrays** (dirstack, path and others) are never followed.
- **Pinned accepted limit (ADR-036).** A word that is exactly `"$X[…]"` counts as a bare variable. It is allowed for the main agent and builders.
- **Harmless commands.** `printf` is dropped from HARMLESS_COMMANDS. `test` and `[` are not harmless with `-v` or `-R`, with an unknown operand, or with a wildcard operand. `plainMentions` counts a name after a dash.
- **oss-hook-env.** The rule decides from tokenized words, not raw text. It covers brace expansion, zsh `path=(…)`, `${HOME:=…}`, scripts after `-c` or `eval`, heredoc bodies and the `env` wrapper. A comment that only mentions HOME is allowed.
- **Output options.** Names are normalised by dropping `_` and `-`, in any case. Added: outputpath, reportdir, coveragedir, declarationdir, and `prettier -w`.
- **Sourced plugin hooks.** A plugin's hook files are trusted for `source` only when the plugin root is a protected path (`~/.claude/plugins/**`, or another protected path). The check uses the real path, with firmlinks stripped.

**Consequences.**
- \+ The gate reads zsh forms the same way under both shells.
- \+ A zsh modifier cannot hide a protected write target.
- \− `printf` no longer counts as harmless. A step that relied on it is now checked as any other command.
- \− A user's own `cd` alias from the zsh snapshot is not handled. This is CR I-b, noted only.

---

## ADR-043: On macOS there is no mount baseline

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R14-1, 2026-11-16: "Record on Linux only"). It amends ADR-041.

**Context.** A heads-up showed that the mount baseline sat in `~/.oss/run/gate-run/`. Code running as the user can write there. So it can forge the baseline. Round 13 SEC CRITICAL-1 showed the same risk from the other side: a reviewer called mount(2) directly and mounted devfs over `~/.claude/plugins`. That turned the gate off.

**Decision.**
- The review sandbox denies `file-mount` and `file-unmount`.
- **macOS:** there is no baseline. Any mount at or under a watched place voids the run.
- **Linux:** the per-agent baseline stays, for dev containers and Codespaces.
  - It compares (device, mount point) entries as a multiset.
  - A stacked mount voids the run.
  - A baseline mount that disappears voids the run.
- **Watched places:**
  - the repo top folders and their git folders;
  - the private folder;
  - `~/.claude`, `~/.oss` and the plugin root in use.
- Every review pre call checks the watched places, not only post calls.
  - On a pre call, an unreadable mount table refuses the call. It does not void the run.
  - On a post call, an unreadable mount table voids the run.
- The mount table is read before the decision deadline starts. The read is capped at 1.5 s.
- When the shell hook fails on a review agent's post call, it writes the same tamper mark as the CLI. The failures are a crash, a kill, no node, and the 4 s limit.

**Accepted limits.**
- On Linux, code running as the user can rewrite the baseline. This joins the Linux-fallback limit.
- On macOS, a repo that is itself a volume's root folder cannot be reviewed.

**Consequences.**
- \+ On macOS, a mount over a watched place cannot hide from the gate.
- \+ A reviewer cannot mount anything.
- \− On macOS, a repo that is a volume root is refused.

---

## ADR-044: Cheap fixes for the nested-repo check

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R14-2, 2026-11-16: "Cheap fixes + wider text"). It amends ADR-040.

**Context.** The nested-repo check ran two git calls one after the other. The untracked scan had a fixed 500 ms cap. A killed call could leave a temp folder behind, and nothing removed it.

**Decision.**
- The two nested-repo git calls run side by side.
- Each call gets the decision's time left, at most 1000 ms.
- Temp folders live under `$TMPDIR/oss-nested-<uid>`.
- At the start of a scan, temp folders older than 10 minutes are removed.
- The timeout refusal now says "retry this call on its own, or with fewer calls at once".
- The sandbox-exec advice is dropped from the timeout text.
- No cache and no lock are added.

**Accepted limit (reworded in round 15, PERF LOW-1).** The cost grows with the number of files times the number of parallel calls. On a 12-core Mac, calls may be refused with "the nested-repo check timed out" at about 100k files with 16 or more calls at once, at about 200k files with 2 or more, and at about 250k files or more even alone. Files inside an ignored folder don't count. Repos with 30k files and our own repos are fine.

**Consequences.**
- \+ A killed call no longer leaves temp folders to pile up.
- \+ The timeout message says what to do next.
- \− Huge worktrees can still hit the timeout under parallel calls.

---

## ADR-045: Gate state moves to `~/.oss/gate-state/`

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R14-3, 2026-11-16: "Move gate state out"). It amends ADR-041 and ADR-040.

**Context.** Security INFO-1: the main agent and builders can delete a review run's tamper marks. On Linux they can also rewrite the mount baseline. Both live in `~/.oss/run/gate-run/`. Protecting that folder in place would refuse a served /oss:plan block. That block runs `find ~/.oss/run -mindepth 2 -name '*.txt' -mtime +7 -delete`.

**Decision.**
- All gate run state moves from `~/.oss/run/gate-run/` to `~/.oss/gate-state/`.
- The folder is made 0700. A symlinked root is refused.
- The state is:
  - the session folders;
  - the started, seen and done files;
  - the `.tamper` marks;
  - the `*.notice.json` files;
  - the `.mounts` baselines;
  - the answer files.
- `~/.oss/gate-state/**` is a protected path. The main agent and builders cannot delete tamper marks or rewrite baselines.
- Old `~/.oss/run/gate-run` folders are left behind. They are not migrated and not deleted.
- The `gate-run` name stays for the CLI and the commands. Only the folder path changes.

**Side effect.** The unused `oss-gate-run.sh add-repo` route is refused. It made an agent write `repo-request.txt` into the gate folder.

**Consequences.**
- \+ A builder or the main agent cannot forge or delete review run state.
- \+ The served /oss:plan clean-up still works.
- \− Old run folders stay on disk until the user removes them.

---

## ADR-046: More shell forms read as unknown

**Date:** 2026-11-16 · **Status:** Accepted (round 14). It extends ADR-042.

**Context.** Round 13 review and security gates found shell forms the gate read as plain text. The forms could hide a write to a protected path under zsh or bash.

**Decision.**
- **zsh forms.**
  - `${(…)…}` parameter flags are unreadable.
  - An unquoted `(` right after a word is unreadable.
  - `[[ ]]`, `name=(…)`, `f()` and `function f()` are exempt.
  - Glob qualifiers that run code, or that hold a `:` modifier, are refused. So bash `!(test)` is refused.
- **Tilde forms.** `~+`, `~-`, `~N`, `~+N`, `~-N`, `~[…]`, and a `~` before any other character, are an unknown head. They are treated like `$(…)`.
- **Shell options.** A shell option the gate does not model makes the folder and all variables unknown from then on.
  - It covers `setopt` and `unsetopt`, `options[…]=`, `emulate`, `set -o` and `set +o`, `shopt -s` and `shopt -u`, and the start options of a nested `zsh`, `bash` or `sh`.
  - Allowlist names: errexit, (no)unset, pipefail, xtrace, verbose, errtrace, functrace, glob, clobber, nomatch, nullglob, failglob, braceexpand, localoptions, localtraps, globdots, dotglob.
  - Allowlist letters: e, u, x, v, f, C, E, B, 4.
  - shopt names: dotglob, nullglob, failglob, extglob.
  - `emulate [-L|-R] zsh` is allowed.
  - extendedglob is not allowlisted.
- **Wildcards in values.** An unquoted variable whose value holds `*?[#^(<` is treated as a wildcard pattern.
- **Destinations.** A cp, mv, ln, install, ditto or rsync destination that could be a folder holding protected files is refused. For example `cp x .git/hooks`.
- **Indirect names.** oss-hook-env counts these as HOME or PATH setters:
  - `printf -v` with a name that is not written out;
  - `declare`-family commands with a name that is not written out;
  - `-n` namerefs.

**Consequences.**
- \+ The zsh and bash forms above can no longer hide a write to a protected path.
- \− Some valid commands that use these forms are now checked or refused. Bash `!(…)` is refused.
- \− A user who relies on an unmodelled shell option will see the gate read the rest of the folder as unknown.

---

## ADR-047: Bash extended patterns and common shell options are safe again (D-R14-4)

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R14-4, 2026-11-16: "Loosen the safe cases"). It amends ADR-046.

**Context.** A heads-up said that round 14 had tightened the agents' own commands without asking first. Round 14 refused ordinary commands that were safe.

**Decision.**
- **Bash extended patterns.** `!(…)`, `@(…)`, `+(…)`, `*(…)` and `?(…)` are ordinary wildcards, unless the text in the brackets could be a zsh qualifier list that runs code.
  - The text counts as a qualifier list only if it has no `|` and starts with a qualifier character.
  - It is refused if it holds `+`, `:`, `#` or `(`, or an `e` or `P` whose delimiter closes later in the list.
  - A fuzz run of about 51,000 real zsh 5.9 evaluations found no unsafe allow.
  - Examples: `!(test)` and `!(node_modules)` are allowed. `!(tests)` and `!(esxs)` are refused, because in zsh they can run a command.
- **The extendedglob option** is safe. Its `#`, `^` and `~` are read as wildcards.
- **Two classes of shell option.**
  - Full: cdablevars, globsubst, braceccl, magicequalsubst, autocd, `-T`, `-J`, `setopt -m` and bare `emulate`. These make the folder and all variables unknown.
  - Partial: every other option the gate does not model. After one of these, a plain literal write target is judged as before. Variables, wildcards (including `#^~`) and any later cd stay unknown. A later cd makes the option full.
- **More safe options:**
  - allexport (`a`), globstar, errreturn, interactivecomments, vi and emacs;
  - `setopt -o NAME` and `setopt +o NAME` are read as names;
  - `set -A` with a literal name is a partial option.
- **Still refused:**
  - cdablevars, globsubst, `(e)` and `${(…)}`;
  - code-running qualifiers;
  - a file run with `.` or `source`. Under the round-11 rule this makes the folder unknown. So `set -a; . .env; set +a; echo x > out.txt` is refused.

**Consequences.**
- \+ Common `!(…)` patterns and the common shell options work again.
- \+ The reason text no longer calls a bash extglob a "glob qualifier that can run a command".
- \− `!(tests)`-style qualifier-like patterns stay refused.

---

## ADR-048: Round 15 is the last round for known shell bypasses (D-R15-1)

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R15-1, 2026-11-16: "Fix r15, then new card"). It sets the end rule for R-266.

**Decision.**
- Round 15 fixes every round-14 finding.
- After round 15, a new shell-trick bypass by the main agent or a builder is an accepted limit of text reading, like ADR-036. It goes to a new card unless it is critical.
- The new card runs main-agent and builder Bash in a macOS write-only sandbox that denies protected paths. The OS then enforces the rule, and no text reading is needed.
- Review-agent containment stays fully enforced. A review-agent escape or a critical finding still blocks R-266.

**Consequences.**
- \+ R-266 has a clear end rule.
- \− Main-agent and builder shell tricks are accepted limits until the new card lands.

---

## ADR-049: On macOS, mounts above the repo are not checked (D-R15-2)

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R15-2, 2026-11-16: "Linux only, accept on macOS"). It amends ADR-043.

**Decision.**
- On Linux, a mount above a watched place (a strict ancestor) is compared with the baseline. A new mount, or a vanished one, voids the run.
- On macOS and other hosts, there is no above-mount check.
- The mount-table read is capped at 1.2 s. The read, the decision and node start-up then fit under the 2.5 s hard limit.
- The tool-gate CLI's answer file moves to the protected `~/.oss/gate-state`.
- Nested-repo git runs go through the main thread's tracked runner. Each run has its own process group. On TERM, every live git group is killed. The `out` file is unlinked right after it is opened.

**Accepted limit.** On macOS, a mount above the repo, `~/.claude` or `~/.oss` is not caught when code outside the review sandbox makes it. The sandbox's mount deny is the defence.

**Reason.** macOS has no baseline (ADR-043). Without one, every review of a repo under a custom volume (for example a case-sensitive APFS volume at `~/dev/ws`) or a mounted home would void.

**Consequences.**
- \+ No false voids for repos on custom volumes or mounted homes on macOS.
- \+ Linux still compares above-mounts with the baseline.
- \− On macOS, an above-mount made outside the review sandbox is not seen.

---

## ADR-050: A trap or emulate string is expanded; an unknown value is refused (D-R15-3)

**Date:** 2026-11-16 · **Status:** Accepted (user pick D-R15-3, 2026-11-16: "Keep the refusal"). Release note: yes.

**Decision.**
- A double-quoted or unquoted `trap` string, or an `emulate … -c "…"` string, is expanded the way the shell does when `trap` runs. Followed literals are substituted, including a leading `$HOME`, `${HOME}` or `~`. The result is read as a nested script.
- A value the gate cannot know inside such a string is refused as too complex. This covers a value from `$(cat f)`, `for` or `read`. The shell reads the trap text as code when the trap fires. So an unknown value works like `eval` of unknown text.
- Common clean-ups stay allowed:
  - `tmp=$(mktemp -d); trap "rm -rf $tmp" EXIT`;
  - `D=build; trap "rm -rf $D" EXIT`;
  - single-quoted traps.
- Agents should use single quotes: `trap 'rm -f "$X"' EXIT`.

**Consequences.**
- \+ A trap cannot hide a script from the gate.
- \− A double-quoted trap with an unknown value is refused. The refusal says to use single quotes.

---

## ADR-051: Other round-15 reader rules (extends ADR-042 and ADR-046)

**Date:** 2026-11-16 · **Status:** Accepted (round 15).

**Decision.**
- A single-quoted trap's first operand and an `emulate -c` string are read as nested scripts.
- `functions[…]=`, `sched`, and a trap string that is neither plain nor expandable are unreadable. This also applies with the `builtin`, `command` and `noglob` prefixes.
- `noglob`, `nocorrect` and `-` are cd prefixes.
- `repeat N`, `enable -n cd`, `disable cd` and `unfunction cd` make the folder unknown from then on.
- An unknown variable next to a wildcard in the same path segment is checked as `*<rest>`.
- Unquoted wildcard characters in an unknown tail stay a pattern.
- A literal-set variable is followed wherever it sits in the word.
- A write target with a literal prefix and an unknown end counts as unknown, not bare, when the prefix plus `*` could match a protected path. So `echo x > ".oss/$X"` is refused, while `"src/$X"` and a bare `"$X"` are allowed.
- `${~X}`, `${=X}` and `${^X}` are unreadable.
- A setter value that starts with `$HOME`, `${HOME}` or `~` (unquoted) resolves to the home folder.
- oss-hook-env counts these as HOME or PATH setters:
  - `mapfile` and `readarray` with a name;
  - zsh `set -A` and `set +A`;
  - any `$` inside `((…))`, `$((…))` or `$[…]`.

**Consequences.**
- \+ More indirect writes and folder changes are read, not guessed.
- \− The forms listed above are refused or read as unknown. Each refusal names a plain spelling to use.

---

## ADR-052: Review-sandbox loopback is an accepted limit (D-R16-1, D-R16-2)

**Date:** 2026-11-17 · **Status:** Accepted. User pick D-R16-1 was "Allow own servers only". User pick D-R16-2 was "Accept as limit", and it replaces D-R16-1.

**Context.** Security INFO-2 (round 15). A review agent's sandbox can open TCP connections to any service on 127.0.0.1, ::1 or the Mac's own LAN address. That includes other Claude Code sessions, Syncthing and eli-daemon.

**Decision.**
- First pick (D-R16-1): deny loopback except to ports bound inside the same sandbox.
- Finding: the macOS sandbox profile can't express that. `(target self|same-sandbox|others)` parses inside network rules but never matches. Ports can only be single fixed ports; ranges are invalid.
- Final pick (D-R16-2): loopback stays open for review agents.
- Unix sockets stay denied except mDNSResponder.

**Accepted limit.** A local service that takes commands without a password can be reached by a review agent.

**Follow-up.** On the OS write-sandbox card, audit local services that take commands without auth. Consider a network-namespace or proxy design.

**Consequences.**
- \+ Loopback works as it did in round 15.
- \− A review agent can reach a passwordless local service. This is recorded as a limit.

---

## ADR-053: Round-16 reader rules (extends ADR-050 and ADR-051)

**Date:** 2026-11-17 · **Status:** Accepted (round 16).

**Decision.**
- A script given to `trap`, `emulate … -c` or `sched` is read as a nested script, even when it holds a `$`. A variable set earlier in the call is filled in when it can be followed, and nothing after the trap can set it unseen. Otherwise the script is a hidden script. A hidden script is refused, like `eval` of unknown text.
- Inside a double-quoted trap or emulate string, these are unknown values, so they are refused as too complex (ADR-050):
  - shell-maintained names (PWD, OLDPWD, `_`, TMPDIR and the other names ADR-035 never follows);
  - subscripted or modified names.
- Any assignment to `functions` or `dis_functions` (whole, by subscript, or with `+=`) is unreadable and risky. So are `set -A` and `set +A` of them, and `enable -f`.
- With extendedglob on, `^` makes the rest of its path segment `*`. A `~` after the first character makes the rest of the word `*`. zsh's `^x` does not match dot names, so `^` adds none.
- A `[…]` list inside a qualifier or extglob bracket rewrites the word. It is allowed only if it holds digits, `,` and `-` alone.
- A write target with a literal head and any number of unknown parts is judged as head + `*`. Variables that can be followed are filled in first. So `".oss/$X$Y"` and `D=.oss; "$D/$X"` are refused.
- `repeat N` is a wrapper. The folder becomes unknown only when the repeated command could move it.
- An EXIT-only trap set outside a function doesn't make the folder unknown.
- A trap whose script sets nothing counts as harmless between a variable's set and its use.
- Arithmetic blocks are bracket-matched in one pass when looking for HOME/PATH setters. `getopts` and `zparseopts` with a name only known at run time count as HOME/PATH setters.

**Consequences.**
- \+ Nested scripts and folder changes are read, not guessed.
- \+ Ordinary `repeat`, EXIT-trap and repeated-trap commands work again.
- \− More forms are refused. Each refusal names a plain spelling to use.

---

## ADR-054: Trap recursive delete keeps the carve-out (D-R16-3)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R16-3, 2026-11-17: "Keep the carve-out").

**Decision.**
- Inside a trap, emulate or sched script, a recursive delete of a folder only known at run time (`trap 'rm -rf "$dir"' EXIT`) is judged like any unknown write. Its literal start and end are checked. It is not refused outright.
- So `trap 'rm -rf "$dir"' EXIT` stays allowed, as in round 15. `trap 'rm -rf .oss/$X' EXIT` is refused.

**Accepted limit, like ADR-036.** A builder can pass an unknown folder to a trap's `rm -rf`, just as it can at top level.

**Consequences.**
- \+ The common single-quoted cleanup trap still works.
- \− An unknown folder in a trap's `rm -rf` is not caught, as at top level.

---

## ADR-055: Three ordinary forms are refused (D-R16-4)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R16-4, 2026-11-17: "Keep all three refused"). Release note: yes.

**Decision.** Three ordinary forms are newly refused in round 16:
- `trap "rm -rf $TMPDIR/x" EXIT`. Use single quotes instead: `trap 'rm -rf "$TMPDIR/x"' EXIT`.
- `functions[f]='echo hi'; f`. Define functions with `f() { … }`.
- `ls src/!([ab]*)`, a bracket list inside `!(…)`.

**Consequences.**
- \+ Each refused form has a plain spelling that works.
- \− Agents that wrote these forms must change them.

---

## Round 16 part A (recorded, no ADR number)

- The review sandbox may write only `/dev/tty`, not every `/dev/tty*`. So a review agent can't write text to the user's other terminals (security INFO-1). Its own stdout and stderr still work.
- The mount re-read uses the injected clock.

---

## ADR-056: Glob groups, `$` in qualifiers, and setters after a filled trap (D-R17-1, extends ADR-053 and ADR-054)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R17-1, 2026-11-17: "Fix A+B, file C").

**Decision.**
- A `(` after the command already has words, or is a redirect target, is a zsh glob group. Its contents are skipped, with quotes respected. The word is unknown, so the call is unreadable. So `ls (a|#); git push --force origin main` and `rm -rf (.oss|x)` are refused.
- A `#` inside a group never starts a comment. A group that holds `#` is never read.
- These are exempt from the group rule: command start, `[[ ]]`, case patterns, `()`, `for ((`, zsh `for x (…)`, and `coproc`.
- A `$` or a backtick anywhere in a qualifier or extglob bracket rewrites the word. So `X='e:…:'; ls *($X)` is refused.
- After a value is filled into a trap, emulate or sched script, every later command must be harmless. Harmless means an outside program, a reporting builtin (pwd, type, which, whence, where, jobs), or exit, return or shift with plain numbers. It can also be one of the ADR-057 forms. Anything else refuses the call. Examples: `printf -v $(…)`, `read $x`, `(( $x = 0 ))`, `getopts ab $x`, `$CMD test`.
- A recursive delete inside such a script (the ADR-054 carve-out) is refused when its literal start plus `*`, or `*` plus its literal end, could be a folder that holds protected files. So `trap 'rm -rf "$dir"/.oss' EXIT` and `trap 'rm -rf ~/"$X"' EXIT` are refused. `trap 'rm -rf "$dir"' EXIT` stays allowed.
- `HIDDEN_SETTERS` and `LATER_HIDDEN_SETTERS` come from one shared list.
- The refusal for a protected path inside a trap, emulate or sched script names the script. It has no Read or `cat` hint.
- Open limit, filed to the OS write-sandbox card (option C): a command word taken from a variable (`T=git; $T push --force origin main`, `$(echo git) push …`, `T=eval; $T '…'`) is not read.

**Consequences.**
- \+ A glob group, a `$` in a qualifier, and a setter after a filled trap are refused, not guessed.
- \+ The hex-named setter limit is closed for filled traps.
- \− Agents that write these forms must change them.

---

## ADR-057: Safe builtins stay allowed after a filled trap (D-R17-2)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R17-2, 2026-11-17: "Loosen safe builtins").

**Decision.** After a value is filled into a trap, these builtins stay allowed. None of them can change the trap's variable.
- `set` with option flags only. `set -A` and `set +A` are refused, and so are unknown words. `set --` with values is allowed only if no filled script reads `$1`, `$@`, `$*` or `$#`.
- `export`, `local`, `typeset`, `declare`, `readonly`, `integer` and `float`, when every name is written out and none is a filled variable. Any `-n` nameref is refused.
- A later trap whose own script is readable: allowlisted or outside programs only. No `$(`, backtick, arithmetic, `${!`, `${(` or `::=`.

So `D=build; trap 'rm -rf "$D"' EXIT; set -e; npm test`, `D=build; trap 'rm -rf "$D"' EXIT; export FOO=1; npm test` and `D=build; trap 'rm -rf "$D"' EXIT; trap 'rm -rf "$D/x"' INT` are allowed. `$CMD test` after a filled trap stays refused.

**Consequences.**
- \+ Common cleanup traps can use `set -e` and exports.
- \− Other builtins after a filled trap are refused (ADR-056).

---

## ADR-058: Refuse only risky setters after a filled trap (D-R18-1)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R18-1, 2026-11-17: "Refuse only risky setters"). Supersedes ADR-057 and the after-trap part of ADR-056.

**Context.** Round 17's allowlist after a filled trap refused many ordinary clean-up scripts: `exit $?`, `[[ ]]`, `while read`, `wait`, `kill $PID` and `time`. Only four were shown to the user. Code review found the rest. This broke the rule "don't tighten customer flows silently" (see the memory note on customer flows).

**Decision.** After a value is filled into a trap, emulate or sched script, the call is refused only when a later command does one of these things. Later commands include top-level commands, commands inside `{ }`, compound bodies, subshells, `$(…)`, and later trap, emulate and sched scripts. The later scripts are read with the real tokenizer. Leading assignments and redirects are skipped.
1. Sets a variable whose name is not written out. Forms: `printf -v`, `print -v`, `read`, `vared`, `getopts`, `zparseopts`, `strftime -s`, `mapfile`, `let`, arithmetic that assigns, `export`, `typeset`, `declare`, `local`, `readonly`, `integer`, `float`, `set -A`, `zle`, `zmodload`, `${…:=}`, `${…::=}`, and subscript assignment. The zsh module builtins `zstyle`, `zformat`, `getln`, `sysread`, `zselect`, `zsocket`, `ztcp`, `zpty`, `compgen`, and `wait -p` count when a word holds `$`.
2. Sets a filled variable by name. It also sets IFS while a filled script reads a variable unquoted.
3. Is `eval`, `source`, `alias`, `unalias`, a nameref, `${!`, `${(P`, a function-array assignment, or a builtin that switches these on.
4. Is an unknown command word, such as `$CMD …`.
5. Changes a shell option outside the safe list. It also turns on extendedglob, because that changes how the trap's patterns expand when it fires.

Variables that the call sets, but that the gate does not follow, are watched like filled ones. The filled trap's own script is checked too. Everything else after a trap is allowed again.

`$argv` and `${argv}` count as positional parameters.

The refusal says: "a later command could change `$F`; or write the trap with double quotes, e.g. `trap \"rm -rf $F\" EXIT`".

Newly refused beyond the RED list: `setopt extendedglob` and `IFS=x` after a filled trap that reads its variable unquoted. The coordinator kept these and told the user. Setting them before the trap is fine.

**Known limit.** Arithmetic that only makes numbers (`exit $x`, `printf %d`) stays allowed.

**Consequences.**
- \+ Ordinary clean-up scripts after a trap work again.
- \− A setter with a computed name, `$CMD`, `eval` or the other forms above are refused after a filled trap.

---

## ADR-059: Round-18 shell-reader rules (amends ADR-056)

**Date:** 2026-11-17 · **Status:** Accepted (round-18 fix; no user pick).

**Decision.**
- A zsh glob group ends at its matching `)`. If an unquoted `;`, `&` or newline (or the end of the line) comes first, the `(` is read as before round 17. That is, as an operator, so later commands are checked. If the unclosed part holds a `#`, the call is refused.
- zsh does not end a group at whitespace. For example, `print -l (a|b c)` matches `a`. The reader does not end a group at whitespace either.
- `for` and `coproc` exempt a following `(` only when the keyword was read where a command starts.
- Quotes inside a group are skipped the way the shell skips them. A `\` in double quotes and `$'…'` are handled.
- A `#` inside a `(` in `[[ … ]]` or in a case pattern does not start a comment.
- Refusal texts quote at most 60 characters of a group or qualifier.
- Operator tokens (`(`, `)`, `;`, `&&`, `|`, newlines and the like) now count against the same 2048 cap as words. Past it, the call is refused as too complex ("too many operators"). Before, a flood of operators made the reader walk the whole input: `(` x 1,000,000 took about 1 s, and `;` or newline x 1,000,000 were allowed. Now they are refused in a few milliseconds. No ordinary command comes near 2048 operators; the 66-row ordinary sample is unchanged.

---

## ADR-060: Check the end of a destination with an unknown part (D-R18-2)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R18-2, 2026-11-17: "Check the end only").

**Decision.**
- For `cp`, `mv`, `ln`, `install`, `ditto`, `rsync` (and the g-variants), `tar`, `bsdtar` and `gtar` with `-C` or `--directory`, and `unzip -d`: a destination (or an `mv` source) with an unknown part is refused when its literal END could be a folder that holds protected files.
- Examples refused: `cp -R x "$D"/.claude`, `mv "$D"/.claude "$D"/.claude.bak`, `rsync -a x/ "$D"/.claude/`, `tar -xf t.tar -C "$D"/.claude`, `unzip -o x.zip -d "$D"/.oss`, `ln -sfn /tmp/z "$D"/.claude`, `mv "$X"/.oss /tmp/y`, `cp x "$D"/.config`.
- The literal START is not checked. This matches the accepted bare-variable limit (ADR-036). So `cp x ../"$NAME"` and `cp x ~/"$D"/y` stay allowed.
- Accepted limit: an unknown start, or a protected folder between two unknown parts (`"$D"/.claude/"$F"`), is not caught. It is filed to the OS write-sandbox card.
- The launcher message reads: "`trap` runs a script that names a protected path: `<script cut to 60 chars>`".
- Documentation only: the `head === '/'` exemption is as strong as a bare `"$X"`.

**Consequences.**
- \+ Copies into a protected folder are refused when the end shows it.
- \− A destination that starts with an unknown part is checked only at its end.

---

## ADR-061: Refuse all mid-command glob groups (D-R19-3)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R19-3, 2026-11-17: "Refuse all groups"). Supersedes the glob-group reading of ADR-056 and ADR-059.

**Context.** Rounds 17, 18 and 19 each found a new way to hide a command inside a zsh glob group read in the middle of a command. The cases were a `#` comment, a newline and a redirect (`>` or `<`).

**Decision.**
- A `(` that the reader treats as a zsh glob group makes the call refused for every agent. This applies when the command already has words, or when the `(` is a redirect target.
- The reason text is: "zsh glob groups like `(a|b)` in the middle of a command aren't read by the gate; list the names instead: <first 60 chars>".
- Still allowed:
  - `( … )` at command start.
  - `for i ({1..3})`.
  - zsh `for x (…)`.
  - case patterns.
  - `[[ … ]]`.
  - `f()` and `name ()`.
  - `name=(…)`.
  - `$(`, `<(` and `>(`.
  - `for ((`.
  - `coproc (…)` and `time (…)`.
  - Quoted text and heredoc bodies.
- Newly refused on purpose: `ls (src|test)/*.ts`, `rm -f (a|b).log` and `noglob echo (a)`. `src/(a|b).ts` was already refused (ADR-046).
- The code that read group contents is removed. This covers the group end, quote skipping inside groups and the unclosed-group rule.
- The operator cap (ADR-059) stays.

**Consequences.**
- \+ No group contents are read, so no hidden command can sit inside one.
- \− Agents that write a glob group in the middle of a command must list the names instead.

---

## ADR-062: Follow later values after a trap (D-R19-1, amends ADR-058 rule 2)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R19-1, 2026-11-17: "Follow later values").

**Context.** Round 18 counted every variable that a trap reads as filled. That included a variable set only after the trap. So a later plain assignment tripped ADR-058 rule 2. The everyday "trap first" idiom was refused. Code review found it (CR MEDIUM-1). The ordinary sample had no trap-first lines, so the tests missed it.

**Decision.**
- A variable that a trap reads is followed when every place the command names it is a plain assignment at command start. The value must be plain text, empty, `$?`, `$!` or `$(mktemp …)`.
- Nothing may change the variable unseen. Forms such as `eval`, `alias` and nameref count as unseen changes.
- The trap script is judged once for each combination of possible values. Each combination runs in its own subshell. The script as written is judged too.
- The call is refused if any combination could touch a protected path.
- Limits:
  - At most 16 combinations. Past that, the call is refused.
  - A value that holds `~` is not followed, so the call is refused.
  - `{ F=x }`, `( F=x )` and `F=x cmd` count as possible values.
- So `trap 'rm -rf $F' EXIT; F=.oss` stays refused. The seven trap-first lines of the ordinary sample are allowed again.

**Consequences.**
- \+ Trap-first clean-ups work again.
- \− The gate runs the trap script once for each value combination, so a trap with many values costs more time.

---

## ADR-063: Keep the other round-19 refusals (D-R19-2 and round-19 rules)

**Date:** 2026-11-17 · **Status:** Accepted (user pick D-R19-2, 2026-11-17: "Keep refused"), plus round-19 rules with no user pick.

**Decision.**
- After a filled trap, two forms stay refused on purpose:
  - `unset` of the trap's variable.
  - An array index taken from a variable, such as `arr[$i]=x`.
  - Release note: yes.
- Leading assignments are checked again after each prefix word. The prefix words are `time`, `nocorrect`, `noglob`, `builtin`, `command` and `exec`. So `F=src; trap 'rm -rf $F' EXIT; time F=.oss` is refused.
- A name given as an option's value is a name. This covers `read -a` and `-A`, `zparseopts -a`, `-A` and `-F`, and `compgen -V`. The option may be attached or given as the next word. An option that is known only at run time is refused. `getopts --` is skipped before the name.
- The after-trap text scan matches brackets in one pass and checks the clock. More than 64 KB after a filled trap is refused as too complex.
- The `${…}` assign and indirect checks run in one pass too.
- `gcp`, `gmv`, `gln`, `ginstall` and `grsync` are read as `cp`, `mv`, `ln`, `install` and `rsync`. They count as write targets, including `-t DIR` and `--target-directory`, and backups. They get the ADR-060 destination check. `gditto` does too.
- A destination written inside an option is judged like any destination with an unknown part. The forms are `-C"$D"/.oss`, `-d"$D"/.claude` and `--directory="$D"/.claude`.
- The refusal for `…; time { F=.oss; }` names the write (`.oss`), not `{`.

**Consequences.**
- \+ Setters hidden in option values or after prefix words are caught.
- \− Some ordinary forms that set a variable after a filled trap stay refused, as the user chose.

---

## ADR-064: Round-20 reader rules (amends ADR-061 and ADR-062; extends ADR-063)

**Date:** 2026-11-17 · **Status:** Accepted. No new user pick. The rules sit inside D-R19-1, D-R19-2 and D-R19-3, and under ADR-048.

**Decision.**
- **Glob groups after a word or wildcard** (amends ADR-061). `*(`, `?(`, `!(`, `@(`, `+(`, `[ab](` and `x*(` still read as zsh qualifiers and extglob groups. The call is refused for every agent when its group:
  - holds an unquoted newline, `<`, `>`, `&`, `;`, a backtick, or `$(`;
  - holds a `#` after a blank;
  - never closes.
  - `|` alternation stays allowed.
- Ordinary forms stay allowed: `ls *(.N)`, `ls **/*.ts(.om[1,5])`, `ls !(node_modules)`, `ls @(a|b).txt` and `ls *.(ts|js)`.
- Newly refused on purpose: a `<1-5>` number range inside a qualifier.
- **`name=(` is an array only in an assignment** (amends ADR-061). It is an array:
  - at command start, after leading keywords and other assignments;
  - as an argument of `typeset`, `declare`, `local`, `export`, `readonly`, `integer` or `float`.
  - Anywhere else it is a glob group and is refused.
  - So `ls x=(a|b` (newline) `#x) ; git push …` and `echo x=(a)` are refused.
  - `noglob typeset x=(…)`, `command typeset x=(…)` and `builtin typeset x=(…)` are refused too. zsh does not make an array there.
- **IFS** (amends ADR-062). A variable that the trap reads unquoted is not followed through later values when the command mentions IFS. This is the same rule as the earlier followed-value path. `IFS=/; trap 'rm -rf $F' EXIT; F=x/.oss` is refused again.
- **mktemp values** (amends ADR-062). `$(mktemp …)` and `` `mktemp …` `` are followed when they use `-d`, `-q`, `-u`, `-t` or `-p`, as clusters or attached.
  - A literal or `~` template becomes a pattern. Each run of X is a wildcard.
  - A temp-folder path stays unknown. It is refused if the command sets TMPDIR.
  - A template that could name a protected path is refused. Examples: `.oss/tool-gates.XXXX`, `-p .oss/tool-gates`, `~/.claude/settings.XXXX`.
  - `.oss/x.XXXX` is allowed, as `rm -rf .oss/x.y` is.
- **Trap's own assignments** are judged by their value. They are not counted as later changes. Example: `trap 'rc=$?; rm -rf "$tmp"; exit $rc' EXIT`. `wait $pid` without options reads the pid. It does not set it.
- **Target folders inside option clusters** (extends ADR-063). For cp, mv, ln and install (and their g-names), a `t` anywhere in a short-option cluster names the destination. So does any prefix of `--target-directory`. tar `C` and unzip `d` inside clusters are read too, and so is old-style `tar xCf`. Ambiguous old-style tar letters make the folder unknown (fail closed).
- **GNU names** (extends ADR-063). One explicit list, `plainWriterName` in command-reader.ts, maps Homebrew GNU names to their plain programs: gcp, gmv, gln, ginstall, grsync, gtar, gditto, gtee, grm, gdd, gtouch, gtruncate, gshred, gchmod, gchown, gmkdir, grmdir, gsed, gsplit and gcsplit. A `g` is never stripped from other names (git, grep, gzip). Each g-name gets the verdict of its plain program.
- **`time { … }`** (and bash `time -p {`) is read as a group. Messages name the real word.

**Consequences.**
- \+ Trap-first mktemp forms, `rc=$?` and `wait $pid` work again.
- \+ Destinations inside option clusters and GNU names are checked like their plain programs.
- \− Ambiguous old-style tar letters are refused.
- \− A `<1-5>` number range inside a qualifier is refused.

---

## ADR-065: Round-21 reader rules (amends ADR-064; D-R21-1)

**Date:** 2026-11-17 · **Status:** Accepted. User pick D-R21-1 "Keep the wider check" (2026-11-17). The other rules sit under ADR-048.

**Decision.**
- **Arrays need plainly written words** (amends ADR-064). `x=(` is an array only when:
  - the typeset-family word is written plainly (no quotes, backslashes, braces, `$` or backtick);
  - every earlier assignment is written plainly, by the same test;
  - every leading reserved word or `nocorrect` is written plainly.
  - zsh does not treat `\typeset`, `'typeset'` or `'A=1'` as a reserved word or an assignment. It reads `x=(` as a glob group. Otherwise the ADR-061 refusal applies.
  - Options after the typeset word may be quoted: `typeset "-a" arr=(a b)` stays allowed.
  - A plain `nocorrect arr=(a b)` is an array again.
- **`disable -r` and `enable -r`** are refused for every agent in command position. Command position means after assignments, reserved words, and the prefixes `builtin`, `command`, `noglob`, `nocorrect`, `exec` and `-`. It also counts inside `eval`, `( )` and `$( )`. These builtins change zsh's reserved words. `grep enable -r src` stays allowed.
- **GNU names.** `gfind` maps to `find`, and `gxargs` maps to `xargs` (extends ADR-064). Rules that look up a program name use `plainWriterName`. Read-only and harmless lists still match only plain names. So a g-name is never treated as safer than its plain name.
- **tar `--cd` and `--directory` prefixes.** `--cd`, and any prefix of `--directory` from `--di` (with `=` or as the next word), is read as `-C`. This holds for tar, bsdtar and gtar.
- **mktemp.**
  - GNU long options and their unique prefixes are read: `--directory`, `--dry-run`, `--quiet`, `--tmpdir[=DIR]` and `--suffix`.
  - A `-t` value that holds `/` is an unknown folder.
  - Every `$(mktemp …)` value is judged by its pattern, not only after a trap.
  - mktemp itself gets a write target: the path it makes, plus a `-p` folder with an unknown part and a written end.
- **IFS check speed.** The names a trap reads unquoted are collected in one pass, with the clock check. The pass is not run once per name.
- **D-R21-1 "Keep the wider check".** A folder that can hold a protected path at any depth counts as holding protected files. Examples are `**/.git/hooks/**` and `**/.git/refs/**`. So these are refused for the main agent and builders:
  - `rm -rf .git/hooks`;
  - `find .git/hooks -delete`;
  - `find .git/refs -delete`;
  - `find .git/hooks -name pre-commit -exec sh -c 'echo x > {}' +`.
  They were allowed before. That was a hole. The reference copy of the round-9 check in protected-path-equivalence.test.ts got the same rule. Release note: yes.

**Consequences.**
- \+ Quoted `typeset`, quoted assignments and `disable -r` before `x=(` are refused. zsh no longer writes files through them.
- \+ `gfind`, `gxargs`, `tar --cd` and `mktemp` long options are checked.
- \+ Deleting `.git/hooks` or `.git/refs` as a whole folder is refused.

---

## ADR-066: Stop the ship gate loop; final regression fixes only (user pick 2026-11-17 "Stop: ship + sandbox card")

**Status:** Accepted (supersedes D-R22-1 "Fix all three in round 22", picked earlier the same day)

**Context:**
- R-266 reached ship round 21. Most gate findings were new zsh/bash forms against the text-based command reader for the main agent and builders.
- Each fix added reader code, and the next round attacked that code.
- Review-agent containment, the feature's goal, held in every round, through the OS sandbox profile.
- Round 21: performance and pen test PASS; code review and security FAIL.

**Decision:**
- Round 22 is the last fix round. It runs through /oss:build (PLAN.md Phase 8).
- It fixes only the ordinary commands that round 21 wrongly refuses:
  - mktemp with a `${TMPDIR:-/tmp}` template;
  - `A="x y" arr=(…)`;
  - single-file `rm -f .git/modules/sub/index.lock`.
- It also applies D-R22-2 "Folders only, single files free": the D-R21-1 folder rule applies only to whole-folder writes.
- It also closes the one round-21 security regression (user pick 2026-11-17 "Add it to round 22"): a mktemp temp-folder template holding `/` (`--tmpdir ../…`, `-p "$TMPDIR" ../…`) is an unknown destination (Task 21).
- No more gate rounds after it: a final verify, then ship into the Sprint D branches.
- Every other main/builder finding from round 21 goes to the OS write-sandbox card (FOLLOWUPS). That includes security's HIGHs (unknown wrappers such as `arch`/`xcrun`/`gtimeout`/`ssh-agent`, and `git stash -u/--all` removing `.oss/tool-gates.json`). The user chose this.
- The OS write-sandbox card becomes the next R-266 follow-up card.

**Consequences:**
- \- The main agent and builders keep known text-reader gaps until the OS write-sandbox lands.
- \+ The ship ends, and the review-agent boundary ships.
- \+ The lesson goes to Sprint D cards: R-274 (fix rounds run through build) and the ship-convergence card (round cap, shrinking findings, gates bounded to the feature's own diff).

## ADR-067: One-shot security review of the Task 20 disk check (2026-11-18)

**Status:** Accepted (user pick "One-shot review of this rule")

**Context:** Task 20 (D-R22-2) added a new kind of gate logic: a non-recursive `rm` whose target `lstat` shows is a regular file skips the folder rule. Its first version let `rm -f .git/hooks` through (caught by the coordinator, fixed test-first). ADR-066 stopped the gate rounds, so no reviewer had seen it.

**Decision:** One security audit scoped to `deletesSingleFile` and its two callers. If it finds a hole, Task 20 is reverted (the lock-file delete goes back to refused, as in round 21, and is filed on the sandbox card) instead of opening a fix round. Either way, no further round.

**Consequences:** The loop stays bounded; nothing new ships without a review.

## ADR-068: One-shot security review of Tasks 18 and 19 (2026-11-18)

**Status:** Accepted (user pick "One-shot review, revert on a hole")

**Context:** Round 22's Tasks 18 (mktemp `${TMPDIR:-/tmp}` templates) and 19 (quoted or expanded assignments before `arr=(`) loosened the gate without an independent review; the only reviewed loosening (Task 20) had a hole (ADR-067).

**Decision:** Same rule as ADR-067: one security audit scoped to Task 18's and Task 19's changes. A hole in either task reverts that task (its command goes back to refused and onto the sandbox card); no fix round. The merges into the Sprint D branches wait for the result.

## ADR-069: Refuse writes through array variables (2026-11-18)

**Status:** Accepted (user pick "Fix now: refuse array writes")

**Context:** The ADR-068 review found an older HIGH outside round 22: `arr=(.git/hooks/pre-commit); echo hi > $arr` and `arr=(~/.claude/settings.json); cp /dev/null $arr` are allowed for the main agent and builders, while `x=…; echo hi > $x` is refused and `${arr[1]}` is refused as run-time-only. Confirmed against the bundle.

**Decision:** One /oss:build task (Task 24): a write target that expands an array variable (`$arr`, `${arr}`, `$arr[1]`, `${arr[@]}`, `$arr[@]`) is refused as only known at run time. It only refuses more, so it cannot open a hole; no review round follows. Any newly refused ordinary command in the sample stops the build for a user decision.
