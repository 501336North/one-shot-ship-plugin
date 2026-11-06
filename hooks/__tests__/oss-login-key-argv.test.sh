#!/bin/bash
# /oss:login writes the new API key into the config file without ever putting it on a command line.
#
# @behavior After a successful login the key is saved in config.json (a new file, or an existing one with
#           its other settings kept), and no process login starts to write it carries the key in its argv.
# @business-rule The API key never appears in a process command line: any local user can read argv with
#           `ps`. curl already gets it on stdin (oss_api_curl); the config write hands it to jq on stdin
#           too (security round 3, F3).
# @boundary Sandbox HOME and cwd outside any repo. curl is a stub that prints a canned "<body>\n200".
#           jq is a recording shim first on PATH: it appends its argv to a log, then execs the real jq,
#           so the config is really written by jq. No network, never the real ~/.oss.
#
# Usage: ./hooks/__tests__/oss-login-key-argv.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-login-key-argv.test.sh  (mutants)
set -uo pipefail
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

REAL_JQ=$(command -v jq) || { echo "✗ FAIL: jq is required"; exit 1; }
# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT
H="$T/home"; W="$T/w/cwd"; mkdir -p "$H/.oss/hooks" "$T/bin" "$W"
for f in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$f" "$H/.oss/hooks/"; done
printf '#!/bin/sh\ncat "%s/curl.out"\n' "$T" > "$T/bin/curl"; chmod +x "$T/bin/curl"
printf '{"plan":"pro"}\n200\n' > "$T/curl.out"
# The recording jq: one argument per line, then '--' per call; then the real jq with the same argv.
printf '#!/bin/sh\nfor a in "$@"; do printf "%%s\\n" "$a"; done >> "%s/jq.argv"\necho -- >> "%s/jq.argv"\nexec "%s" "$@"\n' \
    "$T" "$T" "$REAL_JQ" > "$T/bin/jq"
chmod +x "$T/bin/jq"

# A key in the key rule's alphabet ([A-Za-z0-9_-]), with a random tail so a match can only be this run's key.
RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="ossk_Argv-Key_$RND"

in_sandbox() { (cd "$W" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w" HOME="$H" PATH="$T/bin:$PATH" "$@"); }
# login: key.txt holds $KEY, the API accepts it; sets OUT, RC. The jq argv log starts empty.
login() {
    local d; d=$(in_sandbox "$SH" "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null)
    [[ -n "$d" ]] || { OUT="(oss-value.sh dir printed nothing)"; RC=99; return; }
    printf '%s\n' "$KEY" > "$d/key.txt"
    : > "$T/jq.argv"
    OUT=$(in_sandbox "$SH" "$H/.oss/hooks/oss-login.sh" 2>"$T/login.err" </dev/null); RC=$?
}
argv_shown() { sed "s/$KEY/<KEY>/g" "$T/jq.argv" | tr '\n' ' '; }
ends_in_newline() { [[ "$(tail -c 1 "$1" | od -An -tx1 | tr -d ' ')" == 0a ]]; }

# --- 1. No config yet: login builds a new one ---
rm -f "$H/.oss/config.json"
login
if [[ "$RC" == 0 && "$OUT" == "Plan: pro" ]] && grep -q apiKey "$T/jq.argv"; then
    pass "new config: login succeeds and its config write went through jq (the argv check is not vacuous)"
else fail "new config: login succeeds and writes the config with jq" "rc=$RC out='$OUT' err=$(sed "s/$KEY/<KEY>/g" "$T/login.err") argv=$(argv_shown)"; fi
if ! grep -qF "$KEY" "$T/jq.argv"; then pass "new config: the key is in no jq command line"
else fail "new config: the key is in no jq command line" "argv=$(argv_shown)"; fi
if [[ "$("$REAL_JQ" -c . "$H/.oss/config.json" 2>/dev/null)" == "{\"apiKey\":\"$KEY\",\"apiUrl\":\"https://one-shot-ship-api.onrender.com\"}" ]] \
   && ends_in_newline "$H/.oss/config.json"; then
    pass "new config: config.json parses and holds exactly the key and the API URL, ending in a newline"
else fail "new config: config.json holds the key unchanged" "cfg=$(sed "s/$KEY/<KEY>/g" "$H/.oss/config.json" 2>&1)"; fi

# --- 2. An existing config: the key is replaced, every other setting kept ---
# A fresh file, world-readable (644), so "written 600" below is proven by the write, not by case 1's file mode.
rm -f "$H/.oss/config.json"
printf '{"apiKey":"old-key-unused","apiUrl":"https://x.invalid","other":1,"nested":{"a":[1,"two"]}}\n' > "$H/.oss/config.json"
chmod 644 "$H/.oss/config.json"
login
if [[ "$RC" == 0 && "$OUT" == "Plan: pro" ]] && grep -q apiKey "$T/jq.argv"; then
    pass "existing config: login succeeds and its config write went through jq (the argv check is not vacuous)"
else fail "existing config: login succeeds and writes the config with jq" "rc=$RC out='$OUT' err=$(sed "s/$KEY/<KEY>/g" "$T/login.err") argv=$(argv_shown)"; fi
if ! grep -qF "$KEY" "$T/jq.argv"; then pass "existing config: the key is in no jq command line"
else fail "existing config: the key is in no jq command line" "argv=$(argv_shown)"; fi
if [[ "$("$REAL_JQ" -c . "$H/.oss/config.json" 2>/dev/null)" == "{\"apiKey\":\"$KEY\",\"apiUrl\":\"https://x.invalid\",\"other\":1,\"nested\":{\"a\":[1,\"two\"]}}" ]] \
   && ends_in_newline "$H/.oss/config.json"; then
    pass "existing config: config.json parses, holds the key unchanged, keeps every other setting, ends in a newline"
else fail "existing config: key saved unchanged, other settings kept" "cfg=$(sed "s/$KEY/<KEY>/g" "$H/.oss/config.json" 2>&1)"; fi
if [[ "$(stat -c %a "$H/.oss/config.json" 2>/dev/null || stat -f %Lp "$H/.oss/config.json")" == 600 && -z "$(ls -A "$H/.oss" | grep '^config\.json\.')" ]]; then
    pass "existing config: written owner-only (600) through a temp file that is gone afterwards"
else fail "existing config: mode 600, no temp file left" "mode=$(stat -c %a "$H/.oss/config.json" 2>/dev/null || stat -f %Lp "$H/.oss/config.json" 2>&1) files=$(ls -A "$H/.oss" | tr '\n' ' ')"; fi

# --- 3. The write replaces the file (temp file + rename), never rewrites it in place ---
# config.json is a hard link to an outside file: an in-place write (`> config.json`) changes the outside file
# too, and a reader could see a half-written config; a rename leaves the outside file as it was.
printf '{"apiKey":"linked-old-key","apiUrl":"https://x.invalid"}\n' > "$T/outside.json"
rm -f "$H/.oss/config.json"; ln "$T/outside.json" "$H/.oss/config.json"
login
if [[ "$RC" == 0 && "$(cat "$T/outside.json")" == '{"apiKey":"linked-old-key","apiUrl":"https://x.invalid"}' ]] \
   && [[ "$("$REAL_JQ" -r .apiKey "$H/.oss/config.json" 2>/dev/null)" == "$KEY" ]]; then
    pass "linked config: the new config replaced the file by rename; the outside file it was linked to is unchanged"
else fail "linked config: written by rename, not in place" "rc=$RC outside=$(sed "s/$KEY/<KEY>/g" "$T/outside.json") cfg=$(sed "s/$KEY/<KEY>/g" "$H/.oss/config.json" 2>&1)"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
