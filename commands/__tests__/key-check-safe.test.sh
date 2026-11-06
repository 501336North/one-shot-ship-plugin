#!/bin/bash
# The Step 1 "is an API key configured?" line of the shipped prompts is safe to run (T74, security S5).
#
# Usage: /bin/bash commands/__tests__/key-check-safe.test.sh
#        PLUGIN_UNDER_TEST=/path/to/plugin-copy /bin/bash commands/__tests__/key-check-safe.test.sh  (mutants)
#
# @behavior A customer runs any /oss command, skill or agent; its Step 1 says "API key configured" only when
#           ~/.oss/config.json holds a non-empty apiKey string, says nothing otherwise, never prints the key, and
#           never hangs, even when config.json is a FIFO (or a link to one).
# @business-rule An empty or null apiKey is "not configured", as the login and decrypt steps treat it.
# @business-rule Every prompt runs the same one line, so this test runs that line as the prompts ship it.
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PLUGIN_UNDER_TEST:-$(cd "$HERE/../.." && pwd)}"
# shellcheck source=../../hooks/__tests__/lib/run-capped.sh
source "$HERE/../../hooks/__tests__/lib/run-capped.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T=$(mktemp -d); T=$(cd "$T" && pwd -P); trap 'rm -rf "$T"' EXIT
KEY="ossk_T74_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"

# The key-check lines: every prompt line that ends with echo "API key configured" (bash blocks, any indent).
(cd "$ROOT" && grep -hE '^[[:space:]]*[^-[:space:]].*&& echo "API key configured"$' commands/*.md agents/*.md skills/*.md) \
    | sed 's/^[[:space:]]*//' | sort | uniq -c > "$T/lines"
NFILES=$(cd "$ROOT" && grep -lE '&& echo "API key configured"$' commands/*.md agents/*.md skills/*.md | wc -l | tr -d ' ')
LINE=$(sed 's/^ *[0-9]* //' "$T/lines" | head -1)
[[ $(wc -l < "$T/lines" | tr -d ' ') == 1 && $NFILES -ge 150 ]] \
    && pass "every prompt ($NFILES files) runs the same one key-check line" \
    || fail "every prompt runs the same one key-check line" "files=$NFILES variants: $(tr '\n' '|' < "$T/lines")"

# check <name> : run the line with HOME=$T/home under a 10 s cap -> RC, OUT, ERR
check() {
    OUT=$(cd "$T" && run_capped 10 env -i HOME="$T/home" PATH=/usr/bin:/bin /bin/bash -c "$LINE" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
cfg() { rm -rf "$T/home"; mkdir -p "$T/home/.oss"; [[ $# -gt 0 ]] && printf '%s\n' "$1" > "$T/home/.oss/config.json"; return 0; }
says_configured() { [[ "$OUT" == "API key configured" && "$OUT" != *"$KEY"* && "$ERR" != *"$KEY"* ]]; }
says_nothing() { [[ $RC != 124 && $RC != 125 && -z "$OUT" && -z "$ERR" ]]; }

cfg "{\"apiKey\":\"$KEY\",\"apiUrl\":\"https://x.example\"}"; check
says_configured && pass "a key: 'API key configured', the key never printed" || fail "a key: 'API key configured'" "rc=$RC out=$OUT err=$ERR"
cfg "$(printf '{\n  "apiUrl": "https://x.example",\n  "apiKey" : "%s"\n}' "$KEY")"; check
says_configured && pass "a pretty-printed config with a key: 'API key configured'" || fail "a pretty-printed config with a key" "rc=$RC out=$OUT err=$ERR"
for v in '""' 'null' '" "' '"\n"'; do
    cfg "{\"apiKey\": $v, \"apiUrl\":\"https://x.example\"}"; check
    says_nothing && pass "apiKey $v counts as not configured: nothing printed" || fail "apiKey $v counts as not configured" "rc=$RC out=$OUT err=$ERR"
done
cfg '{"apiUrl":"https://x.example","apiKeys":{"openrouter":"sk-or-x"}}'; check
says_nothing && pass "no apiKey (only apiKeys): nothing printed" || fail "no apiKey (only apiKeys)" "rc=$RC out=$OUT err=$ERR"
cfg; check
says_nothing && pass "no config.json: nothing printed, no error" || fail "no config.json: nothing printed, no error" "rc=$RC out=$OUT err=$ERR"
cfg; mkfifo "$T/home/.oss/config.json"; check
says_nothing && pass "config.json is a FIFO: no hang, nothing printed" || fail "config.json is a FIFO: no hang (124/125 = hung)" "rc=$RC out=$OUT err=$ERR"
cfg; mkfifo "$T/fifo"; ln -s "$T/fifo" "$T/home/.oss/config.json"; check
says_nothing && pass "config.json is a link to a FIFO: no hang, nothing printed" || fail "config.json is a link to a FIFO: no hang" "rc=$RC out=$OUT err=$ERR"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
