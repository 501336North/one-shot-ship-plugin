#!/bin/bash
# /oss:status and /oss:workflows fetch through `oss-value.sh status | workflows | workflow` (T60).
#
# @behavior A customer runs /oss:status or /oss:workflows [name] and sees their account or workflow config,
#           with no approval prompt (one allowlisted call each) and their API key never on a command line,
#           in the output, or sent anywhere but the API their OSS config names.
# @business-rule The key and URL come from one read of the OSS config (oss_api_creds); the key goes to curl on
#           stdin (oss_api_curl). The workflow name comes from workflow.txt in the value folder (R5-1), never
#           from argv. A workflow's config comes from GET /api/v1/workflows/<name>/editor (plain JSON;
#           /api/v1/workflows/<name> is license-encrypted). Each verb prints only what its wrapper displays.
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

# The API: "METHOD PATH|AUTHORIZATION" per request in $T/requests.log, a `ps` snapshot taken while the request is
# open appended to $T/ps.log; answers $T/status (default 200) with the bytes of $T/body.
cat > "$T/api.py" << 'PY'
import http.server, os, subprocess, sys
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
        ps = subprocess.run(['/bin/ps', '-axww', '-o', 'args='], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout
        with open(os.path.join(d, 'ps.log'), 'ab') as f: f.write(ps)
        body = rd('body', b'')
        self.send_response(int(rd('status', b'200').strip() or b'200'))
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
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
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in ($LOCAL/*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

H="$T/home"; W="$T/work"
# fresh <status> <body>: a clean sandbox HOME (the hooks under test in ~/.oss/hooks, a config naming the local
# API), an empty request, ps and argv log, a cwd in a git repo.
fresh() {
    rm -rf "$H" "$W" "$T/curl.argv" "$T/ps.log"; : > "$T/requests.log"
    mkdir -p "$H/.oss/hooks" "$W"; (cd "$W" && git init -q) >/dev/null 2>&1
    cp "$HOOKS/oss-value.sh" "$HOOKS/oss-safe-path.sh" "$HOOKS/oss-api-curl.sh" "$H/.oss/hooks/"
    printf '{"apiKey":"%s","apiUrl":"%s"}\n' "$KEY" "$LOCAL" > "$H/.oss/config.json"
    printf '%s' "$1" > "$T/status"; printf '%s' "$2" > "$T/body"
}
# ov <args...>: ~/.oss/hooks/oss-value.sh <args> as the wrapper runs it -> OUT, ERR, RC
ov() {
    OUT=$(cd "$W" && run_capped 30 env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR HOME="$H" PATH="$T/bin:$PATH" OSS_ALLOW_HTTP_LOOPBACK=1 \
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

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
