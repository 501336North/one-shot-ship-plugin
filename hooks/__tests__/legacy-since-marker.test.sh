#!/bin/bash
# complete-gaps Task 3: the one-time ledger phase-results-since marker (D6, AC-002.0).
#
# @behavior The first oss-notify run after the plugin update writes ~/.oss/ledger/phase-results-since with the current
#           UTC time (ledger dir 700, file 600). A later run never rewrites it. A linked or foreign-owned ledger dir, or
#           a linked marker, is refused: nothing is written and the hook still exits 0.
# @business-rule "Only pre-upgrade starts" pass complete as legacy (D6): the marker is the proof of when the phase-results
#           hooks were installed, so it is written once, owner-only, and never moved or written through a link.
#
# Hermetic: its own temp HOME, a sandbox plugin root with no CLIs, and terminal-notifier/osascript/say/afplay tripwires
# first on PATH. "Foreign" is simulated with the BASH_ENV `test -O` seam (project-walk.test.sh, session-routing.test.sh).
# Usage: /bin/bash hooks/__tests__/legacy-since-marker.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

RUNDIR=$(cd "$(mktemp -d)" && pwd -P)
export HOME="$RUNDIR/outer-home"; mkdir "$HOME"
trap 'rm -rf "$RUNDIR"' EXIT
cat > "$RUNDIR/foreign.sh" <<'SH'
test() { if [[ "${1:-}" == -O && -n "${OSS_T_FOREIGN:-}" && "${2:-}" == "$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
SH
ISO='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

T=""
sandbox() {
    T=$(mktemp -d "$RUNDIR/s.XXXXXX")
    mkdir -p "$T/home/.oss" "$T/plugin" "$T/bin" "$T/work"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    for n in terminal-notifier osascript say afplay; do
        printf '#!/bin/sh\necho "%s $*" >> "%s/tripwire"\nexit 0\n' "$n" "$T" > "$T/bin/$n"; chmod +x "$T/bin/$n"
    done
}
# notify [foreign path]: one oss-notify run with the sandbox HOME; rc in RC
notify() {
    RC=0
    (cd "$T/work" && HOME="$T/home" PATH="$T/bin:/usr/bin:/bin:/usr/sbin:/sbin" CLAUDE_PLUGIN_ROOT="$T/plugin" \
        BASH_ENV="$RUNDIR/foreign.sh" OSS_T_FOREIGN="${1:-}" \
        "$SH" "$ROOT/hooks/oss-notify.sh" --workflow ideate quality_passed '{}' </dev/null >/dev/null 2>&1) || RC=$?
}
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null; }
check_tripwire() { [[ ! -e "$T/tripwire" ]] || fail "no real notifier is ever called" "$(cat "$T/tripwire")"; }
M() { printf '%s' "$T/home/.oss/ledger/phase-results-since"; }

# 1. first run writes the marker with the current UTC time, dir 700, file 600
sandbox
before=$(date -u +%Y-%m-%dT%H:%M:%SZ); notify; after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
got=$(cat "$(M)" 2>/dev/null || true)
if [[ $RC -eq 0 && "$got" =~ $ISO && ! "$got" < "$before" && ! "$got" > "$after" \
    && "$(mode "$T/home/.oss/ledger")" == 700 && "$(mode "$(M)")" == 600 ]]; then
    pass "should write ~/.oss/ledger/phase-results-since once with the current UTC time"
else fail "should write ~/.oss/ledger/phase-results-since once with the current UTC time" \
    "rc=$RC got='$got' window=$before..$after dir=$(mode "$T/home/.oss/ledger") file=$(mode "$(M)")"; fi
check_tripwire

# 2. a later run never rewrites it
sandbox
(umask 077; mkdir "$T/home/.oss/ledger"; printf '2026-01-01T00:00:00Z\n' > "$(M)")
notify; notify
if [[ $RC -eq 0 && "$(cat "$(M)")" == 2026-01-01T00:00:00Z ]]; then pass "should never rewrite an existing marker"
else fail "should never rewrite an existing marker" "rc=$RC got='$(cat "$(M)")'"; fi
check_tripwire

# 3. a linked marker (dangling symlink) is refused: its target is never created
sandbox
(umask 077; mkdir "$T/home/.oss/ledger"); ln -s "$T/elsewhere" "$(M)"
notify
if [[ $RC -eq 0 && ! -e "$T/elsewhere" && -L "$(M)" ]]; then pass "should refuse a linked marker and write nothing"
else fail "should refuse a linked marker and write nothing" "rc=$RC target=$([[ -e "$T/elsewhere" ]] && echo written)"; fi
check_tripwire

# 4. a linked ledger dir is refused: nothing lands in its target
sandbox
mkdir -m 700 "$T/other"; ln -s "$T/other" "$T/home/.oss/ledger"
notify
if [[ $RC -eq 0 && -z "$(ls -A "$T/other")" ]]; then pass "should refuse a linked ledger dir and write nothing"
else fail "should refuse a linked ledger dir and write nothing" "rc=$RC other=$(ls -A "$T/other")"; fi
check_tripwire

# 5. a foreign-owned ledger dir is refused: no marker
sandbox
(umask 077; mkdir "$T/home/.oss/ledger")
notify "$T/home/.oss/ledger"
if [[ $RC -eq 0 && ! -e "$(M)" && ! -L "$(M)" ]]; then pass "should refuse a foreign-owned ledger dir and write nothing"
else fail "should refuse a foreign-owned ledger dir and write nothing" "rc=$RC marker=$(cat "$(M)" 2>/dev/null)"; fi
check_tripwire

# 6. a foreign-owned marker is left as it is (never rewritten, never replaced)
sandbox
(umask 077; mkdir "$T/home/.oss/ledger"; printf '2026-01-01T00:00:00Z\n' > "$(M)")
notify "$(M)"
if [[ $RC -eq 0 && "$(cat "$(M)")" == 2026-01-01T00:00:00Z ]]; then pass "should leave a foreign-owned marker untouched"
else fail "should leave a foreign-owned marker untouched" "rc=$RC got='$(cat "$(M)")'"; fi
check_tripwire

echo ""
echo "legacy-since-marker: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
