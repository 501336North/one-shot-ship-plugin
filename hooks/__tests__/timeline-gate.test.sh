#!/bin/bash
# Each ship gate adds one gate line to the feature timeline, built from value files only (radical-observability G2, B4a).
#
# @behavior During a ship round, the prompt writes round.txt, gate.txt, verdict.txt, findings.txt, fixed.txt and
#           mode.txt into the value folder (oss-value.sh dir) and runs `oss-value.sh timeline gate`. The feature's
#           timeline.ndjson gains one `gate` line with those values. Any value outside its rule adds nothing,
#           and every value file read is deleted, whether the values were accepted or refused.
# @business-rule AC-G2-002.1 and 002.2 (one gate line per gate, every value checked), P-1 (values reach the gate
#           verb only through value files), P-6 (a gate name is one of the four standard names or a quality-gate
#           agent name without its plugin prefix, as G3 ADR-005 reads it), the API's severity counts (critical,
#           high, medium, low, info, each 0..1000, any of them omitted).
# Usage: /bin/bash hooks/__tests__/timeline-gate.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OV="$ROOT/hooks/oss-value.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running timeline-gate tests..."

T=$(cd "$(mktemp -d /tmp/oss-timeline-gate.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME/.oss"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_PROJECT_DIR OSS_TL_SESSION
export CLAUDE_CODE_SESSION_ID=gate-sess-1

# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"   # the one time cap a test may use (T49)
API="$T/api-fake"; fake_api_install "$API"   # no config.json: nothing is sent, and any curl reaches only the fake
export PATH="$API/bin:$PATH"

# a product repo on feat/demo/build with the demo feature folder
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
TL="$P/.oss/dev/active/demo/timeline.ndjson"
export CLAUDE_PROJECT_DIR="$P"
D=$(cd "$P" && "$OV" dir 2>/dev/null)
[[ -d "$D" ]] || { echo "oss-value.sh dir printed no folder"; exit 1; }
FILES="round gate verdict findings fixed mode"

# put <round> <gate> <verdict> <findings> <fixed> <mode>: the six value files, as a prompt writes them
put() {
    local n i=1
    for n in $FILES; do printf '%s\n' "${!i}" > "$D/$n.txt"; i=$((i + 1)); done
}
# gate -> RC, ERR: the verb as a served prompt runs it
gate() { (cd "$P" && run_capped 20 "$OV" timeline gate > /dev/null 2> "$T/err"); RC=$?; ERR=$(cat "$T/err"); }
lines() { local c=0; [[ -f "$TL" ]] && c=$(wc -l < "$TL" | tr -d ' '); echo "$c"; }
last() { tail -n 1 "$TL" 2>/dev/null; }
left() { local n o=""; for n in $FILES; do [[ -e "$D/$n.txt" ]] && o="$o $n.txt"; done; echo "${o# }"; }
# refused <round> <gate> <verdict> <findings> <fixed> <mode>: rc != 0 and no new line
refused() { local before; before=$(lines); put "$@"; gate; [[ $RC -ne 0 && $(lines) -eq $before ]]; }
# accepted <...>: rc 0 and one new line
accepted() { local before; before=$(lines); put "$@"; gate; [[ $RC -eq 0 && $(lines) -eq $((before + 1)) ]]; }

# --- one line from the six files ----------------------------------------------------------------------------------
put 2 code-review fail 'critical=0 high=2 low=1' 'high=1' full
gate
got=$(last | jq -c '{kind, feature, session, round, gate, verdict, findings, fixed, mode}' 2>/dev/null)
keys=$(last | jq -c 'keys' 2>/dev/null)
[[ $RC -eq 0 && $(lines) -eq 1 \
    && "$got" == '{"kind":"gate","feature":"demo","session":"gate-sess-1","round":2,"gate":"code-review","verdict":"fail","findings":{"critical":0,"high":2,"low":1},"fixed":{"high":1},"mode":"full"}' \
    && "$keys" == '["feature","findings","fixed","gate","id","kind","mode","round","session","ts","v","verdict"]' ]] \
    && pass "should write one gate line from round.txt, gate.txt, verdict.txt, findings.txt, fixed.txt and mode.txt" \
    || fail "should write one gate line from round.txt, gate.txt, verdict.txt, findings.txt, fixed.txt and mode.txt" "rc=$RC got=$got keys=$keys err=$ERR"

# --- round, verdict and mode --------------------------------------------------------------------------------------
ok=1 bad=""
for r in 1 20; do accepted "$r" security pass '' '' quick || { ok=0; bad="$bad accepted-round=$r"; }; done
for m in full quick no-checks team; do accepted 1 security pass '' '' "$m" || { ok=0; bad="$bad accepted-mode=$m"; }; done
accepted 3 security pass '' '' full && [[ $(last | jq -r .verdict) == pass ]] || { ok=0; bad="$bad accepted-verdict=pass"; }
for r in 0 21 02 -1 1.5 'two' '' '1 2'; do refused "$r" security pass '' '' full || { ok=0; bad="$bad round=[$r]"; }; done
for v in PASS maybe '' 'pass fail' passed; do refused 1 security "$v" '' '' full || { ok=0; bad="$bad verdict=[$v]"; }; done
for m in FULL fast '' 'full quick' no_checks; do refused 1 security pass '' '' "$m" || { ok=0; bad="$bad mode=[$m]"; }; done
[[ $ok -eq 1 ]] && pass "should refuse a round outside 1..20, a verdict other than pass or fail, or a mode other than full, quick, no-checks or team" \
    || fail "should refuse a round outside 1..20, a verdict other than pass or fail, or a mode other than full, quick, no-checks or team" "$bad (err=$ERR)"

# --- P-6: gate names ----------------------------------------------------------------------------------------------
ok=1 bad=""
for g in security code-review performance pen-test accessibility-auditor; do
    accepted 1 "$g" pass '' '' full && [[ $(last | jq -r .gate) == "$g" ]] || { ok=0; bad="$bad accepted=$g"; }
done
for g in oss:code-reviewer Code-Review 'code review' code_review '' "$(printf 'a%.0s' {1..41})" '../x' 'pen-test;x'; do
    refused 1 "$g" pass '' '' full || { ok=0; bad="$bad gate=[$g]"; }
done
[[ $ok -eq 1 ]] && pass "should refuse a gate name that is neither one of security, code-review, performance or pen-test nor a quality-gate agent name without its prefix" \
    || fail "should refuse a gate name that is neither one of security, code-review, performance or pen-test nor a quality-gate agent name without its prefix" "$bad (err=$ERR)"

# --- severity counts ----------------------------------------------------------------------------------------------
ok=1 bad=""
accepted 1 security fail 'critical=0 high=2 medium=3 low=4 info=1000' 'info=0' full \
    && [[ $(last | jq -c '[.findings, .fixed]') == '[{"critical":0,"high":2,"medium":3,"low":4,"info":1000},{"info":0}]' ]] \
    || { ok=0; bad="$bad all-five"; }
accepted 1 security pass '' '' full && [[ $(last | jq -c '[.findings, .fixed]') == '[{},{}]' ]] || { ok=0; bad="$bad empty"; }
for c in 'high=1001' 'severe=1' 'high=1 high=2' 'high=-1' 'high=01' 'high=1  low=2' 'high=1,low=2' 'high=1 ' ' high=1' \
    'HIGH=1' 'high=' 'high' '=1' 'high=1 low=2 high=3'; do
    refused 1 security fail "$c" '' full || { ok=0; bad="$bad findings=[$c]"; }
    refused 1 security fail '' "$c" full || { ok=0; bad="$bad fixed=[$c]"; }
done
[[ $ok -eq 1 ]] && pass "should accept only critical, high, medium, low and info counts, each 0..1000" \
    || fail "should accept only critical, high, medium, low and info counts, each 0..1000" "$bad (err=$ERR)"

# --- the value files are gone afterwards --------------------------------------------------------------------------
ok=1 bad=""
put 1 security pass '' '' full; gate; l=$(left); [[ $RC -eq 0 && -z "$l" ]] || { ok=0; bad="$bad accepted-left=[$l]"; }
# a refusal in the first file read and in the last: every file is still deleted
put 0 security pass '' '' full; gate; l=$(left); [[ $RC -ne 0 && -z "$l" ]] || { ok=0; bad="$bad bad-round-left=[$l]"; }
put 1 security pass '' '' fast; gate; l=$(left); [[ $RC -ne 0 && -z "$l" ]] || { ok=0; bad="$bad bad-mode-left=[$l]"; }
# a missing file is refused, and the others are deleted too
put 1 security pass '' '' full; rm -f "$D/verdict.txt"; before=$(lines); gate; l=$(left)
[[ $RC -ne 0 && -z "$l" && $(lines) -eq $before ]] || { ok=0; bad="$bad missing-verdict rc=$RC left=[$l]"; }
[[ $ok -eq 1 ]] && pass "should delete every value file it read, whether it accepted or refused them" \
    || fail "should delete every value file it read, whether it accepted or refused them" "$bad"

# --- a value file older than 10 minutes is never reused ----------------------------------------------------------
# ago <seconds> <file>: sets the file's mtime that many seconds back (BSD date -r, else GNU date -d)
ago() {
    local t=$(($(date +%s) - $1)) s
    s=$(date -r "$t" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$t" +%Y%m%d%H%M.%S) && touch -t "$s" "$2"
}
ok=1 bad=""
for n in round mode; do   # the first file read and the last
    before=$(lines); put 1 security pass '' '' full; ago 660 "$D/$n.txt"; gate; l=$(left)
    [[ $RC -ne 0 && $(lines) -eq $before && -z "$l" ]] || { ok=0; bad="$bad stale-$n: rc=$RC left=[$l]"; }
done
before=$(lines); put 1 security pass '' '' full; for n in $FILES; do ago 540 "$D/$n.txt"; done; gate
[[ $RC -eq 0 && $(lines) -eq $((before + 1)) ]] || { ok=0; bad="$bad fresh-9-min: rc=$RC"; }
[[ $ok -eq 1 ]] && pass "should refuse a gate value file older than 10 minutes, and delete every file it read" \
    || fail "should refuse a gate value file older than 10 minutes, and delete every file it read" "$bad (err=$ERR)"

# --- the G3 gate-to-agent map -------------------------------------------------------------------------------------
# GATE_AGENTS, copied verbatim from AgenticDevWorkflow packages/web/app/dashboard/observability/lib/flags.ts at
# c6f64a6efce02f1c943dd084df5be1722afa1e2a (G3 ADR-005). G3 reads a gate line's `gate` through this table (any other
# gate is backed by the agent of the same name), so the names the verb accepts must be the names it lists.
G3_FLAGS_TABLE=$(cat << 'TS'
const GATE_AGENTS: Record<string, string[]> = {
  security: ['security-auditor'],
  'code-review': ['code-reviewer'],
  performance: ['performance-auditor', 'performance-engineer'],
  'pen-test': ['penetration-tester'],
};
TS
)
# the map this plugin's ship gates follow (PLAN.md Task 6), one "gate=agent agent" line per gate
want='security=security-auditor
code-review=code-reviewer
performance=performance-auditor performance-engineer
pen-test=penetration-tester'
have=$(printf '%s\n' "$G3_FLAGS_TABLE" | sed -n "s/^  '\{0,1\}\([a-z-]*\)'\{0,1\}: \[\(.*\)\],\$/\1=\2/p" | tr -d "'," )
ok=1 bad=""
[[ "$have" == "$want" ]] || { ok=0; bad="map differs: have=[$have]"; }
# every gate and every agent the map names is a name the verb accepts
for g in $(printf '%s\n' "$want" | tr '= ' '\n\n'); do
    accepted 1 "$g" pass '' '' full && [[ $(last | jq -r .gate) == "$g" ]] || { ok=0; bad="$bad not-accepted=$g"; }
done
[[ $ok -eq 1 ]] && pass "should pin the gate-to-agent map of G3 ADR-005" \
    || fail "should pin the gate-to-agent map of G3 ADR-005" "$bad (err=$ERR)"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
