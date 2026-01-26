#!/bin/bash
# oss-push-metrics.sh - Push command metrics to the API
#
# Usage:
#   oss-push-metrics.sh                     # Read metrics JSON from stdin
#   oss-push-metrics.sh <metrics_json>      # Pass metrics JSON as argument
#   oss-push-metrics.sh --retry             # Retry pending metrics uploads
#
# This hook receives metrics JSON from oss-log-analyzer.sh and pushes
# to the API for the observability dashboard.
#
# Features:
#   - Adds timestamp and plugin metadata
#   - Authenticates with API key from ~/.oss/config.json
#   - Saves to pending queue if API unreachable
#   - Silent failure (never blocks command execution)
#
# Integration:
#   "$SCRIPT_DIR/oss-log-analyzer.sh" build | "$SCRIPT_DIR/oss-push-metrics.sh"

set -euo pipefail

# Configuration
CONFIG_FILE="${HOME}/.oss/config.json"
API_URL="https://one-shot-ship-api.onrender.com"
ENDPOINT="/api/v1/metrics/command-completion"
LOG_DIR="${HOME}/.oss/logs"
LOG_FILE="${LOG_DIR}/metrics-push.log"
PENDING_DIR="${HOME}/.oss/pending-metrics"
PLUGIN_VERSION="2.0.2"
TIMEOUT_SECONDS=10

# Ensure directories exist
mkdir -p "$LOG_DIR"
mkdir -p "$PENDING_DIR"

# Helper: Log message to file
log_message() {
    local level="$1"
    local message="$2"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

# Helper: Get API key from config
get_api_key() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        return 1
    fi

    local api_key
    api_key=$(grep -o '"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*: *"\([^"]*\)"/\1/')

    if [[ -z "$api_key" ]]; then
        return 1
    fi

    echo "$api_key"
}

# Helper: Enhance metrics with timestamp and metadata
enhance_metrics() {
    local metrics_json="$1"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Use jq if available for proper JSON manipulation
    if command -v jq &>/dev/null; then
        echo "$metrics_json" | jq --arg ts "$timestamp" --arg pv "$PLUGIN_VERSION" \
            '. + {timestamp: $ts, metadata: {pluginVersion: $pv}}' 2>/dev/null || echo "$metrics_json"
    else
        # Fallback: Simple string manipulation (less robust but works)
        # Remove trailing } and add new fields
        local base
        base=$(echo "$metrics_json" | sed 's/}[[:space:]]*$//')
        echo "${base}, \"timestamp\": \"${timestamp}\", \"metadata\": {\"pluginVersion\": \"${PLUGIN_VERSION}\"}}"
    fi
}

# Helper: Push metrics to API
push_metrics() {
    local metrics_json="$1"
    local api_key="$2"

    local response
    local http_code

    # Make API call with timeout
    response=$(curl -s -w "\n%{http_code}" \
        --max-time "$TIMEOUT_SECONDS" \
        -X POST "${API_URL}${ENDPOINT}" \
        -H "Authorization: Bearer $api_key" \
        -H "Content-Type: application/json" \
        -d "$metrics_json" 2>/dev/null) || {
        log_message "ERROR" "curl failed (network error or timeout)"
        return 1
    }

    # Extract HTTP status code (last line)
    http_code=$(echo "$response" | tail -n1)

    case "$http_code" in
        200|201|202)
            log_message "INFO" "Metrics pushed successfully (HTTP $http_code)"
            return 0
            ;;
        401)
            log_message "WARN" "Authentication failed (HTTP 401) - run /oss:login"
            return 1
            ;;
        403)
            log_message "WARN" "Subscription expired (HTTP 403)"
            return 1
            ;;
        *)
            log_message "WARN" "API returned HTTP $http_code"
            return 1
            ;;
    esac
}

# Helper: Save metrics to pending queue for later retry
save_pending() {
    local metrics_json="$1"
    local filename
    filename="${PENDING_DIR}/$(date +%Y%m%d_%H%M%S)_$$.json"

    echo "$metrics_json" > "$filename"
    log_message "INFO" "Saved to pending queue: $filename"
}

# Helper: Retry pending metrics uploads
retry_pending() {
    local api_key="$1"
    local count=0
    local success=0

    for pending_file in "$PENDING_DIR"/*.json; do
        [[ -f "$pending_file" ]] || continue

        ((count++))
        local metrics_json
        metrics_json=$(cat "$pending_file")

        if push_metrics "$metrics_json" "$api_key"; then
            rm -f "$pending_file"
            ((success++))
        fi
    done

    if [[ $count -gt 0 ]]; then
        log_message "INFO" "Retry complete: $success/$count pending metrics uploaded"
        echo "Uploaded $success of $count pending metrics"
    else
        echo "No pending metrics to upload"
    fi
}

# Helper: Clean old pending files (older than 7 days)
clean_old_pending() {
    find "$PENDING_DIR" -name "*.json" -mtime +7 -delete 2>/dev/null || true
}

# =============================================================================
# Main
# =============================================================================

# Handle --retry flag
if [[ "${1:-}" == "--retry" ]]; then
    API_KEY=$(get_api_key) || {
        echo "No API key configured. Run /oss:login first."
        exit 0
    }
    retry_pending "$API_KEY"
    exit 0
fi

# Get metrics JSON from argument or stdin
METRICS_JSON=""
if [[ -n "${1:-}" && "${1:-}" != "-" ]]; then
    METRICS_JSON="$1"
elif [[ ! -t 0 ]]; then
    # Read from stdin (piped input)
    METRICS_JSON=$(cat)
fi

# Validate we have metrics
if [[ -z "$METRICS_JSON" ]]; then
    log_message "WARN" "No metrics JSON provided"
    exit 0
fi

# Validate JSON structure (basic check)
if [[ "$METRICS_JSON" != "{"* ]]; then
    log_message "WARN" "Invalid metrics JSON (must start with {)"
    exit 0
fi

# Get API key (skip silently if not configured - user not logged in)
API_KEY=$(get_api_key) || {
    log_message "DEBUG" "No API key - user not logged in, skipping"
    exit 0
}

# Enhance metrics with timestamp and metadata
ENHANCED_METRICS=$(enhance_metrics "$METRICS_JSON")
log_message "DEBUG" "Pushing metrics: ${ENHANCED_METRICS:0:200}..."

# Attempt to push metrics
if push_metrics "$ENHANCED_METRICS" "$API_KEY"; then
    # Success - also try to upload any pending metrics
    for pending_file in "$PENDING_DIR"/*.json; do
        [[ -f "$pending_file" ]] || continue

        pending_json=$(cat "$pending_file")
        if push_metrics "$pending_json" "$API_KEY"; then
            rm -f "$pending_file"
            log_message "INFO" "Uploaded pending: $pending_file"
        else
            break  # Stop if we hit an error
        fi
    done
else
    # Failed - save to pending queue for later retry
    save_pending "$ENHANCED_METRICS"
fi

# Periodically clean old pending files
if [[ $((RANDOM % 10)) -eq 0 ]]; then
    clean_old_pending
fi

exit 0
