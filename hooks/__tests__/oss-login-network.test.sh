#!/bin/bash
# /oss:login tells a refused key apart from a check that never got an answer (T77b).
#
# @behavior Only a real refusal of the key by the API (HTTP 401 or 403) says "Invalid API key". Offline, a timeout,
#           a body cut short, an oversized answer, a 5xx, a 429 or any other code say the key could not be verified
#           (a network or server problem) and to run /oss:login again. In every failure the key is not saved and
#           login fails; a 200 saves it as before.
# @business-rule A user with a good key on a bad connection must not be told the key is wrong, and nothing but a
#           complete 200 answer saves a key (user 2026-11-04 "Separate network message").
# @boundary Real curl (behind a shim that records argv and refuses any URL not on 127.0.0.1) against a python3
#           http.server on a random 127.0.0.1 port, whose status, Content-Length and delay each case sets. Sandbox
#           HOME, a fake key. Every hook run goes through run_capped. Never production, never ~/.oss.
#
# Usage: ./hooks/__tests__/oss-login-network.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-login-network.test.sh  (mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
abort() { fail "$1" "$2"; echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"; exit 1; }
echo "Running oss-login network tests..."

for tool in python3 curl jq; do command -v "$tool" >/dev/null 2>&1 || abort "$tool is required" "not found"; done
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/run-capped.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SPID=''
trap '[[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }; rm -rf "$T"' EXIT
KEY="ossk_t77b_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
CAP=262144
INVALID="Error: Invalid API key. Get a valid key from https://www.oneshotship.com/dashboard"
NETWORK="Error: Couldn't verify the key (network or server problem). Check your connection and run /oss:login again."

# The server answers with the status in $T/status (default 200) and the bytes of $T/body. With $T/short the
# Content-Length promises 1000 bytes more than the body (curl exit 18); with $T/slow it waits 15 s first (curl -m 10).
cat > "$T/api.py" << 'PY'
import http.server, os, sys, time
d = sys.argv[1]
def rd(name, default):
    try:
        with open(os.path.join(d, name), 'rb') as f: return f.read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if os.path.exists(os.path.join(d, 'slow')): time.sleep(15)
        body = rd('body', b'')
        self.send_response(int(rd('status', b'200')))
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body) + (1000 if os.path.exists(os.path.join(d, 'short')) else 0)))
        self.end_headers()
        try: self.wfile.write(body)
        except OSError: pass
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
srv.daemon_threads = True
with open(os.path.join(d, 'portfifo'), 'w') as f: f.write('%d\n' % srv.server_address[1])
srv.serve_forever()
PY
mkfifo "$T/portfifo"
exec 5<> "$T/portfifo"
python3 -I "$T/api.py" "$T" </dev/null >/dev/null 2>&1 5<&- &
SPID=$!
read -r -t 20 -u 5 PORT && [[ "$PORT" =~ ^[0-9]+$ ]] || abort "the local API starts" "no port from the server"
exec 5<&-
LOCAL="http://127.0.0.1:$PORT"
# A port nothing listens on: bound, then closed again.
DEAD_PORT=$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
[[ "$DEAD_PORT" =~ ^[0-9]+$ ]] || abort "a closed port is found" "got '$DEAD_PORT'"

REAL_CURL=$(command -v curl)
warm_stub "$T/bin/curl" "printf '%s\n' \"\$*\" >> '$T/curl.argv'
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in (http://127.0.0.1:*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

H="$T/home"; W="$T/w/cwd"
# login <url>: a clean sandbox HOME with the login hooks and a config holding an old key and <url>, the new key in
# the value folder, then the hook -> OUT, ERR, RC; the config before the run is in $T/cfg.before.
login() {
    rm -rf "$H" "$T/w"; mkdir -p "$H/.oss/hooks" "$W"; : > "$T/curl.argv"
    for n in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$n" "$H/.oss/hooks/"; done
    printf '{"apiKey":"old-key-kept","apiUrl":"%s"}\n' "$1" > "$H/.oss/config.json"; cp "$H/.oss/config.json" "$T/cfg.before"
    hook /bin/bash "$H/.oss/hooks/oss-value.sh" dir; [[ -n "$OUT" ]] && printf '%s\n' "$KEY" > "$OUT/key.txt"
    hook /bin/bash "$H/.oss/hooks/oss-login.sh"
}
hook() {
    OUT=$(cd "$W" && run_capped 60 env HOME="$H" PATH="$T/bin:$PATH" OSS_ALLOW_HTTP_LOOPBACK=1 "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
# answer <status> <body> [short|slow]: what the server sends next
answer() { rm -f "$T/short" "$T/slow"; printf '%s' "$1" > "$T/status"; printf '%s' "$2" > "$T/body"; [[ -n "${3:-}" ]] && : > "$T/$3"; return 0; }
pad() { printf '%s' "$1"; head -c $(($2 - ${#1})) /dev/zero | tr '\0' ' '; }
# refused <name> <expected message>: login failed with exactly that message, printed no plan, and left the config
# byte for byte as it was (the new key not saved).
refused() {
    if [[ "$RC" != 0 && -z "$OUT" && "$ERR" == "$2" ]] && cmp -s "$T/cfg.before" "$H/.oss/config.json"; then pass "$1"
    else fail "$1" "rc=$RC out=${OUT:0:200} err=${ERR:0:200} cfg=$(head -c 200 "$H/.oss/config.json")"; fi
}

# --- the control: a 200 saves the key -------------------------------------------------------------------------------
answer 200 '{"plan":"pro"}'; login "$LOCAL"
[[ "$RC" == 0 && "$OUT" == "Plan: pro" && "$(jq -r .apiKey "$H/.oss/config.json")" == "$KEY" ]] \
    && pass "a 200 saves the key and prints the plan (control)" || fail "a 200 saves the key" "rc=$RC out=$OUT err=$ERR"
grep -qF -- "$KEY" "$T/curl.argv" && fail "the key stays off curl's argv" "found in $(cat "$T/curl.argv")" \
    || pass "the key stays off curl's argv"

# --- a real refusal of the key: "Invalid API key" -------------------------------------------------------------------
answer 401 '{"error":"bad key"}'; login "$LOCAL"; refused "a 401 says Invalid API key, the key not saved" "$INVALID"
answer 403 '{"error":"forbidden"}'; login "$LOCAL"; refused "a 403 says Invalid API key, the key not saved" "$INVALID"

# --- every other failure: could not verify (network or server problem) ---------------------------------------------
answer 500 '{"error":"boom"}'; login "$LOCAL"; refused "a 500 is a server problem, not an invalid key; not saved" "$NETWORK"
answer 503 ''; login "$LOCAL"; refused "a 503 is a server problem, not an invalid key; not saved" "$NETWORK"
answer 429 '{"error":"slow down"}'; login "$LOCAL"; refused "a 429 is a server problem, not an invalid key; not saved" "$NETWORK"
answer 404 'not found'; login "$LOCAL"; refused "a 404 is not a refusal of the key; not saved" "$NETWORK"
login "http://127.0.0.1:$DEAD_PORT"; refused "connection refused is a network problem, not an invalid key; not saved" "$NETWORK"
answer 200 '{"plan":"pro"}' short; login "$LOCAL"; refused "a 200 cut short (curl exit 18) is a network problem; not saved" "$NETWORK"
answer 401 '{"error":"bad key"}' short; login "$LOCAL"; refused "a 401 cut short is no answer either: a network problem; not saved" "$NETWORK"
answer 200 "$(pad '{"plan":"pro"}' $((CAP + 1)))"; login "$LOCAL"; refused "a 200 over the size cap is a network problem; not saved" "$NETWORK"
answer 200 '{"plan":"pro"}' slow; login "$LOCAL"; refused "a timeout (curl -m 10) is a network problem; not saved" "$NETWORK"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
