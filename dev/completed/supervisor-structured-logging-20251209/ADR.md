# Architecture Decision Records: Supervisor Agent with Structured Logging

## ADR-001: Single Log File vs Per-Command Files

### Status
Accepted

### Context
Need to decide how to store workflow log entries. Options:
- Single `.oss/workflow.log` file
- Per-command files like `.oss/logs/build-2025-12-07-001.json`
- Both (log + archive)

### Decision
**Single `.oss/workflow.log` file**

### Rationale
- Simpler for real-time tailing (one file to watch)
- Commands can read previous entries easily (grep/parse one file)
- Chain memory is straightforward (scan backwards for last COMPLETE)
- File size manageable for typical sessions

### Consequences
- May need log rotation for very long sessions
- Slightly larger file to parse for old entries
- Simpler implementation wins over theoretical scalability concerns

---

## ADR-002: Hybrid Log Format (JSONL + Human Summary)

### Status
Accepted

### Context
Need machine-parseable logs but also want human-readability for debugging.

### Decision
**Each entry is JSON line followed by human-readable summary**

```
{"ts":"...","cmd":"build","phase":"RED","event":"COMPLETE","data":{...}}
# BUILD:RED:COMPLETE - Wrote 3 failing tests
```

### Rationale
- JSON line enables fast parsing and querying
- Human summary enables quick visual scanning
- grep/tail work for both use cases
- No need for separate debug format

### Consequences
- Slightly larger file size (2 lines per entry)
- Must keep formats in sync
- Human summary is best-effort (OK if less detailed)

---

## ADR-003: API Prompts Own Logging (Not Wrapper)

### Status
Accepted

### Context
Who should produce log entries - the command wrapper (`.md` files) or the API prompt (executed logic)?

### Decision
**API prompts are responsible for all logging**

### Rationale
- Wrapper doesn't know what phases exist or when they complete
- Only the executing prompt knows when RED starts, when GREEN completes
- Logging from wrapper would only give START/COMPLETE, useless for detecting issues
- Keeps wrapper thin (auth + fetch + execute)

### Consequences
- API prompts must be updated to include logging instructions
- Logging format must be documented for prompt authors
- Consistency depends on prompt discipline

---

## ADR-004: Reasoning-Based Analysis (Not Pattern Matching)

### Status
Accepted

### Context
How should the watcher detect issues - fixed regex patterns or semantic reasoning?

### Decision
**Semantic reasoning about workflow health**

The watcher understands:
- Expected command chain: ideate -> plan -> build -> ship
- TDD phases: RED -> GREEN -> REFACTOR
- What "healthy" looks like: forward progress, phases completing

### Rationale
- Fixed patterns are brittle and miss novel issues
- Workflow semantics are well-defined and don't change often
- Reasoning catches issues patterns would miss
- False positives from patterns are more harmful than missed issues

### Consequences
- More complex watcher logic
- Requires clear documentation of expected workflows
- May need tuning based on real usage

---

## ADR-005: Graduated Response Based on Confidence

### Status
Accepted

### Context
What should happen when the watcher detects an issue?

### Decision
**Response varies by confidence level:**
- High (>0.9): Auto-remediate via queue injection
- Medium (0.7-0.9): Notify + suggest action
- Low (<0.7): Notify only

### Rationale
- Confident fixes shouldn't wait for human
- Uncertain issues need human judgment
- Notifications keep human in the loop regardless
- Queue injection leverages existing infrastructure

### Consequences
- Must calibrate confidence thresholds
- Auto-remediation must be safe (no destructive actions)
- User can adjust thresholds in config

---

## ADR-006: Queue Injection for Intervention Delivery

### Status
Accepted

### Context
How does the watcher deliver interventions to Claude?

### Decision
**Write to existing `.oss/queue.json`, preCommand hook drains it**

### Rationale
- Infrastructure already exists and works
- preCommand fires on every user input
- Claude sees queue tasks before processing user's command
- No new mechanisms needed

### Consequences
- Intervention only delivered on next user prompt (not mid-execution)
- Can use Stop hook for mid-execution if needed
- Queue priority determines urgency

---

## ADR-007: Log as Chain Memory

### Status
Accepted

### Context
How do commands know what previous commands produced?

### Decision
**Commands query `.oss/workflow.log` for previous COMPLETE entries**

### Rationale
- Log is single source of truth
- No separate handoff mechanism needed
- COMPLETE data includes output files and next_suggested
- Simple grep/parse is sufficient

### Consequences
- Commands must handle missing predecessor gracefully
- Log parsing logic shared across commands
- Encourages log discipline (COMPLETE must include outputs)

---

## ADR-008: Spawned Agents Log Independently

### Status
Accepted

### Context
Should spawned agents write to workflow.log, or only the parent command?

### Decision
**Agents log their own lifecycle events to workflow.log**

Entries include `agent` field identifying the agent and parent.

### Rationale
- Full visibility into delegated work
- Can detect stuck/failed agents
- Parent can be notified of agent completion
- Consistent format across all log entries

### Consequences
- More log entries (higher volume)
- Agent prompts must include logging instructions
- Agent ID generation needed for correlation

---

## ADR-009: Phase-Specific Timeout Thresholds

### Status
Accepted

### Context
How long should phases be allowed to run before "stuck" detection?

### Decision
**Configurable per-phase timeouts:**
- RED: 10 min (writing tests takes time)
- GREEN: 5 min
- REFACTOR: 3 min
- Default: 5 min

### Rationale
- Different phases have different expected durations
- RED legitimately takes longer (designing tests)
- REFACTOR should be quick (code already works)
- Configurable allows tuning per project

### Consequences
- Must track phase start time accurately
- Config adds complexity
- Defaults should work for most cases

---

## ADR-010: Watcher State Persistence

### Status
Accepted

### Context
Should the watcher maintain state between restarts?

### Decision
**Watcher writes current state to `.oss/workflow-state.json`**

On restart, watcher reads log from beginning to rebuild state, but uses state file for quick resume if log hasn't changed.

### Rationale
- Crash recovery without re-alerting
- Quick startup (read state vs parse full log)
- State file enables debugging (what does watcher think is happening?)

### Consequences
- Must keep state file in sync with log
- State file is derived (log is source of truth)
- Can regenerate state from log if file corrupted
