#!/bin/bash
# hooks/oss-timeline.sh: the timeline writer runs its tools from fixed paths, never PATH's (R-257 round 6, D47).
#
# @behavior When OSS writes a timeline line (a command line, an unfiled line after the archive lookup, a gate line with
#           its ledger row), programs named git, jq, date, shasum, sha256sum, find, uuidgen or tail planted early on
#           PATH never run, and the line is still written with the real tools.
# @business-rule D47 (security INFO): the writer takes every tool from a fixed path, as oss-stop-dispatch.sh and
#           oss-verdict-capture.sh do (oss-phase-result.sh's _oss_fixed_bin: OSS_GIT_BIN, OSS_JQ_BIN, ...), so a planted
#           jq cannot shape a line and a planted git cannot pick the ledger key.
#
# Hermetic: temp HOME whose settings.json says style "none"; PATH is the sandbox bin plus the system folders. Nothing
# here starts the push; every run still holds fd 9 (held_by) and cleanup waits for it before deleting $T.
# Usage: ./hooks/__tests__/timeline-fixed-tools.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR CLAUDE_CODE_SESSION_ID OSS_TL_SESSION
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR
ROOT="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd)"
# shellcheck source=lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-timeline.sh"
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-fixed-tools tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

T=""
held_by() { exec >/dev/null 2>&1; /bin/cat; /bin/rm -f "$1"; }
cleanup() {
    [[ -n "$T" && -d "$T" ]] || return 0
    local held=""
    for _ in $(seq 300); do held=$(cd "$T" && ls -d held.* 2>/dev/null); [[ -z "$held" ]] && break; sleep 0.1; done
    if [[ -n "$held" ]]; then fail "every process a hook run started has exited" "still held after 30 s: $held (kept $T)"; return; fi
    rm -rf "$T"
}
trap cleanup EXIT

# sandbox <branch> [active feature]: a repo on <branch>, a scratch HOME, and logging fakes in $T/bin -> T, P
sandbox() {
    local tool
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    P="$T/repo"
    mkdir -p "$T/home/.oss" "$T/bin" "$P/.oss/dev/active"
    chmod 700 "$T/home/.oss"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    [[ -n "${2:-}" ]] && mkdir -p "$P/.oss/dev/active/$2"
    (cd "$P" && GIT_CONFIG_GLOBAL=/dev/null git init -q && GIT_CONFIG_GLOBAL=/dev/null git -c user.name=t -c user.email=t@t \
        commit -q --allow-empty -m init && git checkout -q -B "$1")
    # an unfiled file already there, so the newline check (tail) runs
    printf '{"v":1}\n' > "$P/.oss/dev/timeline-unfiled.ndjson"
    for tool in git jq date shasum sha256sum find uuidgen tail; do
        printf '#!/bin/sh\necho %s >> "%s/tools.calls"\nexit 1\n' "$tool" "$T" > "$T/bin/$tool"
        chmod 755 "$T/bin/$tool"
    done
}
# hook <args...>: the hook as oss-notify runs it, planted bin first on PATH
hook() {
    (cd "$P" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") && run_capped 30 env -i HOME="$T/home" PATH="$T/bin:$SAFE_PATH" \
        CLAUDE_PROJECT_DIR="$P" CLAUDE_CODE_SESSION_ID=fixed-tools-1 GIT_CONFIG_GLOBAL=/dev/null \
        "$SH" "$HOOK" "$@" </dev/null >/dev/null 2>"$T/stderr" 9> >(held_by "$h"))
}
# append <kind> <fields>: oss_timeline_append itself, sourced (the gate verb would start the push)
append() {
    (cd "$P" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") && run_capped 30 env -i HOME="$T/home" PATH="$T/bin:$SAFE_PATH" \
        CLAUDE_PROJECT_DIR="$P" CLAUDE_CODE_SESSION_ID=fixed-tools-1 GIT_CONFIG_GLOBAL=/dev/null \
        "$SH" -c 'source "$1" && oss_timeline_append "$2" "$3"' _ "$HOOK" "$1" "$2" </dev/null >/dev/null 2>"$T/stderr" 9> >(held_by "$h"))
}
calls() { tr '\n' ' ' < "$T/tools.calls" 2>/dev/null; }

# 1. An unfiled command line (no active folder: the archive lookup runs git, date and find), planted tools first.
sandbox feat/demo/build
hook command build start; rc=$?
if [[ $rc -eq 0 && ! -e "$T/tools.calls" && $(grep -c '"kind":"command"' "$P/.oss/dev/timeline-unfiled.ndjson") -eq 1 ]]; then
    pass "an unfiled command line: written, and no planted tool runs"
else fail "an unfiled command line: written, and no planted tool runs" "rc=$rc calls=$(calls) err=$(cat "$T/stderr")"; fi
cleanup

# 2. A filed gate line with its ledger row (git picks the ledger key), planted tools first.
sandbox feat/demo/build demo
append gate '{"round":1,"gate":"security","verdict":"pass","findings":{},"fixed":{},"mode":"full"}'; rc=$?
ledger=$(ls "$T"/home/.oss/ledger/*/gates/demo 2>/dev/null)
if [[ $rc -eq 0 && ! -e "$T/tools.calls" && -s "$P/.oss/dev/active/demo/timeline.ndjson" && -s "$ledger" ]]; then
    pass "a gate line and its ledger row: written, and no planted tool runs"
else fail "a gate line and its ledger row: written, and no planted tool runs" "rc=$rc ledger=$ledger calls=$(calls) err=$(cat "$T/stderr")"; fi
cleanup

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
