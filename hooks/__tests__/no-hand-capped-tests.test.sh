#!/bin/bash
# No shell test caps a run by hand; every time cap goes through lib/run-capped.sh (T49).
#
# @behavior Fails when any hooks/__tests__/*.sh or commands/__tests__/*.sh (lib/ is not scanned) has a line, other
#           than a comment, with its own `alarm` cap (perl `alarm N` / `alarm(N)`), a `timeout N` or a `gtimeout`.
#           A line that is a legitimate non-cap use passes only through an explicit ALLOW entry below.
# @business-rule A hand-made cap killed only the hook's shell: its `jq -s` child kept reading /dev/zero, and a
#           dozen such orphans piled up (2026-10-30, the likely cause of the Mac crash). run_capped kills the whole
#           process group and fails a run that leaves anything behind, so it is the one implementation.
#
# Usage: /bin/bash hooks/__tests__/no-hand-capped-tests.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running no-hand-capped-tests tests..."

CAP_RE='alarm[ (]|\btimeout [0-9]|gtimeout'
SELF="hooks/__tests__/no-hand-capped-tests.test.sh"   # this file names the patterns and writes anchor cases
# ALLOW: "path|text". A matching line in <path> passes only when it contains <text>. Each entry is a non-cap use.
ALLOW=(
    # curl's own --connect-timeout flag, asserted as an argument the hook passes; it caps nothing in the test.
    'hooks/__tests__/ensure-decrypt-cli.test.sh|--connect-timeout 15 --speed-limit'
    'hooks/__tests__/iron-laws-sync-safety.test.sh|local name="R3/R4: curl gets --max-filesize 262144, --connect-timeout 2, -m 4"'
    'hooks/__tests__/iron-laws-sync-safety.test.sh|&& "$a" == *"--connect-timeout 2"* &&'
    # The next two tests HIDE timeout/gtimeout from the hook's PATH (and record calls to them) to exercise the
    # hook's own fallback timer on stock macOS. They name the tools; they never run one as a cap.
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|for name in gtimeout timeout; do'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|[[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|command -v gtimeout >/dev/null; then'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|fail "fallback timer setup hides timeout and gtimeout"'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|[[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|command -v gtimeout >/dev/null; then'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|fail "fallback timer setup hides timeout and gtimeout"'
)
COMMENT_RE='^[[:space:]]*#'

# scan <file> <path-as-allowlisted> : prints "<path>:<line>: <text>" for each cap line not allowed.
scan() {
    local n line e ok
    while IFS=: read -r n line; do
        [[ "$line" =~ $COMMENT_RE ]] && continue
        ok=n
        for e in "${ALLOW[@]}"; do [[ "${e%%|*}" == "$2" && "$line" == *"${e#*|}"* ]] && ok=y; done
        [[ $ok == y ]] || echo "$2:$n: $line"
    done < <(grep -nE "$CAP_RE" "$1")
}

# --- anchors: the scan is not vacuous ---------------------------------------------------------------------------
A=$(mktemp -d); trap 'rm -rf "$A"' EXIT
anchor() { # anchor <name> <want: flagged|clean> <line>
    printf '#!/bin/bash\n%s\n' "$3" > "$A/x.test.sh"
    local got=clean; [[ -n "$(scan "$A/x.test.sh" "hooks/__tests__/x.test.sh")" ]] && got=flagged
    [[ $got == "$2" ]] && pass "anchor: $1 is $2" || fail "anchor: $1" "got $got, want $2"
}
anchor "a bare perl alarm cap" flagged "OUT=\$(perl -e 'alarm 20; exec @ARGV' bash \"\$HOOK\")"
anchor "a perl alarm(N) cap" flagged "perl -e 'alarm(20); exec @ARGV' bash hook"
anchor "a timeout cap" flagged 'timeout 20 bash "$HOOK"'
anchor "a gtimeout cap" flagged '"$(command -v timeout || command -v gtimeout)" 20 "$HOOK"'
anchor "a run through run_capped" clean 'OUT=$(run_capped 20 bash "$HOOK")'
anchor "a comment about the alarm" clean '    # the alarm stops a hung run'
anchor "an allowlisted text in a file it is not listed for" flagged 'grep -c -- "--connect-timeout 15 --speed-limit" "$a"'

# --- every allowlist entry still names a real line (a stale entry would excuse a future cap there) --------------
for e in "${ALLOW[@]}"; do
    p="${e%%|*}"
    if [[ -f "$ROOT/$p" ]] && grep -F -- "${e#*|}" "$ROOT/$p" >/dev/null; then pass "allowlist entry in use: ${p##*/}: ${e#*|}"
    else fail "allowlist entry in use" "$e matches no line"; fi
done

# --- the repo -----------------------------------------------------------------------------------------------------
files=0; hits=""
for f in "$ROOT"/hooks/__tests__/*.sh "$ROOT"/commands/__tests__/*.sh; do
    [[ -f "$f" ]] || continue
    rel="${f#"$ROOT"/}"
    [[ "$rel" == "$SELF" ]] && continue
    files=$((files + 1))
    out=$(scan "$f" "$rel")
    [[ -n "$out" ]] && hits="$hits$out"$'\n'
done
echo "  scanned $files test files"
((files > 50)) && pass "scanned the test files ($files)" || fail "scanned the test files" "only $files"
if [[ -z "$hits" ]]; then pass "no test file writes its own alarm/timeout/gtimeout cap (use run_capped)"
else
    fail "no test file writes its own alarm/timeout/gtimeout cap (use run_capped)" \
        "$(printf '%s' "$hits" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') files"
    printf '%s' "$hits" | cut -d: -f1 | sort -u | sed 's/^/    /'
fi

echo "Tests run: $RUN, failed: $FAILED"
[[ $FAILED -eq 0 ]]
