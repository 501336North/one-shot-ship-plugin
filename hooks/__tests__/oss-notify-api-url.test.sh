#!/bin/bash
# oss-notify.sh --workflow <cmd> start sends the API key only to an apiUrl the CLI would accept.
#
# @behavior The start event's best-effort analytics call (Bearer key) goes to <apiUrl>/api/v1/analytics/track
#           only when apiUrl is https, or plain http to 127.0.0.1/localhost/[::1] with OSS_ALLOW_HTTP_LOOPBACK=1,
#           and has no ? or #.
#           Any other apiUrl: no request at all. No apiUrl (with or without jq): the default API.
# @business-rule The API key never travels in cleartext or to a different path than the one we build.
#           Same rule as getApiUrl in packages/cli-decrypt/src/config.ts.
#
# Usage: ./hooks/__tests__/oss-notify-api-url.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-notify-api-url.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-notify-api-url.test.sh   (mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="${HOOKS_UNDER_TEST:-$ROOT/hooks}/oss-notify.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notify-api-url tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

DEFAULT_TRACK="https://one-shot-ship-api.onrender.com/api/v1/analytics/track"

# Stubs made and warmed once (macOS scans each new executable on its first exec): a fake plugin
# root, fake node, and a fake curl that records its arguments and the config it reads on stdin
# (where oss_api_curl puts the Authorization header) into the current case's dir, $SHIM.
KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
mkdir -p "$KS/plugin/watcher/dist/cli"
: > "$KS/plugin/watcher/dist/cli/update-workflow-state.js"
: > "$KS/plugin/watcher/dist/cli/chain-trigger.cjs"
STUBS_WARM=y
warm_stub "$KS/plugin/hooks/oss-log.sh" 'exit 0' || STUBS_WARM=n
# node -e is the config reader without jq (oss_config_strings, T30): that one runs the real node.
REAL_NODE=$(command -v node) || { echo "✗ FAIL: node is required (the no-jq config reader)"; exit 1; }
warm_stub "$KS/bin/node" '[ "${1-}" = -e ] && exec "'"$REAL_NODE"'" "$@"; exit 0' || STUBS_WARM=n
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
echo "$*" >> "$SHIM/curl.args"
cat >> "$SHIM/curl.stdin"
exit 0
EOF
)" || STUBS_WARM=n
if [[ $STUBS_WARM != y ]]; then echo "✗ FAIL: stub warm-up — a stub did not run"; rm -rf "$KS"; exit 1; fi
# Sandbox: a case dir ($T) with a temp HOME holding the config. $T/bin is the stub dir.
sandbox() {  # $1 = config.json body
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss"
    ln -s "$KS/bin" "$T/bin"
    printf '%s' "$1" > "$T/home/.oss/config.json"
}
# A PATH with every command on the real PATH except jq (a symlink farm), for the no-jq branch.
nojq_path() {
    mkdir -p "$T/nojq"
    local d f
    IFS=: read -r -a dirs <<< "$PATH"
    for d in "${dirs[@]}"; do
        [[ -d "$d" ]] || continue
        for f in "$d"/*; do
            [[ -x "$f" && "${f##*/}" != jq && ! -e "$T/nojq/${f##*/}" ]] && ln -s "$f" "$T/nojq/${f##*/}" 2>/dev/null
        done
    done
    echo "$T/bin:$T/nojq"
}
# The hook detaches its analytics job from stdin/stdout/stderr (T1), so it can still be running
# when the hook exits. Fd 3 is a second writer on the command substitution's pipe: the hook, the
# detached job and the curl it runs all inherit it, and $(...) returns only when every writer has
# exited. So every check below runs after the analytics job is done - no polling, no sleeps.
# This is what keeps the "no request" checks honest: without it they would pass by racing the job.
# The accepted-URL cases prove the wait works (they read the request after run_start returns).
run_start() {  # $1 = PATH to use, $2 = workflow name (default build)
    local _out
    _out=$(cd "$T" && SHIM="$T" OSS_ALLOW_HTTP_LOOPBACK="${ALLOW-1}" HOME="$T/home" OSS_CONFIG_DIR="${CFG_DIR:-}" CLAUDE_PLUGIN_ROOT="$KS/plugin" CLAUDE_PROJECT_DIR="" PATH="$1" \
        "$SH" "$HOOK" --workflow "${2:-build}" start </dev/null 2>&1 3>&1)
}
calls() { [[ -f "$T/curl.args" ]] && wc -l < "$T/curl.args" | tr -d ' ' || echo 0; }

# 1. Refused apiUrls: no request at all (so no request carries the key).
for url in 'http://evil.example.com' 'https://api.example.com/?x=' 'https://api.example.com/#' \
           'http://localhost.evil.com' 'http://127.0.0.1@evil.example.com' \
           'http://localhost:4100@evil.example.com' 'ftp://api.example.com'; do
    sandbox "{\"apiKey\":\"k-secret\",\"apiUrl\":\"$url\"}"
    run_start "$T/bin:$PATH"
    if [[ "$(calls)" == 0 ]]; then pass "apiUrl '$url' is refused: no analytics request, key never sent"
    else fail "apiUrl '$url' is refused: no analytics request, key never sent" "curl=$(tr '\n' '|' < "$T/curl.args")"; fi
    rm -rf "$T"
done

# 1b. Plain http to a loopback API without OSS_ALLOW_HTTP_LOOPBACK=1 (T20, pen-test M2): no request either.
# Every other case runs with the opt-in (run_start's default), so it proves the URL rule, not the switch.
for url in 'http://127.0.0.1:4100' 'http://localhost:4100' 'http://[::1]:4100'; do
    sandbox "{\"apiKey\":\"k-secret\",\"apiUrl\":\"$url\"}"
    ALLOW='' run_start "$T/bin:$PATH"
    if [[ "$(calls)" == 0 ]]; then pass "apiUrl '$url' without OSS_ALLOW_HTTP_LOOPBACK=1: no analytics request, key never sent"
    else fail "apiUrl '$url' without OSS_ALLOW_HTTP_LOOPBACK=1: no analytics request, key never sent" "curl=$(tr '\n' '|' < "$T/curl.args")"; fi
    rm -rf "$T"
done

# 2. Accepted apiUrls: exactly one request, to <apiUrl>/api/v1/analytics/track, carrying the key.
for url in 'https://api.example.com' 'http://127.0.0.1:4100' 'http://localhost:4100' 'http://[::1]:4100'; do
    sandbox "{\"apiKey\":\"k-secret\",\"apiUrl\":\"$url\"}"
    run_start "$T/bin:$PATH"
    if [[ "$(calls)" == 1 ]] && grep -qF -- "$url/api/v1/analytics/track" "$T/curl.args" \
       && grep -qF 'Authorization: Bearer k-secret' "$T/curl.stdin"; then
        pass "apiUrl '$url' is accepted: one request to its analytics/track with the key"
    else fail "apiUrl '$url' is accepted: one request to its analytics/track with the key" \
        "calls=$(calls) curl=$(tr '\n' '|' < "$T/curl.args" 2>/dev/null)"; fi
    rm -rf "$T"
done

# 3. No apiUrl, or an empty one: the default API, both with jq and with jq off the PATH.
for cfg in '{"apiKey":"k-secret"}' '{"apiKey":"k-secret","apiUrl":""}'; do
for mode in jq nojq; do
    sandbox "$cfg"
    if [[ $mode == jq ]]; then
        if ! command -v jq >/dev/null 2>&1; then fail "apiUrl absent/empty ($mode, $cfg) uses the default API" "jq not installed"; rm -rf "$T"; continue; fi
        run_start "$T/bin:$PATH"
    else
        p=$(nojq_path)
        if PATH="$p" command -v jq >/dev/null 2>&1; then fail "apiUrl absent/empty ($mode, $cfg) uses the default API" "could not hide jq"; rm -rf "$T"; continue; fi
        run_start "$p"
    fi
    if [[ "$(calls)" == 1 ]] && grep -qF -- " $DEFAULT_TRACK " "$T/curl.args"; then
        pass "apiUrl absent/empty ($mode, $cfg) uses the default API"
    else fail "apiUrl absent/empty ($mode, $cfg) uses the default API" "calls=$(calls) curl=$(tr '\n' '|' < "$T/curl.args" 2>/dev/null)"; fi
    rm -rf "$T"
done
done

# 4. OSS_CONFIG_DIR set: the key and the URL both come from its config, not ~/.oss (like the CLI).
sandbox '{"apiKey":"K1-home","apiUrl":"https://u1.example.com"}'
mkdir -p "$T/alt"; printf '%s' '{"apiKey":"K2-alt","apiUrl":"https://u2.example.com"}' > "$T/alt/config.json"
CFG_DIR="$T/alt" run_start "$T/bin:$PATH"
if [[ "$(calls)" == 1 ]] && grep -qF -- "https://u2.example.com/api/v1/analytics/track" "$T/curl.args" \
   && grep -qF 'Authorization: Bearer K2-alt' "$T/curl.stdin"; then
    pass "OSS_CONFIG_DIR set: one request to its apiUrl with its key"
else fail "OSS_CONFIG_DIR set: one request to its apiUrl with its key" \
    "calls=$(calls) curl=$(tr '\n' '|' < "$T/curl.args" 2>/dev/null) stdin=$(tr '\n' '|' < "$T/curl.stdin" 2>/dev/null)"; fi
rm -rf "$T"

# 5. The analytics body is JSON built from a validated name (R2-5). A name carrying JSON syntax
#    (", \, ","promptType":"x) is refused before the body is built: no request at all. A valid name
#    gives a body that parses as JSON with exactly command/promptType/promptName.
for name in 'build","promptType":"x' 'build\' 'bu"ild' $'build\n'; do
    sandbox '{"apiKey":"k-secret"}'
    run_start "$T/bin:$PATH" "$name"
    if [[ "$(calls)" == 0 ]]; then pass "hostile workflow name $(printf '%q' "$name") never reaches the analytics body"
    else fail "hostile workflow name $(printf '%q' "$name") never reaches the analytics body" "curl=$(tr '\n' '|' < "$T/curl.args")"; fi
    rm -rf "$T"
done
if command -v jq >/dev/null 2>&1; then
    sandbox '{"apiKey":"k-secret"}'
    run_start "$T/bin:$PATH" custom-cmd2
    body=$(sed -n 's/.* -d \({.*}\)$/\1/p' "$T/curl.args" 2>/dev/null)
    if [[ "$(calls)" == 1 ]] && printf '%s' "$body" | jq -e \
         '(keys == ["command","promptName","promptType"]) and .promptType == "command"
          and .command == "custom-cmd2" and .promptName == "custom-cmd2"' >/dev/null 2>&1; then
        pass "valid workflow name gives a JSON body with exactly command/promptType/promptName"
    else fail "valid workflow name gives a JSON body with exactly command/promptType/promptName" "calls=$(calls) body=$body"; fi
    rm -rf "$T"
else fail "valid workflow name gives a JSON body with exactly command/promptType/promptName" "jq not installed"; fi

rm -rf "$KS"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
