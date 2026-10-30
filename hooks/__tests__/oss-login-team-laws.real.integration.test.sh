#!/bin/bash
# Integration test for hooks/oss-login.sh and hooks/oss-fetch-team-iron-laws.sh against the REAL curl and
# real local HTTP servers.
#
# oss-value.test.sh section 22 (login) and oss-fetch-team-iron-laws.test.sh use a fake curl that prints
# "<body>\n<http code>" and records argv and the `--config -` stdin. This file checks what those fakes
# assume about the real one: that real curl, run the way each hook runs it, sends exactly one
# `GET <apiUrl><path>` with `Authorization: Bearer <key>`, keeps the key out of every process command
# line, and that its `-w "\n%{http_code}"` output (including a refused connection, code 000) is read the
# way the fake's output is: 200 saves/caches, anything else falls back.
#
# @behavior /oss:login checks a key against the configured API and saves it only when the API accepts it;
#           with a plain-http local API and no opt-in it sends nothing and names the switch. The team
#           IRON LAWS fetch prints and caches the team's laws, falls back when the API fails, then stops
#           asking for a while; a cache from one API is never served for another.
# @business-rule The API key goes only in a header to the configured, allowed API URL, never in argv;
#           an API that is down is not asked again on every check; one API's laws are never shown as
#           another's.
# @boundary Real curl, real python3 http.server on 127.0.0.1 (random free ports), temp HOME and
#           OSS_CONFIG_DIR with a fake key. Nothing is stubbed.
#
# Event-driven: for the ps check the recorder signals `received` (a fifo) once it has the request, then
# holds the response until the test creates `release`. Time limits (the recorder's hold backstop, the
# fifo read, the port poll) only stop a hang; no duration is asserted.
#
# Usage: ./hooks/__tests__/oss-login-team-laws.real.integration.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-login-team-laws.real.integration.test.sh  (mutants)
#        BASH_UNDER_TEST=/opt/homebrew/bin/bash ./hooks/__tests__/oss-login-team-laws.real.integration.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"

RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

for tool in python3 curl jq git; do
    # login builds config.json with jq, and its value folder is keyed by git: both are required.
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "SKIP: $tool not found — real-curl integration test for oss-login.sh / oss-fetch-team-iron-laws.sh NOT run"
        exit 0
    fi
done

# A developer's exported overrides must not lead the hooks to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
PIDS=''
PORTS=''
# Pids of the curl processes this test caused: real curl whose argv holds one of this run's ports.
our_curls() { local p; for p in $PORTS; do pgrep -f "curl .*127\\.0\\.0\\.1:$p/"; done; }
cleanup() {
    local pid
    : > "$T/A/release" 2>/dev/null   # never leave the recorder holding a request
    for pid in $(our_curls); do kill "$pid" 2>/dev/null; done
    for pid in $PIDS; do kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; done
    rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Fake keys in the shape the unit tests use, with a random tail so a ps match can only be this run's key.
RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="sk-test-INTEGRATION-$RND"
KEY2="sk-test-INTEGRATION-refused-$RND"

# Recorder: one line per request "METHOD PATH|AUTHORIZATION". Answers with the code in CTL/status
# (default 200) and the bytes of CTL/body (default {}). If CTL/armed exists, it holds that one request:
# removes armed, writes "received" to the CTL/received fifo, and answers only once CTL/release exists
# (or after 25 s, a backstop so a broken test cannot hang the server).
cat > "$T/recorder.py" << 'PY'
import http.server, os, sys, time
log_path, port_path, ctl = sys.argv[1], sys.argv[2], sys.argv[3]
def rd(name, default):
    try:
        with open(os.path.join(ctl, name), 'rb') as f: return f.read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def _record(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        with open(log_path, 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        armed = os.path.join(ctl, 'armed')
        if os.path.exists(armed):
            os.remove(armed)
            with open(os.path.join(ctl, 'received'), 'w') as f: f.write('received\n')
            deadline = time.time() + 25
            while not os.path.exists(os.path.join(ctl, 'release')) and time.time() < deadline:
                time.sleep(0.02)
        code = int(rd('status', b'200').strip() or b'200')
        body = rd('body', b'{}')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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

# start_server <name>: a recorder with control dir $T/<name>, log $T/<name>/requests.log.
# Sets SPID and SPORT; returns 1 if it did not start.
start_server() {
    local d="$T/$1"
    mkdir -p "$d"; : > "$d/requests.log"
    python3 -I "$T/recorder.py" "$d/requests.log" "$d/port" "$d" </dev/null >/dev/null 2>&1 4<&- &
    SPID=$!; PIDS="$PIDS $SPID"
    for _ in $(seq 1 50); do [[ -s "$d/port" ]] && break; sleep 0.1; done
    [[ -s "$d/port" ]] || return 1
    SPORT=$(cat "$d/port"); PORTS="$PORTS $SPORT"
}
abort() { fail "$1" "$2"; echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1; }
reqs() { wc -l < "$T/$1/requests.log" | tr -d ' '; }
redact() { sed -e "s/$KEY/<KEY>/g" -e "s/$KEY2/<KEY2>/g" "$@"; }

mkdir -p "$T/A"; mkfifo "$T/A/received"
exec 4<> "$T/A/received"   # read-write, so neither side's open blocks
start_server A || abort "recorder server A starts" "no port file after 5s"
PORT_A=$SPORT
start_server B || abort "recorder server B starts" "no port file after 5s"
PORT_B=$SPORT
printf 500 > "$T/B/status"; printf '{"error":"server B is down"}' > "$T/B/body"

if [[ "$(command -v curl)" != /* ]]; then abort "the hooks run the real curl" "curl is not a file on PATH"; fi

# =========================================== /oss:login ===========================================
# The value folder (as /oss:login uses it): a repo, `oss-value.sh dir` in it, key.txt written there.
mkdir -p "$T/repo" "$T/home" "$T/cfg"
(cd "$T/repo" && git init -q) >/dev/null 2>&1
VD=$(cd "$T/repo" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$T/home" "$SH" "$HOOKS/oss-value.sh" dir 2>/dev/null </dev/null)
[[ -n "$VD" && -d "$VD" ]] || abort "oss-value.sh dir gives the value folder" "got '$VD'"

# login <key> <OSS_ALLOW_HTTP_LOOPBACK value>: write key.txt, run oss-login.sh; sets OUT, ERR, RC.
# The config is $OSS_CONFIG_DIR/config.json ($T/cfg), never ~/.oss/config.json of the sandbox HOME.
login() {
    printf '%s\n' "$1" > "$VD/key.txt"
    OUT=$(cd "$T/repo" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR OSS_ALLOW_HTTP_LOOPBACK="$2" HOME="$T/home" \
        OSS_CONFIG_DIR="$T/cfg" "$SH" "$HOOKS/oss-login.sh" 2>"$T/login.err" </dev/null 4<&-); RC=$?
    ERR=$(cat "$T/login.err")
}

# --- Scenario 1a: the API accepts the key (200): one keyed GET, key never in argv, config saved ---
printf '{"apiKey":"old-key-unused","apiUrl":"http://127.0.0.1:%s","other":1}\n' "$PORT_A" > "$T/cfg/config.json"
printf '{"plan":"pro"}' > "$T/A/body"
: > "$T/A/armed"
(login "$KEY" 1; printf '%s' "$RC" > "$T/s1.rc"; printf '%s' "$OUT" > "$T/s1.out"; printf '%s' "$ERR" > "$T/s1.err") 4<&- &
CLIENT=$!
SAW_CURL=0; KEY_IN_PS=0; HELD=0
if read -r -t 20 -u 4 MARK && [[ "$MARK" == received ]]; then
    HELD=1
    PS_OUT=$(ps -axo args= 2>/dev/null)
    while IFS= read -r LINE; do
        [[ "$LINE" == *curl*"127.0.0.1:$PORT_A/api/v1/subscription/status"* ]] && SAW_CURL=1
        [[ "$LINE" == *"$KEY"* ]] && KEY_IN_PS=1
    done <<< "$PS_OUT"
fi
: > "$T/A/release"
wait "$CLIENT"
RC=$(cat "$T/s1.rc" 2>/dev/null); OUT=$(cat "$T/s1.out" 2>/dev/null); ERR=$(cat "$T/s1.err" 2>/dev/null)

if [[ $HELD == 1 ]]; then pass "1: the recorder held login's key check in flight while ps was read"
else fail "1: the recorder held login's key check in flight while ps was read" "no 'received' within 20s"; fi
if [[ "$(cat "$T/A/requests.log")" == "GET /api/v1/subscription/status|Bearer $KEY" ]]; then
    pass "1: the API got exactly one 'GET /api/v1/subscription/status' with 'Authorization: Bearer <key>' (the stub's URL and header)"
else fail "1: exactly one GET /api/v1/subscription/status with the Bearer key" "log='$(redact "$T/A/requests.log")'"; fi
if [[ $HELD == 1 && $SAW_CURL == 1 ]]; then pass "1: login's curl was seen in ps while the request was held (ps check is not vacuous)"
else fail "1: login's curl was seen in ps while the request was held" "never saw it"; fi
if [[ $HELD == 1 && $KEY_IN_PS == 0 ]]; then pass "1: the key never appeared in any process command line during login"
else fail "1: the key never appeared in any process command line during login" "key found in ps -axo args"; fi
if [[ "$RC" == 0 && "$OUT" == "Plan: pro" ]]; then pass "1: real curl's '<body>\\n200' output is read as the stub's: rc 0, 'Plan: pro'"
else fail "1: login succeeds and prints the plan" "rc=$RC out='$OUT' err='$(printf '%s' "$ERR" | redact)'"; fi
if [[ "$(jq -c . "$T/cfg/config.json" 2>/dev/null)" == "{\"apiKey\":\"$KEY\",\"apiUrl\":\"http://127.0.0.1:$PORT_A\",\"other\":1}" ]]; then
    pass "1: \$OSS_CONFIG_DIR/config.json now holds the key, the server's apiUrl and the other settings kept"
else fail "1: config.json holds the key with apiUrl kept" "cfg=$(redact "$T/cfg/config.json")"; fi
if [[ ! -e "$T/home/.oss/config.json" && ! -e "$VD/key.txt" ]]; then pass "1: ~/.oss/config.json is not written and key.txt is gone"
else fail "1: ~/.oss/config.json not written, key.txt gone" "home cfg exists: $([[ -e "$T/home/.oss/config.json" ]] && echo y || echo n); key.txt: $([[ -e "$VD/key.txt" ]] && echo y || echo n)"; fi

# --- Scenario 1b: the API refuses the key (401): login fails and does not save it ---
printf '{"apiKey":"keep-key-unused","apiUrl":"http://127.0.0.1:%s"}\n' "$PORT_A" > "$T/cfg/config.json"
cp "$T/cfg/config.json" "$T/cfg.before"
: > "$T/A/requests.log"; printf 401 > "$T/A/status"; printf '{"error":"bad key"}' > "$T/A/body"
login "$KEY2" 1
if [[ "$(cat "$T/A/requests.log")" == "GET /api/v1/subscription/status|Bearer $KEY2" ]]; then
    pass "1b: the refused key was really checked (one keyed GET reached the API)"
else fail "1b: one keyed GET reached the API" "log='$(redact "$T/A/requests.log")'"; fi
if [[ "$RC" != 0 && "$OUT" != *Plan:* && "$ERR" == *"Invalid API key"* ]] && cmp -s "$T/cfg.before" "$T/cfg/config.json" \
   && ! grep -qF "$KEY2" "$T/cfg/config.json"; then
    pass "1b: a real 401 → rc != 0, 'Invalid API key', config.json byte for byte unchanged"
else fail "1b: a 401 is not saved" "rc=$RC out='$OUT' err='$(printf '%s' "$ERR" | redact)' cfg=$(redact "$T/cfg/config.json")"; fi
rm -f "$T/A/status"

# --- Scenario 1c: the API's plan string holds control characters (JSON escapes, as a real server sends them):
# ESC [2J (clear screen), BEL, CR, NUL, DEL, C1 CSI, U+202E (bidi override). None reaches the terminal. ---
: > "$T/A/requests.log"
printf '{"plan":"pro\\u001b[2J\\u0007\\r\\u0000\\u007f\\u009b\\u202ex"}' > "$T/A/body"
printf '%s\n' "$KEY2" > "$VD/key.txt"
# The raw bytes, to a file: $(...) would drop a NUL and the final newline before od could see them.
(cd "$T/repo" && env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$T/home" \
    OSS_CONFIG_DIR="$T/cfg" "$SH" "$HOOKS/oss-login.sh" >"$T/1c.out" 2>"$T/1c.err" </dev/null 4<&-); RC=$?
OUT=$(cat "$T/1c.out")
# Hex of every byte login printed (stdout + stderr) except stdout's one final newline. Any C0 byte (LF included),
# DEL, a C1 character (c2 80-9f) or a zero-width/bidi one (e2 80 8b-8f, e2 80 aa-ae, e2 81 a6-a9) fails the check.
CTRL_HEX=$(perl -0777 -pe 's/\n\z//' "$T/1c.out" | cat - "$T/1c.err" | od -An -v -tx1 | tr -s ' \n' ' ' \
    | perl -ne 'print "$1," while / (?=(0[0-9a-f]|1[0-9a-f]|7f|c2 [89][0-9a-f]|e2 80 (?:8[b-f]|a[a-e])|e2 81 a[6-9])(?: |$))/g')
if [[ "$RC" == 0 && "$(reqs A)" == 1 && "$(od -An -tx1 "$T/1c.out" | tr -d ' \n')" == "$(printf 'Plan: pro[2Jx\n' | od -An -tx1 | tr -d ' \n')" && -z "$CTRL_HEX" ]]; then
    pass "1c: a real 200 whose plan holds ESC/BEL/CR/NUL/DEL/C1/U+202E: output is exactly 'Plan: pro[2Jx', od shows no control byte"
else fail "1c: no control character reaches the terminal" "rc=$RC requests=$(reqs A) ctrl=[$CTRL_HEX] out-hex=$(printf '%s' "$OUT" | od -An -tx1 | tr -s ' \n' ' ')"; fi
cp "$T/cfg.before" "$T/cfg/config.json"   # scenario 2 compares against the 1b config
printf '{}' > "$T/A/body"

# --- Scenario 2: loopback apiUrl WITHOUT OSS_ALLOW_HTTP_LOOPBACK=1: no request, the switch line ---
: > "$T/A/requests.log"
login "$KEY2" ''
if [[ "$(reqs A)" == 0 ]]; then pass "2: without the opt-in, the local API got zero requests"
else fail "2: without the opt-in, zero requests" "log='$(redact "$T/A/requests.log")'"; fi
if [[ "$RC" != 0 && "$ERR" == "OSS: apiUrl is plain http to a local API, refused; set OSS_ALLOW_HTTP_LOOPBACK=1 to allow it." ]] \
   && cmp -s "$T/cfg.before" "$T/cfg/config.json"; then
    pass "2: login exits non-zero, stderr is exactly the switch line, config untouched"
else fail "2: the switch line, rc != 0, config untouched" "rc=$RC err='$(printf '%s' "$ERR" | redact)'"; fi

# ===================================== team IRON LAWS fetch =====================================
TEAM=team_INT-1
LAWS_A="{\"law1_tdd\":{\"enabled\":true,\"locked\":false},\"from\":\"server-A-$RND\"}"
# fetch <home>: run the fetch as oss-iron-law-check.sh does (no --force), config in <home>/.oss; sets OUT, RC.
fetch() {
    mkdir -p "$T/cwd"
    OUT=$(cd "$T/cwd" && OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$1" OSS_CONFIG_DIR='' "$SH" "$HOOKS/oss-fetch-team-iron-laws.sh" \
        </dev/null 2>"$T/fetch.err" 4<&-); RC=$?
}
team_cfg() { mkdir -p "$1/.oss"; printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:%s","teamId":"%s"}\n' "$KEY" "$2" "$TEAM" > "$1/.oss/config.json"; }
# The cache and its .src become 2 h old: past the 1 h TTL, so only the backoff can stop a request.
age_cache() { perl -e '$t = time - 7200; utime $t, $t, @ARGV' "$1/.oss/team-iron-laws.json" "$1/.oss/team-iron-laws.json.src"; }
is_default() { [[ "$OUT" == *'"law6_dev_docs"'* && "$OUT" != *server-A* && "$OUT" != *"server B"* ]]; }

# --- Scenario 3: 200 → body printed and cached with its .src; then 500 → fallback, backoff, no more requests ---
H3="$T/h3"; team_cfg "$H3" "$PORT_A"
: > "$T/A/requests.log"; printf '%s' "$LAWS_A" > "$T/A/body"
fetch "$H3"
if [[ "$(cat "$T/A/requests.log")" == "GET /api/v1/iron-laws/team/$TEAM|Bearer $KEY" ]]; then
    pass "3: the API got exactly one 'GET /api/v1/iron-laws/team/<teamId>' with 'Authorization: Bearer <key>'"
else fail "3: exactly one GET to the team endpoint with the Bearer key" "log='$(redact "$T/A/requests.log")'"; fi
if [[ "$RC" == 0 && "$OUT" == "$LAWS_A" ]]; then pass "3: a real 200: the output is exactly the server's body"
else fail "3: the output is the server's body" "rc=$RC out='$OUT' err=$(redact "$T/fetch.err")"; fi
if [[ "$(cat "$H3/.oss/team-iron-laws.json" 2>/dev/null)" == "$LAWS_A" \
   && "$(cat "$H3/.oss/team-iron-laws.json.src" 2>/dev/null)" == "http://127.0.0.1:$PORT_A/api/v1/iron-laws/team/$TEAM" ]]; then
    pass "3: the cache holds the body and the .src sidecar names the request URL"
else fail "3: cache + .src written" "cache='$(cat "$H3/.oss/team-iron-laws.json" 2>&1)' src='$(cat "$H3/.oss/team-iron-laws.json.src" 2>&1)'"; fi

age_cache "$H3"; printf 500 > "$T/A/status"; printf '{"error":"down"}' > "$T/A/body"
fetch "$H3"
if [[ "$(reqs A)" == 2 && "$RC" == 0 && "$OUT" == "$LAWS_A" ]]; then
    pass "3: a real 500 (stale cache): one more request, then this API's cached laws as the fallback"
else fail "3: a 500 falls back to this API's stale cache" "requests=$(reqs A) rc=$RC out='$OUT'"; fi
if [[ -e "$H3/.oss/.team-iron-laws-backoff" ]]; then pass "3: the failed fetch wrote the backoff stamp"
else fail "3: the failed fetch wrote the backoff stamp" "no $H3/.oss/.team-iron-laws-backoff"; fi
fetch "$H3"
if [[ "$(reqs A)" == 2 && "$RC" == 0 && "$OUT" == "$LAWS_A" ]]; then
    pass "3: inside the backoff the next check makes zero requests (count unchanged) and still prints the cached laws"
else fail "3: inside the backoff, zero requests" "requests=$(reqs A) (want 2) rc=$RC out='$OUT'"; fi
rm -f "$T/A/status"

# --- Scenario 3b: the server is stopped (a real refused connection, curl's code 000) ---
start_server C || abort "recorder server C starts" "no port file after 5s"
PORT_C=$SPORT
kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null
H3B="$T/h3b"; team_cfg "$H3B" "$PORT_C"
fetch "$H3B"
if [[ "$RC" == 0 ]] && is_default && [[ -e "$H3B/.oss/.team-iron-laws-backoff" && ! -e "$H3B/.oss/team-iron-laws.json" ]]; then
    pass "3b: connection refused: exit 0, the default config, backoff stamp written, nothing cached"
else fail "3b: connection refused falls back with a backoff" "rc=$RC out='$OUT' files=$(ls -A "$H3B/.oss" | tr '\n' ' ')"; fi

# --- Scenario 4: a cache written for server A is not served for server B (which answers 500) ---
H4="$T/h4"; team_cfg "$H4" "$PORT_A"
printf '%s' "$LAWS_A" > "$T/A/body"; : > "$T/A/requests.log"
fetch "$H4"
if [[ "$OUT" == "$LAWS_A" && "$(cat "$H4/.oss/team-iron-laws.json.src" 2>/dev/null)" == "http://127.0.0.1:$PORT_A/api/v1/iron-laws/team/$TEAM" ]]; then
    pass "4: control: a fresh cache from server A is in place"
else fail "4: control: fresh cache from server A" "out='$OUT'"; fi
team_cfg "$H4" "$PORT_B"; : > "$T/B/requests.log"
fetch "$H4"
if [[ "$(cat "$T/B/requests.log")" == "GET /api/v1/iron-laws/team/$TEAM|Bearer $KEY" ]]; then
    pass "4: with apiUrl now server B, the fresh A cache is not used: B got one keyed request"
else fail "4: B got one keyed request" "log='$(redact "$T/B/requests.log")'"; fi
if [[ "$RC" == 0 ]] && is_default; then pass "4: B's real 500: the default config, never server A's cached laws"
else fail "4: B's 500 gives the default config, not A's laws" "rc=$RC out='$OUT'"; fi

LEFT=$(our_curls)
if [[ -z "$LEFT" ]]; then pass "no curl to this run's ports is left running"
else fail "no curl to this run's ports is left running" "pid(s): $(echo $LEFT)"; fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
