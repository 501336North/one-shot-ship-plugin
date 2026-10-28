#!/bin/bash
# A person's answer to a workflow question is kept in the feature's committed record.
#
# @behavior During a ship, the person answers a question in the picker, changes their mind and is
#           asked the same question again. The feature folder then holds two record lines for that
#           question, in order (answer 1, then answer 2), both tagged as a risk call, each with the
#           question, the options, the recommended option and what the person picked. The person is
#           "unverified" until the API stamps the account (PR 3).
# @business-rule radical-observability G1 (ADR-001, ADR-003, US-001): every picker answer is
#           recorded by a hook, never by the agent; every answer to a question is kept (1:N); ship
#           answers are risk calls.
#
# The REAL hook from this checkout runs on a REAL captured PostToolUse payload, with a sandbox HOME.
# Usage: ./hooks/__tests__/decision-record.acceptance.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-decision-record.sh"
FIX="$ROOT/hooks/__tests__/fixtures/ask-user-question"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-decisions-acc.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID
export HOME="$T/home"; mkdir -p "$HOME/.oss"
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/ship)
printf '{"currentCommand":"ship"}\n' > "$P/.oss/workflow-state.json"
export CLAUDE_PROJECT_DIR="$P"

(cd "$P" && "$HOOK" < "$FIX/pick.json"); rc1=$?
(cd "$P" && "$HOOK" < "$FIX/pick.json"); rc2=$?
REC="$P/.oss/dev/active/demo/decisions.ndjson"

if [[ $rc1 -eq 0 && $rc2 -eq 0 && -f "$REC" ]] && [[ $(wc -l < "$REC") -eq 2 ]]; then
    pass "a question answered twice leaves two lines in the feature's record"
else
    fail "a question answered twice leaves two lines in the feature's record" "rc=$rc1/$rc2, file=$(cat "$REC" 2>/dev/null)"
fi

got=$(jq -sc '[.[] | {answerIndex, kind, choice, recommended, person: .person.status, feature, command}]' "$REC" 2>/dev/null)
want='[{"answerIndex":1,"kind":"risk","choice":"Banana","recommended":"Apple","person":"unverified","feature":"demo","command":"ship"},{"answerIndex":2,"kind":"risk","choice":"Banana","recommended":"Apple","person":"unverified","feature":"demo","command":"ship"}]'
[[ "$got" == "$want" ]] && pass "both answers are risk calls, in order, with the pick, the recommendation and an unverified person" \
    || fail "both answers are risk calls, in order, with the pick, the recommendation and an unverified person" "got $got"

keys=$(jq -s '[.[].questionKey] | unique | length' "$REC" 2>/dev/null)
q=$(jq -rs '.[0].question' "$REC" 2>/dev/null)
[[ "$keys" == 1 && "$q" == 'T0 probe 3 of 4 (throwaway): please pick "Banana" as is, without typing anything.' ]] \
    && pass "both lines belong to the same question, with its full wording" \
    || fail "both lines belong to the same question, with its full wording" "keys=$keys q=$q"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
