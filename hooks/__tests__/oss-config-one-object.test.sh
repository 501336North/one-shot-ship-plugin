#!/bin/bash
# The OSS config is read as exactly one JSON object, with jq or without it, and the API key and the URL it
# goes to always come from that one object (T30).
#
# @behavior oss_api_key and oss_api_url (hooks/oss-api-curl.sh), and every hook that sends the key, read the
#           config file only when it is exactly one JSON value and that value is an object; a field is used
#           only when it is a string (missing or null: none). With jq, and without jq (node reads it then):
#           - the documented nested "models" and "webhook" objects do not stop the key or the URL being read;
#           - several concatenated documents, trailing garbage, a top-level array, or an apiUrl that is not
#             a string give no URL and no key, so no request is made;
#           - an apiKey that sits only inside a nested object is not the key.
#           With neither jq nor node, the config is refused: no key, no URL, no request.
# @business-rule The key is only ever sent to the API configured beside it, in the same object; a user with
#           the documented config gets the same answer whether or not jq is installed.
# @boundary oss-api-curl.sh helpers and the hooks that call the API (system boundary); curl is faked.
#
# Usage:   /bin/bash hooks/__tests__/oss-config-one-object.test.sh
#          HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash ...   (runs against a copy, for mutants)
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
HOOKS="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}"
source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/session-start-alias.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-config-one-object tests..."
command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is needed for the jq branch"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node is needed for the no-jq branch"; exit 1; }

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT

# Symlink farms of every command on the real PATH except the named ones: one without jq (node reads the
# config), one without jq and node (nothing can read it).
farm() { # $1 dir, then names to leave out
    local dir="$1" d f b h skip; shift
    mkdir -p "$dir"
    local IFS=:
    for d in $PATH; do
        [[ -d "$d" ]] || continue
        for f in "$d"/*; do
            b=${f##*/}; skip=n
            for h in "$@"; do [[ "$b" == "$h" ]] && skip=y; done
            [[ $skip == n && -x "$f" && ! -e "$dir/$b" ]] && ln -s "$f" "$dir/$b" 2>/dev/null
        done
    done
}
farm "$KS/nojq" jq
farm "$KS/none" jq node
PATH="$KS/nojq" command -v jq >/dev/null 2>&1 && { echo "✗ FAIL: could not hide jq"; exit 1; }
PATH="$KS/nojq" command -v node >/dev/null 2>&1 || { echo "✗ FAIL: node missing from the no-jq PATH"; exit 1; }
PATH="$KS/none" command -v node >/dev/null 2>&1 && { echo "✗ FAIL: could not hide node"; exit 1; }
mode_path() { case "$1" in (jq) printf '%s' "$PATH" ;; (nojq) printf '%s' "$KS/nojq" ;; (*) printf '%s' "$KS/none" ;; esac; }

URL="https://dev.example.com"
# The shape commands/models.md and commands/webhook.md document: nested objects beside the key and the URL.
NESTED='{
  "apiKey": "fake-key-N",
  "apiUrl": "https://dev.example.com",
  "models": {"default": "claude", "agents": {"oss:code-reviewer": "ollama/qwen2.5-coder"}, "commands": {"oss:ship": "gemini/gemini-2.0-flash"}},
  "webhook": {"enabled": true, "secret": "[REDACTED]", "repos": ["a/b"]}
}'

# helper <shell> <mode> <config body> <function> : runs the function from oss-api-curl.sh; sets OUT and RC.
helper() {
    local T; T=$(mktemp -d "$KS/h.XXXXXX"); mkdir -p "$T/.oss"
    printf '%s' "$3" > "$T/.oss/config.json"
    RC=0
    OUT=$(HOME="$T" PATH="$(mode_path "$2")" "$1" -c 'source "$1"; '"$4" _ "$HOOKS/oss-api-curl.sh" 2>/dev/null) || RC=$?
    rm -rf "$T"
}

# --- helpers: nested objects are read, with and without jq ------------------------------------------
for SH in /bin/bash /bin/zsh; do
    for MODE in jq nojq; do
        tag="[${SH##*/}, $MODE]"
        helper "$SH" "$MODE" "$NESTED" oss_api_url
        if [[ $RC == 0 && "$OUT" == "$URL" ]]; then pass "$tag nested models/webhook: oss_api_url gives the configured URL"
        else fail "$tag nested models/webhook: oss_api_url gives the configured URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        helper "$SH" "$MODE" "$NESTED" oss_api_key
        if [[ $RC == 0 && "$OUT" == fake-key-N ]]; then pass "$tag nested models/webhook: oss_api_key gives the key"
        else fail "$tag nested models/webhook: oss_api_key gives the key" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
done

# --- helpers: a field with a character outside printable ASCII is refused inside the reader -----------
# (zsh's =~ stops at a NUL, so the shell would validate only the part before it.)
for SH in /bin/bash /bin/zsh; do
    for MODE in jq nojq; do
        helper "$SH" "$MODE" '{"apiKey":"fake-key-C","apiUrl":"http://127.0.0.1\u0000@evil.example.com"}' 'OSS_ALLOW_HTTP_LOOPBACK=1 oss_api_url'
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "[${SH##*/}, $MODE] an apiUrl holding a NUL (\\u0000) gives no URL"
        else fail "[${SH##*/}, $MODE] an apiUrl holding a NUL (\\u0000) gives no URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
done

# --- helpers: anything but exactly one object is refused, with and without jq ---------------------
# Each body holds a key and an https URL that would be accepted on their own.
REFUSED_NAMES=(concatenated concatenated-split trailing-garbage top-level-array top-level-null top-level-string)
REFUSED_BODIES=(
    '{"apiKey":"fake-key-C","apiUrl":"https://dev.example.com"}{"apiKey":"fake-key-D","apiUrl":"https://dev.example.com"}'
    $'{"apiUrl":"https://dev.example.com"}\n{"apiKey":"fake-key-C"}\n'
    '{"apiKey":"fake-key-C","apiUrl":"https://dev.example.com"} x'
    '[{"apiKey":"fake-key-C","apiUrl":"https://dev.example.com"}]'
    'null'
    '"https://dev.example.com"'
)
for MODE in jq nojq; do
    for i in "${!REFUSED_NAMES[@]}"; do
        tag="[$MODE] ${REFUSED_NAMES[$i]}"
        helper /bin/bash "$MODE" "${REFUSED_BODIES[$i]}" oss_api_url
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "$tag: no URL"
        else fail "$tag: no URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi
        helper /bin/bash "$MODE" "${REFUSED_BODIES[$i]}" oss_api_key
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "$tag: no key"
        else fail "$tag: no key" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
    for body in '{"apiKey":"fake-key-C","apiUrl":443}' '{"apiKey":"fake-key-C","apiUrl":["https://dev.example.com"]}' \
                '{"apiKey":"fake-key-C","apiUrl":{"href":"https://dev.example.com"}}'; do
        helper /bin/bash "$MODE" "$body" oss_api_url
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "[$MODE] apiUrl not a string ($body): no URL"
        else fail "[$MODE] apiUrl not a string ($body): no URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
    for body in '{"apiKey":12345,"apiUrl":"https://dev.example.com"}' '{"apiKey":true,"apiUrl":"https://dev.example.com"}' \
                '{"apiKey":{"k":"v"},"apiUrl":"https://dev.example.com"}' '{"apiKey":["k"],"apiUrl":"https://dev.example.com"}'; do
        helper /bin/bash "$MODE" "$body" oss_api_key
        if [[ $RC != 0 && -z "$OUT" ]]; then pass "[$MODE] apiKey not a string ($body): no key"
        else fail "[$MODE] apiKey not a string ($body): no key" "rc=$RC out=$(printf '%q' "$OUT")"; fi
    done
    helper /bin/bash "$MODE" '{"x":{"apiKey":"fake-key-X"},"apiUrl":"https://dev.example.com"}' oss_api_key
    if [[ $RC != 0 && -z "$OUT" ]]; then pass "[$MODE] an apiKey only inside a nested object is not the key"
    else fail "[$MODE] an apiKey only inside a nested object is not the key" "rc=$RC out=$(printf '%q' "$OUT")"; fi
done

# --- helpers: neither jq nor node ------------------------------------------------------------------
helper /bin/bash none '{"apiKey":"fake-key-G","apiUrl":"https://dev.example.com"}' oss_api_url
if [[ $RC != 0 && -z "$OUT" ]]; then pass "[no jq, no node] a valid config gives no URL"
else fail "[no jq, no node] a valid config gives no URL" "rc=$RC out=$(printf '%q' "$OUT")"; fi
helper /bin/bash none '{"apiKey":"fake-key-G","apiUrl":"https://dev.example.com"}' oss_api_key
if [[ $RC != 0 && -z "$OUT" ]]; then pass "[no jq, no node] a valid config gives no key"
else fail "[no jq, no node] a valid config gives no key" "rc=$RC out=$(printf '%q' "$OUT")"; fi

# --- every hook that sends the key: the key and the URL come from the same one object ---------------
# A sandbox plugin root holding the real hooks, a recording curl (argv, and the --config stdin where the
# Authorization header travels) and a no-op oss-notify.sh, all warmed once.
mkdir -p "$KS/plugin/hooks"
for n in oss-session-start.sh oss-api-curl.sh oss-safe-path.sh oss-config.sh oss-settings-cleanup.sh \
         fetch-iron-laws.sh oss-fetch-team-iron-laws.sh oss-push-metrics.sh oss-iron-laws-sync.sh; do
    [[ -f "$HOOKS/$n" ]] && cp "$HOOKS/$n" "$KS/plugin/hooks/$n"
done
SS_HOOK=$(session_start_alias "$KS/plugin/hooks") || { echo "✗ FAIL: session start alias"; exit 1; }
WARM=y
warm_stub "$KS/plugin/hooks/oss-notify.sh" 'exit 0' || WARM=n
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
printf '%s\n' "$*" >> "$SHIM/argv"
prev=""; for a in "$@"; do [[ "$prev" == --config && "$a" == - ]] && cat >> "$SHIM/stdin"; prev="$a"; done
printf '# IRON LAWS\n'
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo "IRON LAW padding line $i: a real laws body is several KB, the sync rejects anything under 500 bytes."; done
printf '\n200'
EOF
)" || WARM=n
[[ $WARM == y ]] || { echo "✗ FAIL: stub warm-up — a stub did not run"; exit 1; }

# site <name> <mode> <config body> : runs one hook as its caller does; sets OUT, RC, SENT (y when a request
# carried fake-key-*), TO (the URLs requested).
site() {
    SHIM=$(mktemp -d "$KS/s.XXXXXX"); mkdir -p "$SHIM/home/.oss" "$SHIM/proj"
    printf '%s' "$3" > "$SHIM/home/.oss/config.json"
    printf '# Mine\n' > "$SHIM/proj/CLAUDE.md"
    local p; p="$KS/bin:$(mode_path "$2")"
    local -a cmd
    case "$1" in
        (fetch-iron-laws) cmd=(/bin/bash "$KS/plugin/hooks/fetch-iron-laws.sh") ;;
        (team-iron-laws) cmd=(/bin/bash "$KS/plugin/hooks/oss-fetch-team-iron-laws.sh" --force) ;;
        (push-metrics) cmd=(/bin/bash "$KS/plugin/hooks/oss-push-metrics.sh" '{"command":"build"}') ;;
        (iron-laws-sync) cmd=(/bin/bash "$KS/plugin/hooks/oss-iron-laws-sync.sh" --install) ;;
        (session-start) cmd=(/bin/bash "$SS_HOOK") ;;
    esac
    OUT=$(cd "$SHIM/proj" && run_capped 60 env -u OSS_SKIP_HEALTH_CHECK -u CLAUDE_CODE_SESSION_ID -u OSS_RUN_HEALTH_CHECK \
        SHIM="$SHIM" HOME="$SHIM/home" CLAUDE_PLUGIN_ROOT="$KS/plugin" CLAUDE_PROJECT_DIR="$SHIM/proj" PATH="$p" \
        "${cmd[@]}" </dev/null 2>&1 3>&1); RC=$?
    SENT=n; grep -q 'Bearer fake-key-' "$SHIM/stdin" 2>/dev/null && SENT=y
    TO=$(grep -oE 'https?://[^ ]+' "$SHIM/argv" 2>/dev/null | tr '\n' ' ')
}

SITES=(fetch-iron-laws team-iron-laws push-metrics iron-laws-sync)
for MODE in jq nojq; do
    for S in "${SITES[@]}"; do
        site "$S" "$MODE" "$NESTED"
        if [[ $SENT == y && "$TO" == "$URL/"* && "$TO" != *onrender* ]] && grep -q 'Bearer fake-key-N"' "$SHIM/stdin"; then
            pass "[$MODE] $S: nested models/webhook config sends its key to its apiUrl"
        else fail "[$MODE] $S: nested models/webhook config sends its key to its apiUrl" "sent=$SENT to=$TO out=$(printf '%q' "${OUT:0:300}")"; fi
        for i in "${!REFUSED_NAMES[@]}"; do
            site "$S" "$MODE" "${REFUSED_BODIES[$i]}"
            if [[ $SENT == n ]]; then pass "[$MODE] $S: ${REFUSED_NAMES[$i]} config sends no key"
            else fail "[$MODE] $S: ${REFUSED_NAMES[$i]} config sends no key" "to=$TO"; fi
        done
        site "$S" "$MODE" '{"x":{"apiKey":"fake-key-X"},"apiUrl":"https://dev.example.com"}'
        if [[ $SENT == n ]]; then pass "[$MODE] $S: an apiKey only inside a nested object is never sent"
        else fail "[$MODE] $S: an apiKey only inside a nested object is never sent" "to=$TO"; fi
    done
    # Session start says whether there is a key: the same reader decides.
    site session-start "$MODE" $'{"apiUrl":"https://dev.example.com"}\n{"apiKey":"fake-key-C"}\n'
    if [[ "$OUT" == *"No API key found"* ]]; then pass "[$MODE] session start: a key in a second document is no key"
    else fail "[$MODE] session start: a key in a second document is no key" "out=$(printf '%q' "${OUT:0:300}")"; fi
    site session-start "$MODE" "$NESTED"
    # "OSS: Ready" and exit 0: the hook ran to the end (a hook killed mid-run prints nothing, which alone
    # would pass the "no refusal message" check).
    if [[ $RC == 0 && "$OUT" == *"OSS: Ready"* && "$OUT" != *"No API key found"* && "$OUT" != *"Not logged in"* ]]; then
        pass "[$MODE] session start: nested models/webhook config has a key (ran to the end: OSS: Ready, exit 0)"
    else fail "[$MODE] session start: nested models/webhook config has a key" "rc=$RC out=$(printf '%q' "${OUT:0:300}")"; fi
done
for S in "${SITES[@]}"; do
    site "$S" none '{"apiKey":"fake-key-G","apiUrl":"https://dev.example.com"}'
    if [[ $SENT == n ]]; then pass "[no jq, no node] $S: sends no key"
    else fail "[no jq, no node] $S: sends no key" "to=$TO"; fi
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
