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
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
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
last=""; for a in "$@"; do last="$a"; done
printf '{"law1_tdd":{"enabled":true,"locked":true},"from":"stub","src":"%s"}\n%s' "$last" "$(cat "$SHIM/code" 2>/dev/null || echo 200)"
EOF
)" || WARM=n
[[ $WARM == y ]] || fail "curl stub warms up" "warm_stub returned non-zero"

key_case() { # $1 case dir, $2 ~/.oss/config.json body, [$3 OSS_CONFIG_DIR config.json body]
    SHIM="$KS/$1"; mkdir -p "$SHIM/home/.oss"
    printf '%s' "$2" > "$SHIM/home/.oss/config.json"
    local cfgdir=""
    if [[ -n "${3:-}" ]]; then cfgdir="$SHIM/alt"; mkdir -p "$cfgdir"; printf '%s' "$3" > "$cfgdir/config.json"; fi
    RC=0
    OUT=$(cd "$SHIM" && SHIM="$SHIM" OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$SHIM/home" OSS_CONFIG_DIR="$cfgdir" PATH="$KS/bin:$PATH" \
        /bin/bash "$HOOK_SCRIPT" --force </dev/null 2>&1) || RC=$?
    CALLS=0; ARGV=""
    if [[ -f "$SHIM/argv" ]]; then CALLS=$(wc -l < "$SHIM/argv" | tr -d ' '); ARGV=$(tr '\n' '|' < "$SHIM/argv"); fi
}
# fetch_case <case dir> <config.json body> [args...]: one run as oss-iron-law-check.sh makes it (no
# --force unless passed). The case dir, its ~/.oss and the stub's argv persist across runs of one case.
fetch_case() {
    SHIM="$KS/$1"; mkdir -p "$SHIM/home/.oss"; printf '%s' "$2" > "$SHIM/home/.oss/config.json"; shift 2
    RC=0
    OUT=$(cd "$SHIM" && SHIM="$SHIM" OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$SHIM/home" OSS_CONFIG_DIR="" PATH="$KS/bin:$PATH" \
        /bin/bash "$HOOK_SCRIPT" "$@" </dev/null 2>&1) || RC=$?
    CALLS=0; LAST_URL=""
    if [[ -f "$SHIM/argv" ]]; then CALLS=$(wc -l < "$SHIM/argv" | tr -d ' '); LAST_URL=$(tail -n 1 "$SHIM/argv" | awk '{print $NF}'); fi
}
# Every file the script keeps in ~/.oss (cache, stamps) becomes 2 h old: past the 1 h cache TTL and backoff.
age_state() { find "$SHIM/home/.oss" -type f ! -name config.json -exec perl -e '$t = time - 7200; utime $t, $t, @ARGV' {} +; }
CFG_A='{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9"}'
CFG_B='{"apiKey":"fake-key-K","apiUrl":"http://localhost:9"}'
is_default() { [[ "$OUT" == *'"law6_dev_docs"'* && "$OUT" != *stub* ]]; }

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

# (e) A teamId that is not a plain id (S6): it would go into the request path, so no request at
#     all; the default config, exit 0, nothing cached. A plain teamId still gets its team endpoint.
for tid in '../x' 'a?b' 'a/b' 'a#b' 'a%2e' 'a\b'; do
    name="teamId $(printf '%q' "$tid") is refused: no request, default config printed, exit 0, no cache"
    key_case "e-$RUN" "{\"apiKey\":\"fake-key-K\",\"apiUrl\":\"http://127.0.0.1:9\",\"teamId\":\"$(printf '%s' "$tid" | sed 's/\\/\\\\/g')\"}"
    if [[ $RC -eq 0 && $CALLS == 0 && "$OUT" == *'"law6_dev_docs"'* && "$OUT" != *stub* \
          && ! -e "$SHIM/home/.oss/team-iron-laws.json" ]]; then pass "$name"
    else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV out=$OUT"; fi
done
name="control: a plain teamId (team_A-1) → one request to its team endpoint"
key_case f '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9","teamId":"team_A-1"}'
if [[ $RC -eq 0 && $CALLS == 1 && "$ARGV" == *" http://127.0.0.1:9/api/v1/iron-laws/team/team_A-1|" ]] \
      && sent_key fake-key-K; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS argv=$ARGV"; fi

# (g) The cache is tied to the API (apiUrl + endpoint) it came from: switching the apiUrl, or a
#     refused apiUrl or teamId, never serves another API's laws, fresh or as the stale fallback.
name="fresh cache from API A, apiUrl now B: a request to B, and B's laws (not A's) are printed"
fetch_case g1 "$CFG_A" --force; fetch_case g1 "$CFG_B"
if [[ $RC -eq 0 && $CALLS == 2 && "$LAST_URL" == http://localhost:9/api/v1/iron-laws/defaults \
      && "$OUT" == *'"src":"http://localhost:9/'* ]]; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS last=$LAST_URL out=$OUT"; fi

name="stale cache from API A, apiUrl now B and B fails: the default config, never A's laws as the stale fallback"
fetch_case g2 "$CFG_A" --force; age_state; printf 503 > "$SHIM/code"; fetch_case g2 "$CFG_B"
if [[ $RC -eq 0 ]] && is_default; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="stale cache from API A, apiUrl now refused (http://evil.example): no request, the default config"
fetch_case g3 "$CFG_A" --force; age_state; fetch_case g3 '{"apiKey":"fake-key-K","apiUrl":"http://evil.example"}'
if [[ $RC -eq 0 && $CALLS == 1 ]] && is_default; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="fresh cache from API A's defaults, teamId now refused (../x): no request, the default config"
fetch_case g4 "$CFG_A" --force; fetch_case g4 '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9","teamId":"../x"}'
if [[ $RC -eq 0 && $CALLS == 1 ]] && is_default; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="control: stale cache from API A, A fails: A's cached laws are still the fallback"
fetch_case g5 "$CFG_A" --force; age_state; printf 503 > "$SHIM/code"; fetch_case g5 "$CFG_A"
if [[ $RC -eq 0 && $CALLS == 2 && "$OUT" == *'"src":"http://127.0.0.1:9/'* ]]; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="control: fresh cache from API A, still A: no request, the cached laws"
fetch_case g6 "$CFG_A" --force; fetch_case g6 "$CFG_A"
if [[ $RC -eq 0 && $CALLS == 1 && "$OUT" == *'"src":"http://127.0.0.1:9/'* ]]; then pass "$name"
else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

# (h) A failed fetch backs off for 1 h (as oss-iron-laws-sync.sh does): while the API is down, an
#     IRON LAW check does not wait on it every time. --force still asks.
api_down() { mkdir -p "$KS/$1"; printf 503 > "$KS/$1/code"; }  # $1 case dir: its API answers 503
name="a failed fetch backs off: the next check makes no request and prints the default config"
api_down h1; fetch_case h1 "$CFG_A"; fetch_case h1 "$CFG_A"
if [[ $RC -eq 0 && $CALLS == 1 ]] && is_default; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="control: the backoff ends after 1 h: a check then asks the API again"
api_down h2; fetch_case h2 "$CFG_A"; age_state; fetch_case h2 "$CFG_A"
if [[ $RC -eq 0 && $CALLS == 2 ]]; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

name="control: --force asks the API even inside the backoff"
api_down h3; fetch_case h3 "$CFG_A"; fetch_case h3 "$CFG_A" --force
if [[ $RC -eq 0 && $CALLS == 2 ]]; then pass "$name"; else fail "$name" "exit=$RC calls=$CALLS out=$OUT"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
