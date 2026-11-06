#!/bin/bash
# No shell test caps a run by hand; every time cap goes through lib/run-capped.sh (T49).
#
# @behavior Fails when any hooks/__tests__/*.sh or commands/__tests__/*.sh (lib/ is not scanned) has a line, other
#           than a comment, with its own `alarm` cap (perl `alarm N` / `alarm(N)`), a `timeout N` (or `timeout "$v"`,
#           `timeout -s ...`) or a `gtimeout`. A line that is a legitimate non-cap use passes only through an ALLOW
#           entry below that is that whole line; an entry that is not exactly one line of its file fails (T55).
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

CAP_RE='alarm[ (]|\btimeout +([0-9]|"?\$|-[a-z-])|gtimeout'   # T55: also timeout "$secs" / -s / --signal= / -k
SELF="hooks/__tests__/no-hand-capped-tests.test.sh"   # this file names the patterns and writes anchor cases
# ALLOW: "path|line". A matching line in <path> passes only when it IS <line>, leading/trailing blanks aside (T55).
# Each entry is a non-cap use.
ALLOW=(
    # curl's own --connect-timeout flag, asserted as an argument the hook passes; it caps nothing in the test.
    'hooks/__tests__/ensure-decrypt-cli.test.sh|local n; n=$(grep -c -- "-fsSL --proto =https --connect-timeout 15 --speed-limit 1024 --speed-time 60" "$args" 2>/dev/null)'
    'hooks/__tests__/iron-laws-sync-safety.test.sh|local name="R3/R4: curl gets --max-filesize 262144, --connect-timeout 2, -m 4"; ((TESTS_RUN++)); setup'
    'hooks/__tests__/iron-laws-sync-safety.test.sh|if [[ "$a" == *"--max-filesize 262144"* && "$a" == *"--connect-timeout 2"* && ( "$a" == *"-m 4"* || "$a" == *"--max-time 4"* ) ]]; then pass "$name"'
    # The next two tests HIDE timeout/gtimeout from the hook's PATH (and record calls to them) to exercise the
    # hook's own fallback timer on stock macOS. They name the tools; they never run one as a cap.
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|for name in gtimeout timeout; do'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|[[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|if PATH="$T/bin:$T/sys" command -v timeout >/dev/null || PATH="$T/bin:$T/sys" command -v gtimeout >/dev/null; then'
    'hooks/__tests__/oss-notify-complete-bounds.test.sh|fail "fallback timer setup hides timeout and gtimeout" "a timeout tool is still on the PATH"'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|[[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|if PATH="$T/bin:$T/sys" command -v timeout >/dev/null || PATH="$T/bin:$T/sys" command -v gtimeout >/dev/null; then'
    'hooks/__tests__/session-start-timeout-fallback.test.sh|fail "fallback timer setup hides timeout and gtimeout" "a timeout tool is still on the PATH"'
    # The same for oss-timeline.sh's merge verb (G2 P-9): its gh bound is tested on a PATH without either tool.
    'hooks/__tests__/timeline-merge.test.sh|path_without "$T/stock" gh gtimeout timeout   # stock macOS (the fake gh goes first): the bound is the inline perl supervisor (P-9)'
    'hooks/__tests__/timeline-merge.test.sh|&& ! -e "$T/stock/timeout" && ! -e "$T/stock/gtimeout" ]] \'
)
COMMENT_RE='^[[:space:]]*#'

# scan <file> <path-as-allowlisted> : prints "<path>:<line>: <text>" for each cap line not allowed.
scan() {
    local n line t e ok
    while IFS=: read -r n line; do
        [[ "$line" =~ $COMMENT_RE ]] && continue
        t="${line#"${line%%[![:space:]]*}"}"; t="${t%"${t##*[![:space:]]}"}"
        ok=n
        for e in "${ALLOW[@]}"; do [[ "${e%%|*}" == "$2" && "$t" == "${e#*|}" ]] && ok=y; done
        [[ $ok == y ]] || echo "$2:$n: $line"
    done < <(grep -nE "$CAP_RE" "$1")
}

# stale_entries <root> <entry>... : prints each entry that is not exactly one whole line (blanks trimmed) of its file.
stale_entries() {
    local root="$1" e; shift
    for e in "$@"; do
        [[ -f "$root/${e%%|*}" && $(L="${e#*|}" awk '{ sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, "") }
            $0 == ENVIRON["L"] { c++ } END { print c + 0 }' "$root/${e%%|*}") == 1 ]] || echo "$e"
    done
}

# --- anchors: the scan is not vacuous ---------------------------------------------------------------------------
A=$(mktemp -d); trap 'rm -rf "$A"' EXIT
anchor() { # anchor <name> <want: flagged|clean> <line> [path-as-allowlisted]
    printf '#!/bin/bash\n%s\n' "$3" > "$A/x.test.sh"
    local got=clean; [[ -n "$(scan "$A/x.test.sh" "${4:-hooks/__tests__/x.test.sh}")" ]] && got=flagged
    [[ $got == "$2" ]] && pass "anchor: $1 is $2" || fail "anchor: $1" "got $got, want $2"
}
anchor "a bare perl alarm cap" flagged "OUT=\$(perl -e 'alarm 20; exec @ARGV' bash \"\$HOOK\")"
anchor "a perl alarm(N) cap" flagged "perl -e 'alarm(20); exec @ARGV' bash hook"
anchor "a timeout cap" flagged 'timeout 20 bash "$HOOK"'
anchor "a gtimeout cap" flagged '"$(command -v timeout || command -v gtimeout)" 20 "$HOOK"'
anchor "a run through run_capped" clean 'OUT=$(run_capped 20 bash "$HOOK")'
anchor "a comment about the alarm" clean '    # the alarm stops a hung run'
anchor "an allowlisted text in a file it is not listed for" flagged 'grep -c -- "--connect-timeout 15 --speed-limit" "$a"'
# T55: the duration as a quoted variable, and the option forms before it.
anchor "a timeout cap on a quoted variable" flagged 'timeout "$secs" bash "$HOOK"'
anchor "a timeout -s KILL cap" flagged 'timeout -s KILL 5 cmd'
anchor "a timeout --signal= cap" flagged 'timeout --signal=KILL 5 cmd'
anchor "a gtimeout -k cap" flagged 'gtimeout -k 1 5 cmd'
anchor "a run_with_timeout call" clean 'run_with_timeout 2 node x'
anchor "a timeout_secs variable" clean 'local timeout_secs=5'
anchor "an OSS_HEALTH_CHECK_TIMEOUT setting" clean 'OSS_HEALTH_CHECK_TIMEOUT=1'
anchor "a --timeout-ms flag" clean 'node x --timeout-ms 500'
anchor "a comment naming timeout 20" clean '# timeout 20 in a comment'
# T55: an allowlist entry excuses its whole line exactly (indent aside), never a cap appended to it.
e="${ALLOW[0]}"
anchor "an allowlisted line as written" clean "    ${e#*|}" "${e%%|*}"
anchor "an allowlisted line with a perl alarm cap appended" flagged \
    "${e#*|}; perl -e 'alarm 20; exec @ARGV' bash \"\$HOOK\"" "${e%%|*}"
# T55: an entry is stale unless it is exactly one whole line of its file.
printf '#!/bin/bash\n    echo one\necho one\n  echo two three  \n' > "$A/x.test.sh"
staleness() { # staleness <name> <want: stale|in use> <entry under $A>
    local got="in use"; [[ -n "$(stale_entries "$A" "$3")" ]] && got=stale
    [[ $got == "$2" ]] && pass "anchor: $1 is $2" || fail "anchor: $1" "got $got, want $2"
}
staleness "an entry for its whole line" "in use" 'x.test.sh|echo two three'
staleness "an entry matching no line" stale 'x.test.sh|echo gone'
staleness "an entry matching only part of a line" stale 'x.test.sh|two three'
staleness "an entry matching two lines" stale 'x.test.sh|echo one'
staleness "an entry for a missing file" stale 'nope.test.sh|echo one'

# --- every allowlist entry still names a real line (a stale entry would excuse a future cap there) --------------
for e in "${ALLOW[@]}"; do
    p="${e%%|*}"
    if [[ -z "$(stale_entries "$ROOT" "$e")" ]]; then pass "allowlist entry in use: ${p##*/}: ${e#*|}"
    else fail "allowlist entry in use" "$e is not exactly one line of its file"; fi
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
