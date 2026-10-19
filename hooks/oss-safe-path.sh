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
#   not a symlink, a directory, owned by the current user (or, under a uid-0 project root, by
#   anyone if neither group- nor other-writable),
#   no "." or ".." or control characters,
#   and the physical result still lies inside the physical project.
# <project> == $HOME means the target is the user's own ~/.oss: out of scope, plain mkdir -p.
# Bash cannot open O_NOFOLLOW, so `>>` after oss_safe_target is racy: a concurrent process that can
# write the (checked) directory, i.e. running as the user or the uid-0 project owner, can swap the
# target for a link between check and write (reproduced in the 2.0.87 pen test). Committed repo
# content cannot: it needs a live local process. See DECISIONS.md and FOLLOWUPS (G17).

_oss_phys_dir() { (cd -P -- "$1" 2>/dev/null && pwd -P); }
# G9: the project and $HOME are resolved once per process (each resolution is a subshell).
_OSS_PC_K1=""; _OSS_PC_V1=""; _OSS_PC_K2=""; _OSS_PC_V2=""
_oss_phys_cached() { # <path> -> _OSS_PHYS (no subshell, so the cache survives)
    if [[ -n "$_OSS_PC_K1" && "$1" == "$_OSS_PC_K1" ]]; then _OSS_PHYS="$_OSS_PC_V1"; return 0; fi
    if [[ -n "$_OSS_PC_K2" && "$1" == "$_OSS_PC_K2" ]]; then _OSS_PHYS="$_OSS_PC_V2"; return 0; fi
    _OSS_PHYS=$(_oss_phys_dir "$1") && [[ -n "$_OSS_PHYS" ]] || return 1
    _OSS_PC_K2="$_OSS_PC_K1"; _OSS_PC_V2="$_OSS_PC_V1"; _OSS_PC_K1="$1"; _OSS_PC_V1="$_OSS_PHYS"
}
_oss_uid_of() { local m l o r; read -r m l o r < <(ls -ldn -- "$1" 2>/dev/null) && echo "$o"; }
# N2-2 (narrowed G3): a component is acceptable when owned by the current user, OR when the
# physical project root is owned by uid 0 (root-in-container / root-owned bind mount) AND the
# component is neither group- nor other-writable.
_oss_owned_ok() { # <path> <project-real>
    [[ -O "$1" ]] && return 0
    [[ "$(_oss_uid_of "$2")" == 0 ]] || return 1
    local m l o r; read -r m l o r < <(ls -ldn -- "$1" 2>/dev/null) || return 1
    [[ "${m:5:1}" != w && "${m:8:1}" != w ]]
}

oss_safe_mkdir() {
    [[ -n "${BASH_VERSION:-}" ]] || return 1   # G4: other shells (zsh read -a) would fail open
    local proj="${1:-}" rel="${2:-}" real home cur comp phys
    _OSS_SAFE_DIR=""; _OSS_SAFE_HOME=""
    [[ -n "$proj" && -n "$rel" && "$rel" != /* ]] || return 1
    [[ "$rel" != *[[:cntrl:]]* ]] || return 1   # a newline would end `read` early: check != write
    _oss_phys_cached "$proj" || return 1; real="$_OSS_PHYS"
    [[ -n "$real" ]] || return 1
    home=""; _oss_phys_cached "${HOME:-/nonexistent}" && home="$_OSS_PHYS"
    if [[ -n "$home" && "$real" == "$home" ]]; then
        mkdir -p -- "$real/$rel" 2>/dev/null || return 1
        _OSS_SAFE_DIR="$real/$rel"; _OSS_SAFE_HOME=1
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
        [[ ! -L "$cur" && -d "$cur" ]] && _oss_owned_ok "$cur" "$real" || return 1
    done
    phys=$(_oss_phys_dir "$cur") || return 1
    [[ "$phys" == "$real" || "$phys" == "$real"/* ]] || return 1
    _OSS_SAFE_DIR="$cur"   # the directory the checks above actually walked
}

oss_safe_target() {
    [[ -n "${BASH_VERSION:-}" ]] || return 1
    local proj="${1:-}" rel="${2:-}" dir base t
    [[ -n "$rel" && "$rel" != */ && "$rel" != *[[:cntrl:]]* ]] || return 1
    base="${rel##*/}"
    if [[ "$base" == "$rel" ]]; then dir="."; else dir="${rel%/*}"; fi
    [[ -n "$base" && "$base" != "." && "$base" != ".." ]] || return 1
    oss_safe_mkdir "$proj" "$dir" || return 1
    [[ -n "$_OSS_SAFE_HOME" ]] && return 0   # G5: ~/.oss and ~/.claude are the user's own (as Node)
    t="$_OSS_SAFE_DIR/$base"
    [[ -L "$t" ]] && return 1
    [[ -e "$t" ]] || return 0
    [[ -f "$t" && -n "$(find "$t" -prune -type f -links 1 2>/dev/null)" ]]
}

oss_refuse_unsafe() { echo "oss: refusing unsafe .oss path ${1:-}" >&2; }

oss_valid_workflow_name() {
    [[ -n "${BASH_VERSION:-}" ]] || return 1
    local re='^[a-z][a-z0-9-]{0,40}$'
    [[ "${1:-}" =~ $re ]]
}
