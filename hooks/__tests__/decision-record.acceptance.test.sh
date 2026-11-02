#!/bin/bash
# A person's answer to a workflow question is kept in the feature's committed record.
#
# @behavior During a ship, the person answers a question in the picker, changes their mind and is
#           asked the same question again. The feature folder then holds two record lines for that
#           question, in order (answer 1, then answer 2), both tagged as a risk call, each with the
#           question, the options, the recommended option and what the person picked. The person is
#           "unverified" in the line itself; once the OSS API has stored an answer (redacted: a token in the
#           person's note never leaves the machine), the person's private outbox marks it verified with
#           the account; the committed record never gains a line for that.
# @business-rule radical-observability G1 (ADR-001, ADR-003, US-001): every picker answer is
#           recorded by a hook, never by the agent; every answer to a question is kept (1:N); ship
#           answers are risk calls; the API, not the hook, says who answered (PR 3, Task 13).
#
# The REAL hook from this checkout runs on a REAL captured PostToolUse payload, with a sandbox HOME
# whose OSS config points at a fake API (a `curl` first on PATH: hooks/__tests__/fake-oss-api.sh).
# Usage: ./hooks/__tests__/decision-record.acceptance.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API (fake-oss-api.sh) stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
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
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
API="$T/api"; fake_api_install "$API"; export PATH="$API/bin:$PATH"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' 'fake-oss-key-acceptance-0000' > "$HOME/.oss/config.json"
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/ship)
printf '{"currentCommand":"ship"}\n' > "$P/.oss/workflow-state.json"
export CLAUDE_PROJECT_DIR="$P"

# the person adds a note holding a (fake, built from parts) GitHub token: it must never reach the API
tok="gh""p_$(printf 'Zq9Xw8Vu%.0s' 1 2 3 4 5)"
jq --arg t "$tok" '.tool_response.annotations[.tool_response.questions[0].question] = {notes: ("token " + $t)}' "$FIX/pick.json" > "$T/pick.json"
(cd "$P" && "$HOOK" < "$T/pick.json"); rc1=$?
(cd "$P" && "$HOOK" < "$T/pick.json"); rc2=$?
REC="$P/.oss/dev/active/demo/decisions.ndjson"
answers() { jq -c 'select(.questionKey)' "$REC" 2>/dev/null; }

if [[ $rc1 -eq 0 && $rc2 -eq 0 && -f "$REC" ]] && [[ $(answers | wc -l) -eq 2 ]]; then
    pass "a question answered twice leaves two answer lines in the feature's record"
else
    fail "a question answered twice leaves two answer lines in the feature's record" "rc=$rc1/$rc2, file=$(sed "s/$tok/<TOKEN>/g" "$REC" 2>/dev/null)"
fi

got=$(answers | jq -sc '[.[] | {answerIndex, kind, choice, recommended, person: .person.status, feature, command}]' 2>/dev/null)
want='[{"answerIndex":1,"kind":"risk","choice":"Banana","recommended":"Apple","person":"unverified","feature":"demo","command":"ship"},{"answerIndex":2,"kind":"risk","choice":"Banana","recommended":"Apple","person":"unverified","feature":"demo","command":"ship"}]'
[[ "$got" == "$want" ]] && pass "both answers are risk calls, in order, with the pick, the recommendation and an unverified person" \
    || fail "both answers are risk calls, in order, with the pick, the recommendation and an unverified person" "got $got"

keys=$(answers | jq -s '[.[].questionKey] | unique | length' 2>/dev/null)
q=$(answers | jq -rs '.[0].question' 2>/dev/null)
[[ "$keys" == 1 && "$q" == 'T0 probe 3 of 4 (throwaway): please pick "Banana" as is, without typing anything.' ]] \
    && pass "both lines belong to the same question, with its full wording" \
    || fail "both lines belong to the same question, with its full wording" "keys=$keys q=$q"

# Task 13 / 15b: the API stored both answers; each is verified in the person's private outbox (outside the
# repo) with the account the API stamped, and the committed record gains no line for it
ids=$(answers | jq -sc '[.[].id]')
OB=$(ls "$HOME"/.oss/decisions-outbox/*.ndjson 2>/dev/null | head -n 1)
got=$(jq -sc '[.[] | select(.state == "verified") | {id, account}]' "$OB" 2>/dev/null)
want=$(jq -nc --argjson ids "$ids" '[$ids[] | {id: ., account: "acct-fake-1"}]')
[[ "$got" == "$want" && $(wc -l < "$REC") -eq 2 ]] && pass "both answers are verified in the outbox, each naming the account the API stamped" \
    || fail "both answers are verified in the outbox, each naming the account the API stamped" "verified=$got want=$want record-lines=$(wc -l < "$REC")"

sent=$(cat "$API"/api/body.* 2>/dev/null | jq -sc '[.[] | {id, notes}]')
want=$(jq -nc --argjson ids "$ids" '[$ids[] | {id: ., notes: "token [REDACTED]"}]')
[[ "$sent" == "$want" ]] && ! cat "$API"/api/body.* 2>/dev/null | grep -q "$tok" \
    && pass "the API received each answer once, redacted: the token in the note never left the machine" \
    || fail "the API received each answer once, redacted: the token in the note never left the machine" "sent=$(printf '%s' "$sent" | sed "s/$tok/<TOKEN>/g")"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
