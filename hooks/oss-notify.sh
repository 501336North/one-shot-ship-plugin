#!/bin/bash
# oss-notify.sh - Unified notification hook for OSS Dev Workflow
#
# Usage (direct):
#   oss-notify.sh "Title" "Message"
#
# Usage (with copy service):
#   oss-notify.sh --workflow <command> <event> [context-json]
#   oss-notify.sh --session <event> [context-json]
#   oss-notify.sh --issue <type> [context-json]
#
# Respects settings from ~/.oss/settings.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/oss-api-curl.sh" ]]; then source "$SCRIPT_DIR/oss-api-curl.sh"; fi  # oss_api_curl: API key via stdin, never argv
if [[ -f "$SCRIPT_DIR/oss-safe-path.sh" ]]; then source "$SCRIPT_DIR/oss-safe-path.sh"; else oss_safe_mkdir() { return 1; }; oss_safe_target() { return 1; }; oss_valid_workflow_name() { return 1; }; oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-} (oss-safe-path.sh missing)" >&2; }; fi  # oss_valid_workflow_name (fail closed if absent)
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
# R-257: oss_run_bounded_rc, oss_phase_gate_ok, oss_plugin_root_file and the fixed git and jq (OSS_GIT_BIN,
# OSS_JQ_BIN); absent, every gate fails closed.
if [[ -f "$SCRIPT_DIR/oss-phase-result.sh" ]]; then source "$SCRIPT_DIR/oss-phase-result.sh"; else oss_run_bounded_rc() { OSS_BOUNDED_OUT=""; return 127; }; oss_phase_gate_ok() { echo "cli_missing" >&2; return 1; }; oss_plugin_root_file() { return 1; }; OSS_GIT_BIN=/usr/bin/git; OSS_JQ_BIN=/usr/bin/jq; fi

# =============================================================================
# TIMEOUT WRAPPER - Prevents blocking on slow/hanging node calls
# Keeps the command's stderr: each caller redirects it (F6: chain-trigger's goes to its log).
# =============================================================================
run_with_timeout() {
    local timeout_secs="${1:-2}"
    shift
    if command -v gtimeout &>/dev/null; then
        gtimeout "$timeout_secs" "$@" || true
    elif command -v timeout &>/dev/null; then
        timeout "$timeout_secs" "$@" || true
    elif [[ -x /usr/bin/perl ]]; then
        # Fallback (stock macOS): one supervisor owns the time limit (T72; the same program as oss-session-start.sh's, byte
        # for byte: one-copy-helpers.test.sh, T81; inline, so a hook never loses its limit to a missing file). It is the
        # command's parent and runs it in its own process group (like GNU timeout; stdin /dev/null). It never signals
        # that group after reaping the leader (the id may then be reused): it polls the leader with
        # waitpid(WNOHANG) between short sleeps (1 ms doubling to 100 ms; a SIGCHLD cuts them short), and handlers only
        # set flags. At the bound, or once this shell is gone (HUP, INT or TERM to it, or its parent changes), it
        # kills the group, waits for the leader's SIGCHLD, kills the group again while the zombie leader still holds
        # the id (a child forked while the first kill landed, T54c), and only then reaps. It sits in a group of its
        # own, so a KILL to this shell's group still leaves it to end the command's.
        /usr/bin/perl -e '
            my ($s, $pp, $stop, $chld) = (shift, getppid, 0, 0);
            $SIG{CHLD} = sub { $chld = 1 };   # before the fork: an inherited SIG_IGN would let the kernel reap
            my $p = fork; exit 125 unless defined $p;
            if (!$p) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit($!{ENOENT} ? 127 : 126) }
            setpgrp($p, $p); setpgrp(0, 0);
            my %n = (HUP => 1, INT => 2, TERM => 15);
            for my $g (keys %n) { $SIG{$g} = sub { $stop = $n{$g} } }
            sub gkill { kill "KILL", -$p }
            my ($t0, $used, $tick) = (time, 0, 0.001);
            while (1) {
                my $r = waitpid($p, 1);   # 1: WNOHANG
                if ($r == $p) { exit($? & 127 ? 128 + ($? & 127) : $? >> 8) }
                exit 125 if $r == -1;     # not ours to reap (never expected): signal nothing
                last if $stop || $used >= $s || time - $t0 > $s + 1 || getppid != $pp;   # time(): whole seconds, a backstop
                select(undef, undef, undef, $tick); $used += $tick; $tick = $tick < 0.05 ? $tick * 2 : 0.1;
            }
            gkill(); for (1 .. 200) { last if $chld; select(undef, undef, undef, 0.005) }
            gkill(); waitpid($p, 0); exit($stop ? 128 + $stop : 137);
        ' "$timeout_secs" "$@" </dev/null || true
    else
        "$@" </dev/null || true   # no perl either: unbounded, so nothing is ever signalled (T72)
    fi
}

# =============================================================================
# CLI PATH RESOLUTION - Version-agnostic lookup with plugin cache fallback
# =============================================================================
# Priority 1: CLAUDE_PLUGIN_ROOT (set by Claude Code hook system)
# Priority 2: the plugin named by ~/.oss/plugin-root (R-257 T10c: `claude --plugin-dir` has no plugin cache)
# Priority 3: find in ~/.claude/plugins/cache/ (fallback for command prompts)
resolve_cli() {
    local cli_name="$1"
    local cli_subpath="$2"
    # Try PLUGIN_ROOT first
    local direct_path="$PLUGIN_ROOT/$cli_subpath"
    if [[ -f "$direct_path" ]]; then
        echo "$direct_path"
        return
    fi
    # ~/.oss/plugin-root only as session-start writes it (oss_plugin_root_file: not a link, owned, mode 600; D25 c)
    if oss_plugin_root_file && [[ -f "$_OSS_ROOT_FILE/$cli_subpath" ]]; then
        echo "$_OSS_ROOT_FILE/$cli_subpath"
        return
    fi
    # Fallback: search plugin cache (version-agnostic)
    local found
    found=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "$cli_name" -path "*/$cli_subpath" -type f 2>/dev/null | sort -V | tail -1)
    if [[ -n "$found" ]]; then
        echo "$found"
        return
    fi
    # Last resort: return the direct path (will fail gracefully)
    echo "$direct_path"
}

COPY_CLI="$(resolve_cli "get-copy.js" "watcher/dist/cli/get-copy.js")"
WORKFLOW_STATE_CLI="$(resolve_cli "update-workflow-state.js" "watcher/dist/cli/update-workflow-state.js")"
# Prefer bundled .cjs (standalone, no external imports) over .js (needs api/engine deps)
CHAIN_TRIGGER_CLI="$(resolve_cli "chain-trigger.cjs" "watcher/dist/cli/chain-trigger.cjs")"
if [[ ! -f "$CHAIN_TRIGGER_CLI" ]]; then
    CHAIN_TRIGGER_CLI="$(resolve_cli "chain-trigger.js" "watcher/dist/cli/chain-trigger.js")"
fi

# =============================================================================
# PROJECT DIRECTORY RESOLUTION - For multi-project workflow state isolation
# =============================================================================
# Resolve project directory so workflow state writes go to the correct
# project-local file (not the global ~/.oss/workflow-state.json).
# Resolution: oss_resolve_project (hooks/oss-safe-path.sh), the one rule for every model-run script.
_OSS_PROJ=""
declare -F oss_resolve_project >/dev/null && oss_resolve_project
_OSS_PROJECT_DIR="$_OSS_PROJ"

# Helper: call update-workflow-state.js with --project-dir when available
# Usage: wf_state <command> [args...]
wf_state() {
    if [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]]; then
        node "$WORKFLOW_STATE_CLI" --project-dir "$_OSS_PROJECT_DIR" "$@"
    else
        node "$WORKFLOW_STATE_CLI" "$@"
    fi
}

# Helper: call wf_state with timeout wrapper
wf_state_timeout() {
    local timeout_secs="$1"
    shift
    if [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]]; then
        run_with_timeout "$timeout_secs" node "$WORKFLOW_STATE_CLI" --project-dir "$_OSS_PROJECT_DIR" "$@"
    else
        run_with_timeout "$timeout_secs" node "$WORKFLOW_STATE_CLI" "$@"
    fi
}

# =============================================================================
# PHASE RESULTS (R-257) - the start gate (D16, D17) and the ledger run row (D14)
# =============================================================================

# _oss_phase_check <phase> <project>: rc 0 when that phase's result is valid and verified; else the reason class
# (timeout, cli_missing, exit_<rc>, ...) in _OSS_GATE_WHY. The CLI's own reason goes to stderr.
_oss_phase_check() {
    local rc=0
    oss_run_bounded_rc 15 "$BASH" "$SCRIPT_DIR/oss-phase-result.sh" check "$1" --repo "$2" || rc=$?
    _OSS_GATE_WHY=$(oss_phase_gate_ok "$rc" "$OSS_BOUNDED_OUT" 2>&1) && return 0
    return 1
}

# _oss_ledger_key <dir> -> stdout: the ledger key of <dir>'s repo, as watcher/src/phase-results/ledger.ts ledgerKey
# derives it (the first 16 hex of the git blob id of "<toplevel>\n<absolute git dir>\n"); fails outside a repo.
_oss_ledger_key() (
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
    local top g k
    cd -P -- "$1" 2>/dev/null && top=$("$OSS_GIT_BIN" rev-parse --show-toplevel 2>/dev/null) && cd -- "$top" 2>/dev/null \
        && g=$("$OSS_GIT_BIN" rev-parse --absolute-git-dir 2>/dev/null) || return 1
    k=$(printf '%s\n%s\n' "$top" "$g" | "$OSS_GIT_BIN" hash-object --stdin | cut -c1-16) && [[ ${#k} == 16 ]] || return 1
    printf '%s\n' "$k"
)

# _oss_ledger_has_results <project> <feature>: true when the ledger holds results rows for <feature> in this repo
# (~/.oss/ledger/<key>/results/<feature>, any kind of entry), i.e. the feature is not a pre-R-257 one (D17).
_oss_ledger_has_results() {
    local k
    k=$(_oss_ledger_key "$1") || return 1
    [[ -e "$HOME/.oss/ledger/$k/results/$2" || -L "$HOME/.oss/ledger/$k/results/$2" ]]
}

# _oss_ledger_run <phase>: appends {"startedAt","session","headSha","feature"} to ~/.oss/ledger/<key>/run/<phase> (NOTES.md
# ledger contract). startedAt is read back from the workflow state this start just wrote; the key is _oss_ledger_key's
# (the same as _ov_key's), from the physical cwd's repo. Dirs 700, file 600, links refused, one append.
_oss_ledger_run() (
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
    local sf="$HOME/.oss/workflow-state.json" s k top feat d c f sid head row
    local iso='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' sre='^[A-Za-z0-9-]{1,100}$'
    [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]] && sf="$_OSS_PROJECT_DIR/.oss/workflow-state.json"
    s=$("$OSS_JQ_BIN" -r '.currentCommandStartedAt // empty' "$sf" 2>/dev/null) && [[ "$s" =~ $iso ]] || return 1
    oss_phys_cwd; k=$(_oss_ledger_key "$_OSS_CWD") && cd "$_OSS_CWD" 2>/dev/null || return 1
    d="$HOME/.oss"
    for c in ledger "$k" run; do
        d="$d/$c"
        [[ -e "$d" || -L "$d" ]] || mkdir -m 700 "$d" 2>/dev/null
        [[ -d "$d" && ! -L "$d" ]] && test -O "$d" || return 1
    done
    f="$d/$1"
    oss_single_link "$f" && { [[ ! -e "$f" ]] || test -O "$f"; } || return 1
    sid="${CLAUDE_CODE_SESSION_ID:-}"; [[ "$sid" =~ $sre ]] || sid=""
    head=$("$OSS_GIT_BIN" rev-parse -q --verify HEAD 2>/dev/null) || head=""
    # the feature resolved for this repo and branch now ("" when none); the Stop shell reads the compact row by regex
    feat=""; top=$("$OSS_GIT_BIN" rev-parse --show-toplevel 2>/dev/null) && { oss_resolve_feature "$top" || true; feat="${_OSS_FEATURE:-}"; }
    row=$("$OSS_JQ_BIN" -cn --arg a "$s" --arg b "$sid" --arg c "$head" --arg d "$feat" \
        '{startedAt: $a, session: $b, headSha: $c, feature: $d}') || return 1
    (umask 077; printf '%s\n' "$row" >> "$f")
)

LOG_SCRIPT="$PLUGIN_ROOT/hooks/oss-log.sh"
# LOG_SCRIPT fallback: check plugin cache if not found at PLUGIN_ROOT
if [[ ! -f "$LOG_SCRIPT" ]]; then
    _found_log=$(find "$HOME/.claude/plugins/cache/one-shot-ship-plugin" -name "oss-log.sh" -path "*/hooks/*" -type f 2>/dev/null | sort -V | tail -1 || true)
    [[ -n "$_found_log" ]] && LOG_SCRIPT="$_found_log"
fi

# =============================================================================
# Parse arguments
# =============================================================================

USE_COPY_SERVICE=false
COPY_TYPE=""
COPY_ARGS=()
TITLE=""
MESSAGE=""
SUBTITLE=""

if [[ "${1:-}" == "--workflow" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="workflow"
    COPY_ARGS=("${@:2}")
    CMD="${2:-}"
    # The name reaches file paths (oss-log.sh <name>.log), analytics JSON and chain-trigger:
    # anything but a plain command name (e.g. build/../ship) is refused before any of them.
    if ! oss_valid_workflow_name "$CMD" 2>/dev/null; then
        echo "oss-notify: invalid workflow name refused (must match ^[a-z][a-z0-9-]{0,40}\$)" >&2
        exit 0
    fi
elif [[ "${1:-}" == "--session" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="session"
    COPY_ARGS=("${@:2}")
elif [[ "${1:-}" == "--issue" ]]; then
    USE_COPY_SERVICE=true
    COPY_TYPE="issue"
    COPY_ARGS=("${@:2}")
else
    # Direct usage: oss-notify.sh "Title" "Message"
    TITLE="${1:-Notification}"
    MESSAGE="${2:-}"
fi

# =============================================================================
# Get copy from service if requested
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true ]] && [[ -f "$COPY_CLI" ]]; then
    # Call copy service CLI (with timeout to prevent hanging)
    COPY_JSON=$(run_with_timeout 3 node "$COPY_CLI" "$COPY_TYPE" "${COPY_ARGS[@]}" 2>/dev/null || echo '{}')

    if command -v jq &>/dev/null; then
        # || a default: under set -e a non-JSON answer (FOLLOWUPS #130) must not end the hook here
        TITLE=$(echo "$COPY_JSON" | jq -r '.title // "OSS"' 2>/dev/null) || TITLE="OSS"
        MESSAGE=$(echo "$COPY_JSON" | jq -r '.message // ""' 2>/dev/null) || MESSAGE=""
        SUBTITLE=$(echo "$COPY_JSON" | jq -r '.subtitle // ""' 2>/dev/null) || SUBTITLE=""
    else
        # Fallback parsing
        TITLE=$(echo "$COPY_JSON" | grep -o '"title":"[^"]*"' | cut -d'"' -f4 || echo "OSS")
        MESSAGE=$(echo "$COPY_JSON" | grep -o '"message":"[^"]*"' | cut -d'"' -f4 || echo "")
        SUBTITLE=$(echo "$COPY_JSON" | grep -o '"subtitle":"[^"]*"' | cut -d'"' -f4 || echo "")
    fi
elif [[ "$USE_COPY_SERVICE" == true ]]; then
    # Copy service not available, use defaults
    case "$COPY_TYPE" in
        workflow)
            CMD="${COPY_ARGS[0]:-}"
            EVT="${COPY_ARGS[1]:-}"
            TITLE="OSS: $CMD"
            MESSAGE="$EVT"
            ;;
        session)
            TITLE="OSS Session"
            MESSAGE="${COPY_ARGS[0]:-event}"
            ;;
        issue)
            TITLE="OSS Issue"
            MESSAGE="${COPY_ARGS[0]:-detected}"
            ;;
    esac
fi

# =============================================================================
# Load settings
# =============================================================================

SETTINGS_FILE=~/.oss/settings.json

if [[ -f "$SETTINGS_FILE" ]]; then
    if command -v jq &>/dev/null; then
        STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE" 2>/dev/null || echo "visual")
        VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE" 2>/dev/null || echo "Samantha")
        SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE" 2>/dev/null || echo "Glass")
    else
        STYLE=$(grep -o '"style"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "visual")
        VOICE=$(grep -o '"voice"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Samantha")
        SOUND=$(grep -o '"sound"[[:space:]]*:[[:space:]]*"[^"]*"' "$SETTINGS_FILE" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' || echo "Glass")
    fi
else
    STYLE="visual"
    VOICE="Samantha"
    SOUND="Glass"
fi

# =============================================================================
# Update workflow state (for Claude Code status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "workflow" ]]; then
    WORKFLOW_CMD="${COPY_ARGS[0]:-}"
    WORKFLOW_EVENT="${COPY_ARGS[1]:-}"
    WORKFLOW_CONTEXT="${COPY_ARGS[2]:-}"
    [[ -n "$WORKFLOW_CONTEXT" ]] || WORKFLOW_CONTEXT='{}'

    # R-257: the phase this command runs (a -team variant is gated like its main command)
    _OSS_PHASE=""
    case "$WORKFLOW_CMD" in
        ideate | plan | build | ship) _OSS_PHASE="$WORKFLOW_CMD" ;;
        ideate-team | plan-team | build-team | ship-team) _OSS_PHASE="${WORKFLOW_CMD%-team}" ;;
    esac

    # Start gate (D16), before any log line or state change: plan, build and ship need the previous phase's valid
    # result. D17: a feature with no results/ folder at all and no results rows in the ledger (made before R-257) starts
    # with a one-line notice.
    if [[ "$WORKFLOW_EVENT" == start ]]; then
        _OSS_PREV=""
        case "$_OSS_PHASE" in plan) _OSS_PREV=ideate ;; build) _OSS_PREV=plan ;; ship) _OSS_PREV=build ;; esac
        if [[ -n "$_OSS_PREV" ]]; then
            _OSS_FEATURE=""
            # `|| true`: under set -e its git call would end the hook outside a repo (rc 128)
            [[ -n "$_OSS_PROJECT_DIR" ]] && { oss_resolve_feature "$_OSS_PROJECT_DIR" || true; }
            _OSS_RD="$_OSS_PROJECT_DIR/.oss/dev/active/$_OSS_FEATURE/results"
            # Legacy only when the ledger never saw a result for it either: deleting results/ skips nothing.
            if [[ -z "$_OSS_FEATURE" ]] || { [[ ! -e "$_OSS_RD" && ! -L "$_OSS_RD" ]] \
                && ! _oss_ledger_has_results "$_OSS_PROJECT_DIR" "$_OSS_FEATURE"; }; then
                # The notice is for OSS projects only: a folder with no .oss starts silently, as before R-257.
                [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]] && \
                    echo "no phase results for ${_OSS_FEATURE:-this project}: start gate skipped; run /oss:$_OSS_PREV to enable it"
            elif ! _oss_phase_check "$_OSS_PREV" "$_OSS_PROJECT_DIR"; then
                echo "oss-notify: $WORKFLOW_CMD start refused: no valid $_OSS_PREV result for $_OSS_FEATURE ($_OSS_GATE_WHY); run /oss:$_OSS_PREV to build it" >&2
                exit 1
            fi
        fi
    fi

    # Complete gate (US-001), before any log line, completeStep, setNextCommand, the checklist and the chain: the phase's
    # result must be valid, verified and bound to this run, in the project this command is for, which must be the
    # physical cwd's repo (repo_mismatch). A refusal takes the failed path (supervisor intervening), prints no CHAIN
    # and exits 1.
    if [[ "$WORKFLOW_EVENT" == complete && -n "$_OSS_PHASE" ]]; then
        _OSS_GATE_WHY=""
        oss_phys_cwd
        _OSS_TOP_CWD=$(unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; cd "$_OSS_CWD" 2>/dev/null && "$OSS_GIT_BIN" rev-parse --show-toplevel 2>/dev/null) || _OSS_TOP_CWD=""
        _OSS_TOP_PROJ=$(unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; cd "$_OSS_PROJECT_DIR" 2>/dev/null && "$OSS_GIT_BIN" rev-parse --show-toplevel 2>/dev/null) || _OSS_TOP_PROJ=""
        if [[ -z "$_OSS_PROJECT_DIR" ]]; then _OSS_GATE_WHY="no_repo"
        elif [[ -z "$_OSS_TOP_CWD" || "$_OSS_TOP_CWD" != "$_OSS_TOP_PROJ" ]]; then _OSS_GATE_WHY="repo_mismatch"
        fi
        if [[ -n "$_OSS_GATE_WHY" ]] || ! _oss_phase_check "$_OSS_PHASE" "$_OSS_PROJECT_DIR"; then
            _OSS_MSG="oss-notify: $WORKFLOW_CMD complete refused: no valid $_OSS_PHASE result ($_OSS_GATE_WHY); build it with oss-phase-result.sh assemble $_OSS_PHASE, then complete again"
            [[ "$_OSS_PHASE" == build ]] && _OSS_MSG="$_OSS_MSG; build evidence is from repo files (not ledger-checked)"
            echo "$_OSS_MSG" >&2
            if [[ -x "$LOG_SCRIPT" ]]; then "$LOG_SCRIPT" write "$WORKFLOW_CMD" "[failed] phase result refused ($_OSS_GATE_WHY)" 2>/dev/null || true; fi
            "$SCRIPT_DIR/oss-timeline.sh" command "$WORKFLOW_CMD" failed </dev/null >/dev/null 2>&1 || true
            if [[ -f "$WORKFLOW_STATE_CLI" ]]; then wf_state_timeout 2 setSupervisor intervening >/dev/null 2>&1 || true; fi
            exit 1
        fi
        # D26: a ship result whose gate evidence is not all captured reviewer verdicts passes, labelled (like D15)
        if [[ "$_OSS_PHASE" == ship ]] && _OSS_UNC=$(printf '%s' "$OSS_BOUNDED_OUT" \
            | "$OSS_JQ_BIN" -er 'select(.gateEvidence != "agent") | .uncapturedGates | join(", ")' 2>/dev/null) \
            && [[ -n "$_OSS_UNC" ]]; then
            echo "ship gates without a captured reviewer verdict: $_OSS_UNC (model-reported)"
        fi
    fi

    # Write to workflow log file
    if [[ -x "$LOG_SCRIPT" && -n "$WORKFLOW_CMD" ]]; then
        LOG_MSG="[$WORKFLOW_EVENT]"
        if [[ -n "$WORKFLOW_CONTEXT" && "$WORKFLOW_CONTEXT" != "{}" ]]; then
            # Extract key info from context for log
            if command -v jq &>/dev/null; then
                CONTEXT_SUMMARY=$(echo "$WORKFLOW_CONTEXT" | jq -r 'to_entries | map("\(.key)=\(.value)") | join(", ")' 2>/dev/null || echo "$WORKFLOW_CONTEXT")
                LOG_MSG="$LOG_MSG $CONTEXT_SUMMARY"
            else
                LOG_MSG="$LOG_MSG $WORKFLOW_CONTEXT"
            fi
        fi
        "$LOG_SCRIPT" write "$WORKFLOW_CMD" "$LOG_MSG" 2>/dev/null || true
    fi

    # G2 B2: one command line in the feature timeline (AC-G2-001.1), before the watcher check so it is written
    # without watcher/dist; the name passed oss_valid_workflow_name above. A refusal never stops this hook. G2 B5:
    # then the copy to the API starts detached, in a process group of its own, so it never delays this hook.
    case "$WORKFLOW_EVENT" in
        start | complete | failed)
            "$SCRIPT_DIR/oss-timeline.sh" command "$WORKFLOW_CMD" "$WORKFLOW_EVENT" </dev/null >/dev/null 2>&1 || true
            "$SCRIPT_DIR/oss-timeline.sh" push --detach </dev/null >/dev/null 2>&1 || true ;;
    esac

    # Update workflow state based on workflow event
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        case "$WORKFLOW_EVENT" in
            start)
                wf_state setActiveStep "$WORKFLOW_CMD" 2>/dev/null || true
                wf_state setCurrentCommand "$WORKFLOW_CMD" 2>/dev/null || true
                wf_state setSupervisor watching 2>/dev/null || true
                # Clear stale state from previous workflow
                wf_state clearTddPhase 2>/dev/null || true
                wf_state clearLastCommand 2>/dev/null || true
                wf_state setWorkflowComplete false 2>/dev/null || true
                wf_state clearProgress 2>/dev/null || true
                # Set nextCommand based on workflow chain position
                case "$WORKFLOW_CMD" in
                    ideate) wf_state setNextCommand "plan" 2>/dev/null || true ;;
                    plan)   wf_state setNextCommand "build" 2>/dev/null || true ;;
                    build)  wf_state setNextCommand "ship" 2>/dev/null || true ;;
                    ship)   wf_state clearNextCommand 2>/dev/null || true ;;
                    *)      ;; # Non-chain commands don't affect nextCommand
                esac
                # R-257 D14: this phase's private run start; a ledger failure never blocks the start
                if [[ -n "$_OSS_PHASE" ]]; then
                    # The warning, like the D17 notice, is for OSS projects only (a folder with no .oss starts silently).
                    _oss_ledger_run "$_OSS_PHASE" || { [[ -n "$_OSS_PROJECT_DIR" && -d "$_OSS_PROJECT_DIR/.oss" ]] \
                        && echo "oss-notify: ledger run row not written for $_OSS_PHASE" >&2; }
                fi
                # Track ALL command invocations via analytics API
                # Note: oss-decrypt also tracks when prompts are fetched from API,
                # but cached prompts bypass the API, so we track here as the source of truth
                (
                    if oss_api_creds; then   # key and URL from one read (T37)
                        # the answer is discarded; oss_capped stops reading it at OSS_BODY_MAX bytes (T74c)
                        oss_capped oss_api_curl "$OSS_KEY" -sS -m 5 --max-filesize "$OSS_BODY_MAX" -X POST "${OSS_URL}/api/v1/analytics/track" \
                            -H "Content-Type: application/json" \
                            -d "{\"command\": \"$WORKFLOW_CMD\", \"promptType\": \"command\", \"promptName\": \"$WORKFLOW_CMD\"}" \
                            >/dev/null 2>&1 || true
                    fi
                ) </dev/null >/dev/null 2>&1 &
                ;;
            merged)
                # When ship merged, reset the entire workflow chain to start fresh
                if [[ "$WORKFLOW_CMD" == "ship" ]]; then
                    wf_state reset 2>/dev/null || true
                else
                    wf_state completeStep "$WORKFLOW_CMD" 2>/dev/null || true
                fi
                # Log IRON LAW compliance checklist on merge
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                ;;
            complete)
                # F7/F8: state updates are bounded (2s each) and silent; only the CHAIN block below reaches the model
                wf_state_timeout 2 completeStep "$WORKFLOW_CMD" >/dev/null 2>&1 || true
                # Clear currentCommand since it's done
                wf_state_timeout 2 clearCurrentCommand >/dev/null 2>&1 || true
                # Clear TDD phase so it doesn't show stale indicator after build ends
                wf_state_timeout 2 clearTddPhase >/dev/null 2>&1 || true
                # Set lastCommand for status line display (shows last_cmd → next_cmd)
                wf_state_timeout 2 setLastCommand "$WORKFLOW_CMD" >/dev/null 2>&1 || true
                # Set nextCommand based on workflow progression
                case "$WORKFLOW_CMD" in
                    ideate) wf_state_timeout 2 setNextCommand "plan" >/dev/null 2>&1 || true ;;
                    plan) wf_state_timeout 2 setNextCommand "build" >/dev/null 2>&1 || true ;;
                    build) wf_state_timeout 2 setNextCommand "ship" >/dev/null 2>&1 || true ;;
                    ship)
                        wf_state_timeout 2 clearNextCommand >/dev/null 2>&1 || true
                        # Set workflowComplete flag for status line to show "→ DONE"
                        wf_state_timeout 2 setWorkflowComplete true >/dev/null 2>&1 || true
                        ;;
                    *) ;; # Non-chain commands don't affect nextCommand
                esac
                # Log IRON LAW compliance checklist on command completion
                "$LOG_SCRIPT" checklist "$WORKFLOW_CMD" 2>/dev/null || true
                # Output chain instructions for Claude to invoke as skills
                # Runs synchronously so stdout (CHAIN: lines) is visible to Claude
                # Stderr goes to log file for debugging
                CHAIN_TRIGGER_LOG="$HOME/.oss/logs/chain-trigger.log"
                mkdir -p "$(dirname "$CHAIN_TRIGGER_LOG")" 2>/dev/null
                if [[ -f "$CHAIN_TRIGGER_CLI" ]]; then
                    run_with_timeout 30 node "$CHAIN_TRIGGER_CLI" --workflow "$WORKFLOW_CMD" 2>> "$CHAIN_TRIGGER_LOG" || true
                fi
                ;;
            failed)
                wf_state setSupervisor intervening 2>/dev/null || true
                ;;
            task_complete)
                # Extract progress from context
                if command -v jq &>/dev/null; then
                    CURRENT=$(echo "$WORKFLOW_CONTEXT" | jq -r '.current // ""' 2>/dev/null) || CURRENT=""
                    TOTAL=$(echo "$WORKFLOW_CONTEXT" | jq -r '.total // ""' 2>/dev/null) || TOTAL=""
                    TASK_NAME=$(echo "$WORKFLOW_CONTEXT" | jq -r '.taskName // ""' 2>/dev/null) || TASK_NAME=""
                    TDD_PHASE=$(echo "$WORKFLOW_CONTEXT" | jq -r '.tddPhase // ""' 2>/dev/null) || TDD_PHASE=""

                    if [[ -n "$TDD_PHASE" && "$TDD_PHASE" != "null" ]]; then
                        wf_state setTddPhase "$TDD_PHASE" 2>/dev/null || true
                    fi

                    if [[ -n "$CURRENT" && "$CURRENT" != "null" ]]; then
                        PROGRESS_JSON=$(jq -cn --arg p "$CURRENT/$TOTAL" --arg t "$TASK_NAME" '{progress: $p, currentTask: $t}')
                        wf_state setProgress "$PROGRESS_JSON" 2>/dev/null || true
                    fi
                fi
                ;;
        esac
    fi

    exit 0
fi

# =============================================================================
# Handle session notifications (update workflow state for status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "session" ]]; then
    SESSION_EVENT="${COPY_ARGS[0]:-}"
    SESSION_CONTEXT="${COPY_ARGS[1]:-}"
    [[ -n "$SESSION_CONTEXT" ]] || SESSION_CONTEXT='{}'

    # Update workflow state for session events (with timeout to prevent hanging)
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        case "$SESSION_EVENT" in
            context_restored|fresh_start)
                wf_state_timeout 2 setSupervisor watching 2>/dev/null
                # Set non-sticky notification (auto-clears after 10 seconds)
                if [[ -n "$MESSAGE" && "$MESSAGE" != "" ]]; then
                    wf_state_timeout 2 setNotification "$MESSAGE" 10 2>/dev/null
                fi
                # Check for plugin/prompt updates (non-blocking, background)
                if [[ -x "$SCRIPT_DIR/check-updates.sh" ]]; then
                    (
                        update_msg=$(run_with_timeout 3 "$SCRIPT_DIR/check-updates.sh" 2>/dev/null)
                        if [[ -n "$update_msg" ]]; then
                            # Wait for session notification to expire before showing update
                            sleep 11
                            wf_state_timeout 2 setNotification "$update_msg" 30 2>/dev/null
                        fi
                    ) </dev/null >/dev/null 2>&1 &
                fi
                ;;
            context_saved)
                wf_state_timeout 2 setSupervisor idle 2>/dev/null
                ;;
        esac
    fi

    # Write to log file for session events
    if [[ -x "$LOG_SCRIPT" && -n "$SESSION_EVENT" ]]; then
        "$LOG_SCRIPT" write "session" "[$SESSION_EVENT] $SESSION_CONTEXT" 2>/dev/null || true
    fi

    # Session start notifications only update status line (workflow state above)
    # The "Ready" notification for user input is handled by oss-notification.sh
    # The "Done" notification for task completion is handled by oss-stop.sh

    exit 0
fi

# =============================================================================
# Handle issue notifications (update workflow state for status line)
# =============================================================================

if [[ "$USE_COPY_SERVICE" == true && "$COPY_TYPE" == "issue" ]]; then
    ISSUE_TYPE="${COPY_ARGS[0]:-}"
    ISSUE_CONTEXT="${COPY_ARGS[1]:-}"
    [[ -n "$ISSUE_CONTEXT" ]] || ISSUE_CONTEXT='{}'

    # Update workflow state to show issue in status line
    if [[ -f "$WORKFLOW_STATE_CLI" ]]; then
        wf_state setSupervisor intervening 2>/dev/null || true
        # Extract message from context if available
        if command -v jq &>/dev/null; then
            ISSUE_MSG=$(echo "$ISSUE_CONTEXT" | jq -r '.message // ""' 2>/dev/null) || ISSUE_MSG=""
            if [[ -n "$ISSUE_MSG" && "$ISSUE_MSG" != "null" ]]; then
                wf_state setIssue "$ISSUE_TYPE" "$ISSUE_MSG" 2>/dev/null || true
            fi
        fi
    fi

    # Write to log file for issue events
    if [[ -x "$LOG_SCRIPT" && -n "$ISSUE_TYPE" ]]; then
        "$LOG_SCRIPT" write "issue" "[$ISSUE_TYPE] $ISSUE_CONTEXT" 2>/dev/null || true
    fi

    # Issue notifications ONLY update the status line - no terminal-notifier
    exit 0
fi

# =============================================================================
# Direct notifications (legacy - only used for explicit title/message calls)
# These are for backward compatibility with direct script invocation
# =============================================================================

case "$STYLE" in
    "audio")
        if command -v say &>/dev/null; then
            say -v "$VOICE" "$MESSAGE" &>/dev/null || true
        fi
        ;;
    "sound")
        SOUND_FILE="/System/Library/Sounds/${SOUND}.aiff"
        if [[ -f "$SOUND_FILE" ]] && command -v afplay &>/dev/null; then
            afplay "$SOUND_FILE" &>/dev/null || true
        fi
        ;;
    # "visual" and other styles - no-op, status line handles this
esac

exit 0
