#!/usr/bin/env bash
# oss-value.sh - the one plugin script that owns the per-repo value folder (G21 cut 1, ADR-001).
#
#   oss-value.sh dir                print the physical ~/.oss/run/<key> for the cwd's repo (outside any
#                                   repo ~/.oss/run/home), cleared of the value files; nothing printed
#                                   and rc != 0 when unsafe.
#   oss-value.sh failed <workflow>  send reason.txt from that folder, cleaned, as the workflow's
#                                   failed notice to the project the cwd is in; then delete it.
#   oss-value.sh error <cmd:name>   emit message.txt, hint.txt and error.txt (5 fields) through
#                                   oss-error.js as an OSSError from <cmd:name>; then delete them.
#   oss-value.sh read <name>        print <name>.txt (key style prompt model workflow category name
#                                   notify_style voice sound verbosity custom) when it matches that
#                                   name's rule in _ov_cmd_read; deleted once read.
#   oss-value.sh agent <workflow> start|complete
#                                   log agent.txt (the specialist's name) through oss-log.sh agent
#                                   with a fixed task text, for the status line; deleted once read.
#   oss-value.sh root               print the plugin root named by ~/.oss/plugin-root, checked (any cwd).
#
# `dir` is the served value-folder command, step for step, except the key (toplevel + git dir, ship
# round 1 R1-3); `failed` is the served failure-notice reader and `error` the served oss-error
# emitter (same code and severity lists). Phase B moves the served copies onto this script.
set -u

case "${HOME:-}" in /*) ;; *) echo "oss-value: HOME is not an absolute path; refusing" >&2; exit 1 ;; esac

_OV_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$_OV_HERE/oss-safe-path.sh" ]]; then
    echo "oss-value: oss-safe-path.sh missing beside $_OV_HERE/oss-value.sh; refusing" >&2
    exit 1
fi
source "$_OV_HERE/oss-safe-path.sh"

_ov_usage() { echo "usage: oss-value.sh dir | failed <workflow> | error cmd:<name> | read <name> | agent <workflow> start|complete | root" >&2; exit 2; }

_OV_RUN="$HOME/.oss/run"

# The cwd's repo, never one named by the environment; cd to its toplevel. Outside any repo
# _OV_TOP is empty: the one per-user folder (ship round 4, R4-1).
_ov_repo() {
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
    _OV_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || { _OV_TOP=""; return 0; }
    cd "$_OV_TOP" >/dev/null
}
# Toplevel + git dir, so a .git file naming another repo's git dir gets its own key; an empty
# lookup is refused, never hashed. (The served prompts still hash the git dir alone: Phase B.)
# Outside any repo the key is "home" (never 16 hex, so it cannot meet a repo's folder).
_ov_key() {
    local g k
    test -n "$_OV_TOP" || { echo home; return 0; }
    g=$(git rev-parse --absolute-git-dir) && test -n "$g" \
    && k=$(printf '%s\n%s\n' "$_OV_TOP" "$g" | git hash-object --stdin | cut -c1-16) && test "${#k}" = 16 && printf '%s\n' "$k"
}
_ov_safe() { test ! -L "$1" && test -O "$1"; }   # the served not-link + owner checks

# Lookup only (no create): sets _OV_DIR to the physical ~/.oss/run/<key> when both folders pass
# the checks. Reused by the verbs that read a value file.
_ov_dir() {
    _OV_DIR=""
    _ov_repo && _ov_safe "$_OV_RUN" || return 1
    local k g && k=$(_ov_key) && g="$_OV_RUN/$k" && _ov_safe "$g" \
    && _OV_DIR=$(CDPATH= cd -P -- "$g" >/dev/null && pwd -P)
}

_ov_cmd_dir() {
    _ov_repo \
    && mkdir -p -m 700 "$_OV_RUN" && _ov_safe "$_OV_RUN" && chmod 700 "$_OV_RUN" \
    && { find "$_OV_RUN" -mindepth 2 -maxdepth 2 -type f -name '*.txt' -mtime +7 -delete; find "$_OV_RUN" -mindepth 1 -maxdepth 1 -type d -empty -mtime +1 -delete || true; } 2>/dev/null \
    && local k && k=$(_ov_key) && mkdir -p -m 700 "$_OV_RUN/$k" && _ov_dir && chmod 700 "$_OV_DIR" && touch "$_OV_DIR" \
    && local p="$_OV_DIR" \
    && rm -f "$p/feature.txt" "$p/numbers.txt" "$p/date.txt" "$p/reason.txt" "$p/message.txt" "$p/hint.txt" "$p/error.txt" \
             "$p/agent.txt" "$p/key.txt" "$p/style.txt" "$p/prompt.txt" "$p/model.txt" "$p/workflow.txt" "$p/category.txt" "$p/name.txt" \
             "$p/notify_style.txt" "$p/voice.txt" "$p/sound.txt" "$p/verbosity.txt" "$p/custom.txt" \
    && printf '%s\n' "$p"
}

# The served #374 walk: the nearest real (not linked) .oss from <cwd> up to the repo top, or $HOME.
_ov_walk() {
    local d="$1"; _OV_PROJ=$HOME   # none found: the global ~/.oss, never ~/.oss/current-project
    while test -n "$_OV_TOP" && case "$d" in "$_OV_TOP"|"$_OV_TOP"/*) true ;; *) false ;; esac; do
        test -d "$d/.oss" && test ! -L "$d/.oss" && _OV_PROJ=$d && break; d=${d%/*}
    done
}

# "<inode> <link count>": of the opened file for /dev/fd/N, else of the path itself (not followed).
_ov_st() { case "$1" in /dev/fd/*) stat -L -c '%i %h' "$1" 2>/dev/null || stat -L -f '%i %l' "$1" ;; *) stat -c '%i %h' "$1" 2>/dev/null || stat -f '%i %l' "$1" ;; esac; }
# Opens <file> in _OV_DIR on fd 3, then checks the opened file IS that path: not a link, a regular
# file, link count 1 (the served checks), same inode - so a swap between check and read is refused.
_ov_open() {
    local f="$_OV_DIR/$1" s
    test ! -L "$f" && test -f "$f" && { exec 3< "$f"; } 2>/dev/null \
    && test ! -L "$f" && test -f "$f" && s=$(_ov_st /dev/fd/3) && test "$s" = "$(_ov_st "$f")" && test "${s#* }" = 1
}
# Checked <file>, kept to the served charset, at most 200 characters -> _OV_VAL.
_ov_read_value() {
    _ov_open "$1" && _OV_VAL=$(LC_ALL=C tr -cd 'A-Za-z0-9 ._,:()/-' <&3 | cut -c1-200); local r=$?; exec 3<&-; return $r
}

# <file> <regex>: the checked file, read whole, deleted at once (valid or not: a key never
# lingers), then held to <regex> -> _OV_VAL. A refused open leaves the path alone.
_ov_take() {
    _OV_VAL=""; _ov_open "$1" || { exec 3<&- 2>/dev/null; return 1; }
    local v; v=$(cat <&3); exec 3<&-; rm -f "$_OV_DIR/$1"
    [[ "$v" =~ $2 ]] && _OV_VAL=$v
}

_ov_cmd_read() {
    local re
    case "${1:-}" in
        key) re='^[A-Za-z0-9_-]{8,200}$' ;;
        style) re='^(visual|audio|sound|none)$' ;;
        prompt|model) re='^[a-z0-9_./:-]{1,100}$' ;;
        workflow) re='^[a-z0-9_.:-]{1,100}$' ;;
        category|name) re='^[a-z0-9_-]{1,100}$' ;;
        notify_style) re='^(visual|audio|sound|telegram|none)$' ;;   # /oss:settings' own lists
        voice) re='^(Samantha|Daniel|Karen|Moira)$' ;;
        sound) re='^(Glass|Ping|Purr|Pop)$' ;;
        verbosity) re='^(all|important|errors-only)$' ;;
        custom) re='^[a-z0-9-]{1,100}$' ;;   # oss-custom Step 0 = isSafeTeamCommandName
        *) false ;;
    esac && _ov_dir && _ov_take "$1.txt" "$re" && printf '%s\n' "$_OV_VAL" \
    || { echo "oss-value: read: refused (unknown name, or the value file missing, unsafe or not a valid ${1:-value})" >&2; return 1; }
}

_ov_cmd_agent() {
    local o t
    o=$(pwd -P)
    oss_valid_workflow_name "${1:-}" \
    && case "${2:-}" in start) t="starting: delegated task" ;; complete) t="completed: delegated task" ;; *) false ;; esac \
    && _ov_dir && _ov_take agent.txt '^[a-z][a-z0-9:-]{0,60}$' \
    || { echo "oss-value: agent: refused (bad workflow or start|complete, or agent.txt missing, unsafe or not an agent name)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-log.sh" agent "$1" "$_OV_VAL" "$t"
}

_ov_cmd_failed() {
    local o r
    o=$(pwd -P)
    oss_valid_workflow_name "${1:-}" && _ov_dir && _ov_read_value reason.txt && r="$_OV_VAL" \
    || { echo "oss-value: failed: refused (bad workflow name, or reason.txt missing or unsafe)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-notify.sh" --workflow "$1" failed "$(printf '{"reason": "%s", "blocker": "%s"}' "$r" "$r")" \
    && rm -f "$_OV_DIR/reason.txt"
}

# The plugin root named by ~/.oss/plugin-root (not a link, owned, absolute, one line, a folder)
# -> _OV_ROOT. The one place the plugin root is checked: error and root use it.
_ov_root() {
    _OV_ROOT=""; local r
    _ov_safe "$HOME/.oss/plugin-root" && r=$(cat "$HOME/.oss/plugin-root" 2>/dev/null) && case "$r" in /*) ;; *) false ;; esac \
    && test "$(printf '%s' "$r" | wc -l)" -eq 0 && test -d "$r" && _OV_ROOT=$r
}

_ov_cmd_root() {
    _ov_root && printf '%s\n' "$_OV_ROOT" \
    || { echo "oss-value: root: refused (~/.oss/plugin-root missing, a link, not absolute, not one line or not a folder)" >&2; return 1; }
}

_ov_cmd_error() {
    local o R m h e c s y k a x
    o=$(pwd -P)
    case "${1:-}" in cmd:*) ;; *) false ;; esac && oss_valid_workflow_name "${1#cmd:}" \
    && _ov_root && R=$_OV_ROOT && test -f "$R/watcher/dist/cli/oss-error.js" \
    && _ov_dir && _ov_read_value message.txt && m="$_OV_VAL" && _ov_read_value hint.txt && h="$_OV_VAL" \
    && _ov_open error.txt && e=$(LC_ALL=C tr -c 'A-Za-z0-9-' ' ' <&3 | cut -c1-120) && exec 3<&- \
    && read -r c s y k a x <<< "$e" && test -z "$x" \
    && case "$c" in OSS-API-001|OSS-API-002|OSS-API-003|OSS-AUTH-001|OSS-AUTH-002|OSS-AUTH-003|OSS-CONFIG-001|OSS-CONFIG-002|OSS-GIT-001|OSS-GIT-002|OSS-GIT-003|OSS-TDD-001|OSS-TDD-002|OSS-TDD-003|OSS-WORKFLOW-001|OSS-WORKFLOW-002|OSS-WORKFLOW-901|OSS-WORKFLOW-902) ;; *) false ;; esac \
    && case "$s" in CRITICAL|HIGH|MEDIUM|LOW) ;; *) false ;; esac && case "$y" in true|false) ;; *) false ;; esac \
    && case "$k" in cheap|expensive) ;; *) false ;; esac && case "$a" in ''|*[!0-9]*) false ;; esac \
    || { echo "oss-value: error: refused (bad source, plugin root, value file or error.txt field)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" node "$R/watcher/dist/cli/oss-error.js" --code "$c" --severity "$s" --message "$m" --source "$1" \
        --retry-eligible "$y" --retry-cost "$k" --retry-hint "$h" --attempt "$a" \
    && rm -f "$_OV_DIR/message.txt" "$_OV_DIR/hint.txt" "$_OV_DIR/error.txt"
}

case "${1:-}" in
    dir) _ov_cmd_dir ;;
    error) _ov_cmd_error "${2:-}" ;;
    failed) _ov_cmd_failed "${2:-}" ;;
    read) _ov_cmd_read "${2:-}" ;;
    agent) _ov_cmd_agent "${2:-}" "${3:-}" ;;
    root) _ov_cmd_root ;;
    *) _ov_usage ;;
esac
