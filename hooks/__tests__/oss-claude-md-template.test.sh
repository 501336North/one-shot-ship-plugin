#!/bin/bash
# /oss:login Step 4.2 fetches the CLAUDE.md template with ~/.oss/hooks/oss-claude-md-template.sh.
#
# @behavior A user whose OSS config names an API (apiUrl, in $OSS_CONFIG_DIR/config.json or
#           ~/.oss/config.json) gets the template from THAT API; their key is never sent anywhere else.
#           On any failure the command prints nothing on stdout, a reason on stderr, and exits non-zero,
#           so login skips the merge and tells the user.
# @business-rule The API key goes only to the URL oss_api_url allows for the config it came from
#           (oss_config_file), in a header fed to curl on stdin (oss_api_curl), never in argv. Plain http
#           is allowed only to loopback and only with OSS_ALLOW_HTTP_LOOPBACK=1 (T33, security F8, CR4).
# @boundary Real curl (behind a recording shim that refuses any host but 127.0.0.1) against a python3
#           http.server on a random 127.0.0.1 port. Sandbox HOME and OSS_CONFIG_DIR, a fake key.
#           Never production, never the real ~/.oss.
#
# Usage: ./hooks/__tests__/oss-claude-md-template.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-claude-md-template.test.sh  (mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
abort() { fail "$1" "$2"; echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"; exit 1; }

for tool in python3 curl jq; do command -v "$tool" >/dev/null 2>&1 || abort "$tool is required" "not found"; done
# A developer's exported overrides must not lead the hook to the real key or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME

source "$SCRIPT_DIR/lib/warm-stub.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SPID=''
trap '[[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }; rm -rf "$T"' EXIT
RND=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
KEY="sk-test-TEMPLATE-$RND"
TEMPLATE=$'# OSS Dev Workflow - Project Guidelines\n\nUse /oss:build.\n<!-- IRON LAWS will be injected here by /oss:login -->'

# The API: one line per request "METHOD PATH|AUTHORIZATION" in $T/requests.log; answers $T/status
# (default 200) with the bytes of $T/body. It writes its port to the fifo $T/portfifo once listening.
cat > "$T/api.py" << 'PY'
import http.server, os, sys
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
        body = rd('body', b'')
        mode = rd('mode', b'normal').strip()
        self.send_response(int(rd('status', b'200').strip() or b'200'))
        self.send_header('Content-Type', 'text/markdown')
        if mode == b'stall':        # promise more than is sent, then hang until the test writes $T/release
            self.send_header('Content-Length', str(len(body) + 4096))
        elif mode not in (b'nolength', b'flood'):   # nolength: no Content-Length, the body ends at close
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if mode == b'flood':        # body bytes repeated, no Content-Length; the count actually sent goes to sentfifo
            sent = 0
            try:
                while sent < 64 * 1024 * 1024:
                    self.wfile.write(body); self.wfile.flush(); sent += len(body)
            except OSError:
                pass
            with open(os.path.join(d, 'sentfifo'), 'w') as f: f.write('%d\n' % sent)
            return
        self.wfile.write(body)
        self.wfile.flush()
        if mode == b'stall':
            with open(os.path.join(d, 'release'), 'rb') as f: f.read(1)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
with open(os.path.join(d, 'portfifo'), 'w') as f: f.write('%d\n' % srv.server_address[1])
srv.serve_forever()
PY
mkfifo "$T/portfifo"
exec 5<> "$T/portfifo"   # read-write: neither side's open blocks
python3 -I "$T/api.py" "$T" </dev/null >/dev/null 2>&1 5<&- &
SPID=$!
read -r -t 20 -u 5 PORT && [[ "$PORT" =~ ^[0-9]+$ ]] || abort "the local API starts" "no port from the server"
exec 5<&-

# curl shim: records its argv, refuses any URL that is not this run's local API, else runs real curl.
REAL_CURL=$(command -v curl)
warm_stub "$T/bin/curl" "printf '%s\n' \"\$*\" >> '$T/curl.argv'
# OLD_CURL=1: drop --max-filesize, as a curl that does not enforce it for a body with no Content-Length would.
if [ -n \"\${OLD_CURL:-}\" ]; then n=\$#; i=0; skip=''; for a in \"\$@\"; do i=\$((i + 1)); if [ -n \"\$skip\" ]; then skip=''; elif [ \"\$a\" = --max-filesize ]; then skip=1; else set -- \"\$@\" \"\$a\"; fi; done; shift \$n; fi
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in (http://127.0.0.1:$PORT/*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

H="$T/home"; CFG="$T/cfg"
# run_tpl [VAR=value...]: run the hook with the sandbox HOME, the shim first on PATH; OUT, ERR, RC.
run_tpl() {
    OUT=$(env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$H" PATH="$T/bin:$PATH" "$@" "$SH" "$HOOKS/oss-claude-md-template.sh" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
# fresh <status> <body> [mode]: empty request log and shim log, a clean sandbox HOME and config dir.
# mode: normal (default), stall, nolength or flood (see api.py).
fresh() {
    rm -rf "$H" "$CFG" "$T/curl.argv"; : > "$T/requests.log"; mkdir -p "$H/.oss" "$CFG"
    printf '%s' "$1" > "$T/status"; printf '%s' "$2" > "$T/body"; printf '%s' "${3:-normal}" > "$T/mode"
}
reqs() { cat "$T/requests.log"; }
cfg() { printf '{"apiKey":"%s","apiUrl":"%s"}\n' "$KEY" "$2" > "$1/config.json"; }
LOCAL="http://127.0.0.1:$PORT"

[[ -f "$HOOKS/oss-claude-md-template.sh" ]] && pass "hooks/oss-claude-md-template.sh exists" || fail "hooks/oss-claude-md-template.sh exists" "missing"

# 1. The configured API, with the opt-in: the template on stdout, one keyed GET, the key never in argv.
fresh 200 "$TEMPLATE"; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" == 0 && "$OUT" == "$TEMPLATE" ]] && pass "configured API: prints the template, exit 0" || fail "configured API: prints the template, exit 0" "rc=$RC out=$OUT err=$ERR"
[[ "$(reqs)" == "GET /api/v1/prompts/claude-md|Bearer $KEY" ]] && pass "configured API: one GET /api/v1/prompts/claude-md with the key in the Authorization header" || fail "configured API: one keyed GET" "requests=$(reqs | sed "s/$KEY/<KEY>/g")"
[[ -s "$T/curl.argv" ]] && ! grep -qF "$KEY" "$T/curl.argv" && pass "configured API: the key is in no curl argv" || fail "configured API: the key is in no curl argv" "argv=$(sed "s/$KEY/<KEY>/g" "$T/curl.argv" 2>/dev/null)"

# 2. OSS_CONFIG_DIR wins: its config's key and apiUrl are used; ~/.oss/config.json (another API) is not read.
fresh 200 "$TEMPLATE"; cfg "$CFG" "$LOCAL"
printf '{"apiKey":"other-home-key","apiUrl":"https://home-api.example.invalid"}\n' > "$H/.oss/config.json"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1 OSS_CONFIG_DIR="$CFG"
[[ "$RC" == 0 && "$OUT" == "$TEMPLATE" && "$(reqs)" == "GET /api/v1/prompts/claude-md|Bearer $KEY" ]] && ! grep -q 'home-api\|refused' "$T/curl.argv" \
    && pass "OSS_CONFIG_DIR: key and apiUrl come from \$OSS_CONFIG_DIR/config.json" || fail "OSS_CONFIG_DIR: key and apiUrl from \$OSS_CONFIG_DIR/config.json" "rc=$RC requests=$(reqs | sed "s/$KEY/<KEY>/g") argv=$(cat "$T/curl.argv" 2>/dev/null) err=$ERR"

# 3. Loopback http without the opt-in: no request, no stdout, the same switch line login prints.
fresh 200 "$TEMPLATE"; cfg "$H/.oss" "$LOCAL"
run_tpl
LB_LINE=$(source "$HOOKS/oss-api-curl.sh" && oss_loopback_refused)
[[ "$RC" != 0 && -z "$OUT" && -z "$(reqs)" && ! -e "$T/curl.argv" && "$ERR" == *"$LB_LINE"* ]] \
    && pass "loopback http without OSS_ALLOW_HTTP_LOOPBACK=1: no request, no stdout, names the switch" || fail "loopback http without the opt-in" "rc=$RC out=$OUT requests=$(reqs) err=$ERR"

# 4. Plain http to a host that is not loopback: refused, no request at all.
fresh 200 "$TEMPLATE"; cfg "$H/.oss" "http://api.example.invalid"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" != 0 && -z "$OUT" && ! -e "$T/curl.argv" && -n "$ERR" ]] \
    && pass "http to a non-loopback host: refused, no request, no stdout, a reason on stderr" || fail "http to a non-loopback host is refused" "rc=$RC out=$OUT argv=$(cat "$T/curl.argv" 2>/dev/null) err=$ERR"

# 5. The API refuses the key (401) or fails (500): nothing on stdout, a reason on stderr.
for code in 401 500; do
    fresh "$code" '{"error":"no"}'; cfg "$H/.oss" "$LOCAL"
    run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
    [[ "$RC" != 0 && -z "$OUT" && "$ERR" == *"$code"* && -n "$(reqs)" ]] \
        && pass "HTTP $code: exit non-zero, no stdout, stderr names the status" || fail "HTTP $code: exit non-zero, no stdout" "rc=$RC out=$OUT err=$ERR"
done

# 6. A 200 with an empty body is not a template.
fresh 200 ''; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" != 0 && -z "$OUT" && -n "$ERR" ]] && pass "an empty 200 body: exit non-zero, no stdout" || fail "an empty 200 body: exit non-zero, no stdout" "rc=$RC out=$OUT err=$ERR"

# 7. Not logged in (no config, or no apiKey): no request.
fresh 200 "$TEMPLATE"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" != 0 && -z "$OUT" && ! -e "$T/curl.argv" && -n "$ERR" ]] && pass "no config: no request, exit non-zero, no stdout" || fail "no config: no request" "rc=$RC out=$OUT argv=$(cat "$T/curl.argv" 2>/dev/null) err=$ERR"
fresh 200 "$TEMPLATE"; printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" != 0 && -z "$OUT" && ! -e "$T/curl.argv" && -n "$ERR" ]] && pass "no apiKey: no request, exit non-zero, no stdout" || fail "no apiKey: no request" "rc=$RC out=$OUT argv=$(cat "$T/curl.argv" 2>/dev/null) err=$ERR"

# 8. A 200 cut short (the API stalls mid-body until curl's -m timer ends): curl fails, so nothing on stdout.
# OSS_CLAUDE_MD_MAX_TIME (digits, below the 10 s default) shortens -m so this case costs 1 s, not 10.
# The server blocks reading the FIFO $T/release; it is opened read-write here, so neither side blocks on
# open, and the byte written after the run lets the server finish this request.
mkfifo "$T/release"; exec 6<> "$T/release"
fresh 200 "$TEMPLATE" stall; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1 OSS_CLAUDE_MD_MAX_TIME=1
printf 'x' >&6
[[ "$RC" != 0 && -z "$OUT" && -n "$ERR" && -n "$(reqs)" ]] \
    && pass "a 200 cut short by the timeout: exit non-zero, no half template on stdout" || fail "a 200 cut short by the timeout" "rc=$RC out=$OUT err=$ERR"

# 9. A body over the 256 KB cap is refused, with a Content-Length and without one (curl cannot refuse up front).
BIG=$(head -c 400000 /dev/zero | tr '\0' 'a')
for mode in normal nolength; do
    fresh 200 "# OSS$BIG" "$mode"; cfg "$H/.oss" "$LOCAL"
    run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
    [[ "$RC" != 0 && -z "$OUT" && -n "$ERR" ]] \
        && pass "a body over 256 KB ($mode): exit non-zero, no stdout" || fail "a body over 256 KB ($mode)" "rc=$RC out_bytes=${#OUT} err=$ERR"
done
# A body just under the cap, sent without a Content-Length, is still a template.
UNDER="# OSS${BIG:0:200000}"
fresh 200 "$UNDER" nolength; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" == 0 && "$OUT" == "$UNDER" ]] && pass "a 200 KB body without a Content-Length: printed whole, exit 0" || fail "a 200 KB body without a Content-Length is printed" "rc=$RC out_bytes=${#OUT} err=$ERR"

# 9b. A curl that does not enforce --max-filesize on a body with no Content-Length (OLD_CURL=1 in the shim):
# one byte over the cap is still refused, and an oversized stream is not read past the cap. The API offers
# 64 MB; it reports how much it got to send (socket buffers allow a few MB) to $T/sentfifo.
fresh 200 "# OSS${BIG:0:262140}" nolength; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1 OLD_CURL=1
[[ "$RC" != 0 && -z "$OUT" && -n "$ERR" ]] \
    && pass "old curl: a body one byte over 256 KB without a Content-Length: exit non-zero, no stdout" || fail "old curl: one byte over the cap is refused" "rc=$RC out_bytes=${#OUT} err=$ERR"
mkfifo "$T/sentfifo"; exec 7<> "$T/sentfifo"
fresh 200 "${BIG:0:65536}" flood; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1 OLD_CURL=1 OSS_CLAUDE_MD_MAX_TIME=9
SENT=''; read -r -t 20 -u 7 SENT
[[ "$RC" != 0 && -z "$OUT" && "$SENT" =~ ^[0-9]+$ ]] && (( SENT < 32 * 1024 * 1024 )) \
    && pass "old curl: a 64 MB stream is cut off near the cap (the API sent $SENT bytes), no stdout" || fail "old curl: a 64 MB stream is cut off near the cap" "rc=$RC out_bytes=${#OUT} sent=$SENT err=$ERR"

# 9c. An API that announces a body over the cap (Content-Length) and then stalls is refused from the headers
# (curl exit 63, the --max-filesize refusal), not after the -m timer has run out (curl exit 28): the user is not
# kept waiting for a body the hook would refuse anyway. The server blocks on $T/release (fd 6, case 8) after it.
fresh 200 "# OSS${BIG:0:261000}" stall; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1 OSS_CLAUDE_MD_MAX_TIME=3
printf 'x' >&6
[[ "$RC" != 0 && -z "$OUT" && "$ERR" == *"curl exit 63"* ]] \
    && pass "an announced body over 256 KB is refused from its Content-Length (curl exit 63), not by the timeout" \
    || fail "an announced body over 256 KB is refused from its Content-Length" "rc=$RC out_bytes=${#OUT} err=$ERR"

# 10. An HTML 200 (a captive portal or proxy page) is not a template.
# The third page is large, so a check that stops reading at the first match must not turn that into a pass.
for page in $'<!DOCTYPE html>\n<html><body>Sign in to Wi-Fi</body></html>' $'<html lang="en">\n<p>portal</p></html>' \
    "<!DOCTYPE html><p>${BIG:0:200000}</p>"; do
    fresh 200 "$page"; cfg "$H/.oss" "$LOCAL"
    run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
    [[ "$RC" != 0 && -z "$OUT" && "$ERR" == *HTML* ]] \
        && pass "an HTML 200 (${page:0:9}...): exit non-zero, no stdout, stderr says HTML" || fail "an HTML 200 is refused" "rc=$RC out=$OUT err=$ERR"
done

# 11. Terminal control codes never reach stdout: C0 but tab and newline (ESC, BEL, CR, ...), DEL, C1, and the
# bidi and zero-width format characters are removed; the rest of the template, tabs and newlines kept.
ESCBODY=$'# OSS \e[31mred\e[0m\n\e]0;pwned title\a\tindented\r\nC1:\xc2\x9b2J DEL:\x7f bidi:\xe2\x80\xaeevil\xe2\x80\xac zw:a\xe2\x80\x8bb iso:\xe2\x81\xa6x\xe2\x81\xa9 end'
CLEAN=$'# OSS [31mred[0m\n]0;pwned title\tindented\nC1:2J DEL: bidi:evil zw:ab iso:x end'
fresh 200 "$ESCBODY"; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" == 0 && "$OUT" == "$CLEAN" ]] && pass "control and format characters are stripped; tabs and newlines kept" \
    || fail "control and format characters are stripped" "rc=$RC out=$(printf '%s' "$OUT" | od -c | head -8) err=$ERR"

# 12. The same set oss_json_field strips (T45): U+2028/U+2029 and every Unicode format character (Cf), so an
# invisible tag-character run (U+E0041...) cannot hide an instruction inside CLAUDE.md. Visible neighbours
# (U+00AC, U+00AE, U+061B, U+2027, U+205F, U+FEFC) are kept, and so are tab and newline.
INVBODY=$'# OSS\n\ta\xe2\x80\xa8b\xe2\x80\xa9c\xef\xbb\xbfd\xc2\xade\xd8\x9cf\xe2\x81\xa0g\xf3\xa0\x81\x81\xf3\xa0\x81\x82h keep:\xc2\xac\xc2\xae\xd8\x9b\xe2\x80\xa7\xe2\x81\x9f\xef\xbb\xbc end'
INVCLEAN=$'# OSS\n\tabcdefgh keep:\xc2\xac\xc2\xae\xd8\x9b\xe2\x80\xa7\xe2\x81\x9f\xef\xbb\xbc end'
fresh 200 "$INVBODY"; cfg "$H/.oss" "$LOCAL"
run_tpl OSS_ALLOW_HTTP_LOOPBACK=1
[[ "$RC" == 0 && "$OUT" == "$INVCLEAN" ]] && pass "U+2028/2029, BOM, soft hyphen, U+061C, word joiner and tag characters are stripped" \
    || fail "U+2028/2029 and format characters (Cf) are stripped" "rc=$RC out=$(printf '%s' "$OUT" | od -c | head -8) err=$ERR"

echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
