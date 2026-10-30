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
#   HOME               - Holds ~/.oss/config.json (unless OSS_CONFIG_DIR is set) and the cache stamps
#   OSS_CONFIG_DIR     - Holds config.json instead of ~/.oss: apiKey, and apiUrl, the only API it is sent to
#
# Safety (both modes refuse, without writing, and warn on stderr):
#   - CLAUDE.md is a symlink (incl. dangling) or not a regular file
#   - CLAUDE.md's directory resolves outside the project, or the project resolves to $HOME
#   - the markers are not exactly one START line before exactly one END line
#   - the API body is empty, < 500 bytes, > 256KB, HTML, or has no "IRON LAW"
# A failed fetch sets a 1h backoff; only a validated write marks the cache fresh (24h), for the
# apiUrl it came from (a new apiUrl refreshes on the next run).
#
# Exit codes (refresh mode always exits 0, so session start never fails):
#   0  done or nothing to do
#   1  install mode failed for another reason (lock held, temp file, missing helper)
#   2  bad arguments
#   3  install mode refused: CLAUDE.md is unsafe to write (symlink, not a regular file, outside
#      the project, the project is $HOME, malformed markers). Nothing written.
#   4  install mode has no valid laws to write (not logged in, no key, API unreachable or
#      non-200, invalid body). Nothing written.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENDPOINT="/api/v1/prompts/shared/iron-laws"
STATE_DIR="${HOME}/.oss"
LAST_CHECK_FILE="${STATE_DIR}/.iron-laws-last-check"
BACKOFF_FILE="${STATE_DIR}/.iron-laws-backoff"
LOCK_DIR="${STATE_DIR}/.iron-laws-sync.lock"
CACHE_TTL_SECONDS=86400   # 24h after a validated write
BACKOFF_SECONDS=3600      # 1h after a failed fetch
LOCK_STALE_SECONDS=30
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
# Writes the validated, marker-free laws to $1. Returns 1 on any failure.
fetch_body() {
    local out="$1" raw="$WORK/raw" key rc=0 code bytes
    key=$OSS_KEY   # set beside API_URL by the one oss_api_creds read in main (T30, T37)
    if [[ -z "$key" ]]; then warn "no API key in $CONFIG_FILE"; return 1; fi
    oss_api_curl "$key" -sS --connect-timeout 2 -m 4 --max-filesize "$MAX_BODY_BYTES" \
        -w '\n%{http_code}' "${API_URL}${ENDPOINT}" > "$raw" 2>/dev/null || rc=$?
    unset key
    if (( rc != 0 )); then warn "API unreachable or response too large (curl exit $rc)"; return 1; fi
    code=$(tail -n 1 "$raw")
    if [[ "$code" != "200" ]]; then warn "API returned HTTP $code"; return 1; fi
    bytes=$(wc -c < "$raw" | tr -d ' ')
    if (( bytes > MAX_BODY_BYTES + 8 )); then warn "rejected: body over $MAX_BODY_BYTES bytes"; return 1; fi
    # Drop the status line and any marker-like lines; trim leading/trailing blank lines.
    sed '$d' "$raw" | awk '
        /^[[:space:]]*<!--[[:space:]]*IRON LAWS (START|END)/ { next }
        /^[[:space:]]*$/ { if (started) blanks++; next }
        { while (blanks > 0) { print ""; blanks-- } started = 1; print }' > "$out"
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
    # shellcheck source=oss-api-curl.sh
    source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || { warn "missing $SCRIPT_DIR/oss-api-curl.sh"; give_up; }
    if [[ "$MODE" == refresh ]]; then
        [[ "$state" == one ]] || exit 0
        # The fresh stamp holds the apiUrl that wrote the block: another apiUrl refreshes now. The stamp and the
        # backoff count only as regular files (oss_is_regular: a FIFO is never opened, a symlink never trusted, T32).
        oss_is_regular "$LAST_CHECK_FILE" && younger_than "$LAST_CHECK_FILE" "$CACHE_TTL_SECONDS" \
            && [[ "$(cat "$LAST_CHECK_FILE" 2>/dev/null)" == "$(oss_api_url 2>/dev/null)" ]] && exit 0
        oss_is_regular "$BACKOFF_FILE" && younger_than "$BACKOFF_FILE" "$BACKOFF_SECONDS" && exit 0
    fi
    CONFIG_FILE=$(oss_config_file)
    [[ -f "$CONFIG_FILE" ]] || { warn "not logged in ($CONFIG_FILE missing)"; give_up 4; }
    # The key goes only to the API configured beside it.
    oss_api_creds || true; API_URL=$OSS_URL   # key and URL from one read (T37)
    [[ $OSS_URL_RC == 0 ]] || { warn "refusing: apiUrl in $CONFIG_FILE must be an https URL (plain http only for localhost) with no user@, query or fragment"; give_up 4; }

    trap cleanup EXIT
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/oss-iron-laws.XXXXXX") || give_up
    mkdir -p "$STATE_DIR"
    local body="$WORK/body"
    if ! fetch_body "$body"; then
        oss_write_atomic "$BACKOFF_FILE" ""   # temp + mv: a symlink at the path is replaced, not followed (T32)
        give_up 4
    fi

    acquire_lock || give_up
    write_block "$body" || give_up $?
    if [[ "$RESULT" != skipped ]]; then
        oss_write_atomic "$LAST_CHECK_FILE" "$API_URL"$'\n'
        rm -f "$BACKOFF_FILE"
    fi
    # The current session read CLAUDE.md before this block existed: show it once.
    [[ "$RESULT" == added ]] && cat "$body"
    exit 0
}

main
