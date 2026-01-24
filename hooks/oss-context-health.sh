#!/bin/bash
# oss-context-health.sh - Context health tracking for OSS Dev Workflow
#
# Usage:
#   oss-context-health.sh update <usage_percent> [tokens_used] [tokens_total]
#   oss-context-health.sh check
#   oss-context-health.sh clear
#
# Updates ~/.oss/status-line.json with context health information
# and warns when context usage is high.
#
# Thresholds:
#   - healthy:  < 50%
#   - warning:  50-69%
#   - critical: >= 70%

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"
OSS_DIR="${HOME}/.oss"
STATUS_FILE="${OSS_DIR}/status-line.json"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook oss-context-health "$1"
    fi
}

calculate_level() {
    local usage=$1
    if [[ $usage -ge 70 ]]; then
        echo "critical"
    elif [[ $usage -ge 50 ]]; then
        echo "warning"
    else
        echo "healthy"
    fi
}

read_status() {
    if [[ -f "$STATUS_FILE" ]]; then
        cat "$STATUS_FILE"
    else
        echo '{"phase":null,"task":null,"supervisor":null,"contextHealth":null}'
    fi
}

write_status() {
    mkdir -p "$OSS_DIR"
    echo "$1" > "$STATUS_FILE"
}

# =============================================================================
# Commands
# =============================================================================

cmd_update() {
    local usage_percent="${1:-0}"
    local tokens_used="${2:-}"
    local tokens_total="${3:-}"

    log_info "START update=$usage_percent"

    local level=$(calculate_level "$usage_percent")

    # Build context health JSON
    local context_health="{\"level\":\"$level\",\"usagePercent\":$usage_percent"
    if [[ -n "$tokens_used" ]]; then
        context_health+=",\"tokensUsed\":$tokens_used"
    fi
    if [[ -n "$tokens_total" ]]; then
        context_health+=",\"tokensTotal\":$tokens_total"
    fi
    context_health+="}"

    # Update status file
    local current=$(read_status)
    if command -v jq &>/dev/null; then
        local updated=$(echo "$current" | jq --argjson ch "$context_health" '.contextHealth = $ch')
        write_status "$updated"
    else
        # Fallback: simple string replacement (less robust but works)
        # This is a best-effort approach when jq is not available
        if echo "$current" | grep -q '"contextHealth"'; then
            local updated=$(echo "$current" | sed "s/\"contextHealth\":[^,}]*/\"contextHealth\":$context_health/")
        else
            # Add contextHealth field
            local updated=$(echo "$current" | sed "s/}$/,\"contextHealth\":$context_health}/")
        fi
        write_status "$updated"
    fi

    # Output warning messages based on level
    case "$level" in
        warning)
            echo "⚠️  Context usage at ${usage_percent}% - Consider delegating to fresh agents"
            ;;
        critical)
            echo "🔴 Context usage at ${usage_percent}% - Spawning fresh agents recommended"
            echo "   Use Task tool to delegate work to specialized agents"
            ;;
    esac

    log_info "COMPLETE level=$level"
}

cmd_check() {
    log_info "START check"

    local current=$(read_status)
    if command -v jq &>/dev/null; then
        local level=$(echo "$current" | jq -r '.contextHealth.level // "unknown"')
        local usage=$(echo "$current" | jq -r '.contextHealth.usagePercent // 0')
        echo "Context: $level ($usage%)"
    else
        echo "Context: check status-line.json"
    fi

    log_info "COMPLETE"
}

cmd_clear() {
    log_info "START clear"

    local current=$(read_status)
    if command -v jq &>/dev/null; then
        local updated=$(echo "$current" | jq '.contextHealth = null')
        write_status "$updated"
    fi

    log_info "COMPLETE"
}

# =============================================================================
# Main
# =============================================================================

case "${1:-}" in
    update)
        cmd_update "${2:-0}" "${3:-}" "${4:-}"
        ;;
    check)
        cmd_check
        ;;
    clear)
        cmd_clear
        ;;
    *)
        echo "Usage: oss-context-health.sh <update|check|clear> [args...]"
        echo ""
        echo "Commands:"
        echo "  update <usage%> [tokens_used] [tokens_total] - Update context health"
        echo "  check                                         - Check current health"
        echo "  clear                                         - Clear context health"
        exit 1
        ;;
esac
