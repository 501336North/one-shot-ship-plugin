#!/bin/bash
# Integration test for the analytics POST in hooks/oss-notify.sh, against the REAL curl and a real local HTTP server.
#
# oss-notify-api-url.test.sh and watcher/test/hooks/oss-notify-analytics-detach.test.ts use a fake curl. This
# file checks the assumptions those fakes encode about the real one: that the `--workflow <cmd> start` POST runs
# in a job detached from the hook's stdio (so the hook's caller is not held while the API is slow), and that
# real curl's `-m 5` ends that job by itself when the API never answers (so no curl is left behind).
#
# @behavior Starting a workflow command returns to Claude Code at once, even while the OSS API is still
#           holding the analytics request; the request still arrives (once, with the user's key). When the API
#           never answers, the background request gives up on its own and leaves no curl process behind.
# @business-rule Analytics is best effort: it must never block or slow a command, and it must never leak
#           processes on the user's machine.
# @boundary Real curl, real python3 http.server on 127.0.0.1 (random free port), temp HOME with a fake key and
#           apiUrl pointing at that server. Only node and oss-log.sh (other collaborators) are stubbed.
#
# Event-driven: the recorder signals `received` (a fifo) once it has the request, then holds the response until
# the test creates `release`. Time limits (the recorder's hold backstop, the 60 s watchdog, the curl exit poll)
# only stop a hang; no duration is asserted.
#
# Usage: ./hooks/__tests__/oss-notify-analytics.real.integration.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-notify-analytics.real.integration.test.sh  (mutants)
#        BASH_UNDER_TEST=/opt/homebrew/bin/bash ./hooks/__tests__/oss-notify-analytics.real.integration.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}/oss-notify.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
# shellcheck source=lib/warm-stub.sh
source "$SCRIPT_DIR/lib/warm-stub.sh"

RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

for tool in python3 curl jq; do
    # Without jq the hook ignores apiUrl and posts to the production API, so jq is required, not optional.
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "SKIP: $tool not found — real-curl integration test for oss-notify.sh analytics NOT run"
        exit 0
    fi
done

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SERVER_PID=''
PORT=''
# Pids of the curl processes this test caused: real curl whose argv holds this run's random port.
our_curls() { [[ -n "$PORT" ]] && pgrep -f "curl .*127\\.0\\.0\\.1:$PORT/api/v1/analytics/track"; }
cleanup() {
    local pid
    : > "$T/hold/release" 2>/dev/null   # never leave the recorder holding a request
    for pid in $(our_curls); do kill "$pid" 2>/dev/null; done
    [[ -n "$SERVER_PID" ]] && { kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }
    rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

KEY="oss_itest_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

# Recorder: one line per request "METHOD PATH|AUTHORIZATION". If HOLD_DIR/armed exists, it takes that one
# request on hold: removes armed, writes "received" to the HOLD_DIR/received fifo, and answers only once
# HOLD_DIR/release exists (or after 120 s, a backstop longer than the 60 s watchdog, so a broken test cannot
# hang the server and a hold always outlasts the watchdog).
cat > "$T/recorder.py" << 'PY'
import http.server, os, sys, time
log_path, port_path, hold_dir = sys.argv[1], sys.argv[2], sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        with open(log_path, 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        if os.path.exists(os.path.join(hold_dir, 'armed')):
            os.remove(os.path.join(hold_dir, 'armed'))
            with open(os.path.join(hold_dir, 'received'), 'w') as f: f.write('received\n')
            deadline = time.time() + 120
            while not os.path.exists(os.path.join(hold_dir, 'release')) and time.time() < deadline:
                time.sleep(0.02)
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b'{}')
        except OSError:
            pass
    do_GET = do_POST = _record
    def log_message(self, *a): pass
class S(http.server.ThreadingHTTPServer):
    daemon_threads = True
srv = S(('127.0.0.1', 0), H)
with open(port_path + '.tmp', 'w') as f: f.write(str(srv.server_address[1]))
os.rename(port_path + '.tmp', port_path)
srv.serve_forever()
PY
: > "$T/requests.log"
mkdir -p "$T/hold"
mkfifo "$T/hold/received"
exec 4<> "$T/hold/received"   # read-write, so neither side's open blocks; fd 4 (fd 3 is the hook's wait pipe)
python3 -I "$T/recorder.py" "$T/requests.log" "$T/port" "$T/hold" </dev/null >/dev/null 2>&1 4<&- &
SERVER_PID=$!
for _ in $(seq 1 50); do [[ -s "$T/port" ]] && break; sleep 0.1; done
if [[ ! -s "$T/port" ]]; then
    fail "recorder server starts" "no port file after 5s"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
PORT=$(cat "$T/port")

# Fake plugin root (the hook only sends analytics when update-workflow-state.js exists) and a no-op node,
# warmed once. curl is NOT stubbed: the PATH below adds only $T/bin (node) in front of the real PATH.
mkdir -p "$T/plugin/watcher/dist/cli" "$T/home/.oss" "$T/cwd"
: > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
if ! warm_stub "$T/plugin/hooks/oss-log.sh" 'exit 0' || ! warm_stub "$T/bin/node" 'exit 0'; then
    fail "stub warm-up" "a stub did not run"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi
printf '{"apiKey": "%s", "apiUrl": "http://127.0.0.1:%s"}\n' "$KEY" "$PORT" > "$T/home/.oss/config.json"
if [[ "$(PATH="$T/bin:$PATH" command -v curl)" == "$T/bin/curl" ]]; then
    fail "the hook runs the real curl" "a curl stub is on the test PATH"
    echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1
fi

# run_hook <out-file> <keep-fd3: y|n>
# Runs `oss-notify.sh --workflow build start` in the sandbox, in the background, under a 60 s watchdog.
# keep-fd3=n: $(...) returns when the hook's stdout/stderr close (what Claude Code waits for).
# keep-fd3=y: fd 3 is a second writer on the substitution's pipe that the detached job and its curl inherit,
#             so $(...) returns only when they have all exited.
# Sets HOOK_RETURNED=1 if the substitution returned, WATCHDOG_FIRED=1 if the watchdog had to stop it.
run_hook() {
    local out=$1 fd3=$2 pid wd
    rm -f "$T/watchdog.fired"
    (
        cd "$T/cwd" || exit 1
        if [[ $fd3 == y ]]; then
            o=$(HOME="$T/home" OSS_CONFIG_DIR='' CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR='' PATH="$T/bin:$PATH" \
                "$SH" "$HOOK" --workflow build start </dev/null 2>&1 3>&1 4<&-)
        else
            o=$(HOME="$T/home" OSS_CONFIG_DIR='' CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR='' PATH="$T/bin:$PATH" \
                "$SH" "$HOOK" --workflow build start </dev/null 2>&1 3<&- 4<&-)
        fi
        printf '%s' "$o" > "$out"
    ) &
    pid=$!
    # On firing, it records the curls still running, then stops them: the substitution only returns once its
    # pipe has no writer left (the subshell inherits this script's TERM trap, so killing it alone does nothing).
    ( trap 'kill $s 2>/dev/null; exit 0' TERM; sleep 60 & s=$!
      wait $s && { our_curls > "$T/watchdog.fired"; for c in $(cat "$T/watchdog.fired"); do kill "$c"; done; kill "$pid"; }
    ) </dev/null >/dev/null 2>&1 4<&- &
    wd=$!
    wait "$pid" 2>/dev/null
    kill "$wd" 2>/dev/null; wait "$wd" 2>/dev/null
    WATCHDOG_FIRED=0; [[ -e "$T/watchdog.fired" ]] && WATCHDOG_FIRED=1
    HOOK_RETURNED=0; [[ $WATCHDOG_FIRED == 0 && -e "$out" ]] && HOOK_RETURNED=1
}
# Waits (hang backstop 30 s) until no curl of this run is left. Returns 1 if one still is.
wait_no_curl() { local i; for i in $(seq 1 300); do our_curls >/dev/null || return 0; sleep 0.1; done; return 1; }

EXPECTED="POST /api/v1/analytics/track|Bearer $KEY"

# --- Scenario 1: the hook returns while the API still holds the analytics request ---
: > "$T/hold/armed"
run_hook "$T/s1.out" n
# The hook has returned (or the watchdog fired). The request may not have reached the server yet: wait for it.
HELD=0; CURL_ALIVE=0
if [[ $HOOK_RETURNED == 1 ]] && read -r -t 20 -u 4 MARK && [[ "$MARK" == received ]]; then
    HELD=1
    # The recorder holds the response and release does not exist yet: if the hook's curl is still running,
    # the hook returned while its request was provably still in flight.
    [[ ! -e "$T/hold/release" ]] && our_curls >/dev/null && CURL_ALIVE=1
fi
if [[ $HOOK_RETURNED == 1 ]]; then pass "the hook's output pipe closed (the hook returned)"
else fail "the hook's output pipe closed (the hook returned)" "watchdog fired after 60 s"; fi
if [[ $HELD == 1 ]]; then pass "the API received the analytics request and is holding it"
else fail "the API received the analytics request and is holding it" "no 'received' from the recorder within 20 s of the hook returning"; fi
if [[ $CURL_ALIVE == 1 ]]; then pass "real curl was still waiting on the held request after the hook returned (detached, not awaited)"
else fail "real curl was still waiting on the held request after the hook returned" \
    "no curl to 127.0.0.1:$PORT running once the hook returned: the hook waited for the request to end"; fi
: > "$T/hold/release"
if wait_no_curl; then pass "after the API answers, the background curl exits"
else fail "after the API answers, the background curl exits" "curl to 127.0.0.1:$PORT still running 30 s after release"; fi
if [[ "$(cat "$T/requests.log")" == "$EXPECTED" ]]; then
    pass "server received exactly one 'POST /api/v1/analytics/track' with 'Authorization: Bearer <key>'"
else
    fail "server received exactly one POST /api/v1/analytics/track with the Bearer key" \
        "log='$(sed "s/$KEY/<KEY>/g" "$T/requests.log")'"
fi
if [[ -z "$(cat "$T/s1.out" 2>/dev/null)" ]]; then pass "the start event writes nothing to the hook's stdout/stderr"
else fail "the start event writes nothing to the hook's stdout/stderr" "out='$(sed "s/$KEY/<KEY>/g" "$T/s1.out")'"; fi

# --- Scenario 2: the API never answers; real curl's -m ends the detached job by itself ---
rm -f "$T/hold/release"
: > "$T/requests.log"
: > "$T/hold/armed"
run_hook "$T/s2.out" y
if [[ $HOOK_RETURNED == 1 ]]; then
    pass "with the API never answering, the detached job and its curl end by themselves (\$(... 3>&1) returned)"
else fail "with the API never answering, the detached job and its curl end by themselves" \
    "watchdog fired after 60 s: real curl is not bounded by its -m limit"; fi
if read -r -t 1 -u 4 MARK && [[ "$MARK" == received ]] && [[ "$(cat "$T/requests.log")" == "$EXPECTED" ]]; then
    pass "the never-answering API did receive the request (the bound is curl's, not a missed connection)"
else fail "the never-answering API did receive the request" "log='$(sed "s/$KEY/<KEY>/g" "$T/requests.log")'"; fi
LEFT=$(our_curls; cat "$T/watchdog.fired" 2>/dev/null)
if [[ -z "$LEFT" ]]; then pass "no curl to the sandbox port is left running"
else fail "no curl to the sandbox port is left running" "curl pid(s) still running: $(echo $LEFT)"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
