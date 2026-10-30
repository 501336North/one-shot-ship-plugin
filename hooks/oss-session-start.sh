#!/bin/bash
# OSS Session Start Hook
# Triggered on: SessionStart
# Checks subscription, restores context, and displays welcome

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || true  # oss_api_curl: API key via stdin, never argv
source "$SCRIPT_DIR/oss-config.sh" 2>/dev/null || true
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi  # ADR-1 write guard

# =============================================================================
# TIMEOUT WRAPPER - Prevents blocking on slow/hanging node calls
# =============================================================================
# run_bounded <secs> <cmd...>: run a command, killed after <secs>; keeps its output and exit status
# (ended by the bound: non-zero, 124 from timeout, 137 from the fallback's kill -9).
run_bounded() {
    local secs=$1; shift
    if command -v gtimeout &>/dev/null; then gtimeout "$secs" "$@"      # macOS with coreutils installed
    elif command -v timeout &>/dev/null; then timeout "$secs" "$@"      # Linux or macOS with timeout available
    else
        # Fallback: background + sleep + kill. The timer holds no stdio, and killing it also kills its
        # sleep (R2-1; same shape as oss-notify.sh).
        "$@" &
        local pid=$! killer rc
        ( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep "$secs" & s=$!; wait $s && kill -9 $pid 2>/dev/null ) </dev/null >/dev/null 2>&1 &
        killer=$!
        wait $pid; rc=$?
        kill $killer 2>/dev/null; wait $killer 2>/dev/null
        return $rc
    fi
}
# Run command with timeout, fail silently if it takes too long
# This prevents Claude Code from hanging on startup if node CLI calls are slow
run_with_timeout() {
    local timeout_secs="${1:-2}"
    shift
    run_bounded "$timeout_secs" "$@" 2>/dev/null || true
}

# Check for simple mode FIRST - CLAUDE_CODE_SIMPLE disables hooks/skills, OSS cannot function
SIMPLE_CHECK_SCRIPT="$SCRIPT_DIR/oss-simple-mode-check.sh"
if [[ -x "$SIMPLE_CHECK_SCRIPT" ]]; then
    "$SIMPLE_CHECK_SCRIPT"
fi

# Ensure ~/.oss directory exists with secure permissions
mkdir -p ~/.oss
chmod 700 ~/.oss  # Only owner can access

# Telegram is retired: drop its old plaintext bot token from settings.json (silent, never fails the session)
bash "$SCRIPT_DIR/oss-settings-cleanup.sh" </dev/null >/dev/null 2>&1 || true

# --- Session Logging (for supervisor visibility) ---
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"
if [[ -x "$LOG_SCRIPT" ]] && [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    "$LOG_SCRIPT" hook oss-session-start START
fi

# Determine plugin root (persisted to ~/.oss/plugin-root below, together with the shared hooks)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"

# Copy frequently-used hooks to ~/.oss/hooks/ for reliable access from skills
# This ensures skills can find these hooks without relying on CLAUDE_PLUGIN_ROOT
mkdir -p ~/.oss/hooks
HOOKS_TO_COPY=(
    "oss-log.sh"
    "oss-notify.sh"
    "oss-safe-path.sh"            # sourced by oss-log.sh and oss-notify.sh: the project-write guard
    "oss-value.sh"                # served prompts' value files: dir / failed / error (G21); needs the two above
    "oss-login.sh"                # /oss:login saves the key; sources oss-value.sh; NOT allowlisted (R5-8)
    "oss-api-curl.sh"             # sourced by oss-notify.sh and oss-iron-laws-sync.sh: API key via curl stdin
    "oss-statusline.sh"
    "oss-detect-playwright.sh"
    "ensure-decrypt-cli.sh"
    "oss-decrypt-checksums.txt"   # committed hash manifest ensure-decrypt-cli.sh verifies against
    "verify-decrypt-setup.sh"
    "oss-iron-laws-sync.sh"
    "oss-claude-md-template.sh"   # /oss:login Step 4.2: the CLAUDE.md template from the configured API
    "oss-onboard-check.sh"
    "oss-setup-permissions.sh"
)
# Never downgrade them (T17): ~/.oss/hooks is machine-global, so a session on an older plugin must not
# replace hooks a newer plugin installed. Versions are dot-separated digits (a -prerelease suffix is
# dropped), compared per part; anything else counts as unreadable (and never reaches arithmetic). No
# trusted record: copy, as before. Unreadable own version with a trusted record: keep the record's hooks
# (we cannot show we are not older).
oss_version() { # the numeric core (2.1.0-beta.1 -> 2.1.0); parts of 1-9 digits, so (( )) never overflows
    local re='^([0-9]{1,9}(\.[0-9]{1,9})*)(-[0-9A-Za-z.-]+)?$'
    [[ "$1" =~ $re ]] && printf '%s' "${BASH_REMATCH[1]}"
}
oss_version_ge() { # A >= B, both from oss_version (digits and dots only, so the split below is safe)
    local IFS=. i
    # shellcheck disable=SC2206
    local -a a=($1) b=($2)
    for ((i = 0; i < ${#a[@]} || i < ${#b[@]}; i++)); do
        (( 10#${a[i]:-0} != 10#${b[i]:-0} )) && { (( 10#${a[i]:-0} > 10#${b[i]:-0} )); return; }
    done
    return 0
}
oss_plugin_version() { # <root>: the top-level "version" of <root>/.claude-plugin/plugin.json
    # Top-level keys are indented 0-2 spaces, nested ones deeper, so a nested "version" never wins. One
    # parser for every session (no jq branch): two plugins on one machine always read a root the same way.
    oss_version "$(grep -oE '^ {0,2}"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1/.claude-plugin/plugin.json" 2>/dev/null | head -1 | cut -d'"' -f4)"
}
PLUGIN_VERSION=$(oss_plugin_version "$PLUGIN_ROOT")
# The record is "<version>\n<plugin root that wrote it>". It counts only while that root still has that
# version: an uninstalled or rolled-back plugin (or a planted record) is no record. A one-line record
# (only the unreleased 2.0.95 wrote one) names no root, so it is no record too.
oss_record_trusted() { # <version> <root>: <root> is the plugin the installed hooks came from (T31)
    # A user-owned real directory and plugin.json, tested before any read (a FIFO is never opened: it
    # would hang session start); then that root's version; then the hooks, cheapest checks first.
    local v=$1 r=$2 n
    [[ -d "$r" && ! -L "$r" && -O "$r" ]] || return 1
    [[ -f "$r/.claude-plugin/plugin.json" && ! -L "$r/.claude-plugin/plugin.json" && -O "$r/.claude-plugin/plugin.json" ]] || return 1
    [[ "$(oss_plugin_version "$r")" == "$v" ]] || return 1
    # Every hook this plugin installs must be a regular non-symlink file in the root AND in ~/.oss/hooks,
    # byte-identical (T36): one missing on either side means not trusted, since a root holding only some
    # proves nothing about the rest. The first mismatch stops; cmp opens only regular files.
    for n in "${HOOKS_TO_COPY[@]}"; do
        [[ -f "$r/hooks/$n" && ! -L "$r/hooks/$n" && -f "$HOME/.oss/hooks/$n" && ! -L "$HOME/.oss/hooks/$n" ]] || return 1
        cmp -s "$r/hooks/$n" "$HOME/.oss/hooks/$n" || return 1
    done
}
OSS_RECORD="$HOME/.oss/hooks/.installed-version"
INSTALLED_VERSION=""   # only a regular file is ever opened: a FIFO would block the read, a link points elsewhere
if [[ -f "$OSS_RECORD" && ! -L "$OSS_RECORD" ]]; then
    { IFS= read -r _rec_version; IFS= read -r _rec_root; } 2>/dev/null < "$OSS_RECORD"
    _rec_version=$(oss_version "${_rec_version:-}")
    # Only a record newer than this plugin (or any record, when this version is unreadable) can stop
    # the copy, so only then is its root checked.
    if [[ -n "$_rec_version" && -n "${_rec_root:-}" ]] &&
        ! { [[ -n "$PLUGIN_VERSION" ]] && oss_version_ge "$PLUGIN_VERSION" "$_rec_version"; } &&
        oss_record_trusted "$_rec_version" "$_rec_root"; then
        INSTALLED_VERSION=$_rec_version
    fi
fi
if [[ -z "$INSTALLED_VERSION" ]] || { [[ -n "$PLUGIN_VERSION" ]] && oss_version_ge "$PLUGIN_VERSION" "$INSTALLED_VERSION"; }; then
    # Persist plugin root path for skills/commands that run outside hook context (they have no
    # CLAUDE_PLUGIN_ROOT). Only with the hooks (T18): the shared hooks and the root they use are one plugin's.
    echo "$PLUGIN_ROOT" > ~/.oss/plugin-root
    chmod 600 ~/.oss/plugin-root
    _copied=1
    for hook in "${HOOKS_TO_COPY[@]}"; do
        if [[ -f "$PLUGIN_ROOT/hooks/$hook" ]]; then
            cp "$PLUGIN_ROOT/hooks/$hook" ~/.oss/hooks/ || _copied=0
            if [[ "$hook" == *.sh ]]; then chmod +x ~/.oss/hooks/$hook || _copied=0; fi   # data files (checksum manifest) stay non-executable
        fi
    done

    # Also copy to legacy location for backwards compatibility
    if [[ -f "$PLUGIN_ROOT/hooks/oss-statusline.sh" ]]; then
        cp "$PLUGIN_ROOT/hooks/oss-statusline.sh" ~/.oss/oss-statusline.sh || _copied=0
        chmod +x ~/.oss/oss-statusline.sh || _copied=0
    fi
    # The record says who installed ALL of them: written only when every copy succeeded, by replacing
    # the file (temp in the same dir + mv), so a reader never sees half a record and nothing at the
    # record's path (a hard link, a symlink) is written through.
    if [[ "$_copied" == 1 && -n "$PLUGIN_VERSION" ]]; then
        _rec_tmp=$(mktemp "$HOME/.oss/hooks/.installed-version.XXXXXX" 2>/dev/null) &&
            printf '%s\n%s\n' "$PLUGIN_VERSION" "$PLUGIN_ROOT" > "$_rec_tmp" &&
            { [[ ! -L "$OSS_RECORD" && ! -d "$OSS_RECORD" ]] || rm -rf "$OSS_RECORD"; } &&   # mv would land inside a dir (or a link to one)
            mv -f "$_rec_tmp" "$OSS_RECORD" ||
            rm -f "$_rec_tmp" 2>/dev/null
    fi
fi

# Write current project path EARLY for multi-project support
# This must happen before config checks so other hooks can read it
# Other hooks/scripts read this to know which project is active
if [[ -n "$CLAUDE_PROJECT_DIR" ]]; then
    echo "$CLAUDE_PROJECT_DIR" > ~/.oss/current-project
    chmod 600 ~/.oss/current-project  # Only owner can read/write
fi

# This session's pointer (notify-routing-unify D2): model-run scripts get no CLAUDE_PROJECT_DIR but
# do get CLAUDE_CODE_SESSION_ID, so they read ~/.oss/sessions/<id>/project. Written on every
# SessionStart (startup/resume/clear/compact) under that id and, when it differs, the stdin session_id.
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]] && declare -F oss_session_pointer_write >/dev/null; then
    oss_hook_stdin
    oss_session_pointer_write "${CLAUDE_CODE_SESSION_ID:-}" "$CLAUDE_PROJECT_DIR"
    [[ "$_OSS_HOOK_SID" != "${CLAUDE_CODE_SESSION_ID:-}" ]] && oss_session_pointer_write "$_OSS_HOOK_SID" "$CLAUDE_PROJECT_DIR"
    oss_session_pointer_prune
fi

# Check Claude Code version (non-blocking) - runs claude --version, MIN_VERSION is 2.1.50
if [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    VERSION_CHECK_SCRIPT="$SCRIPT_DIR/oss-version-check.sh"
    if [[ -x "$VERSION_CHECK_SCRIPT" ]]; then
        run_with_timeout 2 "$VERSION_CHECK_SCRIPT"
    fi
fi

# Check for API key configuration
if ! declare -F oss_config_file >/dev/null; then
    echo "OSS: install incomplete (oss-api-curl.sh missing) — reinstall the plugin."
    exit 0
fi
CONFIG_FILE=$(oss_config_file 2>/dev/null)   # the same file oss_api_url reads: key and URL from one place
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "OSS: Not logged in. Run /oss login to authenticate."
    exit 0
fi

# Check if API key exists in config
oss_api_creds 2>/dev/null; API_KEY=$OSS_KEY   # key and URL from one read of one object (T30, T37)
if [[ -z "$API_KEY" ]]; then
    echo "OSS: No API key found. Run /oss login to authenticate."
    exit 0
fi

# Plain http to a local API without the opt-in: oss_api_url gives no URL (rc 2), so the key goes nowhere;
# say why instead of going quiet (T20, D7). The URL is not echoed: the user knows it, and it is never printed.
[[ "$OSS_URL_RC" == 2 ]] && oss_loopback_refused

# Quick subscription check (non-blocking, skipped in test environments)
# Note: Full validation happens when skills are used
if [[ "${OSS_SKIP_HEALTH_CHECK:-}" == "1" ]]; then
    SUBSCRIPTION_STATUS="active"
elif API_URL=$OSS_URL; [[ "$OSS_URL_RC" == 0 ]]; then
    SUBSCRIPTION_STATUS=$(oss_api_curl "$API_KEY" -s -m 2 \
        "${API_URL}/api/v1/subscription/status" 2>/dev/null | \
        grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 || echo "unknown")
else
    SUBSCRIPTION_STATUS="unknown"   # invalid apiUrl: the key goes nowhere
fi

# Get project name for notification
PROJECT_NAME="${CLAUDE_PROJECT_DIR##*/}"
[[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="OSS"

# Display session start message
case "$SUBSCRIPTION_STATUS" in
    "active"|"trial")
        echo "OSS: Ready ($SUBSCRIPTION_STATUS) - IRON LAWS active"
        ;;
    "expired")
        echo "OSS: Subscription expired. Upgrade at https://www.oneshotship.com/pricing"
        ;;
    *)
        # Don't block on network issues - just continue
        echo "OSS: Ready - IRON LAWS active"
        ;;
esac

# Clear iron-laws session marker (legacy cleanup)
rm -f ~/.oss/iron-laws-session-notified 2>/dev/null

# Setup project permissions (creates .claude/settings.local.json with OSS entries)
SETUP_PERMS_SCRIPT="$PLUGIN_ROOT/hooks/oss-setup-permissions.sh"
if [[ -x "$SETUP_PERMS_SCRIPT" ]]; then
    "$SETUP_PERMS_SCRIPT" "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || true
fi

# Refresh an existing IRON LAWS block in CLAUDE.md (skipped in test environments).
# Detached, output discarded: a slow or dead API must never delay session start.
if [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    IRON_LAWS_SYNC_SCRIPT="$PLUGIN_ROOT/hooks/oss-iron-laws-sync.sh"
    if [[ -x "$IRON_LAWS_SYNC_SCRIPT" ]]; then
        ( CLAUDE_PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}" nohup "$IRON_LAWS_SYNC_SCRIPT" </dev/null >/dev/null 2>&1 & )
    fi
fi

# --- Watcher Management (US-001) ---
# Spawn watcher process if not already running (singleton pattern)
# PLUGIN_ROOT already set above
PROJECT_OSS_DIR="${CLAUDE_PROJECT_DIR:-.}/.oss"
WATCHER_PID_FILE="$PROJECT_OSS_DIR/watcher.pid"
WATCHER_SCRIPT="$PLUGIN_ROOT/watcher/dist/index.js"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"
HEALTH_CHECK_CLI="$PLUGIN_ROOT/watcher/dist/cli/health-check.js"

# Ensure project .oss directory exists, and setup .gitignore on first creation
GITIGNORE_FILE="${CLAUDE_PROJECT_DIR:-.}/.gitignore"

_OSS_PROJECT="${CLAUDE_PROJECT_DIR:-.}"
if [[ -z "${CLAUDE_PROJECT_DIR:-}" ]]; then
    :   # no project known: no stray ./.oss (R1-4; Claude Code always sets CLAUDE_PROJECT_DIR)
elif [[ ! -d "$PROJECT_OSS_DIR" ]]; then
    # First time - create .oss folder (through the guard: a committed .oss link is refused)
    if ! oss_safe_mkdir "$_OSS_PROJECT" .oss; then
        oss_refuse_unsafe .oss
    # Setup .gitignore (only on first .oss creation; a committed .gitignore link is refused)
    elif ! oss_safe_target "$_OSS_PROJECT" .gitignore; then
        oss_refuse_unsafe .gitignore
    elif [[ -f "$GITIGNORE_FILE" ]]; then
        OSS_GITIGNORE_MARKER="# OSS Dev Workflow (auto-added)"
        # Check if .oss entries already exist
        if ! grep -qE "^\.oss/\*$|^\.oss/$" "$GITIGNORE_FILE" 2>/dev/null; then
            # Add OSS entries to existing .gitignore
            echo "" >> "$GITIGNORE_FILE"
            echo "$OSS_GITIGNORE_MARKER" >> "$GITIGNORE_FILE"
            echo ".oss/*" >> "$GITIGNORE_FILE"
            echo "!.oss/dev/" >> "$GITIGNORE_FILE"
        fi
    else
        # Create new .gitignore with OSS entries
        cat > "$GITIGNORE_FILE" << 'GITIGNORE_EOF'
# OSS Dev Workflow (auto-added)
.oss/*
!.oss/dev/
GITIGNORE_EOF
    fi
else
    # .oss already exists - just ensure it is a real, user-owned directory
    oss_safe_mkdir "$_OSS_PROJECT" .oss || oss_refuse_unsafe .oss
fi

# Get git branch for session logging
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Log session START event with project metadata
TIMESTAMP=$(date '+%H:%M:%S')
SESSION_LOG="$HOME/.oss/logs/current-session/session.log"
mkdir -p "$(dirname "$SESSION_LOG")"
echo "[$TIMESTAMP] [session] [START] project=$PROJECT_NAME branch=$CURRENT_BRANCH" >> "$SESSION_LOG"

# Initialize workflow state (for Claude Code status line)
# prepareForNewSession clears stale workflow data (progress, currentTask, notifications)
# while preserving chainState history and setting supervisor to 'watching'
# NOTE: All node calls use run_with_timeout to prevent blocking Claude Code startup
if [[ -f "$WORKFLOW_STATE_CLI" ]] && [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    # Use --project-dir so state writes go to the project-local file
    _WF_PROJECT_DIR_ARGS=()
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" && -d "${CLAUDE_PROJECT_DIR}/.oss" ]]; then
        _WF_PROJECT_DIR_ARGS=(--project-dir "$CLAUDE_PROJECT_DIR")
    fi
    run_with_timeout 2 node "$WORKFLOW_STATE_CLI" "${_WF_PROJECT_DIR_ARGS[@]}" init
    run_with_timeout 2 node "$WORKFLOW_STATE_CLI" "${_WF_PROJECT_DIR_ARGS[@]}" prepareForNewSession
    # Generate unique session ID for staleness detection
    SESSION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "session-$(date +%s)")
    run_with_timeout 2 node "$WORKFLOW_STATE_CLI" "${_WF_PROJECT_DIR_ARGS[@]}" setSessionId "$SESSION_ID"
fi

# Watcher daemon spawn removed - watcher/dist/index.js is a library module (exports
# Watcher class with no main/event-loop), so spawning it as a background process
# exits immediately and creates stale PID files. Chain execution is now handled by
# oss-notify.sh via chain-trigger.js on complete events.
# Clean up any stale PID files from previous versions.
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]] && oss_safe_mkdir "$_OSS_PROJECT" .oss 2>/dev/null; then rm -f "$WATCHER_PID_FILE" 2>/dev/null; fi

# --- Health Check (Run tests on session start) ---
# Run npm test to catch any pre-existing failures and queue them
# This ensures the supervisor catches issues BEFORE work begins
# NOTE: Health check is OPT-IN to prevent startup delays on large projects
# Set OSS_RUN_HEALTH_CHECK=1 to enable automatic health checks on session start
if [[ "${OSS_RUN_HEALTH_CHECK:-}" == "1" ]] && [[ -f "$HEALTH_CHECK_CLI" ]] && [[ -f "package.json" ]]; then
    echo "OSS: Running health check (background)..."
    # Run in background to not block session start
    # Output goes to session log for debugging
    (
        cd "${CLAUDE_PROJECT_DIR:-.}"
        # Run with verbose flag, log output to session log
        # Use > to overwrite (not >>) so stale results don't persist
        LOG_DIR="$HOME/.oss/logs/current-session"
        mkdir -p "$LOG_DIR"
        # Bounded (T18): a hung check must not live on after the session. OSS_HEALTH_CHECK_TIMEOUT: seconds.
        _hc_secs=900; [[ "${OSS_HEALTH_CHECK_TIMEOUT:-}" =~ ^[1-9][0-9]{0,5}$ ]] && _hc_secs=$OSS_HEALTH_CHECK_TIMEOUT
        run_bounded "$_hc_secs" node "$HEALTH_CHECK_CLI" --verbose > "$LOG_DIR/health-check.log" 2>&1
        EXIT_CODE=$?
        # Append summary to the log (stdout is detached, D3)
        if [[ $EXIT_CODE -eq 0 ]]; then
            echo "OSS: ✅ Health check passed - all tests passing"
        elif [[ $EXIT_CODE -eq 1 ]]; then
            echo "OSS: ❌ Health check found failing tests - check queue"
        else
            echo "OSS: ⚠️ Health check error - see ~/.oss/logs/current-session/health-check.log"
        fi >> "$LOG_DIR/health-check.log"
    ) </dev/null >/dev/null 2>&1 &
fi

# Restore previous session context if available (project-local first, for multi-project isolation)
NOTIFY_SCRIPT="$PLUGIN_ROOT/hooks/oss-notify.sh"
# The notify context is JSON built from a folder name and a saved branch (S6): jq builds it, so a " or a backslash
# stays data. Without jq only values in a plain charset are interpolated; any other value: no notification.
NOTIFY_CONTEXT=""
oss_plain_values() { local re='^[A-Za-z0-9 ._/+@:-]*$' v; for v in "$@"; do [[ "$v" =~ $re ]] || return 1; done; }
PROJECT_CONTEXT_FILE="$PROJECT_OSS_DIR/session-context.md"

if [[ -f "$PROJECT_CONTEXT_FILE" ]]; then
    # Get context info for notification (from project-local)
    CONTEXT_FILE="$PROJECT_CONTEXT_FILE"
    BRANCH_LINE=$(grep "^\*\*Branch:\*\*" "$CONTEXT_FILE" 2>/dev/null | head -1)
    BRANCH=$(echo "$BRANCH_LINE" | sed 's/\*\*Branch:\*\* //')

    # Parse save date from context file (format: _Saved: 2025-12-09 11:54:10_)
    SAVE_DATE_RAW=$(grep "^_Saved:" "$CONTEXT_FILE" 2>/dev/null | sed 's/_Saved: //' | sed 's/_$//')

    # Calculate human-friendly "X ago" format
    # Initialize empty - notification-copy.ts handles gracefully (shows "Context restored")
    SAVE_DATE=""
    if [[ -n "$SAVE_DATE_RAW" ]]; then
        # Convert save date to epoch (macOS vs Linux)
        if [[ "$(uname)" == "Darwin" ]]; then
            SAVE_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "$SAVE_DATE_RAW" "+%s" 2>/dev/null || echo "0")
        else
            SAVE_EPOCH=$(date -d "$SAVE_DATE_RAW" "+%s" 2>/dev/null || echo "0")
        fi
        NOW_EPOCH=$(date "+%s")

        if [[ "$SAVE_EPOCH" != "0" ]]; then
            DIFF_SECS=$((NOW_EPOCH - SAVE_EPOCH))
            if [[ $DIFF_SECS -lt 60 ]]; then
                SAVE_DATE="just now"
            elif [[ $DIFF_SECS -lt 3600 ]]; then
                MINS=$((DIFF_SECS / 60))
                SAVE_DATE="${MINS}m ago"
            elif [[ $DIFF_SECS -lt 86400 ]]; then
                HOURS=$((DIFF_SECS / 3600))
                SAVE_DATE="${HOURS}h ago"
            else
                DAYS=$((DIFF_SECS / 86400))
                SAVE_DATE="${DAYS}d ago"
            fi
        fi
    fi

    # Count uncommitted changes from current git status
    # One number: grep -c prints 0 AND exits 1 when nothing matches, so "|| echo 0" gave "0<newline>0"
    UNCOMMITTED_COUNT=$(git status -s 2>/dev/null | grep -c . || true)
    [[ "$UNCOMMITTED_COUNT" =~ ^[0-9]+$ ]] || UNCOMMITTED_COUNT=0

    echo ""
    echo "Previous session context restored."

    # Visual notification for context restore (via unified oss-notify.sh)
    # NOTE: Backgrounded to prevent blocking Claude Code startup
    # Skip in test mode to prevent background processes from blocking test runners
    if [[ -x "$NOTIFY_SCRIPT" ]] && [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
        if command -v jq >/dev/null 2>&1; then
            NOTIFY_CONTEXT=$(jq -cn --arg project "$PROJECT_NAME" --arg branch "${BRANCH:-unknown}" --arg saveDate "$SAVE_DATE" \
                --argjson uncommitted "$UNCOMMITTED_COUNT" '{project: $project, branch: $branch, saveDate: $saveDate, uncommitted: $uncommitted}' 2>/dev/null || true)
        elif oss_plain_values "$PROJECT_NAME" "${BRANCH:-unknown}" "$SAVE_DATE"; then
            NOTIFY_CONTEXT="{\"project\": \"$PROJECT_NAME\", \"branch\": \"${BRANCH:-unknown}\", \"saveDate\": \"${SAVE_DATE}\", \"uncommitted\": $UNCOMMITTED_COUNT}"
        fi
        if [[ -n "$NOTIFY_CONTEXT" ]]; then "$NOTIFY_SCRIPT" --session context_restored "$NOTIFY_CONTEXT" </dev/null >/dev/null 2>&1 & fi
    fi
else
    # No saved context - fresh start notification (via unified oss-notify.sh)
    # NOTE: Backgrounded to prevent blocking Claude Code startup
    if [[ -x "$NOTIFY_SCRIPT" ]] && [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
        if command -v jq >/dev/null 2>&1; then
            NOTIFY_CONTEXT=$(jq -cn --arg project "$PROJECT_NAME" '{project: $project}' 2>/dev/null || true)
        elif oss_plain_values "$PROJECT_NAME"; then
            NOTIFY_CONTEXT="{\"project\": \"$PROJECT_NAME\"}"
        fi
        if [[ -n "$NOTIFY_CONTEXT" ]]; then "$NOTIFY_SCRIPT" --session fresh_start "$NOTIFY_CONTEXT" </dev/null >/dev/null 2>&1 & fi
    fi
fi

# Log hook COMPLETE
if [[ -x "$LOG_SCRIPT" ]] && [[ "${OSS_SKIP_HEALTH_CHECK:-}" != "1" ]]; then
    "$LOG_SCRIPT" hook oss-session-start COMPLETE
fi

exit 0
