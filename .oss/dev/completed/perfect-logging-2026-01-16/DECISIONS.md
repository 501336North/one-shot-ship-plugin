# Architecture Decisions: Perfect Logging System

## ADR-001: Log Format Standardization

### Context
The current logging system has inconsistent formats across components (shell scripts, TypeScript, prompts).

### Decision
Standardize on the format:
```
[HH:MM:SS] [COMPONENT] [EVENT] message key=value key=value
```

### Rationale
- Human-readable timestamps
- Greppable component names
- Key-value pairs for structured data
- Works in both shell and TypeScript

### Consequences
- All existing logging calls must be updated
- Supervisor queries are consistent

---

## ADR-002: Dual Logging (Command + Session)

### Context
Need both per-command logs and unified session log.

### Decision
Write to BOTH command-specific log AND unified session log for every entry.

### Rationale
- Command logs for debugging specific commands
- Session log for full workflow visibility
- Supervisor can choose granularity

### Consequences
- Slightly more disk I/O
- ~2x log data, but manageable with rotation

---

## ADR-003: Hook Logging Requirement

### Context
Hooks execute before/after commands but have no visibility.

### Decision
Every hook MUST log START and COMPLETE/FAILED to session log.

### Rationale
- Hooks can fail silently
- Supervisor needs visibility into pre-command state
- Essential for debugging hook chains

### Consequences
- More logging calls in hooks
- Clearer debugging path

---

## ADR-004: Agent Logging in Prompts

### Context
Agent delegation happens via Task tool in prompts, not shell scripts.

### Decision
Prompts MUST include agent logging instructions:
```bash
# Before Task tool
$PLUGIN_ROOT/hooks/oss-log.sh agent {cmd} {agent_type} "starting: {task}"

# After Task tool returns
$PLUGIN_ROOT/hooks/oss-log.sh agent {cmd} {agent_type} "completed: {result}"
```

### Rationale
- Agents are first-class citizens
- Supervisor needs agent visibility
- Can't rely on TypeScript hooks for prompt execution

### Consequences
- Every command prompt must be updated
- More verbose prompts

---

## ADR-005: Milestone Logging for Progress Tracking

### Context
Commands have significant checkpoints that should be visible.

### Decision
Add `milestone` action to oss-log.sh for command progress:
```bash
oss-log.sh milestone {cmd} {milestone_name} "{description}"
```

### Rationale
- Provides progress visibility
- Enables ETA estimation
- Helps identify slow phases

### Consequences
- Commands need milestone identification
- More granular logging

---

*Last Updated: 2025-12-25*
