#!/bin/bash
# Integration test for hooks/oss-iron-laws-sync.sh against the REAL curl and a real local HTTP server.
#
# iron-laws-sync.test.sh and iron-laws-sync-safety.test.sh put a fake curl on PATH that ignores the URL,
# prints "<body>\n<code>\n" and (safety) records argv and the `--config -` stdin. This file checks what those
# fakes assume about the real one: that real curl, run the way the hook runs it, sends exactly one
# `GET <apiUrl>/api/v1/prompts/shared/iron-laws` with `Authorization: Bearer <key>` (the key decoded from
# curl's config syntax, quote and backslash included), keeps the key out of every process command line,
# and that its `-w '\n%{http_code}'` output is read the way the fake's is: the laws land in CLAUDE.md.
#
# @behavior /oss:login installs the IRON LAWS block from the API named in the OSS config, with the key read
#           by the shared reader (jq, or node when jq is missing), never from a nested object; a config file
#           that is two JSON documents sends nothing; a successful install stamps the apiUrl so session start
#           does not ask again for 24h; a symlink at a stamp path is replaced, never written through.
# @business-rule The API key goes only in a header to the configured, allowed API URL, never in argv, and
#           key and URL always come from one JSON object; state files in ~/.oss are never followed out.
# @boundary Real curl (behind a shim that records argv and refuses any URL but this run's 127.0.0.1:PORT),
#           a real python3 http.server on a random 127.0.0.1 port, sandbox HOME, fake keys. Nothing stubbed.
#
# Event-driven: the server's port arrives through a fifo; for the ps check the server writes `received` to a
# fifo once it has the request and holds the answer until the test creates `release`. Time limits (the
# server's hold backstop, the fifo reads) only stop a hang; no duration is asserted.
#
# Usage: ./hooks/__tests__/iron-laws-sync.real.integration.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/iron-laws-sync.real.integration.test.sh  (mutants)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"

RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
abort() { fail "$1" "$2"; echo ""; echo "Results: $((RUN - FAILED))/$RUN passed"; exit 1; }

for tool in python3 curl jq node; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "SKIP: $tool not found — real-curl integration test for oss-iron-laws-sync.sh NOT run"
        exit 0
    fi
done

# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME

source "$SCRIPT_DIR/lib/warm-stub.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SPID=''
cleanup() {
    : > "$T/release" 2>/dev/null   # never leave the server holding a request
    [[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }
    rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="sk-test-SYNC-$RND"
# The JSON text "sk-test-SYNC-q\"uo\\te-RND" decodes to sk-test-SYNC-q"uo\te-RND.
KEY_ESC_JSON="sk-test-SYNC-q\\\"uo\\\\te-$RND"
KEY_ESC="sk-test-SYNC-q\"uo\\te-$RND"
LAWS_PATH=/api/v1/prompts/shared/iron-laws
START='<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->'
END='<!-- IRON LAWS END -->'

# The API: one line per request "METHOD PATH|AUTHORIZATION" in $T/requests.log. Answers $T/status (default 200)
# with the bytes of $T/body. If $T/armed exists it holds that one request: removes armed, writes "received" to
# the $T/received fifo, and answers once $T/release exists (25 s backstop). Its port goes to the $T/portfifo fifo.
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
        with open(os.path.join(d, 'requests.log'), 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        armed = os.path.join(d, 'armed')
        if os.path.exists(armed):
            os.remove(armed)
            with open(os.path.join(d, 'received'), 'w') as f: f.write('received\n')
            deadline = time.time() + 25
            while not os.path.exists(os.path.join(d, 'release')) and time.time() < deadline:
                time.sleep(0.02)
        body = rd('body', b'')
        try:
            self.send_response(int(rd('status', b'200').strip() or b'200'))
            self.send_header('Content-Type', 'text/markdown')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass
    def log_message(self, *a): pass
class S(http.server.ThreadingHTTPServer):
    daemon_threads = True
srv = S(('127.0.0.1', 0), H)
with open(os.path.join(d, 'portfifo'), 'w') as f: f.write('%d\n' % srv.server_address[1])
srv.serve_forever()
PY
mkfifo "$T/portfifo" "$T/received"
exec 5<> "$T/portfifo"   # read-write: neither side's open blocks
exec 4<> "$T/received"
: > "$T/requests.log"
python3 -I "$T/api.py" "$T" </dev/null >/dev/null 2>&1 4<&- 5<&- &
SPID=$!
read -r -t 20 -u 5 PORT && [[ "$PORT" =~ ^[0-9]+$ ]] || abort "the local API starts" "no port from the server"
exec 5<&-
LOCAL="http://127.0.0.1:$PORT"

# curl shim: records its argv (one line per call), refuses any URL that is not this run's local API, else
# execs the real curl with the same argv and stdin.
REAL_CURL=$(command -v curl)
[[ "$REAL_CURL" == /* ]] || abort "the hook runs the real curl" "curl is not a file on PATH"
warm_stub "$T/bin/curl" "printf '%s\n' \"\$*\" >> '$T/curl.argv'
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in ($LOCAL/*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

# A PATH with node but no jq: the shim, then the system dirs minus jq and python, plus node.
mkdir -p "$T/sys"
for d in /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        b=${f##*/}
        case "$b" in (jq|jq.*|jq[0-9]*|python*|node*) continue ;; esac
        [[ -e "$T/sys/$b" ]] || ln -s "$f" "$T/sys/$b"
    done
done
ln -s "$(command -v node)" "$T/sys/node"
PATH_JQ="$T/bin:$PATH"
PATH_NODE="$T/bin:$T/sys"
if [[ -z "$(PATH="$PATH_NODE" command -v jq)" && -n "$(PATH="$PATH_NODE" command -v node)" ]]; then
    pass "control: the no-jq PATH has node and no jq"
else abort "control: the no-jq PATH has node and no jq" "jq='$(PATH="$PATH_NODE" command -v jq)' node='$(PATH="$PATH_NODE" command -v node)'"; fi

# laws <tag>: a realistic laws body (heading, "IRON LAW", well over 500 bytes), with a final newline.
laws() {
    printf '# IRON LAWS - FROM THE LOCAL API %s\n\n## IRON LAW #1: TDD\n\nNo production code without a failing test first.\n' "$1"
    local i
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        printf 'Rule line %s: write the failing test, watch it fail, then write minimal code.\n' "$i"
    done
}
# cfg_nested <home> <apiKey as JSON text>: nested objects with their own apiKey/apiUrl come BEFORE the
# top-level fields, so a reader that greps for the first "apiKey" or "apiUrl" gets the wrong one.
cfg_nested() {
    mkdir -p "$1/.oss"
    printf '{\n  "webhook": {"apiKey": "webhook-secret-%s", "apiUrl": "https://webhook.example.invalid", "enabled": true},\n  "models": {"default": "claude", "apiUrl": "https://models.example.invalid", "agents": {"oss:code-reviewer": "ollama/qwen2.5-coder"}},\n  "apiKey": "%s",\n  "apiUrl": "%s"\n}\n' \
        "$RND" "$2" "$LOCAL" > "$1/.oss/config.json"
}
# run_sync <PATH> <home> <project> [args]: the hook with that PATH and sandbox HOME, the loopback opt-in on.
run_sync() {
    local p="$1" h="$2" proj="$3"; shift 3
    mkdir -p "$T/tmp"
    OUT=$(cd "$T" && env -u CLAUDE_PLUGIN_ROOT TMPDIR="$T/tmp" HOME="$h" OSS_ALLOW_HTTP_LOOPBACK=1 CLAUDE_PROJECT_DIR="$proj" \
        PATH="$p" "$SH" "$HOOKS/oss-iron-laws-sync.sh" "$@" 2>"$T/err" </dev/null 4<&-); RC=$?
    ERR=$(cat "$T/err")
}
fresh() { : > "$T/requests.log"; rm -f "$T/curl.argv" "$T/status" "$T/release"; }
reqs() { wc -l < "$T/requests.log" | tr -d ' '; }
redact() { sed -e "s/$RND/<RND>/g"; }
# expect_block <file> <body file>: CLAUDE.md made by --install in an empty project.
expect_block() { { printf '%s\n\n' "$START"; cat "$2"; printf '\n%s\n' "$END"; } | cmp -s - "$1"; }
no_key_in_argv() { [[ -s "$T/curl.argv" ]] && ! grep -qF "sk-test-SYNC" "$T/curl.argv" && ! grep -q refused "$T/curl.argv"; }

# ==================== 1. The key goes out from the shared reader (jq, then node) ====================
# --- 1a: jq on PATH; the request is held while ps is read ---
H1="$T/h1"; P1="$T/p1"; mkdir -p "$P1"; cfg_nested "$H1" "$KEY"
fresh; laws jq > "$T/laws-jq"; printf '%s' "$(laws jq)" > "$T/body"   # no final newline: '\n%{http_code}' alone ends the line
: > "$T/armed"
(run_sync "$PATH_JQ" "$H1" "$P1" --install; printf '%s' "$RC" > "$T/1a.rc"; printf '%s' "$OUT" > "$T/1a.out") 4<&- &
CLIENT=$!
HELD=0; SAW_CURL=0; KEY_IN_PS=0
if read -r -t 20 -u 4 MARK && [[ "$MARK" == received ]]; then
    HELD=1
    PS_OUT=$(ps -axo args= 2>/dev/null)
    while IFS= read -r LINE; do
        [[ "$LINE" == *curl*"$LOCAL$LAWS_PATH"* ]] && SAW_CURL=1
        [[ "$LINE" == *"$KEY"* ]] && KEY_IN_PS=1
    done <<< "$PS_OUT"
fi
: > "$T/release"
wait "$CLIENT"
RC=$(cat "$T/1a.rc" 2>/dev/null); OUT=$(cat "$T/1a.out" 2>/dev/null); ERR=$(cat "$T/err" 2>/dev/null)

if [[ "$(cat "$T/requests.log")" == "GET $LAWS_PATH|Bearer $KEY" ]]; then
    pass "1a (jq): the API got exactly one 'GET $LAWS_PATH' with 'Authorization: Bearer <top-level apiKey>'"
else fail "1a (jq): exactly one keyed GET with the top-level key" "log='$(redact < "$T/requests.log")' err='$(printf '%s' "$ERR" | redact)'"; fi
if [[ $HELD == 1 && $SAW_CURL == 1 && $KEY_IN_PS == 0 ]]; then
    pass "1a (jq): while the request was held, the hook's curl was in ps and the key was in no process command line"
else fail "1a (jq): key never in ps (curl seen while held)" "held=$HELD saw_curl=$SAW_CURL key_in_ps=$KEY_IN_PS"; fi
if no_key_in_argv; then pass "1a (jq): the key is in no curl argv (shim record) and no URL was refused"
else fail "1a (jq): the key is in no curl argv" "argv=$(redact < "$T/curl.argv" 2>/dev/null)"; fi
if [[ "$RC" == 0 ]] && expect_block "$P1/CLAUDE.md" "$T/laws-jq" && [[ "$OUT" == "$(cat "$T/laws-jq")" ]]; then
    pass "1a (jq): real curl's '<body>\\n200' is read as the stub's: CLAUDE.md is exactly START, the laws, END; the laws printed once"
else fail "1a (jq): the laws block written and printed" "rc=$RC CLAUDE.md=$(head -c 300 "$P1/CLAUDE.md" 2>&1 | redact)"; fi

# --- 3. (uses 1a's run) the stamp holds the apiUrl; session start within 24h asks nothing ---
STAMP="$H1/.oss/.iron-laws-last-check"
if [[ -f "$STAMP" && ! -L "$STAMP" ]] && printf '%s\n' "$LOCAL" | cmp -s - "$STAMP"; then
    pass "3: after a successful install the stamp is a regular file holding exactly the apiUrl"
else fail "3: the stamp is a regular file holding the apiUrl" "stamp=$(ls -l "$STAMP" 2>&1) content='$(cat "$STAMP" 2>&1)'"; fi
fresh; cp "$P1/CLAUDE.md" "$T/p1.before"
run_sync "$PATH_JQ" "$H1" "$P1"
if [[ "$RC" == 0 && "$(reqs)" == 0 && ! -e "$T/curl.argv" ]] && cmp -s "$T/p1.before" "$P1/CLAUDE.md"; then
    pass "3: a session-start run within 24h (same apiUrl, opt-in on) sends no request and leaves CLAUDE.md alone"
else fail "3: no request within 24h" "rc=$RC requests=$(reqs) argv=$(redact < "$T/curl.argv" 2>/dev/null) err='$ERR'"; fi
fresh; touch -t 202601010000 "$STAMP"
run_sync "$PATH_JQ" "$H1" "$P1"
if [[ "$RC" == 0 && "$(reqs)" == 1 ]]; then pass "3: control: the same run with a stale stamp does send one request (the zero above is not vacuous)"
else fail "3: control: a stale stamp sends one request" "rc=$RC requests=$(reqs) err='$(printf '%s' "$ERR" | redact)'"; fi

# --- 1b: node, no jq; the key holds a quote and a backslash (curl config syntax must decode them) ---
H1B="$T/h1b"; P1B="$T/p1b"; mkdir -p "$P1B"; cfg_nested "$H1B" "$KEY_ESC_JSON"
fresh; laws node > "$T/laws-node"; cp "$T/laws-node" "$T/body"   # final newline: the stub's shape
run_sync "$PATH_NODE" "$H1B" "$P1B" --install
if [[ "$(cat "$T/requests.log")" == "GET $LAWS_PATH|Bearer $KEY_ESC" ]]; then
    pass "1b (node, no jq): the API got exactly one GET with 'Authorization: Bearer <top-level key>', quote and backslash decoded"
else fail "1b (node, no jq): exactly one keyed GET with the decoded top-level key" "rc=$RC log='$(redact < "$T/requests.log")' err='$(printf '%s' "$ERR" | redact)'"; fi
if no_key_in_argv; then pass "1b (node, no jq): the key is in no curl argv and no URL was refused"
else fail "1b (node, no jq): the key is in no curl argv" "argv=$(redact < "$T/curl.argv" 2>/dev/null)"; fi
if [[ "$RC" == 0 ]] && expect_block "$P1B/CLAUDE.md" "$T/laws-node"; then pass "1b (node, no jq): CLAUDE.md is exactly START, the laws, END"
else fail "1b (node, no jq): the laws block written" "rc=$RC CLAUDE.md=$(head -c 300 "$P1B/CLAUDE.md" 2>&1 | redact)"; fi

# ==================== 2. A config that is two concatenated JSON documents sends nothing ====================
for reader in jq node; do
    H2="$T/h2-$reader"; P2="$T/p2-$reader"; mkdir -p "$H2/.oss" "$P2"
    printf '{"apiKey":"%s","apiUrl":"%s"}\n{"apiKey":"%s-second","apiUrl":"%s"}\n' "$KEY" "$LOCAL" "$KEY" "$LOCAL" > "$H2/.oss/config.json"
    printf '# My Project\n\nUser rules.\n' > "$P2/CLAUDE.md"; cp "$P2/CLAUDE.md" "$T/p2.before"
    fresh; cp "$T/laws-jq" "$T/body"
    if [[ $reader == jq ]]; then run_sync "$PATH_JQ" "$H2" "$P2" --install; else run_sync "$PATH_NODE" "$H2" "$P2" --install; fi
    if [[ "$RC" == 4 && "$(reqs)" == 0 && ! -e "$T/curl.argv" && "$OUT$ERR" != *sk-test-SYNC* ]] && cmp -s "$T/p2.before" "$P2/CLAUDE.md"; then
        pass "2 ($reader): two concatenated documents: exit 4, the server got no request, curl never ran, CLAUDE.md unchanged"
    else fail "2 ($reader): two documents send nothing" "rc=$RC requests=$(reqs) argv=$(redact < "$T/curl.argv" 2>/dev/null) err='$(printf '%s' "$ERR" | redact)'"; fi
done

# ==================== 4. A symlink at a stamp path is replaced, never written through ====================
# --- 4a: the fresh stamp (written after a successful install) ---
H4="$T/h4"; P4="$T/p4"; mkdir -p "$P4"; cfg_nested "$H4" "$KEY"
printf 'victim-original\n' > "$T/victim"; cp "$T/victim" "$T/victim.before"
ln -s "$T/victim" "$H4/.oss/.iron-laws-last-check"
fresh; cp "$T/laws-jq" "$T/body"
run_sync "$PATH_JQ" "$H4" "$P4" --install
S4="$H4/.oss/.iron-laws-last-check"
if [[ "$RC" == 0 && "$(reqs)" == 1 ]] && cmp -s "$T/victim.before" "$T/victim" \
   && [[ -f "$S4" && ! -L "$S4" ]] && printf '%s\n' "$LOCAL" | cmp -s - "$S4"; then
    pass "4a: a symlink at the stamp: after a successful install the victim is unchanged and the stamp is a regular file holding the apiUrl"
else fail "4a: the stamp symlink is replaced, the victim untouched" "rc=$RC requests=$(reqs) victim='$(cat "$T/victim")' stamp=$(ls -l "$S4" 2>&1) err='$(printf '%s' "$ERR" | redact)'"; fi
# --- 4b: the backoff stamp (written after a failed fetch) ---
H4B="$T/h4b"; P4B="$T/p4b"; mkdir -p "$P4B"; cfg_nested "$H4B" "$KEY"
printf 'victim-original\n' > "$T/victim-b"
ln -s "$T/victim-b" "$H4B/.oss/.iron-laws-backoff"
fresh; printf 500 > "$T/status"; printf 'server error' > "$T/body"
run_sync "$PATH_JQ" "$H4B" "$P4B" --install
B4="$H4B/.oss/.iron-laws-backoff"
if [[ "$RC" == 4 && "$(reqs)" == 1 ]] && cmp -s "$T/victim.before" "$T/victim-b" && [[ -f "$B4" && ! -L "$B4" && ! -s "$B4" ]]; then
    pass "4b: a symlink at the backoff stamp: after a real 500 the victim is unchanged and the backoff is an empty regular file"
else fail "4b: the backoff symlink is replaced, the victim untouched" "rc=$RC requests=$(reqs) victim='$(cat "$T/victim-b")' backoff=$(ls -l "$B4" 2>&1)"; fi
rm -f "$T/status"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
