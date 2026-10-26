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
#   oss-value.sh decrypt [custom]   ~/.oss/bin/oss-decrypt --type <category> --name <name> from category.txt
#                                   + name.txt (or --type custom --name <custom.txt>), checked as read does.
#   oss-value.sh models-set         the plugin's models.js set <type> <prompt> <model> from prompt.txt + model.txt.
#   oss-value.sh cli <script> <args>  one of the fixed plugin CLI calls (webhook-setup setup [--port N],
#                                   webhook-toggle on, update-workflow-state init) from the plugin root.
# (Saving the API key is hooks/oss-login.sh, NOT a verb here: this script is allowlisted, a key
# change must always ask - R5-8. oss-login.sh sources this file for its functions.)
# Each value hand-off is ONE call spelled ~/.oss/hooks/oss-value.sh <verb> (the allowed prefix): a
# $(...) && chain asks for approval even when every part is allowed (ship round 5, R5-1).
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

_ov_usage() { echo "usage: oss-value.sh dir | failed <workflow> | error cmd:<name> | read <name> | agent <workflow> start|complete | root | decrypt [custom] | models-set | cli <script> <args> | keycheck | api auth/verify|workflows|prompts/claude-md|workflow" >&2; exit 2; }

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
    && mkdir -p -m 700 "$HOME/.oss" "$_OV_RUN" && _ov_safe "$_OV_RUN" && chmod 700 "$_OV_RUN" \
    && { find "$_OV_RUN" -mindepth 2 -maxdepth 2 -type f -name '*.txt' -mtime +7 -delete; find "$_OV_RUN" -mindepth 1 -maxdepth 1 -type d -empty -mtime +1 -delete || true; } 2>/dev/null \
    && local k && k=$(_ov_key) && mkdir -p -m 700 "$_OV_RUN/$k" && _ov_dir && chmod 700 "$_OV_DIR" && touch "$_OV_DIR" \
    && local p="$_OV_DIR" \
    && rm -f "$p/feature.txt" "$p/numbers.txt" "$p/date.txt" "$p/reason.txt" "$p/message.txt" "$p/hint.txt" "$p/error.txt" \
             "$p/agent.txt" "$p/key.txt" "$p/style.txt" "$p/prompt.txt" "$p/model.txt" "$p/workflow.txt" "$p/category.txt" "$p/name.txt" \
             "$p/notify_style.txt" "$p/voice.txt" "$p/sound.txt" "$p/verbosity.txt" "$p/custom.txt" \
    && printf '%s\n' "$p"
}

# The shared rule (oss_resolve_project in oss-safe-path.sh) from <cwd>: CLAUDE_PROJECT_DIR, this
# session's pointer, the nearest real .oss up to the first .git entry, or $HOME (the global ~/.oss,
# never ~/.oss/current-project).
_ov_walk() { oss_resolve_project "$1"; _OV_PROJ=${_OSS_PROJ:-$HOME}; }

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
    _OV_VAL=""; _ov_open "$1" || { { exec 3<&-; } 2>/dev/null; return 1; }   # braces: a bare exec 2>/dev/null would silence the caller
    local v; v=$(cat <&3); exec 3<&-; rm -f "$_OV_DIR/$1"
    [[ "$v" =~ $2 ]] && _OV_VAL=$v
}

# <name>: <name>.txt from _OV_DIR held to that name's rule -> _OV_VAL (deleted once read). The one
# list of per-name rules: read and the verbs that act on a value (decrypt, models-set) use it.
_ov_get() {
    local re
    case "${1:-}" in
        key) re='^[A-Za-z0-9_-]{8,200}$' ;;
        style) re='^(visual|audio|sound|none)$' ;;
        prompt) re='^[a-z0-9_./:-]{1,100}$' ;;
        model) re='^[A-Za-z0-9_./:-]{1,100}$' ;;   # isValidModelId's ids (upper case too); no `..` (below)
        workflow) re='^[a-z0-9_.:-]{1,100}$' ;;
        category|name) re='^[a-z0-9_-]{1,100}$' ;;
        notify_style) re='^(visual|audio|sound|none)$' ;;   # /oss:settings' own lists
        voice) re='^(Samantha|Daniel|Karen|Moira)$' ;;
        sound) re='^(Glass|Ping|Purr|Pop)$' ;;
        verbosity) re='^(all|important|errors-only)$' ;;
        custom) re='^[a-z0-9-]{1,100}$' ;;   # oss-custom Step 0 = isSafeTeamCommandName
        *) false ;;
    esac && _ov_take "$1.txt" "$re" && case "$1:$_OV_VAL" in model:*..*) _OV_VAL=""; false ;; esac
}

_ov_cmd_read() {
    _ov_dir && _ov_get "${1:-}" && printf '%s\n' "$_OV_VAL" \
    || { echo "oss-value: read: refused (unknown name, or the value file missing, unsafe or not a valid ${1:-value})" >&2; return 1; }
}

# decrypt [custom]: oss-decrypt with category.txt + name.txt (or custom.txt as a custom name), each
# held to its read rule, in the caller's folder - one allowed call instead of a $(read) && chain.
_ov_cmd_decrypt() {
    local o t n
    oss_phys_cwd; o="$_OSS_CWD"
    _ov_dir && case "$#:${1:-}" in
        0:) _ov_get category && t=$_OV_VAL && _ov_get name && n=$_OV_VAL ;;
        1:custom) t=custom && _ov_get custom && n=$_OV_VAL ;;
        *) false ;;
    esac || { echo "oss-value: decrypt: refused (bad argument, or a value file missing, unsafe or not a valid name)" >&2; return 1; }
    cd "$o" && exec "$HOME/.oss/bin/oss-decrypt" --type "$t" --name "$n"
}

# models-set: models.js set <type> <name> <model> from prompt.txt + model.txt (/oss:x -> commands
# oss:x, oss:x -> agents, else skills: the /oss:models set rule), from the checked plugin root.
_ov_cmd_models_set() {
    local p m t n
    _ov_dir && _ov_get prompt && p=$_OV_VAL && _ov_get model && m=$_OV_VAL && _ov_root \
    || { echo "oss-value: models-set: refused (prompt.txt or model.txt missing, unsafe or not valid, or no plugin root)" >&2; return 1; }
    case "$p" in /oss:*) t=commands; n=${p#/} ;; oss:*) t=agents; n=$p ;; *) t=skills; n=$p ;; esac
    exec node "$_OV_ROOT/watcher/dist/cli/models.js" set "$t" "$n" "$m"
}

# cli <script> <args>: one of the fixed plugin CLI calls the wrappers make, from the checked plugin root.
_ov_cmd_cli() {
    case "$#:${1:-}:${2:-}:${3:-}" in
        2:webhook-setup:setup:|2:webhook-toggle:on:|2:update-workflow-state:init:) ;;
        4:webhook-setup:setup:--port) case "$4" in ''|*[!0-9]*|??????*) false ;; esac ;;
        *) false ;;
    esac && _ov_root && test -f "$_OV_ROOT/watcher/dist/cli/$1.js" \
    || { echo "oss-value: cli: refused (not one of the fixed plugin CLI calls, or no plugin root)" >&2; return 1; }
    exec node "$_OV_ROOT/watcher/dist/cli/$1.js" "${@:2}"
}

_ov_cmd_agent() {
    local o t
    oss_phys_cwd; o="$_OSS_CWD"
    oss_valid_workflow_name "${1:-}" \
    && case "${2:-}" in start) t="starting: delegated task" ;; complete) t="completed: delegated task" ;; *) false ;; esac \
    && _ov_dir && _ov_take agent.txt '^[a-z][a-z0-9:-]{0,60}$' \
    || { echo "oss-value: agent: refused (bad workflow or start|complete, or agent.txt missing, unsafe or not an agent name)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-log.sh" agent "$1" "$_OV_VAL" "$t"
}

_ov_cmd_failed() {
    local o r
    oss_phys_cwd; o="$_OSS_CWD"
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
    oss_phys_cwd; o="$_OSS_CWD"
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

# keycheck: says whether the OSS config holds an API key, never the key itself (follow-up #44).
_ov_cmd_keycheck() {
    source "$_OV_HERE/oss-api-curl.sh" && oss_api_key >/dev/null && echo "API key configured"
}

# api <endpoint>: GET one endpoint of a fixed set at the API the OSS config names (oss_api_url), the key on
# curl's stdin (oss_api_curl); prints the answer. `api workflow` fetches workflows/<name>, the name from
# workflow.txt. One allowlisted command, so a wrapper's API call asks no approval (R5-1).
_ov_cmd_api() {
    local e u k
    case "$#:${1:-}" in
        1:auth/verify|1:workflows|1:prompts/claude-md) e=$1 ;;
        1:workflow) _ov_dir && _ov_get workflow && e="workflows/$_OV_VAL" ;;
        *) false ;;
    esac || { echo "oss-value: api: refused (not auth/verify, workflows, prompts/claude-md or workflow, or workflow.txt missing or not a valid name)" >&2; return 1; }
    source "$_OV_HERE/oss-api-curl.sh" && u=$(oss_api_url) && k=$(oss_api_key) \
    || { echo "oss-value: api: refused (no API key, or apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment)" >&2; return 1; }
    oss_api_curl "$k" -s -m 30 "$u/api/v1/$e"
}

[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0   # sourced (oss-login.sh): the functions only, no verb
case "${1:-}" in
    dir) _ov_cmd_dir ;;
    error) _ov_cmd_error "${2:-}" ;;
    failed) _ov_cmd_failed "${2:-}" ;;
    read) _ov_cmd_read "${2:-}" ;;
    agent) _ov_cmd_agent "${2:-}" "${3:-}" ;;
    root) _ov_cmd_root ;;
    decrypt) shift; _ov_cmd_decrypt "$@" ;;
    models-set) _ov_cmd_models_set ;;
    cli) shift; _ov_cmd_cli "$@" ;;
    keycheck) _ov_cmd_keycheck ;;
    api) shift; _ov_cmd_api "$@" ;;
    *) _ov_usage ;;
esac
