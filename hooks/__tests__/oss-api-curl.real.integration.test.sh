#!/bin/bash
# Integration test for hooks/oss-api-curl.sh against the REAL curl and a real local HTTP server.
#
# oss-api-curl.test.sh and oss-api-url.test.sh use a fake curl. This file checks the assumption those
# fakes encode: that real curl, fed `--config -` on stdin, actually sends `Authorization: Bearer <key>`
# to the URL oss_api_url built — and that the key never shows up in any process command line.
#
# @behavior A hook that posts to the OSS API reaches the configured local API with the user's key in the
#           Authorization header, and no local user can read that key from `ps` while the request runs.
#           When apiUrl is not allowed (plain http to a non-loopback host), no request is made at all.
# @business-rule The API key travels only in a header to the configured, allowed API URL; never in argv.
# @boundary Real curl, real python3 http.server on 127.0.0.1 (random free port), temp HOME, fake key.
#
# Usage: ./hooks/__tests__/oss-api-curl.real.integration.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="$(cd "$SCRIPT_DIR/.." && pwd)/oss-api-curl.sh"

RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP: python3 not found — real-curl integration test for oss-api-curl.sh NOT run"
    exit 0
fi
if ! command -v curl >/dev/null 2>&1; then
    echo "SKIP: curl not found — real-curl integration test for oss-api-curl.sh NOT run"
    exit 0
fi

T=$(mktemp -d)
SERVER_PID=''
SERVER2_PID=''
cleanup() {
    local pid
    for pid in $SERVER_PID $SERVER2_PID; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
    rm -rf "$T"
}
trap cleanup EXIT

# A random key generated in-process, so it is never in this script's own argv or source.
KEY="oss_itest_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

# Recorder: one line per request "METHOD PATH|AUTHORIZATION", answers after 1s so the request is in flight.
cat > "$T/recorder.py" << 'PY'
import http.server, sys, time
log_path, port_path = sys.argv[1], sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        with open(log_path, 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        time.sleep(1)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'{}')
    do_GET = do_POST = _record
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
with open(port_path + '.tmp', 'w') as f: f.write(str(srv.server_address[1]))
import os; os.rename(port_path + '.tmp', port_path)
srv.serve_forever()
PY
: > "$T/requests.log"
python3 -I "$T/recorder.py" "$T/requests.log" "$T/port" &
SERVER_PID=$!
for _ in $(seq 1 50); do [[ -s "$T/port" ]] && break; sleep 0.1; done
if [[ ! -s "$T/port" ]]; then
    fail "recorder server starts" "no port file after 5s"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
PORT=$(cat "$T/port")

# Temp HOME pointing at the recorder. A curl shim on PATH counts invocations, then runs the real curl.
REAL_CURL=$(command -v curl)
mkdir -p "$T/home/.oss" "$T/bin"
printf '{"apiKey": "%s", "apiUrl": "http://127.0.0.1:%s"}\n' "$KEY" "$PORT" > "$T/home/.oss/config.json"
printf '#!/bin/bash\necho x >> "%s/curl-calls"\nexec "%s" "$@"\n' "$T" "$REAL_CURL" > "$T/bin/curl"
chmod +x "$T/bin/curl"
export HOME="$T/home"
export PATH="$T/bin:$PATH"

# shellcheck source=/dev/null
source "$HELPER"

# --- Scenario 1: a real POST reaches the configured API with the key only in the header ---
(API_URL=$(oss_api_url) && oss_api_curl "$KEY" -sS -m 5 -X POST "$API_URL/api/v1/analytics/track" -d '{}' \
    > "$T/curl.out" 2> "$T/curl.err"; echo $? > "$T/curl.rc") &
CLIENT_PID=$!

# While the server holds the request (1s), sample every process command line.
SAW_CURL=0; KEY_IN_PS=0
for _ in $(seq 1 8); do
    PS_OUT=$(ps -axo args 2>/dev/null)
    [[ "$PS_OUT" == *"$REAL_CURL"*"/api/v1/analytics/track"* || "$PS_OUT" == *"curl --config -"*"/api/v1/analytics/track"* ]] && SAW_CURL=1
    [[ "$PS_OUT" == *"$KEY"* ]] && KEY_IN_PS=1
    sleep 0.1
done
wait "$CLIENT_PID"

if [[ "$(cat "$T/curl.rc" 2>/dev/null)" == 0 ]]; then pass "real curl POST to the local API succeeds"
else fail "real curl POST to the local API succeeds" "rc=$(cat "$T/curl.rc" 2>/dev/null) err=$(cat "$T/curl.err" 2>/dev/null)"; fi

EXPECTED="POST /api/v1/analytics/track|Bearer $KEY"
if [[ "$(cat "$T/requests.log")" == "$EXPECTED" ]]; then
    pass "server received exactly one 'POST /api/v1/analytics/track' with 'Authorization: Bearer <key>'"
else
    fail "server received exactly one POST /api/v1/analytics/track with the Bearer key" \
        "log='$(sed "s/$KEY/<KEY>/g" "$T/requests.log")'"
fi

if [[ $SAW_CURL == 1 ]]; then pass "curl was observed in ps while the request was in flight (ps check is not vacuous)"
else fail "curl was observed in ps while the request was in flight" "never saw the curl process"; fi

if [[ $KEY_IN_PS == 0 ]]; then pass "the key never appeared in any process command line during the request"
else fail "the key never appeared in any process command line during the request" "key found in ps -axo args"; fi

# --- Scenario 2: a non-loopback plain-http apiUrl refuses before any request ---
printf '{"apiKey": "%s", "apiUrl": "http://evil.example.com"}\n' "$KEY" > "$T/home/.oss/config.json"
rm -f "$T/curl-calls"
: > "$T/requests.log"
API_URL=''
API_URL=$(oss_api_url) && oss_api_curl "$KEY" -sS -m 3 -X POST "$API_URL/api/v1/analytics/track" -d '{}' >/dev/null 2>&1
RC=$?
if [[ $RC != 0 && -z "$API_URL" ]]; then pass "oss_api_url refuses http://evil.example.com (non-zero, empty URL)"
else fail "oss_api_url refuses http://evil.example.com" "rc=$RC url='$API_URL'"; fi

if [[ ! -e "$T/curl-calls" ]]; then pass "curl was never invoked for the refused apiUrl"
else fail "curl was never invoked for the refused apiUrl" "curl called $(wc -l < "$T/curl-calls") time(s)"; fi

if [[ ! -s "$T/requests.log" ]]; then pass "no request reached the server for the refused apiUrl"
else fail "no request reached the server for the refused apiUrl" "log='$(cat "$T/requests.log")'"; fi

# --- Scenarios 3-5: curl reads no default config file, and never expands URL globs ---
# A default .curlrc (from $CURL_HOME, $XDG_CONFIG_HOME or $HOME) is read unless -q is curl's FIRST argument.
# One with `url =` sends the keyed request to a second host:port too; `trace-ascii =` writes the key to disk.
: > "$T/stolen.log"
python3 -I "$T/recorder.py" "$T/stolen.log" "$T/port2" &
SERVER2_PID=$!
for _ in $(seq 1 50); do [[ -s "$T/port2" ]] && break; sleep 0.1; done
if [[ ! -s "$T/port2" ]]; then
    fail "second recorder server starts" "no port2 file after 5s"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
PORT2=$(cat "$T/port2")

# $1 scenario label, $2 env var holding the .curlrc directory (HOME or CURL_HOME)
check_curlrc_ignored() {
    local label=$1 var=$2 dir="$T/rc-$2"
    mkdir -p "$dir"
    printf 'url = "http://127.0.0.1:%s/stolen"\ntrace-ascii = "%s/trace.txt"\n' "$PORT2" "$dir" > "$dir/.curlrc"
    : > "$T/requests.log"; : > "$T/stolen.log"
    (
        unset CURL_HOME XDG_CONFIG_HOME
        export "$var=$dir"
        oss_api_curl "$KEY" -sS -m 5 "http://127.0.0.1:$PORT/api/v1/subscription/status" >/dev/null 2>&1
    )
    if [[ "$(cat "$T/requests.log")" == "GET /api/v1/subscription/status|Bearer $KEY" ]]; then
        pass "$label: the intended request still reaches the API exactly once (check is not vacuous)"
    else
        fail "$label: the intended request still reaches the API exactly once" "log='$(sed "s/$KEY/<KEY>/g" "$T/requests.log")'"
    fi
    if [[ ! -s "$T/stolen.log" ]]; then pass "$label: a .curlrc url= line sends nothing to a second host:port"
    else fail "$label: a .curlrc url= line sends nothing to a second host:port" "stolen='$(sed "s/$KEY/<KEY>/g" "$T/stolen.log")'"; fi
    if [[ ! -e "$dir/trace.txt" ]]; then pass "$label: a .curlrc trace-ascii= line writes no trace file (key never on disk)"
    else fail "$label: a .curlrc trace-ascii= line writes no trace file" "trace file exists ($(grep -c "$KEY" "$dir/trace.txt") key line(s))"; fi
}
check_curlrc_ignored "HOME/.curlrc" HOME
check_curlrc_ignored "CURL_HOME/.curlrc" CURL_HOME

# A {a,b} or [1-2] in the URL is a curl glob unless --globoff: several keyed requests from one call.
: > "$T/requests.log"
oss_api_curl "$KEY" -sS -m 5 "http://127.0.0.1:$PORT/api/v1/{a,b}" >/dev/null 2>&1
KEYED=$(grep -c "|Bearer $KEY\$" "$T/requests.log")
if (( KEYED <= 1 )); then pass "a URL with {a,b} sends at most one keyed request (no glob expansion)"
else fail "a URL with {a,b} sends at most one keyed request" "$KEYED keyed requests: '$(sed "s/$KEY/<KEY>/g" "$T/requests.log" | tr '\n' ' ')'"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
