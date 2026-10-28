#!/bin/bash
# Integration (no curl stub): with apiUrl pointing at a real local HTTP server, the hooks and the wrapper verbs
# really send their requests there, with the key in the Authorization header (release channels US-002, ADR-005).
#
# @behavior The unit tests prove where each call is AIMED with a curl stub that records arguments. This test
#           runs the real curl through oss_api_curl against a real server and checks what ARRIVES: method,
#           path, and "Authorization: Bearer <key>". The key is never on any process command line.
# @business-rule On a DEV/STAGING config every keyed call reaches the configured API, authenticated, and nothing
#           reaches production.
#
# Usage: ./hooks/__tests__/release-channels.real.integration.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T="$(mktemp -d)"; SERVER_PID=""
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
KEY="oss_itest_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

cat > "$T/recorder.py" << 'PY'
import http.server, sys, os
log_path, port_path = sys.argv[1], sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        with open(log_path, 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path.split('?')[0], self.headers.get('Authorization', '')))
        body = b'{"status":"active","valid":true,"workflows":[]}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    do_GET = do_POST = _record
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
with open(port_path + '.tmp', 'w') as f: f.write(str(srv.server_address[1]))
os.rename(port_path + '.tmp', port_path)
srv.serve_forever()
PY
: > "$T/requests.log"
python3 -I "$T/recorder.py" "$T/requests.log" "$T/port" &
SERVER_PID=$!
for _ in $(seq 1 50); do [[ -s "$T/port" ]] && break; sleep 0.1; done
[[ -s "$T/port" ]] || { fail "recorder server starts" "no port after 5s"; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1; }
API="http://127.0.0.1:$(cat "$T/port")"

mkdir -p "$T/home/.oss" "$T/proj" "$T/bin"
printf '{"apiKey":"%s","apiUrl":"%s"}' "$KEY" "$API" > "$T/home/.oss/config.json"
# A curl that also records any argv holding the key, then runs the REAL curl.
REAL_CURL="$(command -v curl)"
printf '#!/bin/sh\ncase " $* " in *%s*) echo leaked >> "%s/argv-leak";; esac\nexec "%s" "$@"\n' "$KEY" "$T" "$REAL_CURL" > "$T/bin/curl"
chmod +x "$T/bin/curl"
N=0
run() {  # run <script> [args...] with the sandbox HOME/config and the recording curl first on PATH. Each run gets its
         # own output file: oss-session-start leaves a background notifier that writes to its stdout later.
    N=$((N + 1)); OUT="$T/out.$N"
    (cd "$T/proj" && env -u CLAUDE_PLUGIN_ROOT HOME="$T/home" OSS_CONFIG_DIR="$T/home/.oss" CLAUDE_PROJECT_DIR="$T/proj" \
        PATH="$T/bin:$PATH" perl -e 'alarm 30; exec @ARGV' bash "$@" </dev/null >"$OUT" 2>/dev/null)
}
arrived() {  # arrived <method> <path>: the request reached the server with the key in the Authorization header
    grep -qxF "$1 $2|Bearer $KEY" "$T/requests.log"
}

# fetch-iron-laws.sh is not driven here since FR15: the decrypt CLI makes that request (verified against the
# signed manifest), and its request to the configured API is tested in packages/cli-decrypt.

run "$ROOT/hooks/oss-session-start.sh"
arrived GET /api/v1/subscription/status && pass "oss-session-start's subscription check reaches the configured API, authenticated" \
    || fail "oss-session-start's subscription check reaches the configured API, authenticated" "log: $(tr '\n' ' ' < "$T/requests.log")"

run "$ROOT/hooks/oss-push-metrics.sh" '{"event":"itest"}'
arrived POST /api/v1/metrics/command-completion && pass "oss-push-metrics posts to the configured API, authenticated" \
    || fail "oss-push-metrics posts to the configured API, authenticated" "log: $(tr '\n' ' ' < "$T/requests.log")"

for ep in auth/verify workflows; do
    run "$ROOT/hooks/oss-value.sh" api "$ep"
    if arrived GET "/api/v1/$ep" && grep -q '"valid":true' "$OUT"; then pass "oss-value.sh api $ep reaches the configured API, authenticated, and prints the answer"
    else fail "oss-value.sh api $ep reaches the configured API, authenticated, and prints the answer" "log: $(tr '\n' ' ' < "$T/requests.log") out: $(cat "$OUT")"; fi
done

run "$ROOT/hooks/oss-value.sh" keycheck
[[ "$(cat "$OUT")" == "API key configured" ]] && pass "oss-value.sh keycheck reports the key without printing it" \
    || fail "oss-value.sh keycheck reports the key without printing it" "out: $(cat "$OUT")"

! grep -rq "$KEY" "$T"/out.* && [[ ! -e "$T/argv-leak" ]] && pass "the key was never on a curl command line or in any output" \
    || fail "the key was never on a curl command line or in any output" "leak marker or key in output"
! grep -q "onrender.com" "$T/requests.log" && pass "every request went to the configured API" \
    || fail "every request went to the configured API" "log: $(cat "$T/requests.log")"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
