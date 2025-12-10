# Design: Supervisor Health Observatory

## Problem Statement

The current health check only runs `npm test`. We need comprehensive system health observability that:
1. Monitors 8 key health indicators
2. Detects anomalies the supervisor should act on
3. Can self-heal or notify when issues arise
4. Provides actionable suggestions

## User Requirements

From the user request:
> Make our HEALTHCHECK look at what it currently does PLUS:
> - DO EVERY COMMAND LOG MEANINGFUL DATA THE SUPERVISOR CAN KNOW THE SYSTEM IS HEALTHY?
> - DO EVERY COMMAND UPDATE DEV DOCS
> - ARE WE DELEGATING TO SUBAGENTS?
> - DOES THE QUEUE & SUPERVISOR WORK WELL?
> - FILES ARE ARCHIVED PROPERLY WHEN RUNNING OSS:PLAN THE NEXT TIME AROUND
> - PARALLEL QUALITY GATE (code-review, performance, security)
> - NOTIFICATIONS ARE WORKING AS EXPECTED?
> - LAST DATE SINCE AGENTS WROTE TO MAIN
>
> When can instruct the supervisor to report and logs that look suspicious and drop something in the queue so we can either self heal or notify

## 8 Health Indicators

### 1. Command Logging Health
**What it checks**: Are commands logging meaningful structured data?
**How**: Parse session.log for JSON entries, check timestamps
**Healthy**: Recent logs with structured data
**Degraded**: Empty logs or missing timestamps
**Unhealthy**: No logs for 15+ minutes during active session
**Self-heal action**: Queue task to investigate logging

### 2. Dev Docs Health
**What it checks**: Are PROGRESS.md and other dev docs updated?
**How**: Check file existence and modification times in dev/active/
**Healthy**: PROGRESS.md updated within 1 hour
**Degraded**: PROGRESS.md stale (>1 hour)
**Unhealthy**: Required docs missing (PLAN.md, PROGRESS.md)
**Self-heal action**: Queue task to update docs

### 3. Delegation Health
**What it checks**: Are specialized agents being delegated to?
**How**: Parse session.log for [AGENT] entries, check against file types modified
**Healthy**: Delegation entries found for specialized work
**Degraded**: No delegation in 30+ minutes of active work
**Unhealthy**: Specialized code (TS/React) written without appropriate agent
**Self-heal action**: Notify with delegation reminder

### 4. Queue & Supervisor Health
**What it checks**: Is the queue system functioning and supervisor responsive?
**How**: Validate queue.json, check task ages, check supervisor heartbeat
**Healthy**: Queue accessible, tasks processing
**Degraded**: Stale tasks (>1 hour pending)
**Unhealthy**: Queue corrupted or supervisor stuck
**Self-heal action**: Restart supervisor, clear corrupted queue

### 5. Archive Health
**What it checks**: Are completed features being archived?
**How**: Use existing oss-archive-check.sh --dry-run
**Healthy**: No completed features in dev/active/
**Degraded**: Completed features not archived
**Unhealthy**: Archive script failing
**Self-heal action**: Queue archive task

### 6. Quality Gate Health
**What it checks**: Are parallel quality gates running?
**How**: Parse logs for code-review, performance, security execution
**Healthy**: All 3 gates ran and passed
**Degraded**: Some gates skipped or partial
**Unhealthy**: Any gate failing
**Self-heal action**: Queue failing gate for fix

### 7. Notification Health
**What it checks**: Is the notification system working?
**How**: Test notification pathway, check for available notifiers
**Healthy**: Notifications sent successfully
**Degraded**: Notification method unavailable
**Unhealthy**: Notifications failing silently
**Self-heal action**: Suggest notification setup

### 8. Branch Staleness
**What it checks**: Time since last agent commit merged to main
**How**: git log to find last merge
**Healthy**: PR merged within 24 hours
**Degraded**: No merge for 3+ days
**Unhealthy**: Branch diverged significantly (10+ commits behind)
**Self-heal action**: Suggest shipping or rebasing

## Action Types

1. **Queue Task**: Add task to supervisor queue for self-healing
2. **Notify**: Send notification with actionable suggestion
3. **Log**: Record suspicious pattern for audit
4. **Menubar Update**: Update SwiftBar with health status

## Integration Points

- **Health Check CLI**: Enhanced to run all 8 indicators
- **SwiftBar**: Display health summary in menu
- **Session Start**: Run health check on session start
- **Periodic**: Run health checks every 15 minutes

## Success Criteria

- All 8 health indicators implemented with tests
- Health report visible in SwiftBar
- Self-healing actions queue appropriate tasks
- Notifications work without spam (debounced)
