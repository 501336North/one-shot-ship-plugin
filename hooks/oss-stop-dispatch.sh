#!/bin/bash
# oss-stop-dispatch.sh - the one Stop hook entry (R-257 T11, ADR-1). Not wired in hooks.json until T18.
#
# Reads Claude Code's Stop input ({"session_id","stop_hook_active","cwd"}) on stdin.
# - Bash fast path: node runs only when the cwd's git toplevel has .oss, .oss/workflow-state.json is a regular file and
#   the ledger run/ shows a started phase with no result bound to it. Otherwise: the notification (oss-stop.sh), exit 0.
# - Else the dispatcher (watcher/dist/cli/stop-dispatch.cjs) runs under oss_run_bounded_rc with a 5 s bound. Its JSON
#   is printed as is; a block skips the notification.
# - When the bound fires or the dispatcher dies with no output, the SHELL writes the ledger unverified/<feature>/<phase>
#   marker and the repo marker results/<phase>.unverified.json, and prints a systemMessage: never a silent pass.
# Always exits 0 (a Stop hook's block is the JSON, not the exit code).

_OSD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=oss-phase-result.sh
source "$_OSD_DIR/oss-phase-result.sh"
# shellcheck source=oss-safe-path.sh
source "$_OSD_DIR/oss-safe-path.sh"
_OSD_SUB="watcher/dist/cli/stop-dispatch.cjs"
# Test-only seam for the shell bound; customers always get 5 s.
_OSD_BOUND="${OSS_STOP_DISPATCH_TEST_BOUND:-5}"
[[ "$_OSD_BOUND" =~ ^[0-9]+$ ]] || _OSD_BOUND=5

_osd_notify() { "$_OSD_DIR/oss-stop.sh" </dev/null >/dev/null 2>&1; exit 0; }

# The dispatcher CLI, found by oss_plugin_cli (oss-phase-result.sh): CLAUDE_PLUGIN_ROOT, ~/.oss/plugin-root, this
# plugin, the cache.
_osd_cli() {
    _OSD_CLI=""
    oss_plugin_cli "$_OSD_SUB" || return 1
    _OSD_CLI="$_OSS_PLUGIN_CLI"
}

_osd_started_at() { # <run file> -> the last row's startedAt
    tail -n 1 "$1" 2>/dev/null | sed -n 's/.*"startedAt":"\([^"]*\)".*/\1/p'
}

# The shell's own fail-open: both unverified markers (best effort, no links followed) and the systemMessage.
_osd_fail_open() { # <errorClass>
    local cls="$1" at d f msg
    at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    if [[ -n "$FEATURE" ]]; then
        d="$LEDGER"
        for seg in unverified "$FEATURE"; do
            d="$d/$seg"
            [[ -L "$d" ]] && { d=""; break; }
            [[ -d "$d" ]] || mkdir -m 700 "$d" 2>/dev/null || { d=""; break; }
        done
        if [[ -n "$d" && ! -L "$d/$PHASE" ]]; then
            (umask 077; printf '{"check":"stop-dispatch","errorClass":"%s","at":"%s","session":"%s"}\n' \
                "$cls" "$at" "$SESSION" > "$d/$PHASE") 2>/dev/null
        fi
        if oss_safe_target "$TOP" ".oss/dev/active/$FEATURE/results/$PHASE.unverified.json" 2>/dev/null; then
            f="$_OSS_SAFE_DIR/$PHASE.unverified.json"
            (umask 077; printf '{"verification":"unverified","verificationError":{"check":"stop-dispatch","errorClass":"%s"},"phase":"%s","at":"%s"}\n' \
                "$cls" "$PHASE" "$at" > "$f") 2>/dev/null
        fi
    fi
    msg="OSS: the stop-dispatch stop check could not finish for the $PHASE phase ($cls). $PHASE is marked unverified and will not pass until you run oss-phase-result.sh assemble $PHASE."
    jq -cn --arg m "$msg" '{systemMessage: $m}'
}

INPUT=$(head -c 65536)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "" | tostring' 2>/dev/null)
[[ "$SESSION" =~ ^[A-Za-z0-9._-]{0,128}$ ]] || SESSION=""
ACTIVE=$(printf '%s' "$INPUT" | jq -r 'if .stop_hook_active == true then "true" else "false" end' 2>/dev/null)
[[ "$ACTIVE" == true ]] || ACTIVE=false
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // "" | tostring' 2>/dev/null)
[[ "$CWD" == /* && -d "$CWD" ]] || CWD="$PWD"

# --- Bash fast path ---------------------------------------------------------------------------------------------
TOP=$(unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; cd -P "$CWD" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
[[ -n "$TOP" && -d "$TOP/.oss" && ! -L "$TOP/.oss" && -f "$TOP/.oss/workflow-state.json" && ! -L "$TOP/.oss/workflow-state.json" ]] || _osd_notify
GITDIR=$(unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR; cd "$TOP" && git rev-parse --absolute-git-dir 2>/dev/null)
KEY=$(printf '%s\n%s\n' "$TOP" "$GITDIR" | git hash-object --stdin 2>/dev/null | cut -c1-16)
LEDGER="$HOME/.oss/ledger/$KEY"
[[ -n "$KEY" && -d "$LEDGER/run" ]] || _osd_notify
PHASE=""; STARTED=""
for p in ideate plan build ship; do
    s=$(_osd_started_at "$LEDGER/run/$p")
    if [[ -n "$s" ]] && { [[ -z "$STARTED" ]] || [[ "$s" > "$STARTED" ]]; }; then PHASE="$p"; STARTED="$s"; fi
done
[[ -n "$PHASE" ]] || _osd_notify
oss_resolve_feature "$TOP"; FEATURE="$_OSS_FEATURE"
if [[ -n "$FEATURE" ]] && [[ "$(_osd_started_at "$LEDGER/results/$FEATURE/$PHASE")" == "$STARTED" ]]; then _osd_notify; fi

# --- The dispatcher, bounded ------------------------------------------------------------------------------------
if ! _osd_cli; then _osd_fail_open cli_missing; _osd_notify; fi
oss_run_bounded_rc "$_OSD_BOUND" node "$_OSD_CLI" --cwd "$TOP" --session "$SESSION" --stop-hook-active "$ACTIVE"
rc=$?
OUT="$OSS_BOUNDED_OUT"
if [[ $rc -ne 0 || -n "$OUT" ]] && ! printf '%s' "$OUT" | jq -e 'type == "object"' >/dev/null 2>&1; then
    if [[ $rc -eq 124 ]]; then _osd_fail_open timeout; else _osd_fail_open "exit_$rc"; fi
    _osd_notify
fi
[[ -n "$OUT" ]] && printf '%s\n' "$OUT"
if printf '%s' "$OUT" | jq -e '.decision == "block"' >/dev/null 2>&1; then exit 0; fi
_osd_notify
