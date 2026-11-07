#!/bin/bash
# The hooks' shared helpers have one source of truth: the time-limit supervisor, the network body cap and the
# decision hooks' keyed API call (T81, code-review L4 and I7).
#
# @behavior A fix to the stock-macOS time limit, to the body cap or to the decision hooks' API call reaches every
#           hook that uses it, so no hook is left with an older, weaker copy.
# @business-rule T81 (user 2026-11-05 "Dedupe now with a match test"):
#   - The perl supervisor stays inline in oss-session-start.sh (run_bounded), oss-notify.sh (run_with_timeout) and
#     oss-timeline.sh (oss_tl_bounded): it IS the time limit, and a sourced copy that is missing or stale mid-update
#     would leave a hook with no limit. So the three programs must be byte-identical, and the supervisor reads no
#     environment variable (no test seam in shipped code; bounded-hook-killed.test.sh observes it from outside).
#     The third copy (G2 P-9, 2026-11-06): the timeline merge verb must bound its `gh pr view` call at 10 s, and
#     neither of the first two hooks can be sourced, so T81's inline rule gives it its own copy, held identical here.
#   - Every network body a hook reads is capped by oss_capped (oss-api-curl.sh), one slack rule: no hook has a
#     head -c byte stop of its own, and every --max-filesize is "$OSS_BODY_MAX" inside an oss_capped call. The
#     binary downloads (ensure-*.sh, 256 MiB, written to a file) and the login icon (commands/login.md, 1 MiB)
#     have their own limits and are not API bodies.
#   - The decision hooks make their keyed API call through oss_ask (oss-api-curl.sh), with no copy of their own.
#
# Usage: /bin/bash hooks/__tests__/one-copy-helpers.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/one-copy-helpers.test.sh  (drifted copies)
set -uo pipefail
# This file only reads the hooks; the unset keeps it consistent with tests-hermetic-env (T29).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$ROOT/hooks}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running one-copy-helpers tests..."

# --- the perl supervisor -------------------------------------------------------------------------------------------
# supervisor <hook> <function>: the perl program (the lines between `/usr/bin/perl -e '` and its closing quote) in
# that function of that hook
supervisor() {
    sed -n "/^$2() {/,/^}/p" "$HOOKS/$1" | awk '/^ *\/usr\/bin\/perl -e .$/ { f = 1; next } f && /^ *. "\$/ { exit } f'
}
A=$(supervisor oss-session-start.sh run_bounded); B=$(supervisor oss-notify.sh run_with_timeout)
C=$(supervisor oss-timeline.sh oss_tl_bounded)
for v in "oss-session-start.sh run_bounded|$A" "oss-notify.sh run_with_timeout|$B" "oss-timeline.sh oss_tl_bounded|$C"; do
    [[ "${v#*|}" == *'waitpid($p, 1)'* && "${v#*|}" == *'kill "KILL", -$p'* ]] && pass "${v%%|*}: the supervisor is found (anchor)" \
        || fail "${v%%|*}: the supervisor is found (anchor)" "got $(printf '%s' "${v#*|}" | wc -l | tr -d ' ') lines"
done
if [[ -n "$A" && "$A" == "$B" && "$A" == "$C" ]]; then pass "the three supervisors are byte-identical ($(printf '%s\n' "$A" | wc -l | tr -d ' ') lines)"
else fail "the three supervisors are byte-identical" "notify: $(diff <(printf '%s\n' "$A") <(printf '%s\n' "$B") | head -3 | tr '\n' '|') timeline: $(diff <(printf '%s\n' "$A") <(printf '%s\n' "$C") | head -3 | tr '\n' '|')"; fi
[[ -n "$A$B$C" && "$A$B$C" != *'$ENV'* && "$A$B$C" != *'%ENV'* ]] && pass "the supervisor reads no environment variable (no test seam)" \
    || fail "the supervisor reads no environment variable (no test seam)" "$(printf '%s\n%s\n%s\n' "$A" "$B" "$C" | grep -n 'ENV' | head -2 | tr '\n' '|')"
seam=$(grep -l 'OSS_TEST_BOUND_TRACE' "$HOOKS"/*.sh 2>/dev/null | tr '\n' ' ')
[[ -z "$seam" ]] && pass "no hook reads OSS_TEST_BOUND_TRACE" || fail "no hook reads OSS_TEST_BOUND_TRACE" "in: $seam"

# --- the body cap --------------------------------------------------------------------------------------------------
# code <file>: its lines, comments dropped
code() { grep -v '^[[:space:]]*#' "$1"; }
own=""; loose=""; uncapped=""
for f in "$HOOKS"/*.sh; do
    n=${f##*/}
    case "$n" in oss-api-curl.sh | ensure-*.sh) continue ;; esac   # oss_capped itself; binary downloads
    code "$f" | grep -qE 'head -c +"?\$\(\(' && own="$own $n"
    code "$f" | grep -oE -- '--max-filesize +[^ ]+' | grep -vqx -- '--max-filesize "\$OSS_BODY_MAX"' && loose="$loose $n"
    m=$(code "$f" | grep -c -- '--max-filesize'); c=$(code "$f" | grep -c 'oss_capped ')
    (( c >= m )) || uncapped="$uncapped $n($c of $m)"
done
[[ -z "$own" ]] && pass "no hook stops a body with a head -c of its own (oss_capped does)" \
    || fail "no hook stops a body with a head -c of its own (oss_capped does)" "in:$own"
[[ -z "$loose" ]] && pass "every hook's --max-filesize is \"\$OSS_BODY_MAX\"" || fail "every hook's --max-filesize is \"\$OSS_BODY_MAX\"" "in:$loose"
[[ -z "$uncapped" ]] && pass "every hook's --max-filesize call goes through oss_capped" \
    || fail "every hook's --max-filesize call goes through oss_capped" "oss_capped calls of --max-filesize lines:$uncapped"
# Anchor: the scan sees the hooks that do cap (a renamed option or glob would make the rows above vacuous).
k=$(cat "$HOOKS"/*.sh 2>/dev/null | grep -v '^[[:space:]]*#' | grep -c -- '--max-filesize "\$OSS_BODY_MAX"')
(( k >= 10 )) && pass "the scan sees the capped calls ($k) (anchor)" || fail "the scan sees the capped calls (anchor)" "found $k"

# --- the decision hooks' API call ----------------------------------------------------------------------------------
for n in oss-decision-record.sh oss-decisions-policy.sh; do
    if code "$HOOKS/$n" | grep -q 'oss_ask ' && ! code "$HOOKS/$n" | grep -q 'oss_capped '; then
        pass "$n: calls the API through oss_ask, no copy of its own"
    else fail "$n: calls the API through oss_ask, no copy of its own" \
        "oss_ask=$(code "$HOOKS/$n" | grep -c 'oss_ask ') oss_capped=$(code "$HOOKS/$n" | grep -c 'oss_capped ')"; fi
done
grep -q '^oss_ask() {' "$HOOKS/oss-api-curl.sh" && pass "oss_ask is defined once, in oss-api-curl.sh" \
    || fail "oss_ask is defined once, in oss-api-curl.sh" "no oss_ask() in oss-api-curl.sh"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
