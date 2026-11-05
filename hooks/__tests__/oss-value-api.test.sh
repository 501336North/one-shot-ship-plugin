#!/bin/bash
# /oss:status and /oss:workflows fetch through `oss-value.sh status | usage | workflows | workflow` (T60, T69).
#
# @behavior A customer runs /oss:status or /oss:workflows [name] and sees their account or workflow config,
#           with no approval prompt (one allowlisted call each) and their API key never on a command line,
#           in the output, or sent anywhere but the API their OSS config names.
# @business-rule The key and URL come from one read of the OSS config (oss_api_creds); the key goes to curl on
#           stdin (oss_api_curl). The workflow name comes from workflow.txt in the value folder (R5-1), never
#           from argv. A workflow's config comes from GET /api/v1/workflows/<name>/editor (plain JSON;
#           /api/v1/workflows/<name> is license-encrypted). Each verb prints only what its wrapper displays.
#           usage (T69) is best-effort: any failure prints one honest line and exits 0, so /oss:status still shows.
# @boundary Real curl (behind a shim that records argv and refuses any host but 127.0.0.1) against a python3
#           http.server on a random 127.0.0.1 port that snapshots `ps` while each request is open. Sandbox
#           HOME, a fake ak_test key. Every hook run goes through run_capped. Never production, never ~/.oss.
#
# Usage: ./hooks/__tests__/oss-value-api.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy ./hooks/__tests__/oss-value-api.test.sh  (mutants)
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$SCRIPT_DIR/.." && pwd)}"
CMDS="$(cd "$SCRIPT_DIR/../../commands" && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
abort() { fail "$1" "$2"; echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"; exit 1; }

for tool in python3 curl jq git; do command -v "$tool" >/dev/null 2>&1 || abort "$tool is required" "not found"; done
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/run-capped.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SPID=''
trap '[[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }; rm -rf "$T"' EXIT
KEY="ak_test_T60_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"

# The API: "METHOD PATH|AUTHORIZATION" per request in $T/requests.log (a POST's body in $T/reqbody, its Content-Type in
# $T/reqctype), a `ps` snapshot taken while the request is
# open appended to $T/ps.log; answers $T/status (default 200) with the bytes of $T/body. With $T/nolen it sends no
# Content-Length and closes the connection to end the body; with $T/stream it then sends 800 chunks of 64 KiB of `a`
# (52 MB) and writes to $T/sent how many of those bytes went out before the client hung up (T74).
cat > "$T/api.py" << 'PY'
import http.server, os, subprocess, sys
d = sys.argv[1]
def rd(name, default):
    try:
        with open(os.path.join(d, name), 'rb') as f: return f.read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        with open(os.path.join(d, 'reqbody'), 'wb') as f: f.write(self.rfile.read(n))
        with open(os.path.join(d, 'reqctype'), 'w') as f: f.write(self.headers.get('Content-Type', ''))
        self.do_GET()
    def do_GET(self):
        with open(os.path.join(d, 'requests.log'), 'a') as f:
            f.write('%s %s|%s\n' % (self.command, self.path, self.headers.get('Authorization', '')))
        ps = subprocess.run(['/bin/ps', '-axww', '-o', 'args='], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        with open(os.path.join(d, 'ps.log'), 'ab') as f: f.write(ps)
        body = rd('body', b'')
        self.send_response(int(rd('status', b'200').strip() or b'200'))
        self.send_header('Content-Type', 'application/json')
        if not os.path.exists(os.path.join(d, 'nolen')):
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not os.path.exists(os.path.join(d, 'stream')):
            self.wfile.write(body)
            return
        sent = 0
        try:
            self.wfile.write(body)
            for _ in range(800):
                self.wfile.write(b'a' * 65536); sent += 65536
        except OSError:
            pass
        with open(os.path.join(d, 'sent'), 'w') as f: f.write('%d\n' % sent)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
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

REAL_CURL=$(command -v curl)
warm_stub "$T/bin/curl" "printf '%s\n' \"\$*\" >> '$T/curl.argv'
[ -e '$T/timeout' ] && exit 28
if [ -e '$T/oldcurl' ]; then a=(); s=''; for x in \"\$@\"; do if [ -n \"\$s\" ]; then s=''; continue; fi; [ \"\$x\" = --max-filesize ] && { s=1; continue; }; a+=(\"\$x\"); done; set -- \"\${a[@]}\"; fi
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in ($LOCAL/*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

H="$T/home"; W="$T/work"
# fresh <status> <body>: a clean sandbox HOME (the hooks under test in ~/.oss/hooks, a config naming the local
# API), an empty request, ps and argv log, a cwd in a git repo.
fresh() {
    rm -rf "$H" "$W" "$T/curl.argv" "$T/reqbody" "$T/reqctype" "$T/ps.log" "$T/timeout" "$T/nolen" "$T/oldcurl" "$T/stream" "$T/sent"; : > "$T/requests.log"
    mkdir -p "$H/.oss/hooks" "$W"; (cd "$W" && git init -q) >/dev/null 2>&1
    cp "$HOOKS/oss-value.sh" "$HOOKS/oss-safe-path.sh" "$HOOKS/oss-api-curl.sh" "$H/.oss/hooks/"
    printf '{"apiKey":"%s","apiUrl":"%s"}\n' "$KEY" "$LOCAL" > "$H/.oss/config.json"
    printf '%s' "$1" > "$T/status"; printf '%s' "$2" > "$T/body"
}
# ov <args...>: ~/.oss/hooks/oss-value.sh <args> as the wrapper runs it -> OUT, ERR, RC
ov() {
    OUT=$(cd "$W" && run_capped 30 env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$H" PATH="$T/bin:${OV_PATH:-$PATH}" OSS_ALLOW_HTTP_LOOPBACK=1 \
        "$H/.oss/hooks/oss-value.sh" "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
# write_value <name> <value>: what the model does: run `dir`, Write <name>.txt in the folder it printed
write_value() {
    local d; d=$(cd "$W" && run_capped 30 env HOME="$H" "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null) && [[ -n "$d" ]] || return 1
    printf '%s\n' "$2" > "$d/$1.txt"; VALUE_DIR=$d
}
reqs() { sed "s/$KEY/<KEY>/g" "$T/requests.log"; }
# keysafe <label>: one request, the key only in its Authorization header: never in curl's argv, in any process
# command line while the request was open, or in the verb's stdout or stderr
keysafe() {
    if [[ -s "$T/ps.log" && -s "$T/curl.argv" ]] && ! grep -qF "$KEY" "$T/ps.log" "$T/curl.argv" && [[ "$OUT$ERR" != *"$KEY"* ]] \
        && [[ "$(grep -c . "$T/requests.log")" == 1 ]] && grep -qF "|Bearer $KEY" "$T/requests.log"; then
        pass "$1: the key only in the Authorization header (not in argv, ps, stdout or stderr)"
    else
        fail "$1: the key only in the Authorization header" "requests=$(reqs) ps_hit=$(grep -cF "$KEY" "$T/ps.log" 2>/dev/null) argv=$(sed "s/$KEY/<KEY>/g" "$T/curl.argv" 2>/dev/null)"
    fi
}
# md_has <file> <literal>: commands/<file> (what the wrapper tells Claude to display) holds <literal>
md_has() { grep -qF -- "$2" "$CMDS/$1"; }

# --- status ----------------------------------------------------------------------------------------------
VERIFY=$(printf '{"valid":true,"userId":"usr_SECRET_ID","email":"dev@example.com\\u001b[31m","plan":"PRO","subscriptionStatus":"ACTIVE","trialEndsAt":"2026-12-01T00:00:00.000Z","maxCustomCommands":5}')
fresh 200 "$VERIFY"; ov status
[[ "$RC" == 0 && "$(reqs)" == "GET /api/v1/auth/verify|Bearer <KEY>" ]] && pass "status: one GET /api/v1/auth/verify to the configured API" || fail "status: one GET /api/v1/auth/verify" "rc=$RC requests=$(reqs) err=$ERR"
keysafe status
WANT=$'Account: dev@example.com[31m\nPlan: PRO\nStatus: ACTIVE\nTrial ends: 2026-12-01T00:00:00.000Z'
[[ "$OUT" == "$WANT" ]] && pass "status: prints only the displayed fields (account, plan, status, trial end), control characters removed" \
    || fail "status: prints only the displayed fields" "out=$(printf '%q' "$OUT")"
ok=1; for l in Account: Plan: Status:; do md_has status.md "$l" || ok=0; done
[[ $ok == 1 ]] && md_has status.md 'Trial ends' && pass "status: status.md displays the same labels the verb prints" || fail "status: status.md displays the labels the verb prints" "missing in status.md"
fresh 401 '{"error":"Unauthorized"}'; ov status
[[ "$RC" != 0 && -z "$OUT" && "$ERR" == *"HTTP 401"* && "$ERR" == *"/oss:login"* ]] && pass "status: a 401 prints nothing on stdout, names HTTP 401 and /oss:login" || fail "status: a 401" "rc=$RC out=$OUT err=$ERR"
fresh 200 "$VERIFY"; printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"; ov status
[[ "$RC" != 0 && -z "$(reqs)" && "$ERR" == *"No API key found"* && "$ERR" == *"/oss:login"* ]] && pass "status: no key: no request, says No API key found and /oss:login" || fail "status: no key" "rc=$RC requests=$(reqs) err=$ERR"

# --- workflows (the list) -----------------------------------------------------------------------------
fresh 200 '{"workflows":[{"name":"ideate","customized":false},{"name":"plan","customized":false},{"name":"build","customized":true},{"name":"ship","customized":false}]}'
ov workflows
[[ "$RC" == 0 && "$(reqs)" == "GET /api/v1/workflows|Bearer <KEY>" ]] && pass "workflows: one GET /api/v1/workflows" || fail "workflows: one GET /api/v1/workflows" "rc=$RC requests=$(reqs) err=$ERR"
keysafe workflows
[[ "$OUT" == $'ideate DEFAULT\nplan DEFAULT\nbuild CUSTOM\nship DEFAULT' ]] && md_has workflows.md 'build         CUSTOM' && md_has workflows.md 'ideate        DEFAULT' \
    && pass "workflows: prints '<name> DEFAULT|CUSTOM' per workflow, the statuses workflows.md displays" || fail "workflows: prints '<name> DEFAULT|CUSTOM'" "out=$(printf '%q' "$OUT")"

# --- workflow <name>: the name from workflow.txt, the plain editor config --------------------------------
EDITOR='{"name":"build","chain":[{"command":"integration","condition":null,"order":1,"slot":null}],"agents":["code-simplifier"],"parallel_agents":false,"task_loop":["red","green","refactor"],"quality_gates":null,"on_pass":null,"pre_steps":null,"checkpoint":"auto","system_blocks":["task_loop"],"customCommands":[{"name":"team:secret-draft","displayName":"x","isDraft":true}]}'
fresh 200 "$EDITOR"; write_value workflow build; ov workflow
[[ "$RC" == 0 && "$(reqs)" == "GET /api/v1/workflows/build/editor|Bearer <KEY>" ]] && pass "workflow: one GET /api/v1/workflows/<name>/editor for the name in workflow.txt" || fail "workflow: GET /api/v1/workflows/build/editor" "rc=$RC requests=$(reqs) err=$ERR"
keysafe workflow
[[ "$(printf '%s' "$OUT" | jq -c '[.name, .chain[0].command, .agents[0], .task_loop[0], .checkpoint, has("customCommands"), has("system_blocks")]' 2>/dev/null)" == '["build","integration","code-simplifier","red","auto",false,false]' ]] \
    && pass "workflow: prints the config fields workflows.md displays (chain, agents, task loop, gates, checkpoint), not the team's command list" \
    || fail "workflow: prints the displayed config fields only" "out=$OUT"
[[ ! -e "$VALUE_DIR/workflow.txt" ]] && pass "workflow: workflow.txt is deleted once read" || fail "workflow: workflow.txt is deleted once read" "still there"
fresh 200 "$EDITOR"; write_value workflow build; ov workflow plan
[[ "$(reqs)" == "GET /api/v1/workflows/build/editor|Bearer <KEY>" ]] && pass "workflow: a name in argv is never used (R5-1: the value file only)" || fail "workflow: a name in argv is never used" "requests=$(reqs)"
fresh 200 "$EDITOR"; ov workflow
[[ "$RC" != 0 && -z "$(reqs)" && -z "$OUT" ]] && pass "workflow: no workflow.txt: no request, nothing on stdout" || fail "workflow: no workflow.txt" "rc=$RC requests=$(reqs) out=$OUT"
fresh 200 "$EDITOR"; write_value workflow 'build;id' ; ov workflow
[[ "$RC" != 0 && -z "$(reqs)" ]] && pass "workflow: a name that breaks the workflow rule: no request" || fail "workflow: an invalid name is refused" "rc=$RC requests=$(reqs)"
# T74 (security S3): the name is held to the shared workflow rule (oss_valid_workflow_name), so `.` and `..` never
# reach the URL, where curl would squash /workflows/../editor into /api/v1/editor.
for name in . .. ...; do
    fresh 200 "$EDITOR"; write_value workflow "$name"; ov workflow
    [[ "$RC" != 0 && -z "$(reqs)" && -z "$OUT" && "$ERR" == *refused* ]] && pass "workflow: '$name' is refused, no request" \
        || fail "workflow: '$name' is refused, no request" "rc=$RC requests=$(reqs) out=$OUT err=$ERR"
done

# --- usage: this month's commands from GET /api/v1/analytics/usage (T69) ---------------------------------
# The route's fields (AgenticDevWorkflow analytics.ts:211-216): totalCommands, commandsByType, currentPeriod, periodStart.
USAGE='{"totalCommands":42,"commandsByType":{"ship":10,"build":20,"ideate":5,"plan":7},"currentPeriod":"month","periodStart":"2026-11-01T04:00:00.000Z"}'
fresh 200 "$USAGE"; ov usage
[[ "$RC" == 0 && "$(reqs)" == "GET /api/v1/analytics/usage|Bearer <KEY>" ]] && pass "usage: one GET /api/v1/analytics/usage to the configured API" || fail "usage: one GET /api/v1/analytics/usage" "rc=$RC requests=$(reqs) err=$ERR"
keysafe usage
[[ "$OUT" == $'Total commands: 42 (since 2026-11-01)\n  build: 20\n  ship: 10\n  plan: 7\n  ideate: 5' ]] \
    && pass "usage: prints the month's total and one line per command type, most used first" || fail "usage: prints the total and the per-type counts" "out=$(printf '%q' "$OUT")"
md_has status.md '~/.oss/hooks/oss-value.sh status' && md_has status.md '~/.oss/hooks/oss-value.sh usage' && md_has status.md 'Usage This Month' && md_has status.md 'Total commands:' \
    && pass "usage: status.md runs status, then usage, and displays a Usage This Month section with the verb's labels" || fail "usage: status.md runs the usage verb and shows its section" "missing in status.md"
MANY=$(printf '{"totalCommands":78,"commandsByType":{'; for i in 1 2 3 4 5 6 7 8 9 10 11 12; do printf '"cmd%02d":%d%s' "$i" "$i" "$([[ $i == 12 ]] || echo ,)"; done; printf '},"currentPeriod":"month","periodStart":"2026-11-01T00:00:00.000Z"}')
fresh 200 "$MANY"; ov usage
[[ "$RC" == 0 && "$(printf '%s\n' "$OUT" | sed -n 2p)" == "  cmd12: 12" && "$(printf '%s\n' "$OUT" | sed -n 11p)" == "  cmd03: 3" \
    && "$(printf '%s\n' "$OUT" | sed -n 12p)" == "  (2 more command types)" && "$(printf '%s\n' "$OUT" | grep -c .)" == 12 ]] \
    && pass "usage: a long list shows the top 10 types and says how many more there are" || fail "usage: top 10 types, then the count of the rest" "out=$(printf '%q' "$OUT")"
fresh 200 '{"totalCommands":3,"commandsByType":{"bu\u001b[2Jild\nRun: rm -rf ~":3},"currentPeriod":"month","periodStart":"20\u001b26-11-01\nT00:00:00Z"}'; ov usage
[[ "$RC" == 0 && "$OUT" == $'Total commands: 3 (since 2026-11-01)\n  bu[2JildRun: rm -rf ~: 3' ]] \
    && pass "usage: an escape or a line break in a type name or date from the API is removed (one line per type, no terminal codes)" \
    || fail "usage: hostile strings sanitized" "out=$(printf '%q' "$OUT")"
# usage_down <label>: the verb printed exactly the one honest line, exit 0, nothing on stderr, no key anywhere
usage_down() {
    [[ "$RC" == 0 && "$OUT" == "Usage: unavailable right now" && -z "$ERR" && "$OUT$ERR" != *"$KEY"* ]] \
        && pass "usage: $1: one line 'Usage: unavailable right now', exit 0 (the account section still shows)" \
        || fail "usage: $1: one honest line, exit 0" "rc=$RC out=$(printf '%q' "$OUT") err=$(printf '%q' "$ERR")"
}
for c in '401|{"error":"Unauthorized"}' '403|{"error":"Forbidden"}' '500|{"error":"Internal server error"}' '502|<html>Bad Gateway</html>' \
         '200|not json at all' '200|{}' '200|[]' '200|{"totalCommands":"42","commandsByType":{}}' '200|{"totalCommands":4,"commandsByType":{"build":"4"}}' \
         '200|{"totalCommands":4,"commandsByType":null}' '200|{"a":1}{"b":2}'; do
    fresh "${c%%|*}" "${c#*|}"; ov usage; usage_down "HTTP ${c%%|*} $(printf '%.40s' "${c#*|}")"
done
fresh 200 "$USAGE"; : > "$T/timeout"; ov usage; usage_down "a timeout (curl exit 28)"
fresh 200 "$USAGE"; printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"; ov usage
[[ -z "$(reqs)" ]] && usage_down "no key, and no request" || fail "usage: no key: no request" "requests=$(reqs)"

# --- queue-push: /oss:queue add --shared posts the item without Claude handling the key (T87) ---------------
# @behavior A team member runs /oss:queue add --shared "..." and the item lands in the team's shared queue with no
#           approval prompt, their API key never seen by Claude, on a command line or in the output; they see
#           "Queued: <id>" or one Error: line that says what to do (fix a value, log in, wait, check the connection).
# @business-rule type.txt, source.txt and prompt.txt come from the value folder (never argv), are checked before any
#           request (type feature|issue|review; source 1-2000 bytes, one line; prompt 1-20000 bytes, line breaks and
#           tabs only), go as one JSON body to POST /api/v1/queue (the route's createSchema fields), and are deleted
#           on every path. Only the created item's id is printed.
# qvals <type> <source> <prompt>: what the model does: run `dir`, Write each file (exact bytes; "-" = not written)
qvals() {
    local d; d=$(cd "$W" && run_capped 30 env HOME="$H" "$H/.oss/hooks/oss-value.sh" dir 2>/dev/null) && [[ -n "$d" ]] || return 1
    VALUE_DIR=$d
    [[ "$1" == - ]] || printf '%s' "$1" > "$d/type.txt"
    [[ "$2" == - ]] || printf '%s' "$2" > "$d/source.txt"
    [[ "$3" == - ]] || printf '%s' "$3" > "$d/prompt.txt"
}
# qgone: the value folder is empty again (the three files and any request body the verb made)
qgone() { [[ -n "$VALUE_DIR" && -d "$VALUE_DIR" && -z "$(ls -A "$VALUE_DIR")" ]]; }
CREATED='{"id":"cmh7queue01","teamId":"team_1","ownerId":"usr_SECRET","type":"feature","source":"x","prompt":"x","status":"queued","createdAt":"2026-11-05T00:00:00.000Z"}'
QPROMPT=$'Refactor the auth module.\n\tKeep "quotes", back\\slashes, $(echo no) and `ticks`; caf\xc3\xa9 \xe4\xb8\xad\xe6\x96\x87 QPMARK'
# A jq that records its argv (its own folder, so the no-jq farms below never see it)
warm_stub "$T/jqspy/jq" "printf '%s\\n' \"\$*\" >> '$T/jq.argv'
exec '$(command -v jq)' \"\$@\"" || abort "the jq spy warms up" "warm-up did not run"
rm -f "$T/jq.argv"
fresh 201 "$CREATED"; qvals $'feature\n' $'Refactor auth module\n' "$QPROMPT"$'\n'; OV_PATH="$T/jqspy:$PATH" ov queue-push
[[ "$RC" == 0 && "$OUT" == "Queued: cmh7queue01" && -z "$ERR" ]] && pass "queue-push: a 201 prints only 'Queued: <id>', exit 0" \
    || fail "queue-push: a 201 prints only 'Queued: <id>'" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
[[ "$(reqs)" == "POST /api/v1/queue|Bearer <KEY>" && "$(cat "$T/reqctype" 2>/dev/null)" == application/json ]] \
    && pass "queue-push: one POST /api/v1/queue to the configured API, as JSON" || fail "queue-push: one POST /api/v1/queue as JSON" "requests=$(reqs) ctype=$(cat "$T/reqctype" 2>/dev/null)"
WANTBODY=$(jq -cn --arg p "$QPROMPT" '{type:"feature",source:"Refactor auth module",prompt:$p}')
[[ "$(jq -c . "$T/reqbody" 2>/dev/null)" == "$WANTBODY" ]] \
    && pass "queue-push: the body is exactly {type, source, prompt} from the files (trailing line break dropped, the rest byte for byte)" \
    || fail "queue-push: the body is {type, source, prompt}" "body=$(cat "$T/reqbody" 2>/dev/null)"
keysafe queue-push
[[ -s "$T/jq.argv" ]] || fail "queue-push: the jq spy saw the verb's jq calls (anti-vacuity)" "no jq.argv"
grep -qF QPMARK "$T/curl.argv" "$T/ps.log" "$T/jq.argv" && fail "queue-push: the prompt never on a command line" "found in argv or ps" \
    || pass "queue-push: the prompt goes in a file, never on a command line"
qgone && pass "queue-push: type.txt, source.txt and prompt.txt are deleted after a success" || fail "queue-push: the value files are deleted after a success" "$(ls -A "$VALUE_DIR")"
[[ -z "$(ls -A "$H/.oss/run" | grep -v '^[0-9a-f]\{16\}$')" ]] && pass "queue-push: no request body left behind in ~/.oss/run" || fail "queue-push: no request body left behind" "$(ls -A "$H/.oss/run")"
for ty in issue review; do
    fresh 200 '{"id":"q-2_b"}'; qvals "$ty" "https://github.com/org/repo/issues/42" "Do it"; ov queue-push
    [[ "$RC" == 0 && "$OUT" == "Queued: q-2_b" && "$(jq -r .type "$T/reqbody" 2>/dev/null)" == "$ty" ]] && pass "queue-push: type '$ty' is sent (a 200 with an id is a success too)" \
        || fail "queue-push: type '$ty' is sent" "rc=$RC out=$OUT err=$ERR body=$(cat "$T/reqbody" 2>/dev/null)"
done
S2000=$(head -c 2000 /dev/zero | tr '\0' s); P20000=$(head -c 20000 /dev/zero | tr '\0' p)
fresh 201 "$CREATED"; qvals feature "$S2000" "$P20000"; ov queue-push
[[ "$RC" == 0 && "$(jq -r '"\(.source | length) \(.prompt | length)"' "$T/reqbody" 2>/dev/null)" == "2000 20000" ]] \
    && pass "queue-push: a 2000-byte source and a 20000-byte prompt are sent whole (the bounds)" || fail "queue-push: the bounds themselves are allowed" "rc=$RC err=$ERR"

# refused <label> <file named in the error> <type> <source> <prompt>: no request, nothing on stdout, exit 1, one
# Error: line naming the file, every value file deleted
refused_value() {
    fresh 201 "$CREATED"; qvals "$3" "$4" "$5"; ov queue-push
    [[ "$RC" == 1 && -z "$OUT" && -z "$(reqs)" && "$ERR" == "Error: $2"* && "$(printf '%s\n' "$ERR" | grep -c .)" == 1 ]] && qgone \
        && pass "queue-push: $1: refused before any request, one Error: line naming $2, the value files deleted" \
        || fail "queue-push: $1: refused before any request" "rc=$RC out=$OUT requests=$(reqs) err=$(printf '%q' "$ERR") left=$(ls -A "$VALUE_DIR")"
}
refused_value "type 'bug'" type.txt bug src prompt
refused_value "type 'Feature' (case matters)" type.txt Feature src prompt
refused_value "type 'feature review'" type.txt "feature review" src prompt
refused_value "no type.txt" type.txt - src prompt
refused_value "no source.txt" source.txt feature - prompt
refused_value "an empty source" source.txt feature $'\n' prompt
refused_value "a 2001-byte source" source.txt feature "${S2000}s" prompt
refused_value "a source with a line break inside" source.txt feature $'one\ntwo' prompt
refused_value "a source with a tab" source.txt feature $'one\ttwo' prompt
refused_value "no prompt.txt" prompt.txt feature src -
refused_value "an empty prompt" prompt.txt feature src ""
refused_value "a 20001-byte prompt" prompt.txt feature src "${P20000}p"
refused_value "a prompt with ESC" prompt.txt feature src $'a\e[2Jb'
refused_value "a prompt with a carriage return" prompt.txt feature src $'a\rb'
refused_value "a prompt with DEL" prompt.txt feature src $'a\x7fb'
refused_value "a prompt with a C1 control (U+009B)" prompt.txt feature src $'a\xc2\x9bb'
fresh 201 "$CREATED"; qvals feature src -; printf 'a\0b' > "$VALUE_DIR/prompt.txt"; ov queue-push
[[ "$RC" == 1 && -z "$(reqs)" && "$ERR" == "Error: prompt.txt"* ]] && qgone && pass "queue-push: a prompt with a NUL byte is refused, no request" \
    || fail "queue-push: a NUL byte is refused" "rc=$RC requests=$(reqs) err=$ERR"
fresh 201 "$CREATED"; qvals feature src -; head -c 5000000 /dev/zero | tr '\0' p > "$VALUE_DIR/prompt.txt"; ov queue-push
[[ "$RC" == 1 && -z "$(reqs)" && "$ERR" == "Error: prompt.txt"*20000* ]] && qgone && pass "queue-push: a 5 MB prompt is refused (says the 20000-byte limit), no request" \
    || fail "queue-push: a 5 MB prompt is refused" "rc=$RC requests=$(reqs) err=$ERR"
# A prompt under the limit, then 200 line breaks, then more text: never cut at the line breaks and sent short
fresh 201 "$CREATED"; qvals feature src -
{ head -c 19990 /dev/zero | tr '\0' p; head -c 200 /dev/zero | tr '\0' '\n'; printf TAIL; } > "$VALUE_DIR/prompt.txt"; ov queue-push
[[ "$RC" == 1 && -z "$(reqs)" && "$ERR" == "Error: prompt.txt"*20000* ]] && qgone \
    && pass "queue-push: a 20194-byte prompt whose tail follows many line breaks is refused, never sent cut short" \
    || fail "queue-push: a long prompt is never sent cut short" "rc=$RC requests=$(reqs) err=$ERR"
fresh 201 "$CREATED"; qvals feature src -; echo "secret text" > "$T/victim"; ln -s "$T/victim" "$VALUE_DIR/prompt.txt"; ov queue-push
[[ "$RC" == 1 && -z "$(reqs)" && "$ERR" == "Error: prompt.txt"* && "$(cat "$T/victim")" == "secret text" ]] && qgone \
    && pass "queue-push: a prompt.txt that is a symlink is refused (the link removed, its target untouched), no request" \
    || fail "queue-push: a symlinked prompt.txt is refused" "rc=$RC requests=$(reqs) err=$ERR"
rm -f "$T/victim"
fresh 201 "$CREATED"; qvals bug src prompt; ov queue-push extra args
[[ "$RC" == 1 && -z "$(reqs)" ]] && pass "queue-push: arguments are never used (values come from the files only)" || fail "queue-push: arguments ignored" "rc=$RC requests=$(reqs)"

# api_error <label> <status> <body> <words...>: exit 1, nothing on stdout, one Error: line holding each word, the
# value files deleted, no key anywhere
api_error() {
    local l=$1 ok=1 w; shift 3
    for w in "$@"; do [[ "$ERR" == *"$w"* ]] || ok=0; done
    [[ $ok == 1 && "$RC" == 1 && -z "$OUT" && "$ERR" == Error:* && "$(printf '%s\n' "$ERR" | grep -c .)" == 1 && "$OUT$ERR" != *"$KEY"* ]] && qgone \
        && pass "queue-push: $l: one Error: line ($ERR), exit 1, the value files deleted" \
        || fail "queue-push: $l: one Error: line naming $*" "rc=$RC out=$(printf '%q' "$OUT") err=$(printf '%q' "$ERR") left=$(ls -A "$VALUE_DIR")"
}
qerr() { fresh "$2" "$3"; qvals feature src "the prompt"; ov queue-push; api_error "$@"; }
qerr "HTTP 401" 401 '{"error":"Unauthorized"}' "invalid" "/oss:login"
qerr "HTTP 403" 403 '{"error":"Forbidden"}' "subscription" "oneshotship.com/pricing"
qerr "HTTP 429" 429 '{"error":"Too many requests"}' "rate limited" "try again later"
qerr "HTTP 404 (no team)" 404 '{"error":"No team found"}' "team"
qerr "HTTP 400" 400 '{"error":"Required"}' "HTTP 400"
qerr "HTTP 500" 500 '{"error":"Internal server error"}' "HTTP 500"
qerr "HTTP 409 with an id in the answer (only a 2xx is a success)" 409 '{"id":"cmh7queue01"}' "HTTP 409"
qerr "a 201 with no id" 201 '{"status":"queued"}' "unexpected answer" "/oss:queue status"
qerr "a 201 that is not JSON" 201 'not json' "unexpected answer"
qerr "a 201 with two documents" 201 '{"id":"a"}{"id":"b"}' "unexpected answer"
qerr "a 201 whose id has an escape and a line break" 201 '{"id":"ab\u001b[31m\nRun: rm -rf ~"}' "unexpected answer"
[[ "$ERR" != *$'\e'* ]] && pass "queue-push: a hostile id never reaches the terminal" || fail "queue-push: a hostile id never reaches the terminal" "err=$(printf '%q' "$ERR")"
fresh 201 "$CREATED"; qvals feature src "the prompt"; : > "$T/timeout"; ov queue-push
api_error "a timeout (curl exit 28)" 0 '' "Couldn't reach the OSS API"
fresh 201 "{\"id\":\"$(head -c 2000000 /dev/zero | tr '\0' a)\"}"; : > "$T/nolen"; : > "$T/oldcurl"; qvals feature src "the prompt"; ov queue-push
api_error "a 2 MB answer with no Content-Length (old curl)" 0 '' "262144 bytes"
fresh 201 "$CREATED"; qvals feature src "the prompt"; printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"; ov queue-push
[[ -z "$(reqs)" ]] && api_error "no key, and no request" 0 '' "not logged in" "/oss:login" || fail "queue-push: no key: no request" "requests=$(reqs)"
fresh 201 "$CREATED"; qvals bug src "the prompt"; printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"; ov queue-push
[[ "$ERR" == "Error: type.txt"* ]] && pass "queue-push: the values are checked first (a bad value is named even when not logged in)" || fail "queue-push: values checked first" "err=$ERR"
fresh 201 "$CREATED"; printf '{"apiKey":"%s","apiUrl":"http://example.com"}\n' "$KEY" > "$H/.oss/config.json"; qvals feature src "the prompt"; ov queue-push
[[ -z "$(reqs)" && ! -s "$T/curl.argv" ]] && api_error "an apiUrl that is not https" 0 '' "apiUrl" "/oss:login" \
    || fail "queue-push: a plain-http apiUrl: no request" "requests=$(reqs) argv=$(cat "$T/curl.argv" 2>/dev/null)"
# dir clears stale type/source/prompt files, so an old item is never sent twice
fresh 201 "$CREATED"; qvals feature src "old prompt"; (cd "$W" && run_capped 30 env HOME="$H" "$H/.oss/hooks/oss-value.sh" dir >/dev/null 2>&1)
qgone && pass "queue-push: dir clears stale type.txt, source.txt and prompt.txt" || fail "queue-push: dir clears stale values" "$(ls -A "$VALUE_DIR")"

# --- no jq (T64): session start treats jq as optional, so node prints the same lines --------------------
# Symlink farms of every command on the real PATH except the named ones (as oss-config-one-object.test.sh does).
farm() { # $1 dir, then names to leave out
    local dir="$1" d f b h skip; shift
    mkdir -p "$dir"
    local IFS=:
    for d in $PATH; do
        [[ -d "$d" ]] || continue
        for f in "$d"/*; do
            b=${f##*/}; skip=n
            for h in "$@"; do [[ "$b" == "$h" ]] && skip=y; done
            [[ $skip == n && -x "$f" && ! -e "$dir/$b" ]] && ln -s "$f" "$dir/$b" 2>/dev/null
        done
    done
}
farm "$T/nojq" jq; farm "$T/none" jq node
PATH="$T/nojq" command -v jq >/dev/null 2>&1 && abort "jq is hidden from the no-jq PATH" "still found"
PATH="$T/nojq" command -v node >/dev/null 2>&1 || abort "node is on the no-jq PATH" "not found"
PATH="$T/none" command -v node >/dev/null 2>&1 && abort "node is hidden from the no-jq-no-node PATH" "still found"
# clean: OUT holds no C0 (but the line breaks between lines), DEL, C1, U+2028/2029, bidi, zero-width, BOM, soft
# hyphen or tag character (the bytes of what the hostile bodies below carry)
clean() { ! printf '%s' "$OUT" | tr -d '\n' | LC_ALL=C grep -qE $'[\x01-\x1f\x7f]|\xc2[\x80-\x9f\xad]|\xe2\x80[\x8b-\x8f\xa8-\xae]|\xe2\x81[\xa6-\xa9]|\xef\xbb\xbf|\xf3\xa0'; }
# raw_error: a shell or tool error the customer must never see
raw_error() { [[ "$OUT$ERR" == *"command not found"* || "$OUT$ERR" == *"jq:"* || "$OUT$ERR" == *"No such file"* || "$OUT$ERR" == *"line "[0-9]* ]]; }
# same_without_jq <label> <verb> <status> <body>: the verb with jq, then with jq hidden (node): same stdout,
# stderr and exit code, nothing raw, the key safe; workflow re-writes workflow.txt before each run.
same_without_jq() {
    local oj ej rj
    fresh "$3" "$4"; [[ "$2" == workflow ]] && write_value workflow build; ov "$2"; oj=$OUT; ej=$ERR; rj=$RC
    fresh "$3" "$4"; [[ "$2" == workflow ]] && write_value workflow build; OV_PATH="$T/nojq" ov "$2"
    if [[ "$OUT" == "$oj" && "$ERR" == "$ej" && "$RC" == "$rj" ]] && ! raw_error && clean; then
        pass "no jq: $1: node prints exactly what jq prints (rc $RC), sanitized, no raw error"
    else
        fail "no jq: $1: node prints what jq prints" "jq rc=$rj out=$(printf '%q' "$oj") err=$ej | node rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
    fi
}
# The hostile string: ESC, CR, tab, line break, DEL, C1 (NEL), U+2028, RLO, zero-width space, soft hyphen, BOM,
# LRI and a tag character (an astral \p{Cf}).
X='\u001b[2J\r\t\n\u007f\u0085 ‮​­﻿⁦󠁁'
same_without_jq "status" status 200 "$VERIFY"
fresh 200 "$VERIFY"; OV_PATH="$T/nojq" ov status; keysafe "no jq: status"
same_without_jq "status, hostile and odd fields" status 200 '{"email":"a'"$X"'b@example.com","plan":5,"subscriptionStatus":null,"trialEndsAt":false}'
same_without_jq "status, a trial end that is not a string" status 200 '{"email":"x@example.com","plan":"PRO","subscriptionStatus":"TRIAL","trialEndsAt":{"at":"2026'"$X"'"}}'
same_without_jq "workflows" workflows 200 '{"workflows":[{"name":"ideate","customized":false},{"name":"build","customized":true},{"name":"pl'"$X"'an","customized":"true"},{"customized":true},null]}'
fresh 200 '{"workflows":[{"name":"build","customized":true}]}'; OV_PATH="$T/nojq" ov workflows; keysafe "no jq: workflows"
same_without_jq "workflow" workflow 200 "$EDITOR"
same_without_jq "workflow, hostile keys and values" workflow 200 '{"name":"bu'"$X"'ild","chain":[{"com'"$X"'mand":"x'"$X"'","order":1,"slot":null,"deep":[["a'"$X"'"],{}]}],"agents":[],"task_loop":{},"checkpoint":true,"extra":"dropped"}'
fresh 200 "$EDITOR"; write_value workflow build; OV_PATH="$T/nojq" ov workflow; keysafe "no jq: workflow"
same_without_jq "usage" usage 200 "$USAGE"
same_without_jq "usage, a long list" usage 200 "$MANY"
same_without_jq "usage, hostile type names and date" usage 200 '{"totalCommands":3,"commandsByType":{"bu'"$X"'ild":2,"a":2,"z":1},"currentPeriod":"month","periodStart":"20'"$X"'26-11-01T00:00:00Z"}'
fresh 200 "$USAGE"; OV_PATH="$T/nojq" ov usage; keysafe "no jq: usage"
for c in 'status|401|{"error":"Unauthorized"}' 'status|200|not json' 'status|200|[]' 'status|200|{"a":1}{"b":2}' 'workflows|200|{}' 'workflows|200|{"workflows":[1]}' \
         'usage|200|{"totalCommands":4,"commandsByType":{"build":"4"}}' 'usage|200|null' 'usage|500|oops'; do
    v=${c%%|*}; r=${c#*|}; same_without_jq "$v, HTTP ${r%%|*} $(printf '%.30s' "${r#*|}")" "$v" "${r%%|*}" "${r#*|}"
done
# T52: jq and node both strip variation selectors (U+FE00-FE0F, U+E0100-E01EF), U+034F and the invisible fillers
# (U+115F, U+1160, U+3164, U+FFA0, U+2800); plain emoji (U+2764, U+1F600) and visible neighbours (U+FE10, U+2801,
# U+3165, U+FFA1, U+0350, U+115E) are kept.
VS='{"email":"a︀b︇c️d󠄀e󠅐f󠇯g͏hᅟiᅠjㅤkﾠl⠀m","plan":"❤😀 ︐⠁ㅥﾡ͐ᅞ","subscriptionStatus":"ACTIVE"}'
VSWANT=$'Account: abcdefghijklm\nPlan: \xe2\x9d\xa4\xf0\x9f\x98\x80 \xef\xb8\x90\xe2\xa0\x81\xe3\x85\xa5\xef\xbe\xa1\xcd\x90\xe1\x85\x9e\nStatus: ACTIVE'
for p in jq node; do
    fresh 200 "$VS"; if [[ $p == jq ]]; then ov status; else OV_PATH="$T/nojq" ov status; fi
    [[ "$RC" == 0 && "$OUT" == "$VSWANT" ]] && pass "$p: variation selectors, U+034F and invisible fillers are stripped; plain emoji and neighbours kept" \
        || fail "$p: variation selectors, U+034F and invisible fillers are stripped" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
done
# T52b: jq and node both strip the shared set (\p{Default_Ignorable_Code_Point}: U+17B4, U+180B, U+2065, U+FFF0,
# U+E0000, U+E0FFF) and print visible text (accents, CJK, Hangul, emoji) as before; a ZWJ family and a heart with
# U+FE0F lose U+200D and U+FE0F, as they have since T38/T52.
DI='{"email":"a឴b᠋c⁥d￰e󠀀f󠿿g","plan":"Ascii café üñ 中文 한국어 👍🏽 👨‍👩‍👧 ❤️","subscriptionStatus":"ACTIVE"}'
DIWANT=$'Account: abcdefg\nPlan: Ascii caf\xc3\xa9 \xc3\xbc\xc3\xb1 \xe4\xb8\xad\xe6\x96\x87 \xed\x95\x9c\xea\xb5\xad\xec\x96\xb4 \xf0\x9f\x91\x8d\xf0\x9f\x8f\xbd \xf0\x9f\x91\xa8\xf0\x9f\x91\xa9\xf0\x9f\x91\xa7 \xe2\x9d\xa4\nStatus: ACTIVE'
for p in jq node; do
    fresh 200 "$DI"; if [[ $p == jq ]]; then ov status; else OV_PATH="$T/nojq" ov status; fi
    [[ "$RC" == 0 && "$OUT" == "$DIWANT" ]] && pass "$p: default-ignorable characters are stripped; visible text printed as before" \
        || fail "$p: default-ignorable characters are stripped" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
done
same_without_jq "status, default-ignorable characters" status 200 "$DI"
# An older jq (Oniguruma without the property) falls back to the T52 list: no error, the lines still print. The shim
# renames the property so the real Oniguruma rejects it, as an old one does.
mkdir -p "$T/oldjq-bin"
warm_stub "$T/oldjq-bin/jq" "a=(); for x in \"\$@\"; do a+=(\"\${x//Default_Ignorable_Code_Point/Default_Ignorable_Code_PointX}\"); done
exec '$(command -v jq)' \"\${a[@]}\"" || abort "the old-jq shim warms up" "warm-up did not run"
PATH="$T/oldjq-bin:$PATH" jq -n '"x" | test("\\p{Default_Ignorable_Code_Point}")' >/dev/null 2>&1 \
    && fail "the old-jq shim rejects the property" "accepted" || pass "the old-jq shim rejects the property (anti-vacuity)"
fresh 200 $'{"email":"a\xe2\x80\x8bbc\xef\xb8\x8fd","plan":"PRO","subscriptionStatus":"ACTIVE"}'; OV_PATH="$T/oldjq-bin:$PATH" ov status
[[ "$RC" == 0 && "$OUT" == $'Account: abcd\nPlan: PRO\nStatus: ACTIVE' && -z "$ERR" ]] \
    && pass "old jq: the T52 list still applies (U+200B, U+FE0F stripped), no error" \
    || fail "old jq: falls back to the T52 list" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
# T74 (pen-test L3): the static lists alone (old jq; node with the property swapped for \p{Cf}) also strip the
# ignorables that are not Cf: U+17B4-17B5, U+180B-180D, U+180F, U+2065, U+FFF0-FFF8, U+E0000-E0FFF (both ends of each
# range; U+E0000 and U+E00FF are unassigned); the visible neighbours U+17B3, U+17B6 and U+180A are kept. Both copies of
# the list must name them.
warm_stub "$T/oldnode-bin/node" "a=(); for x in \"\$@\"; do a+=(\"\${x//Default_Ignorable_Code_Point/Cf}\"); done
exec '$(command -v node)' \"\${a[@]}\"" || abort "the no-property node shim warms up" "warm-up did not run"
STATIC=$'{"email":"a\xe1\x9e\xb4b\xe1\x9e\xb5c\xe1\xa0\x8bd\xe1\xa0\x8de\xe1\xa0\x8ff\xe2\x81\xa5g\xef\xbf\xb0h\xef\xbf\xb8i\xf3\xa0\x87\xb0j\xf3\xa0\xbf\xbfk\xf3\xa0\x80\x80l\xf3\xa0\x83\xbfm|\xe1\x9e\xb3\xe1\x9e\xb6\xe1\xa0\x8a","plan":"PRO","subscriptionStatus":"ACTIVE"}'
STATICWANT=$'Account: abcdefghijklm|\xe1\x9e\xb3\xe1\x9e\xb6\xe1\xa0\x8a\nPlan: PRO\nStatus: ACTIVE'
for p in "old jq:$T/oldjq-bin:$PATH" "node without the property:$T/oldnode-bin:$T/nojq"; do
    fresh 200 "$STATIC"; OV_PATH="${p#*:}" ov status
    [[ "$RC" == 0 && "$OUT" == "$STATICWANT" ]] && pass "${p%%:*}: the static list strips U+17B4-17B5, U+180B-180D, U+180F, U+2065, U+FFF0-FFF8, U+E0000-E0FFF; neighbours kept" \
        || fail "${p%%:*}: the static list strips the non-Cf ignorables" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
done
# T74 (security S4): the body read into the shell is capped with head -c at --max-filesize's 262144 bytes, so a
# curl older than 8.4 (which lets a body with no Content-Length past --max-filesize; simulated by a shim that drops
# the option) still never holds more than that. Too large: one line on stderr, nothing on stdout, rc 1.
BIG="{\"email\":\"$(head -c 2000000 /dev/zero | tr '\0' a)\",\"plan\":\"PRO\",\"subscriptionStatus\":\"ACTIVE\"}"
fresh 200 "$BIG"; : > "$T/nolen"; : > "$T/oldcurl"; ov status
[[ "$RC" == 1 && -z "$OUT" && "$ERR" == *"over 262144 bytes"* ]] \
    && pass "status: a 2 MB answer with no Content-Length is cut at 262144 bytes and refused, even by an old curl" \
    || fail "status: an oversize answer is refused" "rc=$RC out=${#OUT} chars err=$ERR"
grep -q -- '--max-filesize' "$T/curl.argv" && pass "the old-curl shim saw --max-filesize (anti-vacuity: it is the option it drops)" \
    || fail "the old-curl shim saw --max-filesize" "$(cat "$T/curl.argv")"
# The cap stops the read itself, not only the answer: a 52 MB stream is dropped after the first few hundred KB (plus
# socket buffers), never read whole into the shell. 10 MB is far above what the buffers hold, far below 52 MB.
fresh 200 '{"email":"'; : > "$T/nolen"; : > "$T/oldcurl"; : > "$T/stream"; ov status
SENT=$(cat "$T/sent" 2>/dev/null)
[[ "$RC" == 1 && -z "$OUT" && "$ERR" == *"over 262144 bytes"* && "$SENT" =~ ^[0-9]+$ && "$SENT" -lt 10485760 ]] \
    && pass "status: a 52 MB stream is dropped after $SENT bytes (head -c ends the read), refused" \
    || fail "status: the read stops at the cap" "rc=$RC sent=$SENT out=${#OUT} chars err=$ERR"
fresh 200 "$VERIFY"; : > "$T/nolen"; : > "$T/oldcurl"; ov status
[[ "$RC" == 0 && "$OUT" == *"Plan: PRO"* ]] && pass "status: a small answer with no Content-Length still prints (control)" \
    || fail "status: a small answer with no Content-Length still prints" "rc=$RC out=$OUT err=$ERR"
# Surrogate rejoin (T52b): a lone high half, an invisible, a lone low half. Stripping the invisible must never join the
# halves into U+E0020 (an invisible tag). node turns lone halves into U+FFFD before the strip; jq never prints the tag
# (jq 1.7+ rejects a lone high half as invalid JSON, older jq makes U+FFFD). A lone low half: both print U+FFFD.
SUR=$(printf '{"email":"x\\uDB40\xe2\x80\x8b\\uDC20y","plan":"PRO","subscriptionStatus":"ACTIVE"}')
fresh 200 "$SUR"; OV_PATH="$T/nojq" ov status
[[ "$RC" == 0 && "$OUT" == $'Account: x\xef\xbf\xbd\xef\xbf\xbdy\nPlan: PRO\nStatus: ACTIVE' ]] \
    && pass "node: lone surrogate halves become U+FFFD, never joined into U+E0020" \
    || fail "node: lone surrogate halves become U+FFFD" "rc=$RC out=$(printf '%q' "$OUT") err=$ERR"
fresh 200 "$SUR"; ov status
[[ "$OUT" != *$'\xf3\xa0\x80\xa0'* && ( "$RC" != 0 || "$OUT" == *$'x\xef\xbf\xbd\xef\xbf\xbdy'* ) ]] \
    && pass "jq: lone surrogate halves never join into U+E0020 (rc $RC)" || fail "jq: lone surrogate halves never join" "rc=$RC out=$(printf '%q' "$OUT")"
same_without_jq "status, a lone low surrogate half" status 200 '{"email":"x​\udc20y","plan":"PRO","subscriptionStatus":"ACTIVE"}'
fresh 200 "$(printf '{"email":"\\ud83d\\ude00\xe2\x80\x8b","plan":"PRO","subscriptionStatus":"ACTIVE"}')"; OV_PATH="$T/nojq" ov status
[[ "$RC" == 0 && "$OUT" == $'Account: \xf0\x9f\x98\x80\nPlan: PRO\nStatus: ACTIVE' ]] && pass "node: a valid emoji pair is untouched by the surrogate step" \
    || fail "node: a valid emoji pair is untouched" "rc=$RC out=$(printf '%q' "$OUT")"
# Neither jq nor node: one clear line naming jq, never a raw shell error; usage stays one honest line, exit 0.
for v in status workflows; do
    fresh 200 "$VERIFY"; OV_PATH="$T/none" ov "$v"
    [[ "$RC" != 0 && -z "$OUT" && -z "$(reqs)" && "$ERR" == *"needs jq"*"brew install jq"* && "$(printf '%s\n' "$ERR" | grep -c .)" == 1 ]] && ! raw_error \
        && pass "no jq, no node: $v says in one line that it needs jq and how to install it, no request" \
        || fail "no jq, no node: $v: one clear line" "rc=$RC out=$OUT err=$ERR requests=$(reqs)"
done
fresh 200 "$USAGE"; OV_PATH="$T/none" ov usage; usage_down "no jq and no node"
# queue-push builds its body with jq: without jq, one clear line naming jq, no request, the value files deleted
fresh 201 "$CREATED"; qvals feature src "the prompt"; OV_PATH="$T/nojq" ov queue-push
api_error "no jq" 0 '' "needs jq" "brew install jq"
[[ -z "$(reqs)" ]] && ! raw_error && pass "queue-push: no jq: no request, no raw error" || fail "queue-push: no jq: no request" "requests=$(reqs) err=$ERR"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
