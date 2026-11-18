#!/bin/bash
# oss-stop-dispatch.sh - the one Stop hook entry (R-257 T11, ADR-1). Wired as the Stop entry in hooks.json by T18.
#
# Reads Claude Code's Stop input ({"session_id","stop_hook_active","cwd"}) on stdin.
# - The subjects (ship round 1, findings 1-3; round 3, findings 1-2): for EVERY phase, this session's latest ledger
#   run/<phase> row (other sessions' newer rows skipped). A row naming feature F is checked for F whatever the branch
#   resolves to; F's folder gone and no bound result: allowed, marked unverified and said once. A row with feature ""
#   (D30) counts for the feature resolved now; with none resolved, allowed with the unfiled marker, said once. Other
#   sessions' runs never block. The repos of the cwd and of CLAUDE_PROJECT_DIR are both looked at, so cd-ing into a
#   nested repo does not hide the project's run.
# - Bash fast path: first, with no process at all, the ONE .oss walk (oss_project_walk) must find the user's own .oss
#   at or above the cwd (or CLAUDE_PROJECT_DIR) inside the user's own repo; otherwise the notification, exit 0
#   (finding 5). Then one bounded git call
#   per repo gives the toplevel, git dir, HEAD ref and ledger key. A subject whose result is bound to its run, has no
#   ledger pending/unverified marker and no repo unverified marker, and whose results file hashes to the bound row's
#   sha256, allows with no node (finding 4).
# - Else the dispatcher (watcher/dist/cli/stop-dispatch.cjs) runs under oss_run_bounded_rc with a 5 s bound. It
#   re-derives everything itself from --cwd and --project-dir. Its JSON is printed as is; a block skips the
#   notification.
# - When the bound fires or the dispatcher dies with no output, the SHELL writes the ledger unverified/<feature>/<phase>
#   marker and the repo marker results/<phase>.unverified.json, and prints a systemMessage: never a silent pass.
# - The notification (oss-stop.sh) runs in the background, so a slow notifier never holds the stop (finding 7).
# - Round 3 (security L2, pen N3): every external tool comes from a fixed path, and after the pre-check PATH is
#   /usr/bin:/bin for everything (the sourced bounded runner included); node runs under `env PATH=/usr/bin:/bin`. Only
#   the notification and the recorded-node lookup (D21 compares it with PATH's node) get the caller's PATH back.
# Always exits 0 (a Stop hook's block is the JSON, not the exit code).

# The hook's own folder from BASH_SOURCE with builtins only: a fake dirname could point it at a planted copy.
_OSD_DIR="${BASH_SOURCE[0]%/*}"; [[ "$_OSD_DIR" == "${BASH_SOURCE[0]}" ]] && _OSD_DIR=.
_OSD_DIR="$(cd "$_OSD_DIR" && pwd)"

_osd_notify() { ( PATH="${_OSD_PATH:-$PATH}" "$_OSD_DIR/oss-stop.sh" </dev/null >/dev/null 2>&1 & ); exit 0; }

# shellcheck source=oss-safe-path.sh
source "$_OSD_DIR/oss-safe-path.sh"   # functions only: sourcing it starts no process

# _osd_oss_proj <dir>: true when the ONE .oss walk (oss_project_walk, oss-safe-path.sh; builtins only, no process)
# finds the user's own .oss in the user's own repo at or above <dir>.
_osd_oss_proj() { oss_project_walk "$1"; [[ -n "$_OSS_PROJ" ]]; }

IFS= read -r -d '' -n 65536 INPUT
# --- Pre-check, before any other helper, jq or git (finding 5) ---------------------------------------------------------
_osd_cwd_re='"cwd"[[:space:]]*:[[:space:]]*"([^"\\]*)"'
_osd_maybe=false
if [[ "$INPUT" =~ $_osd_cwd_re ]]; then _osd_oss_proj "${BASH_REMATCH[1]}" && _osd_maybe=true
elif [[ "$INPUT" == *'"cwd"'* ]]; then _osd_maybe=true   # an escaped cwd: let jq read it
else _osd_oss_proj "$PWD" && _osd_maybe=true; fi
[[ -n "${CLAUDE_PROJECT_DIR:-}" ]] && _osd_oss_proj "$CLAUDE_PROJECT_DIR" && _osd_maybe=true
[[ "$_osd_maybe" == true ]] || _osd_notify
_OSD_PATH="$PATH"; PATH=/usr/bin:/bin

# shellcheck source=oss-phase-result.sh
source "$_OSD_DIR/oss-phase-result.sh"
_OSD_SUB="watcher/dist/cli/stop-dispatch.cjs"
# Test-only seam for the shell bound; customers always get 5 s.
_OSD_BOUND="${OSS_STOP_DISPATCH_TEST_BOUND:-5}"
[[ "$_OSD_BOUND" =~ ^[0-9]+$ ]] || _OSD_BOUND=5

# The dispatcher CLI, found by oss_plugin_cli (oss-phase-result.sh).
_osd_cli() {
    _OSD_CLI=""
    oss_plugin_cli "$_OSD_SUB" || return 1
    _OSD_CLI="$_OSS_PLUGIN_CLI"
}

# The shell's own fail-open: both unverified markers (best effort, no links followed) and the systemMessage.
_osd_fail_open() { # <errorClass>
    local cls="$1" at d f msg
    at=$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
    if [[ -n "$FEATURE" ]]; then
        d="$LEDGER"
        for seg in unverified "$FEATURE"; do
            d="$d/$seg"
            [[ -L "$d" ]] && { d=""; break; }
            [[ -d "$d" ]] || /bin/mkdir -m 700 "$d" 2>/dev/null || { d=""; break; }
        done
        if [[ -n "$d" && ! -L "$d/$PHASE" ]]; then
            (umask 077; printf '{"check":"stop-dispatch","errorClass":"%s","at":"%s","session":"%s"}\n' \
                "$cls" "$at" "$SESSION" > "$d/$PHASE") 2>/dev/null
        fi
        # Never for a feature whose folder left .oss/dev/active: writing the marker would create the folder again.
        if [[ -d "$TOP/.oss/dev/active/$FEATURE" ]] \
            && oss_safe_target "$TOP" ".oss/dev/active/$FEATURE/results/$PHASE.unverified.json" 2>/dev/null; then
            f="$_OSS_SAFE_DIR/$PHASE.unverified.json"
            (umask 077; printf '{"verification":"unverified","verificationError":{"check":"stop-dispatch","errorClass":"%s"},"phase":"%s","at":"%s"}\n' \
                "$cls" "$PHASE" "$at" > "$f") 2>/dev/null
        fi
    fi
    if [[ -n "$FEATURE" ]]; then
        msg="OSS: the stop-dispatch stop check could not finish for the $PHASE phase ($cls). $PHASE is marked unverified and will not pass until you run oss-phase-result.sh assemble $PHASE."
    else
        msg="OSS: the stop-dispatch stop check could not finish for the $PHASE phase ($cls), which has no feature folder yet, so nothing was marked. Once its feature folder exists, run oss-phase-result.sh assemble $PHASE."
    fi
    "$OSS_JQ_BIN" -cn --arg m "$msg" '{systemMessage: $m}'
}

# One jq for the three Stop fields: session (validated in jq, so it is one line), active, then the cwd (the rest).
_osd_j=$(printf '%s' "$INPUT" | "$OSS_JQ_BIN" -r '(.session_id // "" | tostring
    | if test("^[A-Za-z0-9._-]{0,128}$") then . else "" end),
    (if .stop_hook_active == true then "true" else "false" end), (.cwd // "" | tostring)' 2>/dev/null)
SESSION=${_osd_j%%$'\n'*}; _osd_j=${_osd_j#*$'\n'}; ACTIVE=${_osd_j%%$'\n'*}; CWD=${_osd_j#*$'\n'}
[[ "$SESSION" =~ ^[A-Za-z0-9._-]{0,128}$ ]] || SESSION=""
[[ "$ACTIVE" == true ]] || ACTIVE=false
[[ "$CWD" == /* && -d "$CWD" ]] || CWD="$PWD"

# _osd_repo <dir> -> R_TOP R_GD R_HEAD R_KEY from ONE bounded git rev-parse (plus hash-object for the key; an unborn
# HEAD falls back to symbolic-ref). Paths, never values, go in as arguments; GIT_* are dropped.
_OSD_GIT_SH='unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
cd -P -- "$1" 2>/dev/null || exit 1
r=$("$2" rev-parse --show-toplevel --absolute-git-dir --symbolic-full-name HEAD 2>/dev/null) || {
    r=$("$2" rev-parse --show-toplevel --absolute-git-dir 2>/dev/null) || exit 1
    r="$r
$("$2" symbolic-ref -q HEAD 2>/dev/null)"
}
top=${r%%
*}; gd=${r#*
}; gd=${gd%%
*}
printf "%s\n" "$r"
printf "%s\n%s\n" "$top" "$gd" | "$2" hash-object --stdin'
_osd_repo() {
    local o
    R_TOP=""; R_GD=""; R_HEAD=""; R_KEY=""
    [[ "$OSS_GIT_BIN" == /* ]] || return 1   # no fixed git (D33): never PATH's
    oss_run_bounded_rc 2 /bin/bash -c "$_OSD_GIT_SH" _ "$1" "$OSS_GIT_BIN" || return 1
    o="$OSS_BOUNDED_OUT"
    R_TOP=${o%%$'\n'*}; o=${o#*$'\n'}; R_GD=${o%%$'\n'*}; o=${o#*$'\n'}; R_HEAD=${o%%$'\n'*}; R_KEY=${o#*$'\n'}
    R_KEY=${R_KEY:0:16}
    [[ "$R_TOP" == /* && "$R_GD" == /* && "$R_KEY" =~ ^[0-9a-f]{16}$ ]]
}

# _osd_feature <top> <head-ref> -> _OSD_F: mirrors oss_resolve_feature (oss-safe-path.sh) on a HEAD ref already read.
_osd_feature() {
    local proj="$1" branch="" feature="" active fg=""
    local name_re='^[A-Za-z0-9_-][A-Za-z0-9._-]*$' branch_re='^[^/]+/([^/]+)/[^/]'
    [[ "$2" == refs/heads/* ]] && branch=${2#refs/heads/}
    [[ "$branch" =~ $branch_re ]] && feature=${BASH_REMATCH[1]}
    [[ "$feature" =~ $name_re && -d "$proj/.oss/dev/active/$feature" ]] || feature=""
    if [[ -z "$feature" && ! "$branch" =~ $branch_re ]]; then
        shopt -q failglob && fg=1; shopt -u failglob
        active=("$proj"/.oss/dev/active/*/)
        [[ -z "$fg" ]] || shopt -s failglob
        [[ ${#active[@]} -eq 1 && -d "${active[0]}" ]] && { feature=${active[0]%/}; feature=${feature##*/}; }
        [[ "$feature" =~ $name_re ]] || feature=""
    fi
    _OSD_F="$feature"
}

_osd_field() { # <name> <json row> -> _OSD_V (a string field of a compact jq row); 1 when absent
    local re="\"$1\":\"([^\"]*)\""
    _OSD_V=""
    [[ "$2" =~ $re ]] || return 1
    _OSD_V="${BASH_REMATCH[1]}"
}

_osd_sha256() { # <file> -> stdout: hex sha256, from a fixed path only
    local b
    for b in /sbin/sha256sum /usr/bin/sha256sum; do [[ -x "$b" ]] && { "$b" "$1" | /usr/bin/cut -c1-64; return; }; done
    /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -c1-64
}

# _osd_bound_row <ledger> <feature> <phase> <startedAt> -> _OSD_ROW: the last results row is bound to this run.
_osd_bound_row() {
    local rf="$1/results/$2/$3"
    _OSD_ROW=""
    [[ -f "$rf" && ! -L "$rf" ]] || return 1
    _OSD_ROW=$(/usr/bin/tail -n 1 "$rf" 2>/dev/null)
    _osd_field startedAt "$_OSD_ROW"; [[ -n "$_OSD_V" && "$_OSD_V" == "$4" ]]
}

# _osd_said <marker> <startedAt>: the dispatcher's once-per-run marker already holds this session's run (round 3).
_osd_said() {
    local line=""
    [[ -f "$1" && ! -L "$1" ]] || return 1
    IFS= read -r line < "$1" || [[ -n "$line" ]] || return 1
    _osd_field session "$line"; [[ "$_OSD_V" == "$SESSION" ]] || return 1
    _osd_field startedAt "$line"; [[ -n "$_OSD_V" && "$_OSD_V" == "$2" ]]
}

# _osd_bound_ok <top> <ledger> <feature> <phase> <startedAt>: the result is bound to this run, nothing marks it, and
# its bytes hash to the bound row's sha256 (when the row has one). Any doubt: 1, and the dispatcher decides.
_osd_bound_ok() {
    local top="$1" ledger="$2" f="$3" p="$4" row d seg
    _osd_bound_row "$ledger" "$f" "$p" "$5" || return 1
    row="$_OSD_ROW"
    [[ -e "$ledger/pending/$f/$p" || -L "$ledger/pending/$f/$p" ]] && return 1
    [[ -e "$ledger/unverified/$f/$p" || -L "$ledger/unverified/$f/$p" ]] && return 1
    d="$top"
    for seg in .oss dev active "$f" results; do d="$d/$seg"; [[ -d "$d" && ! -L "$d" ]] || return 1; done
    [[ -e "$d/$p.unverified.json" || -L "$d/$p.unverified.json" ]] && return 1
    _osd_field sha256 "$row"
    [[ -z "$_OSD_V" ]] && return 0
    [[ -f "$d/$p.json" && ! -L "$d/$p.json" ]] || return 1
    [[ "$(_osd_sha256 "$d/$p.json" 2>/dev/null)" == "$_OSD_V" ]]
}

# _osd_needs_node: true when the repo in R_* has a run the fast path cannot clear; sets TOP FEATURE PHASE LEDGER
# (FEATURE "" for a D30 run with no feature resolved: the shell's own fail-open then writes no feature marker).
# Round 3: EVERY phase counts (finding 1), each by this session's latest row (scanned past other sessions' newer
# rows), and a row naming feature F is checked for F whatever the branch resolves to (finding 2); "" rows use the
# feature resolved now (D30). F's folder gone: cleared when bound or already said for this run (the dispatcher's
# marker); else the dispatcher marks it and says so once.
_osd_needs_node() {
    local ledger p row s f name_re='^[A-Za-z0-9_-][A-Za-z0-9._-]*$'
    [[ -d "$R_TOP/.oss" && ! -L "$R_TOP/.oss" && -f "$R_TOP/.oss/workflow-state.json" && ! -L "$R_TOP/.oss/workflow-state.json" ]] || return 1
    ledger="$HOME/.oss/ledger/$R_KEY"
    [[ -d "$ledger/run" ]] || return 1
    _osd_feature "$R_TOP" "$R_HEAD"
    for p in ideate plan build ship; do
        [[ -f "$ledger/run/$p" ]] || continue
        row=$(/usr/bin/grep -F "\"session\":\"$SESSION\"" "$ledger/run/$p" 2>/dev/null | /usr/bin/tail -n 1)
        _osd_field startedAt "$row"; s="$_OSD_V"; [[ -n "$s" ]] || continue
        _osd_field session "$row"; [[ "$_OSD_V" == "$SESSION" ]] || continue
        _osd_field feature "$row" || continue
        f="${_OSD_V:-$_OSD_F}"
        if [[ -z "$f" ]]; then
            _osd_said "$ledger/unfiled/$p" "$s" && continue
        elif [[ ! "$f" =~ $name_re ]]; then
            :   # a name the ledger refuses: the dispatcher blocks on it
        elif [[ -d "$R_TOP/.oss/dev/active/$f" ]]; then
            _osd_bound_ok "$R_TOP" "$ledger" "$f" "$p" "$s" && continue
        else
            _osd_bound_row "$ledger" "$f" "$p" "$s" && continue
            _osd_said "$ledger/unverified/$f/$p" "$s" && continue
        fi
        TOP="$R_TOP"; FEATURE="$f"; PHASE="$p"; LEDGER="$ledger"
        return 0
    done
    return 1
}

# --- Bash fast path ---------------------------------------------------------------------------------------------
TOP=""; FEATURE=""; PHASE=""; LEDGER=""; TOPS=(); NEED=false
_osd_dirs=("$CWD")
# Performance L2: the project dir is looked at only when it is another folder than the cwd (builtin cd -P, no fork).
if [[ "${CLAUDE_PROJECT_DIR:-}" == /* && -d "$CLAUDE_PROJECT_DIR" ]]; then
    _osd_here="$PWD"; _osd_a=""; _osd_b=""
    cd -P -- "$CWD" 2>/dev/null && _osd_a="$PWD"
    cd -P -- "$CLAUDE_PROJECT_DIR" 2>/dev/null && _osd_b="$PWD"
    cd -- "$_osd_here" 2>/dev/null
    [[ -n "$_osd_b" && "$_osd_a" == "$_osd_b" ]] || _osd_dirs+=("$CLAUDE_PROJECT_DIR")
fi
for _osd_d in "${_osd_dirs[@]}"; do
    _osd_oss_proj "$_osd_d" || continue
    _osd_repo "$_osd_d" || continue
    [[ ${#TOPS[@]} -gt 0 && "${TOPS[0]}" == "$R_TOP" ]] && continue
    TOPS+=("$R_TOP")
    if [[ "$NEED" == false ]] && _osd_needs_node; then NEED=true; fi
done
[[ "$NEED" == true ]] || _osd_notify

# --- The dispatcher, bounded ------------------------------------------------------------------------------------
if ! _osd_cli; then _osd_fail_open cli_missing; _osd_notify; fi
# node from ~/.oss/node-path, never PATH's (T26, security C1): a fake node could print an allow.
if ! PATH="$_OSD_PATH" oss_plugin_node "$_OSD_CLI" "$_OSD_SUB" 2>/dev/null; then _osd_fail_open node_missing; _osd_notify; fi
_osd_args=(--cwd "${TOPS[0]}" --session "$SESSION" --stop-hook-active "$ACTIVE")
[[ ${#TOPS[@]} -gt 1 ]] && _osd_args+=(--project-dir "${TOPS[1]}")
oss_run_bounded_rc "$_OSD_BOUND" /usr/bin/env PATH=/usr/bin:/bin "$OSS_NODE" "$_OSD_CLI" "${_osd_args[@]}"
rc=$?
OUT="$OSS_BOUNDED_OUT"
if [[ $rc -ne 0 || -n "$OUT" ]] && ! printf '%s' "$OUT" | "$OSS_JQ_BIN" -e 'type == "object"' >/dev/null 2>&1; then
    if [[ $rc -eq 124 ]]; then _osd_fail_open timeout; else _osd_fail_open "exit_$rc"; fi
    _osd_notify
fi
[[ -n "$OUT" ]] && printf '%s\n' "$OUT"
if printf '%s' "$OUT" | "$OSS_JQ_BIN" -e '.decision == "block"' >/dev/null 2>&1; then exit 0; fi
_osd_notify
