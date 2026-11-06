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
# Scenario 1 is event-driven: the recorder signals `received` once it has the request headers and then
# holds the response until the test creates `release`, so the ps check runs while curl is provably
# in flight. Time limits (-m, the read timeout, the recorder's hold limit) only stop a hang; none is asserted.
#
# Usage: ./hooks/__tests__/oss-api-curl.real.integration.test.sh
#   OSS_API_CURL_HELPER=/path/to/oss-api-curl.sh  test another copy of the helper (e.g. a mutant)

set -uo pipefail
# A developer's exported OSS_CONFIG_DIR would point oss_api_url at the API that config names, so the
# real curl below would send there instead of the local recorder (T29). Loopback is opted in on purpose below.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER="${OSS_API_CURL_HELPER:-$(cd "$SCRIPT_DIR/.." && pwd)/oss-api-curl.sh}"
# shellcheck source=lib/warm-stub.sh
source "$SCRIPT_DIR/lib/warm-stub.sh"

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
    : > "$T/hold/release" 2>/dev/null   # never leave the recorder holding a request
    for pid in $SERVER_PID $SERVER2_PID; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
    rm -rf "$T"
}
trap cleanup EXIT

# A random key generated in-process, so it is never in this script's own argv or source.
KEY="oss_itest_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

# Recorder: one line per request "METHOD PATH|AUTHORIZATION". If HOLD_DIR/armed exists, it takes that
# one request on hold: removes armed, writes "received" to the HOLD_DIR/received fifo, and answers only
# once HOLD_DIR/release exists (or after 25 s, a backstop so a broken test cannot hang the server).
cat > "$T/recorder.py" << 'PY'
import http.server, os, sys, time
log_path, port_path = sys.argv[1], sys.argv[2]
hold_dir = sys.argv[3] if len(sys.argv) > 3 else ''
class H(http.server.BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        with open(log_path, 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        if hold_dir and os.path.exists(os.path.join(hold_dir, 'armed')):
            os.remove(os.path.join(hold_dir, 'armed'))
            with open(os.path.join(hold_dir, 'received'), 'w') as f: f.write('received\n')
            deadline = time.time() + 25
            while not os.path.exists(os.path.join(hold_dir, 'release')) and time.time() < deadline:
                time.sleep(0.02)
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
mkdir -p "$T/hold"
mkfifo "$T/hold/received"
exec 3<> "$T/hold/received"   # read-write, so neither side's open blocks
python3 -I "$T/recorder.py" "$T/requests.log" "$T/port" "$T/hold" &
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
# Warmed: the first-exec scan of the new shim happens here, not while a request is on hold.
if ! warm_stub "$T/bin/curl" "echo x >> \"$T/curl-calls\"
exec \"$REAL_CURL\" \"\$@\""; then
    fail "curl shim warms up" "warm_stub returned non-zero"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
export HOME="$T/home"
export OSS_ALLOW_HTTP_LOOPBACK=1   # the API here is a real local http server: plain http needs the opt-in (T20)
export PATH="$T/bin:$PATH"

# shellcheck source=/dev/null
source "$HELPER"

# --- Scenario 1: a real POST reaches the configured API with the key only in the header ---
: > "$T/hold/armed"
(API_URL=$(oss_api_url) && oss_api_curl "$KEY" -sS -m 30 -X POST "$API_URL/api/v1/analytics/track" -d '{}' \
    > "$T/curl.out" 2> "$T/curl.err" 3<&-; echo $? > "$T/curl.rc") &
CLIENT_PID=$!

# Wait for the recorder to say it holds the request (curl is now waiting for the answer), then read
# every process command line once, while it is held. 20 s is only a hang guard.
SAW_CURL=0; KEY_IN_PS=0; HELD=0
if read -r -t 20 -u 3 MARK && [[ "$MARK" == received ]]; then
    HELD=1
    PS_OUT=$(ps -axo args= 2>/dev/null)
    while IFS= read -r LINE; do
        [[ "$LINE" == *curl*"/api/v1/analytics/track"* ]] && SAW_CURL=1
        [[ "$LINE" == *"$KEY"* ]] && KEY_IN_PS=1
    done <<< "$PS_OUT"
fi
: > "$T/hold/release"
wait "$CLIENT_PID"

if [[ $HELD == 1 ]]; then pass "the recorder held the request in flight while ps was read"
else fail "the recorder held the request in flight while ps was read" "no 'received' from the recorder within 20s"; fi

if [[ "$(cat "$T/curl.rc" 2>/dev/null)" == 0 ]]; then pass "real curl POST to the local API succeeds"
else fail "real curl POST to the local API succeeds" "rc=$(cat "$T/curl.rc" 2>/dev/null) err=$(cat "$T/curl.err" 2>/dev/null)"; fi

EXPECTED="POST /api/v1/analytics/track|Bearer $KEY"
if [[ "$(cat "$T/requests.log")" == "$EXPECTED" ]]; then
    pass "server received exactly one 'POST /api/v1/analytics/track' with 'Authorization: Bearer <key>'"
else
    fail "server received exactly one POST /api/v1/analytics/track with the Bearer key" \
        "log='$(sed "s/$KEY/<KEY>/g" "$T/requests.log")'"
fi

if [[ $HELD == 1 && $SAW_CURL == 1 ]]; then pass "curl was observed in ps while the request was in flight (ps check is not vacuous)"
else fail "curl was observed in ps while the request was in flight" "never saw the curl process"; fi

if [[ $HELD == 1 && $KEY_IN_PS == 0 ]]; then pass "the key never appeared in any process command line during the request"
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
