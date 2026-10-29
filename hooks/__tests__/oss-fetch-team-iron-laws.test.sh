#!/bin/bash
# oss-fetch-team-iron-laws.sh sends the API key only to the configured API, with that config's key.
#
# @behavior The keyed request goes to <apiUrl>/api/v1/iron-laws/defaults, apiUrl and apiKey both
#           read from the one OSS config file (OSS_CONFIG_DIR, else ~/.oss). No apiUrl: the default
#           API. An apiUrl the CLI would refuse: no request, and the default config is printed
#           (the script's existing no-API fallback), exit 0.
# @business-rule The API key is only ever sent to the API the user configured.
# @boundary oss-fetch-team-iron-laws.sh (system boundary); curl is the faked collaborator
#
# Usage: ./hooks/__tests__/oss-fetch-team-iron-laws.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-fetch-team-iron-laws.test.sh  (mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/oss-fetch-team-iron-laws.sh"
source "$SCRIPT_DIR/lib/warm-stub.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-fetch-team-iron-laws.sh tests..."

KS=$(mktemp -d); KS=$(cd "$KS" && pwd -P)
trap 'rm -rf "$KS"' EXIT
# One recording curl for every case, warmed once: argv (a line per call), the --config - stdin
# (where the Authorization header travels), and a canned 200 config.
WARM=y
warm_stub "$KS/bin/curl" "$(cat <<'EOF'
printf '%s\n' "$*" >> "$SHIM/argv"
prev=""; for a in "$@"; do [[ "$prev" == --config && "$a" == - ]] && cat >> "$SHIM/stdin"; prev="$a"; done
printf '{"law1_tdd":{"enabled":true,"locked":true},"from":"stub"}\n200'
EOF
)" || WARM=n
[[ $WARM == y ]] || fail "curl stub warms up" "warm_stub returned non-zero"

key_case() { # $1 case dir, $2 ~/.oss/config.json body, [$3 OSS_CONFIG_DIR config.json body]
    SHIM="$KS/$1"; mkdir -p "$SHIM/home/.oss"
    printf '%s' "$2" > "$SHIM/home/.oss/config.json"
    local cfgdir=""
    if [[ -n "${3:-}" ]]; then cfgdir="$SHIM/alt"; mkdir -p "$cfgdir"; printf '%s' "$3" > "$cfgdir/config.json"; fi
    RC=0
    OUT=$(cd "$SHIM" && SHIM="$SHIM" HOME="$SHIM/home" OSS_CONFIG_DIR="$cfgdir" PATH="$KS/bin:$PATH" \
        /bin/bash "$HOOK_SCRIPT" --force </dev/null 2>&1) || RC=$?
    CALLS=0; ARGV=""
    if [[ -f "$SHIM/argv" ]]; then CALLS=$(wc -l < "$SHIM/argv" | tr -d ' '); ARGV=$(tr '\n' '|' < "$SHIM/argv"); fi
}
sent_key() { grep -qF "Authorization: Bearer $1\"" "$SHIM/stdin" 2>/dev/null; }

# (a) apiUrl in the config: one request there, with the config's key, never to onrender.
name="apiUrl in the config: the one request goes there with the config's key, never to onrender"
key_case a '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9"}'
if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" http://127.0.0.1:9/api/v1/iron-laws/defaults|" && "$ARGV" != *onrender* \
      && "$OUT" == *'"from":"stub"'* ]] && sent_key fake-key-K; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV out=$OUT"; fi

# (b) OSS_CONFIG_DIR set: its key (KB) and apiUrl; the key in ~/.oss (KA) is never sent.
name="OSS_CONFIG_DIR set: its key (KB) and its apiUrl are used, ~/.oss's key (KA) is never sent"
key_case b '{"apiKey":"fake-key-KA"}' '{"apiKey":"fake-key-KB","apiUrl":"http://127.0.0.1:9"}'
if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" http://127.0.0.1:9/api/v1/iron-laws/defaults|" ]] \
      && sent_key fake-key-KB && ! grep -qF fake-key-KA "$SHIM/stdin" "$SHIM/argv"; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV sent=$(grep -o 'Bearer [^"]*' "$SHIM/stdin" 2>/dev/null)"; fi

# (c) A refused apiUrl: no keyed request; the default config, exit 0, nothing cached.
name="apiUrl the CLI refuses (http://evil.example): no request, default config printed, exit 0, no cache"
key_case c '{"apiKey":"fake-key-K","apiUrl":"http://evil.example"}'
if [[ $RC -eq 0 && $CALLS == 0 && "$OUT" == *'"law6_dev_docs"'* && "$OUT" != *stub* \
      && ! -e "$SHIM/home/.oss/team-iron-laws.json" ]]; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV out=$OUT"; fi

# (d) Control: no apiUrl, the default API.
name="control: no apiUrl in the config → the default API"
key_case d '{"apiKey":"fake-key-K"}'
if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" https://one-shot-ship-api.onrender.com/api/v1/iron-laws/defaults|" ]] \
      && sent_key fake-key-K; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
