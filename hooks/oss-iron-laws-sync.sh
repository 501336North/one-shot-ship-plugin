#!/bin/bash
# oss-iron-laws-sync.sh - Keep the IRON LAWS block in the project's CLAUDE.md up to date
#
# Usage:
#   oss-iron-laws-sync.sh            Refresh mode (session start, /oss:ideate, /oss:auto).
#                                    Refreshes ONLY an existing, well-formed block. Never
#                                    creates CLAUDE.md and never appends.
#   oss-iron-laws-sync.sh --install  Install mode (/oss:login only). May create CLAUDE.md or
#                                    append one block; prints the laws when it adds them.
#
# Environment:
#   CLAUDE_PROJECT_DIR - Project directory (defaults to the current directory)
#   HOME               - Holds ~/.oss/config.json and the cache stamps
#
# Safety (both modes refuse, without writing, and warn on stderr):
#   - CLAUDE.md is a symlink (incl. dangling) or not a regular file
#   - CLAUDE.md's directory resolves outside the project, or the project resolves to $HOME
#   - the markers are not exactly one START line before exactly one END line
#   - the decrypt CLI refuses (signature or hash mismatch, not in the signed manifest, API error),
#     takes over 15s, or is missing and cannot be installed
#   - the verified body is empty, < 500 bytes, > 256KB, HTML, or has no "IRON LAW"
# A failed fetch sets a 1h backoff; only a validated write marks the cache fresh (24h).
#
# Exit codes (refresh mode always exits 0, so session start never fails):
#   0  done or nothing to do
#   1  install mode failed for another reason (lock held, temp file, missing helper)
#   2  bad arguments
#   3  install mode refused: CLAUDE.md is unsafe to write (symlink, not a regular file, outside
#      the project, the project is $HOME, malformed markers). Nothing written.
#   4  install mode has no valid laws to write (not logged in, decrypt CLI missing or refused,
#      API unreachable, invalid body). Nothing written.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${HOME}/.oss"
OSS_DECRYPT="${STATE_DIR}/bin/oss-decrypt"
LAST_CHECK_FILE="${STATE_DIR}/.iron-laws-last-check"
BACKOFF_FILE="${STATE_DIR}/.iron-laws-backoff"
LOCK_DIR="${STATE_DIR}/.iron-laws-sync.lock"
CACHE_TTL_SECONDS=86400   # 24h after a validated write
BACKOFF_SECONDS=3600      # 1h after a failed fetch
LOCK_STALE_SECONDS=30
CLI_TIMEOUT_SECONDS=15   # the CLI's own manifest fetch times out at 10s
MIN_BODY_BYTES=500
MAX_BODY_BYTES=262144

MARKER_START="<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->"
MARKER_END="<!-- IRON LAWS END -->"
# Written by /oss:ideate 2026-02-27..03-18 (#146-#161); read as a START, rewritten as MARKER_START.
MARKER_LEGACY_START="<!-- IRON LAWS START -->"

warn() { printf 'oss-iron-laws-sync: %s\n' "$*" >&2; }

MODE=refresh
case "${1:-}" in
    --install) MODE=install ;;
    '') ;;
    *) warn "unknown argument: $1"; exit 2 ;;
esac

# Exit without writing: refresh mode is silent-success, install mode reports failure.
give_up() { [[ "$MODE" == install ]] && exit "${1:-1}"; exit 0; }

mtime() {
    if [[ "$(uname)" == "Darwin" ]]; then stat -f %m "$1" 2>/dev/null || echo 0
    else stat -c %Y "$1" 2>/dev/null || echo 0; fi
}
file_mode() {
    if [[ "$(uname)" == "Darwin" ]]; then stat -f %Lp "$1"; else stat -c %a "$1"; fi
}
younger_than() { # $1 file, $2 seconds
    [[ -e "$1" ]] || return 1
    (( $(date +%s) - $(mtime "$1") < $2 ))
}

# --- where we may write ----------------------------------------------------------------------
# Sets CLAUDE_MD to <physical project dir>/CLAUDE.md, or returns 1 (with a warning) if writing
# there could land anywhere else. Re-run inside the lock, right before the write.
resolve_target() {
    local proj_real home_real parent_real
    proj_real=$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null && pwd -P) || { warn "project directory not found"; return 1; }
    home_real=$(cd "$HOME" 2>/dev/null && pwd -P) || home_real=""
    if [[ "$proj_real" == "$home_real" ]]; then
        warn "refusing: the project directory is \$HOME"; return 1
    fi
    CLAUDE_MD="$proj_real/CLAUDE.md"
    if [[ -L "$CLAUDE_MD" ]]; then warn "refusing: CLAUDE.md is a symlink"; return 1; fi
    if [[ -e "$CLAUDE_MD" && ! -f "$CLAUDE_MD" ]]; then warn "refusing: CLAUDE.md is not a regular file"; return 1; fi
    parent_real=$(cd "$(dirname "$CLAUDE_MD")" 2>/dev/null && pwd -P) || return 1
    if [[ "$parent_real" != "$proj_real" ]]; then warn "refusing: CLAUDE.md resolves outside the project"; return 1; fi
}

# Marker lines are compared after dropping trailing whitespace, \r included (CRLF files).
# Only whole lines equal to a marker count; prose that mentions one is ordinary text.
MARKER_AWK='
    function norm(x) { sub(/[[:space:]]+$/, "", x); return x }
    function is_start(x) { x = norm(x); return x == s || x == ls }
    function is_end(x) { return norm(x) == e }'
awk_markers() { awk -v s="$MARKER_START" -v ls="$MARKER_LEGACY_START" -v e="$MARKER_END" "$@"; }

# none = no marker lines, one = exactly one START before exactly one END, bad = anything else.
block_state() {
    [[ -f "$CLAUDE_MD" ]] || { echo none; return; }
    awk_markers "$MARKER_AWK"'
        is_start($0) { ns++; if (!fs) fs = NR }
        is_end($0) { ne++; if (!fe) fe = NR }
        END {
            if (ns == 0 && ne == 0) print "none"
            else if (ns == 1 && ne == 1 && fs < fe) print "one"
            else print "bad"
        }' "$CLAUDE_MD"
}

# --- fetch + validate ------------------------------------------------------------------------
# The laws come only from the decrypt CLI (FR15, ADR-005): it fetches /api/v1/prompts/shared/iron-laws
# with its own stored credentials, checks the body's sha256 against the signed manifest entry
# shared/iron-laws, and prints it, or refuses (non-zero exit). The hook never sees the API key.
# A missing CLI is installed first by ensure-decrypt-cli.sh beside this hook.
run_cli() { # $1 output file; the CLI is stopped after CLI_TIMEOUT_SECONDS
    local out="$1" pid watchdog rc=0
    "$OSS_DECRYPT" --type shared --name iron-laws > "$out" 2>"$WORK/cli-err" & pid=$!
    ( sleep "$CLI_TIMEOUT_SECONDS"; kill "$pid" 2>/dev/null ) </dev/null >/dev/null 2>&1 & watchdog=$!
    wait "$pid" || rc=$?
    kill "$watchdog" 2>/dev/null
    return "$rc"
}

# Writes the validated, marker-free laws to $1. Returns 1 on any failure.
fetch_body() {
    local out="$1" raw="$WORK/raw" rc=0 bytes
    if [[ ! -x "$OSS_DECRYPT" ]] && ! "$SCRIPT_DIR/ensure-decrypt-cli.sh" </dev/null >/dev/null 2>&1; then
        warn "the decrypt CLI is not installed and could not be installed"; return 1
    fi
    run_cli "$raw" || rc=$?
    if (( rc != 0 )); then
        warn "the decrypt CLI refused or failed (exit $rc): $(tail -n 1 "$WORK/cli-err" 2>/dev/null)"; return 1
    fi
    bytes=$(wc -c < "$raw" | tr -d ' ')
    if (( bytes > MAX_BODY_BYTES + 8 )); then warn "rejected: body over $MAX_BODY_BYTES bytes"; return 1; fi
    # Drop any marker-like lines; trim leading/trailing blank lines.
    awk '
        /^[[:space:]]*<!--[[:space:]]*IRON LAWS (START|END)/ { next }
        /^[[:space:]]*$/ { if (started) blanks++; next }
        { while (blanks > 0) { print ""; blanks-- } started = 1; print }' "$raw" > "$out"
    bytes=$(wc -c < "$out" | tr -d ' ')
    if (( bytes < MIN_BODY_BYTES )); then warn "rejected: body under $MIN_BODY_BYTES bytes"; return 1; fi
    if grep -qiE '<!doctype html|<html[[:space:]>]' "$out"; then
        warn "rejected: body looks like HTML"; return 1
    fi
    if ! grep -q 'IRON LAW' "$out"; then warn "rejected: body has no IRON LAW heading"; return 1; fi
}

# --- write -----------------------------------------------------------------------------------
acquire_lock() {
    for _ in $(seq 1 100); do
        if mkdir "$LOCK_DIR" 2>/dev/null; then LOCKED=1; return 0; fi
        if ! younger_than "$LOCK_DIR" "$LOCK_STALE_SECONDS"; then rmdir "$LOCK_DIR" 2>/dev/null; continue; fi
        sleep 0.1
    done
    warn "another sync holds $LOCK_DIR"; return 1
}

# Replace CLAUDE.md with the content of $1: temp file in the same directory, original mode,
# atomic rename. Skips the write when nothing changed.
replace_claude_md() {
    local new="$1" mode tmp
    if [[ -f "$CLAUDE_MD" ]]; then
        cmp -s "$new" "$CLAUDE_MD" && return 0
        mode=$(file_mode "$CLAUDE_MD") || return 1
    else
        mode=$(printf '%o' $(( 0666 & ~$(umask) )))
    fi
    tmp=$(mktemp "$(dirname "$CLAUDE_MD")/.CLAUDE.md.oss-sync.XXXXXX") || return 1
    TMP_FILE="$tmp"
    cat "$new" > "$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "$CLAUDE_MD"
}

# Sets RESULT to "refreshed", "added" or "skipped"; returns 1 on a refusal.
# Runs in the main shell (not $(...)) so the EXIT trap can remove its temp file.
write_block() {
    local body="$1" new="$WORK/new" state eol=""
    resolve_target || return 3
    state=$(block_state)
    # Lines we add follow the file's line ending (its first line); user lines are copied as-is.
    [[ -f "$CLAUDE_MD" ]] && head -n 1 "$CLAUDE_MD" | grep -q $'\r$' && eol=$'\r'
    case "$MODE/$state" in
        */one)
            awk_markers -v body="$body" -v eol="$eol" "$MARKER_AWK"'
                is_start($0) { print s eol; print eol; while ((getline l < body) > 0) print l eol; print eol; skip = 1; next }
                is_end($0) { print e eol; skip = 0; next }
                !skip { print }
            ' "$CLAUDE_MD" > "$new" || return 1
            replace_claude_md "$new" && RESULT=refreshed ;;
        install/none)
            {
                if [[ -s "$CLAUDE_MD" ]]; then
                    cat "$CLAUDE_MD"
                    [[ -n "$(tail -c 1 "$CLAUDE_MD")" ]] && printf '%s\n' "$eol"
                    printf '%s\n' "$eol"
                fi
                printf '%s\n%s\n' "$MARKER_START$eol" "$eol"
                awk -v eol="$eol" '{ print $0 eol }' "$body"
                printf '%s\n%s\n' "$eol" "$MARKER_END$eol"
            } > "$new" || return 1
            replace_claude_md "$new" && RESULT=added ;;
        refresh/none) RESULT=skipped ;;
        *) warn "skipping: CLAUDE.md does not have exactly one START line before one END line"; return 3 ;;
    esac
}

cleanup() {
    [[ -n "${TMP_FILE:-}" ]] && rm -f "$TMP_FILE"
    [[ -n "${LOCKED:-}" ]] && rmdir "$LOCK_DIR" 2>/dev/null
    [[ -n "${WORK:-}" ]] && rm -rf "$WORK"
    return 0
}

main() {
    resolve_target || give_up 3
    local state; state=$(block_state)
    if [[ "$state" == bad ]]; then
        warn "skipping: CLAUDE.md does not have exactly one START line before one END line"; give_up 3
    fi
    if [[ "$MODE" == refresh ]]; then
        [[ "$state" == one ]] || exit 0
        younger_than "$LAST_CHECK_FILE" "$CACHE_TTL_SECONDS" && exit 0
        younger_than "$BACKOFF_FILE" "$BACKOFF_SECONDS" && exit 0
    fi
    # shellcheck source=oss-api-curl.sh
    source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || { warn "missing $SCRIPT_DIR/oss-api-curl.sh"; give_up; }
    CONFIG_FILE="$(oss_config_file)"  # logged in; the decrypt CLI reads its own credentials
    [[ -f "$CONFIG_FILE" ]] || { warn "not logged in ($CONFIG_FILE missing)"; give_up 4; }
    oss_api_url >/dev/null || { warn "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; give_up 4; }

    trap cleanup EXIT
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/oss-iron-laws.XXXXXX") || give_up
    mkdir -p "$STATE_DIR"
    local body="$WORK/body"
    if ! fetch_body "$body"; then
        touch "$BACKOFF_FILE"
        give_up 4
    fi

    acquire_lock || give_up
    write_block "$body" || give_up $?
    if [[ "$RESULT" != skipped ]]; then
        touch "$LAST_CHECK_FILE"
        rm -f "$BACKOFF_FILE"
    fi
    # The current session read CLAUDE.md before this block existed: show it once.
    [[ "$RESULT" == added ]] && cat "$body"
    exit 0
}

main
