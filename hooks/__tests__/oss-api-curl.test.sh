#!/bin/bash
# Tests for hooks/oss-api-curl.sh - the one place hooks hand the API key to curl.
#
# @behavior Every hook that calls the OSS API authenticates without the API key ever
#           appearing in a process command line (visible to every local user via `ps`).
# @business-rule The key is passed to curl on stdin (`curl --config -`), never in argv.
#           One shared helper answers "how do we send the key", so no hook can drift
#           back to `-H "Authorization: Bearer $KEY"` (IRON LAW #1b provenance).
#
# Usage: ./hooks/__tests__/oss-api-curl.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$HOOKS_DIR/oss-api-curl.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

FAKE_KEY='fake-key-feedfacecafe0042'

setup() { # T/home with config, T/bin/curl shim recording argv + --config stdin
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/bin" "$T/shim"
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    cat > "$T/bin/curl" << SHIM
#!/bin/bash
S="$T/shim"
printf '%s\n' "\$*" >> "\$S/argv"
prev=""
for a in "\$@"; do
    if [[ ( "\$prev" == "--config" || "\$prev" == "-K" ) && "\$a" == "-" ]]; then cat >> "\$S/stdin"; fi
    prev="\$a"
done
printf '# IRON LAWS\nbody\n\n200'
SHIM
    chmod +x "$T/bin/curl"
}
teardown() { rm -rf "$T"; }

key_in_argv() { grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && echo y || echo n; }
key_in_cfg()  { grep -qF "Authorization: Bearer $FAKE_KEY" "$T/shim/stdin" 2>/dev/null && echo y || echo n; }

# --- the helper itself ---------------------------------------------------------------------
test_helper_key_on_stdin() {
    local name="helper: key goes to curl's --config stdin, never argv; other args pass through"; ((TESTS_RUN++)); setup
    local out
    out=$(PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/x' _ "$HELPER" "$FAKE_KEY" 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y && "$(cat "$T/shim/argv" 2>/dev/null)" == *"https://example.invalid/x"* && "$out" == *"IRON LAWS"* ]]; then pass "$name"
    else fail "$name" "argv=n config=y url passed, stdout returned" "argv=$(key_in_argv) config=$(key_in_cfg) out=${out//$FAKE_KEY/<KEY>}"; fi
    teardown
}

test_helper_escapes_and_refuses() {
    local name="helper: quotes/backslashes are escaped for curl config; a key with a newline is refused"; ((TESTS_RUN++)); setup
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" 'a"b\c' >/dev/null 2>&1
    local esc=n; grep -qF 'Authorization: Bearer a\"b\\c"' "$T/shim/stdin" 2>/dev/null && esc=y
    rm -f "$T/shim/argv"
    local rc=0
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" $'bad\nkey' >/dev/null 2>&1 || rc=$?
    if [[ "$esc" == y && $rc -ne 0 && ! -f "$T/shim/argv" ]]; then pass "$name"
    else fail "$name" "escaped config line; newline key → non-zero, no curl" "escaped=$esc rc=$rc curl_called=$([[ -f $T/shim/argv ]] && echo y || echo n)"; fi
    teardown
}

# UR2: the keyed request never goes through a proxy. The Node CLI and the watcher ignore *_proxy, so a proxy variable
# in the environment must not make the shell send the Authorization header (in clear text for a loopback http API) to
# whatever listens at the proxy address. Real curl, two real loopback listeners: the API and a recording "proxy".
test_helper_never_uses_a_proxy() {
    local name="helper: with http_proxy/HTTPS_PROXY/ALL_PROXY set, the keyed request goes to the API, never the proxy"
    ((TESTS_RUN++)); setup
    local real_curl; real_curl=$(command -v curl)
    mkdir -p "$T/guard"   # NETWORK RULE: only loopback URLs reach the real curl
    cat > "$T/guard/curl" << GUARD
#!/bin/bash
for a in "\$@"; do case "\$a" in *://*) case "\$a" in http://127.0.0.1[:/]*|http://localhost[:/]*|http://\[::1\][:/]*) ;; *) echo "\$a" >> "$T/refused"; exit 7 ;; esac ;; esac; done
exec "$real_curl" "\$@"
GUARD
    chmod +x "$T/guard/curl"
    cat > "$T/listen.py" << 'PY'
import socket, sys
s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen(5)
open(sys.argv[1] + ".port", "w").write(str(s.getsockname()[1]))
while True:
    c, _ = s.accept(); c.settimeout(3); data = b""
    try:
        while b"\r\n\r\n" not in data:
            chunk = c.recv(4096)
            if not chunk: break
            data += chunk
    except Exception: pass
    open(sys.argv[1], "ab").write(data)
    c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"); c.close()
PY
    env -u NODE_OPTIONS python3 -I "$T/listen.py" "$T/api.log" & local api_pid=$!
    env -u NODE_OPTIONS python3 -I "$T/listen.py" "$T/proxy.log" & local proxy_pid=$!
    local i; for i in $(seq 50); do [[ -s "$T/api.log.port" && -s "$T/proxy.log.port" ]] && break; perl -e 'select(undef,undef,undef,0.1)'; done
    local api="http://127.0.0.1:$(cat "$T/api.log.port")" proxy="http://127.0.0.1:$(cat "$T/proxy.log.port")" out
    out=$(env -u NO_PROXY -u no_proxy PATH="$T/guard:$PATH" http_proxy="$proxy" https_proxy="$proxy" HTTPS_PROXY="$proxy" \
        ALL_PROXY="$proxy" all_proxy="$proxy" bash -c 'source "$1"; oss_api_curl "$2" -s -m 5 "$3/api/v1/x"' \
        _ "$HELPER" "$FAKE_KEY" "$api" 2>&1)
    kill "$api_pid" "$proxy_pid" 2>/dev/null; wait "$api_pid" "$proxy_pid" 2>/dev/null
    local at_api=n at_proxy=n
    grep -qF "Bearer $FAKE_KEY" "$T/api.log" 2>/dev/null && at_api=y
    [[ -s "$T/proxy.log" ]] && at_proxy=y
    if [[ "$at_api" == y && "$at_proxy" == n && "$out" == ok && ! -e "$T/refused" ]]; then pass "$name"
    else fail "$name" "api=y proxy=n out=ok" "api=$at_api proxy=$at_proxy out=${out//$FAKE_KEY/<KEY>} refused=$(cat "$T/refused" 2>/dev/null)"; fi
    teardown
}

# --- every hook site routes through the helper (provenance guard) -----------------------------
test_no_hook_puts_key_in_argv() {
    local name="guard: no tracked hook interpolates a variable into an Authorization: Bearer header"; ((TESTS_RUN++))
    local offenders
    offenders=$(cd "$HOOKS_DIR/.." && git ls-files 'hooks/*.sh' | grep -v '^hooks/__tests__/' | grep -v '^hooks/oss-api-curl.sh$' \
        | xargs grep -nE 'Bearer[[:space:]]+\$' 2>/dev/null)
    if [[ -z "$offenders" ]]; then pass "$name"
    else fail "$name" "no matches" "$offenders"; fi
}

# --- behavioural, per site --------------------------------------------------------------------
check_site() { # $1 label, then the command to run under the temp HOME/PATH
    local label="$1"; shift
    local name="site: $label sends the key via the helper (not argv)"; ((TESTS_RUN++)); setup
    (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" OSS_SKIP_HEALTH_CHECK='' perl -e 'alarm 30; exec @ARGV' "$@" </dev/null >/dev/null 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y ]]; then pass "$name"
    else fail "$name" "argv=n config=y" "argv=$(key_in_argv) config=$(key_in_cfg) calls=$(wc -l < "$T/shim/argv" 2>/dev/null || echo 0)"; fi
    teardown
}
test_sites() {
    # fetch-iron-laws.sh sends no key since FR15: the decrypt CLI fetches the laws with its own credentials.
    check_site "oss-fetch-team-iron-laws.sh" bash "$HOOKS_DIR/oss-fetch-team-iron-laws.sh"
    check_site "oss-push-metrics.sh" bash "$HOOKS_DIR/oss-push-metrics.sh" '{"command":"build"}'
}

echo "Running oss-api-curl.sh tests..."
echo "======================================="
test_helper_key_on_stdin
test_helper_escapes_and_refuses
test_helper_never_uses_a_proxy
test_no_hook_puts_key_in_argv
test_sites
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
