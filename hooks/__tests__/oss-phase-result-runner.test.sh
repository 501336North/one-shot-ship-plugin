#!/bin/bash
# The phase-result gate passes only on exit 0 with verified JSON, and its runner keeps the real exit code (R-257 T9a).
#
# @behavior `/oss:<phase> complete` lets a phase through only when the result CLI exits 0 AND prints JSON whose
#           `verification` is `verified`. A timeout, a missing CLI, a crash, empty or non-JSON output, or an
#           `unverified` result is refused, and the refusal names its reason class on stderr.
# @business-rule F1/F3/S5: a hung or missing checker must never count as a pass. `run_with_timeout` swallows the
#           exit code (`|| true`), so the gate uses its own bounded runner that returns it (124 on timeout).
#
# Usage: /bin/bash hooks/__tests__/oss-phase-result-runner.test.sh   (bash 3.2)
#        bash hooks/__tests__/oss-phase-result-runner.test.sh        (bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$ROOT/hooks}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-phase-result-runner tests under bash $BASH_VERSION..."

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# shellcheck source=/dev/null
if ! source "$HOOKS/oss-phase-result.sh" 2>"$T/source.err"; then
    fail "the script is sourceable" "$(head -2 "$T/source.err" | tr '\n' '|')"
fi
if declare -F oss_run_bounded_rc >/dev/null && declare -F oss_phase_gate_ok >/dev/null; then
    pass "sourcing defines oss_run_bounded_rc and oss_phase_gate_ok"
else
    fail "sourcing defines oss_run_bounded_rc and oss_phase_gate_ok" "functions missing"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi

# gate_case <label> <rc> <stdout> <want ok|refused> [<reason>]
gate_case() {
    local label="$1" rc="$2" out="$3" want="$4" reason="${5:-}" got
    if oss_phase_gate_ok "$rc" "$out" 2>"$T/gate.err"; then got=ok; else got=refused; fi
    if [[ "$got" != "$want" ]]; then
        fail "$label" "want $want, got $got"
    elif [[ -n "$reason" ]] && ! grep -q "$reason" "$T/gate.err"; then
        fail "$label" "reason should name $reason, stderr: $(tr '\n' '|' <"$T/gate.err")"
    else
        pass "$label"
    fi
}

VERIFIED='{"verification":"verified","phase":"build"}'
gate_case "exit 0 with verified JSON passes the gate" 0 "$VERIFIED" ok
gate_case "exit 0 with unverified JSON is refused" 0 '{"verification":"unverified"}' refused not_verified
for rc in 2 124 125 127 137; do
    gate_case "exit $rc is refused even with verified JSON on stdout" "$rc" "$VERIFIED" refused
done
gate_case "exit 124 names timeout" 124 "" refused timeout
gate_case "exit 127 names cli_missing" 127 "" refused cli_missing
gate_case "exit 2 names exit_2" 2 "" refused exit_2
gate_case "empty output is refused" 0 "" refused no_output
gate_case "non-JSON output is refused" 0 "verified" refused not_verified

# No jq on PATH: refused even for verified JSON.
mkdir -p "$T/nojq"
if (PATH="$T/nojq"; oss_phase_gate_ok 0 "$VERIFIED") 2>/dev/null; then
    fail "without jq the gate refuses" "passed"
else pass "without jq the gate refuses"; fi

# Runner: real exit code and intact stdout.
oss_run_bounded_rc 5 /bin/sh -c 'printf "line one\n{\"a\": 1}\n"; exit 3'; rc=$?
[[ $rc -eq 3 ]] && pass "the runner keeps exit code 3" || fail "the runner keeps exit code 3" "rc=$rc"
want=$'line one\n{"a": 1}'
[[ "$OSS_BOUNDED_OUT" == "$want" ]] && pass "the runner captures stdout intact" \
    || fail "the runner captures stdout intact" "got: $OSS_BOUNDED_OUT"

oss_run_bounded_rc 5 /bin/sh -c 'printf "%s" "{\"verification\":\"verified\"}"'; rc=$?
if [[ $rc -eq 0 ]] && oss_phase_gate_ok "$rc" "$OSS_BOUNDED_OUT" 2>/dev/null; then
    pass "a CLI printing verified JSON and exiting 0 passes end to end"
else fail "a CLI printing verified JSON and exiting 0 passes end to end" "rc=$rc out=$OSS_BOUNDED_OUT"; fi

# Missing command: 127 and cli_missing.
oss_run_bounded_rc 5 "$T/no-such-cli" 2>/dev/null; rc=$?
[[ $rc -eq 127 ]] && pass "a missing command gives 127" || fail "a missing command gives 127" "rc=$rc"
gate_case "a missing command's result names cli_missing" "$rc" "$OSS_BOUNDED_OUT" refused cli_missing

# A fake CLI that sleeps 10 s, bounded at 1 s: 124 within about 3 s, and its child is gone too.
cat >"$T/slow-cli" <<EOF
#!/bin/sh
sleep 10 &
echo \$! >"$T/child.pid"
wait
EOF
chmod +x "$T/slow-cli"
start=$(/usr/bin/perl -MTime::HiRes=time -e 'printf "%d", time*1000')
# Run through /bin/sh: macOS scans a freshly written executable on its first exec, which can take most of the 1 s
# bound before the script records its child (seen as a flaky "pid not recorded").
oss_run_bounded_rc 1 /bin/sh "$T/slow-cli"; rc=$?
end=$(/usr/bin/perl -MTime::HiRes=time -e 'printf "%d", time*1000')
ms=$((end - start))
[[ $rc -eq 124 ]] && pass "a CLI past its bound gives 124" || fail "a CLI past its bound gives 124" "rc=$rc"
[[ $ms -le 8000 ]] && pass "the bound fires well before the 10 s child ends (${ms} ms)" \
    || fail "the bound fires well before the 10 s child ends" "${ms} ms"
gate_case "a timed-out CLI is refused naming timeout" "$rc" "$OSS_BOUNDED_OUT" refused timeout
child=$(cat "$T/child.pid" 2>/dev/null)
if [[ -n "$child" ]] && ! kill -0 "$child" 2>/dev/null; then
    pass "the timed-out CLI's own child is killed too"
else
    [[ -n "$child" ]] && kill -KILL "$child" 2>/dev/null
    fail "the timed-out CLI's own child is killed too" "child pid '${child}' still alive or not recorded"
fi

# Running the script directly prints usage and exits 2.
"$BASH" "$HOOKS/oss-phase-result.sh" >"$T/main.out" 2>&1; rc=$?
[[ $rc -eq 2 ]] && grep -qi usage "$T/main.out" && pass "running the script with no verb prints usage and exits 2" \
    || fail "running the script with no verb prints usage and exits 2" "rc=$rc"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
