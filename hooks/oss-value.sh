#!/usr/bin/env bash
# oss-value.sh - the one plugin script that owns the per-repo value folder (G21 cut 1, ADR-001).
#
#   oss-value.sh dir                print the physical ~/.oss/run/<key> for the cwd's repo, cleared
#                                   of the 7 value files; nothing printed and rc != 0 when unsafe.
#   oss-value.sh failed <workflow>  send reason.txt from that folder, cleaned, as the workflow's
#                                   failed notice to the project the cwd is in; then delete it.
#
# `dir` is the served value-folder command, step for step; `failed` is the served failure-notice
# reader. Keep them identical.
set -u

_OV_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$_OV_HERE/oss-safe-path.sh" ]]; then
    echo "oss-value: oss-safe-path.sh missing beside $_OV_HERE/oss-value.sh; refusing" >&2
    exit 1
fi
source "$_OV_HERE/oss-safe-path.sh"

_ov_usage() { echo "usage: oss-value.sh dir | failed <workflow>" >&2; exit 2; }

_OV_RUN="$HOME/.oss/run"

# The cwd's repo, never one named by the environment; cd to its toplevel.
_ov_repo() {
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
    && _OV_TOP=$(git rev-parse --show-toplevel) && cd "$_OV_TOP" >/dev/null
}
_ov_key() { git rev-parse --absolute-git-dir | git hash-object --stdin | cut -c1-16; }
_ov_safe() { test ! -L "$1" && test -O "$1"; }   # the served not-link + owner checks

# Lookup only (no create): sets _OV_DIR to the physical ~/.oss/run/<key> when both folders pass
# the checks. Reused by the verbs that read a value file.
_ov_dir() {
    _OV_DIR=""
    _ov_repo && _ov_safe "$_OV_RUN" || return 1
    local g && g="$_OV_RUN/$(_ov_key)" && _ov_safe "$g" \
    && _OV_DIR=$(CDPATH= cd -P -- "$g" >/dev/null && pwd -P)
}

_ov_cmd_dir() {
    _ov_repo \
    && mkdir -p -m 700 "$_OV_RUN" && _ov_safe "$_OV_RUN" && chmod 700 "$_OV_RUN" \
    && { find "$_OV_RUN" -mindepth 2 -maxdepth 2 -type f -name '*.txt' -mtime +7 -delete; find "$_OV_RUN" -mindepth 1 -maxdepth 1 -type d -empty -mtime +1 -delete || true; } 2>/dev/null \
    && mkdir -p -m 700 "$_OV_RUN/$(_ov_key)" && _ov_dir && chmod 700 "$_OV_DIR" && touch "$_OV_DIR" \
    && local p="$_OV_DIR" \
    && rm -f "$p/feature.txt" "$p/numbers.txt" "$p/date.txt" "$p/reason.txt" "$p/message.txt" "$p/hint.txt" "$p/error.txt" \
    && printf '%s\n' "$p"
}

# The served #374 walk: the nearest real (not linked) .oss from <cwd> up to the repo top, or "".
_ov_walk() {
    local d="$1"; _OV_PROJ=""
    while test -n "$_OV_TOP" && case "$d" in "$_OV_TOP"|"$_OV_TOP"/*) true ;; *) false ;; esac; do
        test -d "$d/.oss" && test ! -L "$d/.oss" && _OV_PROJ=$d && break; d=${d%/*}
    done
}

# <file> in _OV_DIR: not a link, a regular file, link count 1 (the served checks).
_ov_check_value() {
    local f="$_OV_DIR/$1"
    test ! -L "$f" && test -f "$f" && test "$(stat -c %h "$f" 2>/dev/null || stat -f %l "$f")" = 1
}
# Checked <file>, kept to the served charset, at most 200 characters -> _OV_VAL.
_ov_read_value() {
    _ov_check_value "$1" && _OV_VAL=$(LC_ALL=C tr -cd 'A-Za-z0-9 ._,:()/-' < "$_OV_DIR/$1" | cut -c1-200)
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

case "${1:-}" in
    dir) _ov_cmd_dir ;;
    failed) _ov_cmd_failed "${2:-}" ;;
    *) _ov_usage ;;
esac
