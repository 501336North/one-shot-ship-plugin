#!/bin/bash
# oss-safe-path.sh - the ONE bash guard for writes into a project (ADR-1, oss-writer-nofollow).
# Sourced, never run. Twin of watcher/src/utils/safe-project-write.ts; keep the rules identical.
#
#   oss_safe_mkdir  <project> <rel-dir>   create <project>/<rel-dir> one component at a time
#   oss_safe_target <project> <rel-file>  parent chain as above; target absent, or a regular
#                                         file with link count 1 that is not a symlink
#   oss_refuse_unsafe <rel>               the one stderr line a refused write prints
#   oss_valid_workflow_name <name>        ^[a-z][a-z0-9-]{0,40}$ (twin: watcher/src/utils/workflow-name.ts)
#   oss_project_walk <dir>                the nearest real (not linked) .oss from <dir> up to the first
#                                         dir holding a .git entry -> _OSS_PROJ ("" = the global ~/.oss)
#   oss_resolve_project [dir]             CLAUDE_PROJECT_DIR if set, else oss_project_walk from [dir] or
#                                         the physical cwd when it finds a .oss in another repo than this
#                                         session's pointer (oss_session_project), else the pointer, else
#                                         the walk -> _OSS_PROJ (twin: watcher/src/utils/project-dir.ts)
#   oss_session_pointer_write/_remove/_prune, oss_hook_stdin   the SessionStart/End side of the pointer
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

# The ONE routing rule for model-run scripts (notify-routing-unify D1). ~/.oss/current-project is
# never read: it names whichever session started last, not the project the command runs in.
# The walk stops at (and includes) the first directory holding a .git entry (dir or file); no git
# call, so no git config / GIT_* variable moves the bound. No .git above: no project.
oss_project_walk() { # -> _OSS_PROJ, and _OSS_GIT: the dir holding the .git entry ("" = none)
    local d="${1:-}" found=""
    _OSS_PROJ=""; _OSS_GIT=""
    [[ "$d" == /* ]] || return 0
    d="${d%/}"
    while :; do
        [[ -z "$found" && -d "$d/.oss" && ! -L "$d/.oss" ]] && found="${d:-/}"
        [[ -e "$d/.git" || -L "$d/.git" ]] && { _OSS_PROJ="$found"; _OSS_GIT="${d:-/}"; return 0; }
        [[ -n "$d" ]] || return 0
        d="${d%/*}"
    done
}
# R2-1 (D3): the pointer wins unless the walk finds a .oss in ANOTHER repo (its .git dir is not the
# pointer project's): session started in product 1, the user now works in product 2.
oss_resolve_project() { # [dir] (default: the physical cwd)
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then _OSS_PROJ="$CLAUDE_PROJECT_DIR"; return 0; fi
    local d="${1:-}" w g p
    if [[ -z "$d" ]]; then d=$(pwd -P; echo .); d="${d%$'\n.'}"; fi
    oss_project_walk "$d"; w="$_OSS_PROJ"; g="$_OSS_GIT"
    if oss_session_project; then
        p="$_OSS_PROJ"
        [[ -z "$w" ]] && return 0
        _oss_phys_cached "$p" && oss_project_walk "$_OSS_PHYS" && [[ "$_OSS_GIT" == "$g" ]] && { _OSS_PROJ="$p"; return 0; }
    fi
    _OSS_PROJ="$w"
}

# Per-session pointer ~/.oss/sessions/<id>/project (ship round 1, D2): written by the SessionStart
# hook from CLAUDE_PROJECT_DIR, read by model-run scripts through CLAUDE_CODE_SESSION_ID.
_OSS_SID_RE='^[A-Za-z0-9-]{1,100}$'
_oss_own_dir() { [[ -d "$1" && ! -L "$1" && -O "$1" ]]; }
# This session's pointer -> _OSS_PROJ; rc 1 (and "") when absent or not trusted.
oss_session_project() {
    local id="${CLAUDE_CODE_SESSION_ID:-}" s f p
    _OSS_PROJ=""
    [[ "$id" =~ $_OSS_SID_RE && "${HOME:-}" == /* ]] || return 1
    s="$HOME/.oss/sessions"; f="$s/$id/project"
    _oss_own_dir "$s" && _oss_own_dir "$s/$id" && [[ -f "$f" && ! -L "$f" && -O "$f" ]] || return 1
    p=$(<"$f") 2>/dev/null || return 1
    [[ "$p" == /* && "$p" != *[[:cntrl:]]* && -d "$p/.oss" && ! -L "$p/.oss" ]] || return 1
    _OSS_PROJ="$p"
}
_oss_sessions_dir() { # -> _OSS_SESS (created 700 when absent); rc 1 when linked / not owned
    _OSS_SESS=""
    [[ "${HOME:-}" == /* && -d "$HOME/.oss" ]] || return 1
    [[ -e "$HOME/.oss/sessions" || -L "$HOME/.oss/sessions" ]] || mkdir -m 700 "$HOME/.oss/sessions" 2>/dev/null
    _oss_own_dir "$HOME/.oss/sessions" && chmod 700 "$HOME/.oss/sessions" && _OSS_SESS="$HOME/.oss/sessions"
}
# <id> <project>: atomic, owner-only (dir 700, file 600)
oss_session_pointer_write() {
    local id="${1:-}" p="${2:-}" d t
    [[ "$id" =~ $_OSS_SID_RE && "$p" == /* && "$p" != *[[:cntrl:]]* ]] && _oss_sessions_dir || return 1
    d="$_OSS_SESS/$id"; t="$d/.project.$$"
    [[ -e "$d" || -L "$d" ]] || mkdir -m 700 "$d" 2>/dev/null
    _oss_own_dir "$d" && chmod 700 "$d" || return 1
    rm -f "$t" && (umask 077; printf '%s\n' "$p" > "$t") && mv -f "$t" "$d/project"
}
# <id>: remove that session's pointer folder
oss_session_pointer_remove() {
    local id="${1:-}"
    [[ "$id" =~ $_OSS_SID_RE ]] && _oss_sessions_dir && _oss_own_dir "$_OSS_SESS/$id" || return 1
    rm -rf -- "$_OSS_SESS/$id"
}
# Remove pointer folders whose file is older than 30 days. Run after this session's write, so its
# own (just rewritten) pointer is never old.
oss_session_pointer_prune() {
    local d n
    _oss_sessions_dir || return 1
    for d in "$_OSS_SESS"/*; do
        n="${d##*/}"
        [[ "$n" =~ $_OSS_SID_RE ]] && _oss_own_dir "$d" || continue
        [[ -n "$(find "$d/project" -prune -type f -mtime +30 2>/dev/null)" ]] && rm -rf -- "$d"
    done
    return 0
}
# The stdin JSON a Claude Code hook receives -> _OSS_HOOK_SID (session_id, when valid), _OSS_HOOK_EVENT
oss_hook_stdin() {
    local in="" re
    _OSS_HOOK_SID=""; _OSS_HOOK_EVENT=""
    [[ -t 0 ]] || IFS= read -r -d '' -t 2 in || true
    re='"session_id"[[:space:]]*:[[:space:]]*"([A-Za-z0-9-]{1,100})"'
    [[ "$in" =~ $re ]] && _OSS_HOOK_SID="${BASH_REMATCH[1]}"
    re='"hook_event_name"[[:space:]]*:[[:space:]]*"([A-Za-z]{1,40})"'
    [[ "$in" =~ $re ]] && _OSS_HOOK_EVENT="${BASH_REMATCH[1]}"
    return 0
}
