#!/bin/bash
# oss-safe-path.sh - the ONE bash guard for writes into a project (ADR-1, oss-writer-nofollow).
# Sourced, never run. Twin of watcher/src/utils/safe-project-write.ts; keep the rules identical.
#
#   oss_safe_mkdir  <project> <rel-dir>   create <project>/<rel-dir> one component at a time
#   oss_safe_target <project> <rel-file>  parent chain as above; target absent, or a regular
#                                         file with link count 1 that is not a symlink
#   oss_refuse_unsafe <rel>               the one stderr line a refused write prints
#   oss_valid_workflow_name <name>        ^[a-z][a-z0-9-]{0,40}$ (twin: watcher/src/utils/workflow-name.ts)
#
# oss_safe_mkdir sets _OSS_SAFE_DIR to the directory it checked; oss_safe_target builds the
# target from it, so the path approved is the path the caller writes (G2).
# Return 0 = safe to write. Rules for every component below <project> (which is resolved
# physically, so a symlink ABOVE the project such as /tmp -> /private/tmp is fine):
#   not a symlink, a directory, owned by the current user, no "." or ".." components,
#   and the physical result still lies inside the physical project.
# <project> == $HOME means the target is the user's own ~/.oss: out of scope, plain mkdir -p.
# Bash cannot open O_NOFOLLOW, so `>>` after oss_safe_target is TOCTOU-limited; every directory
# in the chain is user-owned, so only the user (not a cloned repo) can race it.

_oss_phys_dir() { (cd -P -- "$1" 2>/dev/null && pwd -P); }

oss_safe_mkdir() {
    local proj="${1:-}" rel="${2:-}" real home cur comp phys
    _OSS_SAFE_DIR=""
    [[ -n "$proj" && -n "$rel" && "$rel" != /* ]] || return 1
    [[ "$rel" != *[[:cntrl:]]* ]] || return 1   # a newline would end `read` early: check != write
    real=$(_oss_phys_dir "$proj") || return 1
    [[ -n "$real" ]] || return 1
    home=$(_oss_phys_dir "${HOME:-/nonexistent}") || home=""
    if [[ -n "$home" && "$real" == "$home" ]]; then
        mkdir -p -- "$real/$rel" 2>/dev/null || return 1
        _OSS_SAFE_DIR="$real/$rel"
        return 0
    fi
    local -a parts=()
    IFS=/ read -r -a parts <<< "$rel"
    cur="$real"
    for comp in ${parts[@]+"${parts[@]}"}; do
        [[ -z "$comp" || "$comp" == "." ]] && continue
        [[ "$comp" == ".." ]] && return 1
        cur="$cur/$comp"
        [[ -e "$cur" || -L "$cur" ]] || mkdir -- "$cur" 2>/dev/null || true
        [[ ! -L "$cur" && -d "$cur" && -O "$cur" ]] || return 1
    done
    phys=$(_oss_phys_dir "$cur") || return 1
    [[ "$phys" == "$real" || "$phys" == "$real"/* ]] || return 1
    _OSS_SAFE_DIR="$cur"   # the directory the checks above actually walked
}

oss_safe_target() {
    local proj="${1:-}" rel="${2:-}" dir base t
    [[ -n "$rel" && "$rel" != */ && "$rel" != *[[:cntrl:]]* ]] || return 1
    base="${rel##*/}"
    if [[ "$base" == "$rel" ]]; then dir="."; else dir="${rel%/*}"; fi
    [[ -n "$base" && "$base" != "." && "$base" != ".." ]] || return 1
    oss_safe_mkdir "$proj" "$dir" || return 1
    t="$_OSS_SAFE_DIR/$base"
    [[ -L "$t" ]] && return 1
    [[ -e "$t" ]] || return 0
    [[ -f "$t" && -n "$(find "$t" -prune -type f -links 1 2>/dev/null)" ]]
}

oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-}" >&2; }

oss_valid_workflow_name() {
    local re='^[a-z][a-z0-9-]{0,40}$'
    [[ "${1:-}" =~ $re ]]
}
