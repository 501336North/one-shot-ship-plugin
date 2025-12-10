# Requirements: Supervisor Agent with Structured Logging

## User Stories

### US-001: Workflow Logging
**As a** developer using OSS commands
**I want** every command to log its lifecycle to a central log
**So that** the watcher can observe workflow progress in real-time

**Acceptance Criteria:**
- [ ] AC-001.1: `.oss/workflow.log` is created on first log entry
- [ ] AC-001.2: Each log entry contains JSON line + human-readable summary
- [ ] AC-001.3: JSON includes: timestamp, command, phase, event, data object
- [ ] AC-001.4: Human summary follows format: `# CMD:PHASE:EVENT - description`
- [ ] AC-001.5: Log appends atomically (no partial writes)

### US-002: Command Lifecycle Events
**As a** workflow supervisor
**I want** commands to log START, phase transitions, and COMPLETE/FAILED
**So that** I can track progress through the chain

**Acceptance Criteria:**
- [ ] AC-002.1: Every `/oss:` command logs START on invocation
- [ ] AC-002.2: Commands log phase transitions (e.g., RED -> GREEN -> REFACTOR)
- [ ] AC-002.3: Commands log COMPLETE with summary data on success
- [ ] AC-002.4: Commands log FAILED with error context on failure
- [ ] AC-002.5: Milestones within phases are logged (e.g., "3 tests written")

### US-003: Agent Lifecycle Events
**As a** workflow supervisor
**I want** spawned agents to log their own lifecycle
**So that** I have visibility into delegated work

**Acceptance Criteria:**
- [ ] AC-003.1: Agent spawn is logged with agent type and task description
- [ ] AC-003.2: Agent logs its own START event
- [ ] AC-003.3: Agent logs key milestones during execution
- [ ] AC-003.4: Agent logs COMPLETE/FAILED with results
- [ ] AC-003.5: Parent command logs agent completion receipt

### US-004: Real-time Log Reading
**As a** watcher process
**I want** to tail the workflow log in real-time
**So that** I can detect issues as they happen

**Acceptance Criteria:**
- [ ] AC-004.1: LogReader tails `.oss/workflow.log` continuously
- [ ] AC-004.2: New entries are parsed within 1 second of being written
- [ ] AC-004.3: JSON parsing errors don't crash the reader
- [ ] AC-004.4: Reader maintains position across restarts (offset tracking)
- [ ] AC-004.5: Reader handles log rotation gracefully

### US-005: Workflow Reasoning
**As a** watcher process
**I want** to reason about workflow health (not just pattern match)
**So that** I can detect novel issues beyond fixed patterns

**Acceptance Criteria:**

**Negative Signal Detection (presence of bad):**
- [ ] AC-005.1: Detects loops (same action repeated 3+ times with no progress)
- [ ] AC-005.2: Detects stuck phases (START without COMPLETE beyond threshold)
- [ ] AC-005.3: Detects regressions (phase succeeded then failed)
- [ ] AC-005.4: Detects out-of-order (e.g., GREEN before RED)
- [ ] AC-005.5: Detects explicit FAILED events

**Positive Signal Erosion (absence of good):**
- [ ] AC-005.6: Detects silence (no log entries for extended period while command active)
- [ ] AC-005.7: Detects missing milestones (phase progresses without expected checkpoints)
- [ ] AC-005.8: Detects declining velocity (time between milestones increasing)
- [ ] AC-005.9: Detects incomplete chain (command completes without expected outputs)
- [ ] AC-005.10: Detects agent silence (spawned agent produces no entries)

**Hard Stop Detection (positive signals ceased):**
- [ ] AC-005.11: Detects abrupt stop (active workflow, then nothing)
- [ ] AC-005.12: Detects partial completion (some phases complete, then silence)
- [ ] AC-005.13: Detects abandoned agent (agent started, never completed)

**Semantic Understanding:**
- [ ] AC-005.14: Understands command chain semantics (ideate -> plan -> build -> ship)
- [ ] AC-005.15: Understands TDD phase semantics (RED -> GREEN -> REFACTOR)
- [ ] AC-005.16: Knows expected milestones per phase (RED should produce test files)

### US-006: Graduated Response
**As a** watcher process
**I want** to respond based on confidence level
**So that** high-confidence issues get auto-fixed and others get human input

**Acceptance Criteria:**
- [ ] AC-006.1: High confidence (>0.9) -> auto-remediate via queue injection
- [ ] AC-006.2: Medium confidence (0.7-0.9) -> notify + suggest specific action
- [ ] AC-006.3: Low confidence (<0.7) -> notify only, let human decide
- [ ] AC-006.4: Auto-remediation uses appropriate agent for the issue type
- [ ] AC-006.5: Notifications use terminal-notifier with actionable message

### US-007: Queue Integration
**As a** watcher process
**I want** to inject interventions via the existing queue system
**So that** Claude sees them on the next user prompt

**Acceptance Criteria:**
- [ ] AC-007.1: High-priority interventions added to queue as `critical`
- [ ] AC-007.2: Queue task includes clear prompt for Claude to act on
- [ ] AC-007.3: Queue task includes context from log analysis
- [ ] AC-007.4: preCommand hook drains queue and Claude sees intervention
- [ ] AC-007.5: Intervention prompt explains what was detected and suggested action

### US-008: Chain Memory
**As a** command in the chain
**I want** to read the log to find what previous commands produced
**So that** I can pick up where the previous link left off

**Acceptance Criteria:**
- [ ] AC-008.1: Commands can query log for last COMPLETE of a specific command
- [ ] AC-008.2: Query returns the data object from that entry
- [ ] AC-008.3: `/oss:build` can find PLAN.md path from `/oss:plan` completion
- [ ] AC-008.4: Missing previous command logs informative error
- [ ] AC-008.5: Chain validation warns if expected predecessor didn't complete

---

## Edge Cases

### EC-001: Log File Missing
- First command creates `.oss/workflow.log`
- Watcher handles missing file gracefully (waits for creation)

### EC-002: Corrupted Log Entry
- Malformed JSON line is skipped with warning
- Reader continues processing subsequent entries

### EC-003: Concurrent Writes
- Multiple commands writing simultaneously don't corrupt file
- Atomic append ensures complete entries

### EC-004: Very Long Running Phase
- Stuck detection has configurable thresholds per phase type
- RED phase gets longer threshold than REFACTOR (tests take time)

### EC-005: False Positive Loop Detection
- Legitimate retries (e.g., fixing test) shouldn't trigger loop alert
- Require lack of progress, not just repetition

### EC-006: Watcher Restart Mid-Workflow
- Watcher reads full log on start to understand current state
- Doesn't re-alert on issues already in queue

---

## Non-Functional Requirements

### NFR-001: Performance
- Log write latency < 10ms
- Log read/parse latency < 100ms per entry
- Watcher CPU usage < 5% when idle

### NFR-002: Reliability
- No data loss on crash (atomic writes)
- Graceful degradation if log unavailable

### NFR-003: Observability
- Watcher logs its own decisions to `.oss/watcher.log`
- Debug mode shows reasoning process
