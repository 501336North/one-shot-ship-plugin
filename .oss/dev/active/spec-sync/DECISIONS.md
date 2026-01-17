# Technical Decisions: Spec Sync Daemon

## ADR-001: Extend WatcherSupervisor vs Separate Daemon

**Date:** 2026-01-16

**Context:** Need to add spec sync monitoring capability. Two options: extend existing WatcherSupervisor or create separate daemon.

**Decision:** Extend WatcherSupervisor with new SpecMonitor

**Rationale:**
- Leverages existing queue, intervention, and logging infrastructure
- Follows established monitor pattern (LogMonitor, TestMonitor, GitMonitor)
- Single daemon to manage, not multiple
- Shared configuration and lifecycle management

**Consequences:**
- SpecMonitor must follow existing monitor interface patterns
- Additional complexity in WatcherSupervisor
- Easier testing via shared test infrastructure

---

## ADR-002: Hybrid Spec Parsing (Structured + LLM)

**Date:** 2026-01-16

**Context:** Need to extract requirements from DESIGN.md files. Options: pure regex, pure LLM, or hybrid.

**Decision:** Hybrid approach with structured markers for deterministic metrics, LLM for behavioral intent

**Rationale:**
- Structured markers (`<!-- spec:components -->`) provide deterministic parsing for metrics
- LLM can interpret prose behaviors without strict formatting
- Metrics stay stable (not affected by LLM variability)
- Best of both worlds: reliability + flexibility

**Consequences:**
- Spec files need to use marker format for coverage tracking
- Behavioral analysis is optional/secondary
- Initial implementation can skip LLM, add later

---

## ADR-003: Periodic Scan vs Real-time File Watching

**Date:** 2026-01-16

**Context:** Need to detect when code changes affect spec alignment. Options: file watcher (chokidar) or periodic scan.

**Decision:** Periodic scan every 5 minutes (configurable)

**Rationale:**
- Simpler implementation
- Lower resource usage than continuous file watching
- Watcher supervisor already uses interval-based monitoring
- File watchers can be unreliable across platforms

**Consequences:**
- Up to 5 minute delay in drift detection
- Configurable interval for different needs
- Can add real-time watching later if needed

---

## ADR-004: Confidence-Based Auto-Reconciliation

**Date:** 2026-01-16

**Context:** When drift is detected, need to decide between auto-fix and human review.

**Decision:** Use confidence threshold (>0.9 = auto-fix, <0.9 = queue for review)

**Rationale:**
- Consistent with existing intervention system
- High-confidence fixes (checkbox updates) are safe to automate
- Low-confidence issues (behavioral mismatches) need human judgment
- Reduces alert fatigue while maintaining safety

**Consequences:**
- Need to assign confidence scores to each drift type
- May need tuning of thresholds based on experience
- Audit trail required for all auto-fixes

---

## ADR-005: Build Pre-flight Check Location

**Date:** 2026-01-16

**Context:** Need to add spec check to /oss:build command. Options: at start, after each task, or at end.

**Decision:** Run pre-flight check before build starts

**Rationale:**
- Catches drift before any code is written
- Gives user choice to fix, proceed, or update spec
- Doesn't interrupt TDD flow once building starts
- Aligned with "fail fast" principle

**Consequences:**
- Build prompt needs modification to include pre-flight
- Additional step before build execution
- User sees drift summary before committing to build

---

## Last Updated: 2026-01-16 20:45 by /oss:plan
