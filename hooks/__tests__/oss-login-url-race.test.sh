#!/bin/bash
# /oss:login saves the key next to the API URL it was checked against (T51, pen-test re-check N2).
#
# @behavior Login checks the key against the config's apiUrl (or the default when there is none) and saves it.
#           If apiUrl changes while the key is being checked (another process, or a crafted race), the saved
#           config still names the URL the key was checked against. A normal config with no apiUrl keeps no
#           apiUrl: only apiKey changes.
# @business-rule A key is only ever stored with the API it was validated against, so a later hook never sends a
#           production key to an unchecked host (or a dev key to production). Same class as T37.
# @boundary Sandbox HOME and cwd outside any repo. curl is a stub that rewrites the config's apiUrl while it
#           "validates" (the race), records its argv, and prints a canned "<body>\n200". The real jq writes the
#           config. No network, never the real ~/.oss.
#
# Usage: /bin/bash hooks/__tests__/oss-login-url-race.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/oss-login-url-race.test.sh  (mutants)
set -uo pipefail
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/run-capped.sh"   # the one time cap a test may use (T49)
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-login-url-race tests..."

REAL_JQ=$(command -v jq) || { echo "✗ FAIL: jq is required"; exit 1; }
# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "${T:?}"' EXIT
H="$T/home"; W="$T/w/cwd"; CFG="$H/.oss/config.json"; mkdir -p "$H/.oss/hooks" "$T/bin" "$W"
for f in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$f" "$H/.oss/hooks/"; done
DEFAULT_URL=https://one-shot-ship-api.onrender.com
# The curl stub: records its argv (one per line, then '--'), drains stdin (the key header; never stored), then,
# when $T/race.jq exists, rewrites config.json with that filter: the race between the check and the save.
cat > "$T/bin/curl" <<EOF
#!/bin/sh
for a in "\$@"; do printf '%s\n' "\$a"; done >> "$T/curl.argv"; echo -- >> "$T/curl.argv"
cat > /dev/null
if [ -f "$T/race.jq" ]; then "$REAL_JQ" -f "$T/race.jq" "$CFG" > "$CFG.race" && mv -f "$CFG.race" "$CFG"; fi
printf '{"plan":"pro"}\n200\n'
EOF
chmod +x "$T/bin/curl"

RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="ossk_Race-Key_$RND"

in_sandbox() { (cd "$W" && run_capped 20 env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w" HOME="$H" PATH="$T/bin:$PATH" "$@"); }
# login CONFIG_JSON RACE_FILTER: writes the config ("" = no file), arms the race ("" = none), runs /oss:login with
# $KEY in key.txt; sets RC, SAVED (the saved config, compact), CHECKED (the URL curl was called with).
login() {
    local d
    rm -f "$CFG" "$T/race.jq"; : > "$T/curl.argv"
    [[ -n "$1" ]] && printf '%s\n' "$1" > "$CFG"
    [[ -n "$2" ]] && printf '%s\n' "$2" > "$T/race.jq"
    d=$(in_sandbox "$SH" "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null)
    [[ -n "$d" ]] || { RC=99; SAVED='(oss-value.sh dir printed nothing)'; CHECKED=''; return; }
    printf '%s\n' "$KEY" > "$d/key.txt"
    in_sandbox "$SH" "$H/.oss/hooks/oss-login.sh" >/dev/null 2>"$T/login.err" </dev/null; RC=$?
    SAVED=$("$REAL_JQ" -c . "$CFG" 2>&1 | sed "s/$KEY/<KEY>/g")
    CHECKED=$(grep '/api/v1/subscription/status$' "$T/curl.argv" | sed 's#/api/v1/subscription/status$##')
}
key_not_in_argv() {
    if [[ -s "$T/curl.argv" ]] && ! grep -qF "$KEY" "$T/curl.argv"; then pass "$1: the key is in no curl command line"
    else fail "$1: the key is in no curl command line" "argv=$(sed "s/$KEY/<KEY>/g" "$T/curl.argv" | tr '\n' ' ')"; fi
}

# --- 1. apiUrl A is replaced by B while the key is checked against A: the key is saved with A ---
login '{"apiKey":"old","apiUrl":"https://checked.invalid","other":1}' '.apiUrl = "https://swapped.invalid"'
if [[ "$RC" == 0 && "$CHECKED" == https://checked.invalid \
      && "$SAVED" == '{"apiKey":"<KEY>","apiUrl":"https://checked.invalid","other":1}' ]]; then
    pass "apiUrl swapped during the check: the key is saved with the URL it was checked against"
else fail "apiUrl swapped during the check: saved with the checked URL" "rc=$RC checked=$CHECKED saved=$SAVED err=$(cat "$T/login.err")"; fi
key_not_in_argv "swapped"

# --- 2. No apiUrl (checked against the default); one is added during the check: the key is saved with the default ---
login '{"apiKey":"old","other":1}' '.apiUrl = "https://added.invalid"'
if [[ "$RC" == 0 && "$CHECKED" == "$DEFAULT_URL" \
      && "$SAVED" == "{\"apiKey\":\"<KEY>\",\"other\":1,\"apiUrl\":\"$DEFAULT_URL\"}" ]]; then
    pass "apiUrl added during the check: the key is saved with the default URL it was checked against"
else fail "apiUrl added during the check: saved with the default" "rc=$RC checked=$CHECKED saved=$SAVED err=$(cat "$T/login.err")"; fi
key_not_in_argv "added"

# --- 3. apiUrl A is removed during the check against A: the key is saved with A, not left to the default ---
login '{"apiKey":"old","apiUrl":"https://checked.invalid"}' 'del(.apiUrl)'
if [[ "$RC" == 0 && "$CHECKED" == https://checked.invalid \
      && "$SAVED" == '{"apiKey":"<KEY>","apiUrl":"https://checked.invalid"}' ]]; then
    pass "apiUrl removed during the check: the key is saved with the URL it was checked against"
else fail "apiUrl removed during the check: saved with the checked URL" "rc=$RC checked=$CHECKED saved=$SAVED err=$(cat "$T/login.err")"; fi
key_not_in_argv "removed"

# --- 4. No race, a customer's normal config with no apiUrl: only apiKey changes, no apiUrl is added ---
login '{"apiKey":"old","other":1,"nested":{"a":[1,"two"]}}' ''
if [[ "$RC" == 0 && "$CHECKED" == "$DEFAULT_URL" \
      && "$SAVED" == '{"apiKey":"<KEY>","other":1,"nested":{"a":[1,"two"]}}' ]]; then
    pass "normal config without apiUrl: only apiKey changes (the default URL is not pinned into it)"
else fail "normal config without apiUrl: only apiKey changes" "rc=$RC checked=$CHECKED saved=$SAVED err=$(cat "$T/login.err")"; fi
key_not_in_argv "normal"

# --- 5. No race, apiUrl null: it stays null (null means the default, which the key was checked against) ---
login '{"apiKey":"old","apiUrl":null}' ''
if [[ "$RC" == 0 && "$CHECKED" == "$DEFAULT_URL" && "$SAVED" == '{"apiKey":"<KEY>","apiUrl":null}' ]]; then
    pass "apiUrl null: only apiKey changes"
else fail "apiUrl null: only apiKey changes" "rc=$RC checked=$CHECKED saved=$SAVED err=$(cat "$T/login.err")"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
