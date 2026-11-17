#!/bin/bash
# oss-node.sh - sourced by the gate hooks (oss-tool-gate.sh, oss-gate-run.sh), oss-node-path.sh and
# oss-value.sh review-repo.
#
# The gate hooks never find node through PATH: a review agent could place a fake node early on PATH and
# silence both gate layers (security C1). They run the absolute path recorded in ~/.oss/node-path,
# fingerprinted by the review check (layer 2). The record is written by SessionStart (oss-node-path.sh)
# or, when it is missing, by the first gate hook call (oss_node): both before any agent acted. What is
# recorded is PATH's node by its STABLE path (/opt/homebrew/bin/node, not the Cellar file a
# `brew upgrade` deletes); a version manager's link in a temp folder (fnm multishell) records the real
# file it points to. A usable record is kept. A record that existed and is no longer usable is never
# replaced by a DIFFERENT node (security HIGH-1): oss_node fails with OSS_NODE_PROBLEM=changed and
# OSS_NODE_OLD / OSS_NODE_NEW, so the hooks fail closed and tell the user. Re-adopting the same path is fine.
#
# A usable path (oss_program_ok) is absolute; it and every link it goes through (folders resolved
# physically, so `..` and folder links count) lie outside the temp folders; each link and the file
# itself are owned by the user or root; it ends in an executable regular file.
#
# Every other program the hooks run comes from a fixed path, never PATH: OSS_RM, OSS_MKDIR, OSS_DATE,
# OSS_TR, OSS_HEAD, OSS_CUT, OSS_CAT, OSS_MKTEMP, OSS_MV, OSS_CHMOD, OSS_READLINK, OSS_STAT (the first
# of /bin and /usr/bin that has it, the order watcher/src/gate-run/user-files.ts FIXED_PROGRAMS uses).

# _oss_pick VAR first second: VAR is the first path that is executable (else the second).
_oss_pick() {
    if [ -x "$2" ]; then printf -v "$1" '%s' "$2"; else printf -v "$1" '%s' "$3"; fi
}
_oss_pick OSS_RM /bin/rm /usr/bin/rm
_oss_pick OSS_MKDIR /bin/mkdir /usr/bin/mkdir
_oss_pick OSS_DATE /bin/date /usr/bin/date
_oss_pick OSS_CAT /bin/cat /usr/bin/cat
_oss_pick OSS_MV /bin/mv /usr/bin/mv
_oss_pick OSS_CHMOD /bin/chmod /usr/bin/chmod
_oss_pick OSS_TR /usr/bin/tr /bin/tr
_oss_pick OSS_HEAD /usr/bin/head /bin/head
_oss_pick OSS_CUT /usr/bin/cut /bin/cut
_oss_pick OSS_MKTEMP /usr/bin/mktemp /bin/mktemp
_oss_pick OSS_READLINK /usr/bin/readlink /bin/readlink
_oss_pick OSS_STAT /usr/bin/stat /bin/stat

# oss_gate_state_dir [session]: prints the gate's run state folder, ~/.oss/gate-state (round 14 C,
# D-R14-3; watcher/src/gate-run/run-store.ts runRoot names the same), or its session folder under it
# when a plain session id is given. Each folder on the way is made 0700 when missing and is never a
# symlink; fails (nothing printed) when HOME is not absolute, the id is not plain, or a folder is unusable.
# It lives outside ~/.oss/run (a served /oss:plan block sweeps that) and config/tool-gates.json protects it.
oss_gate_state_dir() {
    case "${HOME:-}" in /*) ;; *) return 1 ;; esac
    local d dir="" root="$HOME/.oss/gate-state"
    if [ "$#" -gt 0 ]; then [[ "$1" =~ ^[A-Za-z0-9_-]{1,128}$ ]] || return 1; fi
    for d in "$HOME/.oss" "$root" ${1:+"$root/$1"}; do
        [ -L "$d" ] && return 1
        [ -d "$d" ] || "$OSS_MKDIR" -m 700 "$d" 2>/dev/null || return 1
        [ -d "$d" ] && [ ! -L "$d" ] || return 1
        dir="$d"
    done
    printf '%s\n' "$dir"
}

# True when the path lies in a temp folder.
oss_in_temp() {
    case "$1" in
        /tmp|/tmp/*|/private/tmp|/private/tmp/*|/var/tmp/*|/private/var/tmp/*|/var/folders/*|/private/var/folders/*|/dev/shm/*) return 0 ;;
    esac
    local t="${TMPDIR:-}"
    t="${t%/}"
    if [ -n "$t" ]; then
        case "$1" in "$t"/*) return 0 ;; esac
    fi
    return 1
}

# The uid owning the path itself (a link is not followed).
_oss_uid() {
    "$OSS_STAT" -c %u "$1" 2>/dev/null || "$OSS_STAT" -f %u "$1" 2>/dev/null
}

# True when the file (followed) is owned by the user or by root.
oss_owner_ok() {
    [ -O "$1" ] && return 0
    [ "$(_oss_uid "$1")" = 0 ]
}

# True when the link itself (not followed) is owned by the user or by root.
_oss_link_owner_ok() {
    local uid
    uid="$(_oss_uid "$1")" || return 1
    [ "$uid" = 0 ] || [ "$uid" = "${EUID:-}" ]
}

# oss_follow PATH: follows every link (at most 8), each folder resolved physically. Sets OSS_FOLLOWED
# to the final path and OSS_FOLLOW_TEMP to 1 when the path or any hop lies in a temp folder. 1 when it
# cannot be followed (relative, a missing folder, a link not owned by the user or root, too many hops).
oss_follow() {
    local p="$1" hops=0 dir target
    OSS_FOLLOWED=""
    OSS_FOLLOW_TEMP=0
    case "$p" in /*) ;; *) return 1 ;; esac
    while :; do
        oss_in_temp "$p" && OSS_FOLLOW_TEMP=1
        dir="$(cd -P -- "${p%/*}/" 2>/dev/null && pwd -P)" || return 1
        p="${dir%/}/${p##*/}"
        oss_in_temp "$p" && OSS_FOLLOW_TEMP=1
        [ -L "$p" ] || break
        _oss_link_owner_ok "$p" || return 1
        hops=$((hops + 1))
        [ "$hops" -gt 8 ] && return 1
        target="$("$OSS_READLINK" "$p")" || return 1
        case "$target" in /*) p="$target" ;; *) p="${p%/*}/$target" ;; esac
    done
    OSS_FOLLOWED="$p"
}

# True when the path ends (followed) in an executable regular file owned by the user or root.
_oss_end_ok() {
    [ -f "$1" ] && [ -x "$1" ] && oss_owner_ok "$1"
}

# True when the path is a program the gate hooks may run (see above).
oss_program_ok() {
    oss_follow "$1" && [ "$OSS_FOLLOW_TEMP" = 0 ] && _oss_end_ok "$OSS_FOLLOWED"
}

# The older name, kept for callers.
oss_node_ok() {
    oss_program_ok "$1"
}

# Sets OSS_NODE_NEW to what would be recorded from PATH's node: its own path when usable, else (a
# version manager's link in a temp folder) the real file it ends in, when that is usable. 1 when neither.
oss_node_candidate() {
    local found
    OSS_NODE_NEW=""
    found="$(type -P node 2>/dev/null)" || return 1
    if oss_program_ok "$found"; then
        OSS_NODE_NEW="$found"
        return 0
    fi
    oss_follow "$found" || return 1
    found="$OSS_FOLLOWED"
    oss_program_ok "$found" || return 1
    OSS_NODE_NEW="$found"
}

# Writes the path to ~/.oss/node-path: a private temp file beside it (mode 600), then renamed over it.
oss_node_record() {
    local dir="${HOME:-/nonexistent}/.oss" tmp
    case "$dir" in /*) ;; *) return 1 ;; esac
    [ -L "$dir" ] && return 1
    "$OSS_MKDIR" -p -m 700 "$dir" 2>/dev/null || return 1
    [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
    tmp="$("$OSS_MKTEMP" "$dir/.node-path.XXXXXX" 2>/dev/null)" || return 1
    if printf '%s\n' "$1" > "$tmp" && "$OSS_CHMOD" 600 "$tmp" && "$OSS_MV" -f "$tmp" "$dir/node-path"; then return 0; fi
    "$OSS_RM" -f "$tmp"
    return 1
}

# Sets OSS_NODE to the node recorded in ~/.oss/node-path (a plain file of the user's), recording PATH's
# node first when there is no record; 1 when there is no usable node (OSS_NODE_PROBLEM=changed when a
# record existed and PATH's node is a different one: OSS_NODE_OLD, OSS_NODE_NEW).
oss_node() {
    local file="${HOME:-/nonexistent}/.oss/node-path" line="" had=0
    OSS_NODE=""
    OSS_NODE_PROBLEM=""
    OSS_NODE_OLD=""
    OSS_NODE_NEW=""
    if [ -e "$file" ] || [ -L "$file" ]; then
        had=1
        if [ -f "$file" ] && [ ! -L "$file" ] && [ -O "$file" ]; then
            IFS= read -r line < "$file" || [ -n "$line" ] || line=""
            if [ -n "$line" ] && oss_program_ok "$line"; then
                OSS_NODE="$line"
                return 0
            fi
        fi
    fi
    oss_node_candidate || return 1
    if [ "$had" = 1 ] && [ "$OSS_NODE_NEW" != "$line" ]; then
        OSS_NODE_PROBLEM=changed
        OSS_NODE_OLD="$line"
        return 1
    fi
    oss_node_record "$OSS_NODE_NEW" || return 1
    OSS_NODE="$OSS_NODE_NEW"
}

# A JSON string's inside for the text: \ and " escaped, every control character made `?`.
oss_json_text() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//[[:cntrl:]]/?}"
    printf '%s' "$s"
}

# The user's message when the node changed (OSS_NODE_PROBLEM=changed): the old and new paths named.
oss_node_changed_message() {
    printf 'OSS will not switch to a different node on its own: the node recorded in ~/.oss/node-path (%s) can no longer be used, and PATH now has another one (%s). The review gate cannot run until you check it. If you changed node yourself, delete ~/.oss/node-path and OSS records the new one on its next hook.' \
        "${OSS_NODE_OLD:-an unreadable record}" "$OSS_NODE_NEW"
}
