# TDD Implementation Plan: Project-Local Logs

## Overview

Migrate the logging system from global-only (`~/.oss/logs/`) to project-local-first (`{project}/.oss/logs/`) with global fallback. This enables true multi-project support where each project has its own supervisor with independent logs.

## Problem Statement

**Current State:**
- Logs are stored globally at `~/.oss/logs/current-session/`
- When user runs multiple Claude Code sessions (different projects), logs get mixed
- Supervisor cannot distinguish which project generated which log entries
- Session context (`session-context.md`) gets overwritten by whichever project closes last

**Desired State:**
- Each project has its own logs at `{project}/.oss/logs/current-session/`
- Supervisor can monitor each project independently
- Global fallback for edge cases (no project context available)
- Consistent with existing architecture (queue.json, workflow-state.json already project-local)

## Architecture Decision

**Approach: Project-Local First with Global Fallback**

```
Priority Chain (matching existing patterns):
1. {project}/.oss/logs/current-session/  (primary)
2. ~/.oss/logs/current-session/          (fallback if no project context)
```

This matches the pattern already used for:
- Dev docs: project .oss/dev/ → project dev/ → global ~/.oss/dev/
- Workflow state: project .oss/workflow-state.json → global
- Health state: project .oss/health-workflow-state.json → global

## Components to Update

| Component | File | Change Required |
|-----------|------|-----------------|
| Log base path | `oss-log.sh` | Check project context first |
| Session start logging | `oss-session-start.sh` | Use project-local path |
| Session end logging | `oss-session-end.sh` | Use project-local path |
| Session context save | `oss-session-end.sh` | Save to project-local |
| Session context restore | `oss-session-start.sh` | Read from project-local |
| Hook logging | All UserPromptSubmit hooks | Already use LOG_SCRIPT |
| Health check log | `oss-session-start.sh` | Update log path |

---

## Phase 1: Core Log Path Migration

### Task 1.1: Update oss-log.sh to use project-local paths

**Test:** Log files are created in project-local directory when project context exists
```bash
# Given: CLAUDE_PROJECT_DIR=/path/to/project
# When: oss-log.sh init plan
# Then: Log created at /path/to/project/.oss/logs/current-session/plan.log
```

**Implementation:**
- Add `get_log_base()` function that checks project context
- Check `~/.oss/current-project` first
- Validate path with existing `validate_project_path()`
- Fall back to `~/.oss/logs` if no valid project

### Task 1.2: Update log_entry() helper to use dynamic path

**Test:** Unified session log writes to project-local when available
```bash
# Given: Project context set
# When: log_entry "plan" "PHASE" "RED start"
# Then: Entry appears in {project}/.oss/logs/current-session/session.log
```

### Task 1.3: Update archive and rotation paths

**Test:** Log rotation creates archives in project-local directory
```bash
# Given: Project context and large session.log
# When: Session log exceeds size limit
# Then: Archive created at {project}/.oss/logs/archive/
```

---

## Phase 2: Session Lifecycle Updates

### Task 2.1: Update oss-session-start.sh log paths

**Test:** Session start logs to project-local
```bash
# Given: CLAUDE_PROJECT_DIR set
# When: Session starts
# Then: "[session] [START]" logged to {project}/.oss/logs/current-session/session.log
```

### Task 2.2: Update oss-session-end.sh log paths

**Test:** Session end logs to project-local
```bash
# Given: Project context from ~/.oss/current-project
# When: Session ends
# Then: "[session] [END]" logged to {project}/.oss/logs/current-session/session.log
```

### Task 2.3: Update session-context.md location

**Test:** Session context saved to project-local
```bash
# Given: Project context
# When: Session ends (PreCompact)
# Then: Context saved to {project}/.oss/session-context.md
```

### Task 2.4: Update session context restore

**Test:** Session context restored from project-local
```bash
# Given: Previous session context at {project}/.oss/session-context.md
# When: New session starts in same project
# Then: Context restored from project-local file
```

---

## Phase 3: Health Check Integration

### Task 3.1: Update health check log path

**Test:** Health check logs to project-local
```bash
# Given: Project context
# When: Health check runs
# Then: Results logged to {project}/.oss/logs/current-session/health-check.log
```

---

## Phase 4: CLI and Status Line Updates

### Task 4.1: Update log reading commands (read, session, tail)

**Test:** Log reading commands find project-local logs
```bash
# Given: Project context with logs
# When: oss-log.sh session
# Then: Shows content from {project}/.oss/logs/current-session/session.log
```

### Task 4.2: Update status command for project-local paths

**Test:** Status command shows project-local usage
```bash
# Given: Project context
# When: oss-log.sh status
# Then: Shows project-local log location and sizes
```

---

## Phase 5: Multi-Project Isolation Tests

### Task 5.1: Write multi-project isolation test

**Test:** Two projects maintain separate logs
```bash
# Given: Project A at /tmp/projectA, Project B at /tmp/projectB
# When: Both run oss-log.sh commands
# Then: Each has independent logs in their .oss/logs/
```

### Task 5.2: Test global fallback behavior

**Test:** Falls back to global when no project context
```bash
# Given: No CLAUDE_PROJECT_DIR and no current-project file
# When: oss-log.sh init plan
# Then: Log created at ~/.oss/logs/current-session/plan.log
```

---

## Implementation Details

### get_log_base() Function

```bash
# Add to oss-log.sh after existing helper functions
get_log_base() {
    local project_dir=""

    # Try to get project directory from current-project file
    if [[ -f "$HOME/.oss/current-project" ]]; then
        project_dir=$(cat "$HOME/.oss/current-project" 2>/dev/null | tr -d '[:space:]')
    fi

    # Fall back to CLAUDE_PROJECT_DIR if available
    if [[ -z "$project_dir" && -n "$CLAUDE_PROJECT_DIR" ]]; then
        project_dir="$CLAUDE_PROJECT_DIR"
    fi

    # Validate and use project-local if valid
    if [[ -n "$project_dir" ]]; then
        local validated_path
        validated_path=$(validate_project_path "$project_dir")
        if [[ -n "$validated_path" ]]; then
            echo "$validated_path/.oss/logs"
            return 0
        fi
    fi

    # Fallback to global
    echo "$HOME/.oss/logs"
}

# Update LOG_BASE to use dynamic resolution
LOG_BASE=$(get_log_base)
```

### Backward Compatibility

- If `{project}/.oss/logs/` doesn't exist but `~/.oss/logs/` does, gracefully migrate
- Log reading commands check both locations
- No breaking changes to existing global logs

---

## Success Criteria

- [ ] Each project has independent logs in `.oss/logs/`
- [ ] Session context is project-specific
- [ ] Multiple concurrent sessions don't interfere
- [ ] Global fallback works when no project context
- [ ] All existing tests pass
- [ ] New multi-project isolation tests pass
- [ ] Supervisor can monitor project-specific logs

---

## Files to Modify

1. `hooks/oss-log.sh` - Core log path resolution
2. `hooks/oss-session-start.sh` - Session logging and health check
3. `hooks/oss-session-end.sh` - Session logging and context save

---

*Plan created: 2025-12-25*
*Phases: 5*
*Tasks: 11*
