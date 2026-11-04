#!/bin/bash
# Every network body a hook reads stops at 262144 bytes (T74b, the T74 finding).
#
# @behavior A server (the API, or whatever answers the manifest URL) that sends far more than any real answer, or
#           never stops sending, cannot fill a hook's memory or a state file and cannot get a cut-off body acted on:
#           the hook stops reading at the cap and takes the failure path it already has for an unreachable API,
#           with the same output and no file written in place of a good one.
# @business-rule One cap, 262144 bytes (oss-iron-laws-sync.sh's), through oss_capped in hooks/oss-api-curl.sh:
#           curl --max-filesize refuses a too-large Content-Length, and head -c ends the read of a body sent with
#           none, which curl before 8.4 lets past --max-filesize. Anything over the cap is a failure, never a
#           partial parse. Answers up to the cap behave as before. A current curl (8.4+) stops at the cap itself
#           (exit 63, with what it read so far or the -w status line): that too prints nothing (T77).
# @boundary Real curl (behind a shim that records argv, refuses any host but 127.0.0.1 and, with $T/oldcurl,
#           drops --max-filesize as a curl before 8.4 effectively does for a body with no Content-Length) against
#           a python3 http.server on a random 127.0.0.1 port. Sandbox HOME, a fake key. Every hook run goes through
#           run_capped; session start runs under its alias. Never production, never ~/.oss.
#
# Usage: ./hooks/__tests__/body-cap.test.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
abort() { fail "$1" "$2"; echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"; exit 1; }
echo "Running body-cap tests..."

for tool in python3 curl jq; do command -v "$tool" >/dev/null 2>&1 || abort "$tool is required" "not found"; done
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK OSS_MOCK_MANIFEST OSS_SKIP_MANIFEST CURL_HOME XDG_CONFIG_HOME
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

source "$SCRIPT_DIR/lib/warm-stub.sh"
source "$SCRIPT_DIR/lib/run-capped.sh"
source "$SCRIPT_DIR/lib/session-start-alias.sh"
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
SPID=''
trap '[[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }; rm -rf "$T"' EXIT
KEY="ak_test_T74b_$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
CAP=262144

# The server (T74's, plus POST): answers every request 200 with the bytes of $T/body. With $T/nolen it sends no
# Content-Length and closes the connection to end the body; with $T/stream it then sends 800 chunks of 64 KiB of
# `a` (52 MB) and writes to $T/sent how many of those bytes went out before the client hung up. With $T/short the
# Content-Length promises 1000 bytes more than the body, and the connection closes after it (curl exit 18) (T77).
cat > "$T/api.py" << 'PY'
import http.server, os, sys
d = sys.argv[1]
def rd(name, default):
    try:
        with open(os.path.join(d, name), 'rb') as f: return f.read()
    except OSError:
        return default
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        self.do_GET()
    def do_GET(self):
        with open(os.path.join(d, 'requests.log'), 'a') as f: f.write('%s %s\n' % (self.command, self.path))
        body = rd('body', b'')
        if os.path.exists(os.path.join(d, 'redirect')) and self.path == '/icon.png':
            # T78c: the icon URL redirects to plain http (a relative Location on this http server)
            self.send_response(302); self.send_header('Location', '/redirected.png'); self.send_header('Content-Length', '0')
            self.end_headers(); return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        if not os.path.exists(os.path.join(d, 'nolen')):
            self.send_header('Content-Length', str(len(body) + (1000 if os.path.exists(os.path.join(d, 'short')) else 0)))
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
[ -e '$T/cut28' ] && { cat '$T/body'; exit 28; }
a=(); for x in \"\$@\"; do [ \"\$x\" = https://www.oneshotship.com/icon.png ] && x='$LOCAL/icon.png'; a+=(\"\$x\"); done; set -- \"\${a[@]}\"
case \" \$* \" in (*' $LOCAL/icon.png '*) a=(); for x in \"\$@\"; do [ \"\$x\" = =https ] && [ \"\${p:-}\" = --proto ] && x==http; p=\$x; a+=(\"\$x\"); done; set -- \"\${a[@]}\" ;; esac
if [ -e '$T/oldcurl' ]; then a=(); s=''; for x in \"\$@\"; do if [ -n \"\$s\" ]; then s=''; continue; fi; [ \"\$x\" = --max-filesize ] && { s=1; continue; }; a+=(\"\$x\"); done; set -- \"\${a[@]}\"; fi
for a in \"\$@\"; do case \"\$a\" in (http://*|https://*) case \"\$a\" in ($LOCAL/*) ;; (*) echo \"shim: refused \$a\" >> '$T/curl.argv'; exit 7 ;; esac ;; esac; done
exec '$REAL_CURL' \"\$@\"" || abort "the curl shim warms up" "warm-up did not run"

# The plugin as installed: the hooks under test and their helpers, oss-notify.sh a no-op; session start by its alias.
P="$T/plugin"; mkdir -p "$P/hooks"
for n in check-updates.sh oss-changelog.sh fetch-iron-laws.sh oss-fetch-team-iron-laws.sh oss-login.sh oss-value.sh \
         oss-push-metrics.sh oss-session-start.sh oss-api-curl.sh oss-safe-path.sh oss-config.sh oss-settings-cleanup.sh \
         oss-iron-laws-sync.sh; do
    [[ -f "$HOOKS/$n" ]] && cp "$HOOKS/$n" "$P/hooks/$n"
done
warm_stub "$P/hooks/oss-notify.sh" 'exit 0' || abort "the notify stub warms up" "warm-up did not run"
SS_HOOK=$(session_start_alias "$P/hooks") || abort "session start alias" "not made"
printf '{"version":"1.0.0"}\n' > "$T/plugin.json"

H="$T/home"; W="$T/w/cwd"
# fresh <body>: a clean sandbox HOME (a config naming the local API, the login hooks in ~/.oss/hooks), an empty
# request and argv log, the answer <body>, normal sending (Content-Length, no stream, a current curl).
fresh() {
    rm -rf "$H" "$T/w" "$T/curl.argv" "$T/cut28" "$T/nolen" "$T/oldcurl" "$T/stream" "$T/sent" "$T/short" "$T/redirect"; : > "$T/requests.log"
    mkdir -p "$H/.oss/hooks" "$W"
    for n in oss-login.sh oss-value.sh oss-api-curl.sh oss-safe-path.sh; do cp "$P/hooks/$n" "$H/.oss/hooks/"; done
    printf '{"apiKey":"%s","apiUrl":"%s"}\n' "$KEY" "$LOCAL" > "$H/.oss/config.json"
    printf '%s' "$1" > "$T/body"
}
# flood: the worst sender: no Content-Length, 52 MB after the body, and a curl that ignores --max-filesize for it
flood() { : > "$T/nolen"; : > "$T/oldcurl"; : > "$T/stream"; }
# hook <cmd...>: runs it as the plugin does -> OUT, ERR, RC. Detached jobs are waited for through fd 3, a pipe to
# `cat` inside the capped group (as oss-config-one-read.test.sh does).
hook() {
    OUT=$(cd "$W" && run_capped 60 /bin/bash -c 'set -o pipefail; "$@" 3>&1 | cat' _ \
        env -u OSS_SKIP_HEALTH_CHECK -u CLAUDE_CODE_SESSION_ID -u OSS_RUN_HEALTH_CHECK \
        HOME="$H" PATH="$T/bin:$PATH" OSS_ALLOW_HTTP_LOOPBACK=1 GIT_CEILING_DIRECTORIES="$T/w" \
        CLAUDE_PLUGIN_ROOT="$P" CLAUDE_PROJECT_DIR="$W" OSS_PLUGIN_JSON="$T/plugin.json" \
        OSS_MANIFEST_URL="$LOCAL/api/v1/prompts/manifest" "$@" 2>"$T/err" </dev/null); RC=$?
    ERR=$(cat "$T/err")
}
# stopped <label>: the hook asked for the body and the flood was cut off well before its end (10 MB is far above
# what socket buffers hold past the cap, far below 52 MB), and curl was given --max-filesize 262144
stopped() {
    local i=0
    while [[ ! -s "$T/sent" && $i -lt 100 ]]; do sleep 0.1; i=$((i + 1)); done
    SENT=$(cat "$T/sent" 2>/dev/null)
    [[ "$SENT" =~ ^[0-9]+$ && "$SENT" -lt 10485760 ]] && pass "$1: the read stops at the cap ($SENT of 52428800 bytes sent)" \
        || fail "$1: the read stops at the cap" "sent=${SENT:-none} requests=$(cat "$T/requests.log")"
    grep -q -- "--max-filesize $CAP" "$T/curl.argv" 2>/dev/null && pass "$1: curl gets --max-filesize $CAP" \
        || fail "$1: curl gets --max-filesize $CAP" "argv=$(sed "s/$KEY/<KEY>/g" "$T/curl.argv" 2>/dev/null)"
}
# pad <prefix> <bytes>: <prefix> followed by spaces up to <bytes> bytes in all
pad() { printf '%s' "$1"; head -c $(($2 - ${#1})) /dev/zero | tr '\0' ' '; }

# --- check-updates.sh (session start's update notice; the manifest is unauthenticated) --------------------------
MANIFEST='{"prompts":{"a":{"hash":"new"}}}'
cu_state() { printf '{"lastPluginVersion":"1.0.0","lastCheckedAt":"x","manifestHashes":{"a":"old"}}\n' > "$H/.oss/update-state.json"; }
cu_hash() { jq -r '.manifestHashes.a' "$H/.oss/update-state.json" 2>/dev/null; }
NOTICE="📡 OSS update: 1 prompts improved → /oss:changelog"
fresh "$MANIFEST"; cu_state; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/check-updates.sh"
[[ "$RC" == 0 && "$OUT" == "$NOTICE" && "$(cu_hash)" == new ]] && pass "check-updates: a small manifest with no Content-Length still counts (control)" \
    || fail "check-updates: a small manifest still counts" "rc=$RC out=$OUT hash=$(cu_hash)"
fresh "$MANIFEST"; cu_state; flood; hook /bin/bash "$P/hooks/check-updates.sh"
[[ "$RC" == 0 && -z "$OUT" && "$(cu_hash)" == old ]] && pass "check-updates: a flooded manifest is no manifest: no notice, the cached hashes kept" \
    || fail "check-updates: a flooded manifest is no manifest" "rc=$RC out=${OUT:0:200} hash=$(cu_hash)"
stopped "check-updates"
# The cap is exact: a complete manifest of exactly 262144 bytes counts, one byte more is refused whole.
fresh "$(pad "$MANIFEST" $CAP)"; cu_state; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/check-updates.sh"
[[ "$OUT" == "$NOTICE" && "$(cu_hash)" == new ]] && pass "check-updates: a manifest of exactly $CAP bytes counts" \
    || fail "check-updates: a manifest of exactly $CAP bytes counts" "rc=$RC out=$OUT hash=$(cu_hash)"
fresh "$(pad "$MANIFEST" $((CAP + 1)))"; cu_state; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/check-updates.sh"
[[ -z "$OUT" && "$(cu_hash)" == old ]] && pass "check-updates: a complete manifest of $CAP + 1 bytes is refused" \
    || fail "check-updates: a manifest of $CAP + 1 bytes is refused" "rc=$RC out=$OUT hash=$(cu_hash)"
# Under the cap, curl's own failure still counts: a manifest cut short by the time limit (curl exit 28, $T/cut28 in
# the shim: the body, then exit 28) is no manifest, as before.
fresh "$MANIFEST"; cu_state; : > "$T/cut28"; hook /bin/bash "$P/hooks/check-updates.sh"
[[ -z "$OUT" && "$(cu_hash)" == old ]] && pass "check-updates: a manifest whose read failed (curl exit 28) is still no manifest" \
    || fail "check-updates: a failed read is no manifest" "rc=$RC out=$OUT hash=$(cu_hash)"

# --- oss-changelog.sh (/oss:changelog; the same unauthenticated manifest) ----------------------------------------
fresh ''; cu_state; hook /bin/bash "$P/hooks/oss-changelog.sh"; NOMANIFEST=$OUT   # the answer when no manifest came
fresh "$MANIFEST"; cu_state; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/oss-changelog.sh"
[[ "$RC" == 0 && "$OUT" == *"Updated prompts (1):"*"  • a"* ]] && pass "changelog: a small manifest with no Content-Length still lists its prompts (control)" \
    || fail "changelog: a small manifest still lists its prompts" "rc=$RC out=$OUT"
fresh "$MANIFEST"; cu_state; flood; hook /bin/bash "$P/hooks/oss-changelog.sh"
[[ "$RC" == 0 && "$OUT" == "$NOMANIFEST" && "$OUT" != *"Updated prompts"* ]] && pass "changelog: a flooded manifest shows exactly what no manifest shows" \
    || fail "changelog: a flooded manifest shows what no manifest shows" "rc=$RC out=${OUT:0:300}"
stopped "changelog"

# --- fetch-iron-laws.sh (keyed) ------------------------------------------------------------------------------------
LAWS=$'# IRON LAWS\nLaw one: tests first.'
LAWS_TOO_BIG="Error: the OSS API answer was over $CAP bytes, so it was not used (curl exit 63)"   # (T77)
fresh "$LAWS"; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/fetch-iron-laws.sh"
[[ "$RC" == 0 && "$OUT" == "$LAWS" ]] && pass "fetch-iron-laws: small laws with no Content-Length still print (control)" \
    || fail "fetch-iron-laws: small laws still print" "rc=$RC out=$OUT err=$ERR"
fresh "$LAWS"; flood; hook /bin/bash "$P/hooks/fetch-iron-laws.sh"
[[ "$RC" == 63 && -z "$OUT" && "$ERR" == "$LAWS_TOO_BIG" ]] \
    && pass "fetch-iron-laws: flooded laws fail as too large (exit 63), nothing printed" \
    || fail "fetch-iron-laws: flooded laws fail as too large" "rc=$RC out=${#OUT} bytes err=${ERR:0:200}"
stopped "fetch-iron-laws"

# --- oss-fetch-team-iron-laws.sh (keyed; caches the answer) --------------------------------------------------------
TEAM='{"law1_tdd":{"enabled":true,"locked":true}}'
# team_cache: a good cache from this same API (as an earlier fetch leaves it)
team_cache() { printf '{"cached":true}\n' > "$H/.oss/team-iron-laws.json"; printf '%s\n' "$LOCAL/api/v1/iron-laws/defaults" > "$H/.oss/team-iron-laws.json.src"; }
fresh "$TEAM"; team_cache; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/oss-fetch-team-iron-laws.sh" --force
[[ "$RC" == 0 && "$OUT" == "$TEAM" && "$(cat "$H/.oss/team-iron-laws.json")" == "$TEAM" ]] \
    && pass "team-iron-laws: a small config with no Content-Length is used and cached (control)" \
    || fail "team-iron-laws: a small config is used and cached" "rc=$RC out=$OUT"
fresh "$TEAM"; team_cache; flood; hook /bin/bash "$P/hooks/oss-fetch-team-iron-laws.sh" --force
[[ "$RC" == 0 && "$OUT" == '{"cached":true}' && "$(cat "$H/.oss/team-iron-laws.json")" == '{"cached":true}' && -f "$H/.oss/.team-iron-laws-backoff" ]] \
    && pass "team-iron-laws: a flooded config is a failed fetch: the good cache is served and kept, the backoff set" \
    || fail "team-iron-laws: a flooded config is a failed fetch" "rc=$RC out=${OUT:0:200} cache=$(head -c 200 "$H/.oss/team-iron-laws.json")"
stopped "team-iron-laws"

# --- oss-login.sh (/oss:login: checks the key, then saves it) ------------------------------------------------------
# login: the key in the value folder (what the model writes), a config naming only the local API, then the hook
login() {
    hook /bin/bash "$H/.oss/hooks/oss-value.sh" dir; [[ -n "$OUT" ]] && echo ossk_t74b_login_key > "$OUT/key.txt"
    printf '{"apiUrl":"%s"}\n' "$LOCAL" > "$H/.oss/config.json"
    hook /bin/bash "$H/.oss/hooks/oss-login.sh"
}
saved_key() { jq -r '.apiKey // "none"' "$H/.oss/config.json" 2>/dev/null; }
fresh '{"plan":"pro"}'; : > "$T/nolen"; : > "$T/oldcurl"; login
[[ "$RC" == 0 && "$OUT" == "Plan: pro" && "$(saved_key)" == ossk_t74b_login_key ]] && pass "login: a small answer with no Content-Length saves the key (control)" \
    || fail "login: a small answer saves the key" "rc=$RC out=$OUT err=$ERR key=$(saved_key)"
fresh '{"plan":"pro"}'; flood; login
[[ "$RC" == 1 && -z "$OUT" && "$ERR" == "Error: Couldn't verify the key (network or server problem). Check your connection and run /oss:login again." && "$(saved_key)" == none ]] \
    && pass "login: a flooded answer is a failed check: the network message, the key not saved" \
    || fail "login: a flooded answer is a failed check" "rc=$RC out=${OUT:0:200} err=${ERR:0:200} key=$(saved_key)"
stopped "login"

# --- oss-push-metrics.sh (POST; only the status is used) ------------------------------------------------------------
pm_log() { cat "$H/.oss/logs/metrics-push.log" 2>/dev/null; }
pm_pending() { ls "$H/.oss/pending-metrics" 2>/dev/null | grep -c '\.json$'; }
fresh '{"ok":true}'; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/oss-push-metrics.sh" '{"command":"build"}'
[[ "$RC" == 0 && "$(pm_log)" == *"Metrics pushed successfully (HTTP 200)"* && "$(pm_pending)" == 0 ]] \
    && pass "push-metrics: a small answer with no Content-Length is a push (control)" || fail "push-metrics: a small answer is a push" "rc=$RC log=$(pm_log)"
fresh '{"ok":true}'; flood; hook /bin/bash "$P/hooks/oss-push-metrics.sh" '{"command":"build"}'
[[ "$RC" == 0 && "$(pm_log)" == *"curl failed (network error or timeout)"* && "$(pm_log)" != *"pushed successfully"* && "$(pm_pending)" == 1 ]] \
    && pass "push-metrics: a flooded answer is a failed push: logged as such, the metrics kept for retry" \
    || fail "push-metrics: a flooded answer is a failed push" "rc=$RC pending=$(pm_pending) log=$(pm_log)"
stopped "push-metrics"

# --- oss-session-start.sh (the subscription check) -------------------------------------------------------------------
fresh '{"status":"active"}'; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$SS_HOOK"
[[ "$OUT" == *"OSS: Ready (active) - IRON LAWS active"* ]] && pass "session start: a small answer with no Content-Length gives the status (control)" \
    || fail "session start: a small answer gives the status" "rc=$RC out=${OUT:0:300}"
fresh '{"status":"active",'; flood; hook /bin/bash "$SS_HOOK"
[[ "$OUT" == *"OSS: Ready - IRON LAWS active"* && "$OUT" != *"(active)"* ]] \
    && pass "session start: a flooded answer is an unknown status, as when the API is down" \
    || fail "session start: a flooded answer is an unknown status" "rc=$RC out=${OUT:0:300}"
stopped "session start"

# --- T77: a current curl stops at the cap itself (exit 63) -----------------------------------------------------------
# No old-curl shim here: the system curl gets --max-filesize. curl 8.4+ writes exactly the cap of a body with no
# Content-Length and exits 63, and refuses a Content-Length over the cap up front (still printing -w's "\n200").
echo "(T77 rows: $("$REAL_CURL" --version | head -1 | cut -d' ' -f1-2))"
# capped [-w]: oss_capped around the real curl, as the hooks call it -> OUT, RC
capped() {
    hook /bin/bash -c 'source "$1"; shift; oss_capped curl -s -m 10 --max-filesize "$OSS_BODY_MAX" "$@" "$LOCAL_URL/x"; echo "rc=$?" >&2' _ \
        "$P/hooks/oss-api-curl.sh" "$@"
    RC=${ERR##*rc=}
}
export LOCAL_URL=$LOCAL
fresh '{"status":"active",'; : > "$T/nolen"; : > "$T/stream"; capped
[[ "$RC" == 63 && -z "$OUT" ]] && pass "oss_capped: a stream with no Content-Length that curl stops at the cap prints nothing, rc 63" \
    || fail "oss_capped: a stream curl stops at the cap prints nothing" "rc=$RC out=${#OUT} bytes"
fresh '{"status":"active",'; : > "$T/nolen"; : > "$T/stream"; capped -w '\n%{http_code}'
[[ "$RC" == 63 && -z "$OUT" ]] && pass "oss_capped: the same stream with a -w status line prints nothing, rc 63" \
    || fail "oss_capped: the same stream with -w prints nothing" "rc=$RC out=${#OUT} bytes"
fresh "$(pad '{"plan":"pro"}' $((CAP + 1)))"; capped -w '\n%{http_code}'
[[ "$RC" == 63 && -z "$OUT" ]] && pass "oss_capped: a Content-Length over the cap prints nothing, not even the -w status line, rc 63" \
    || fail "oss_capped: a Content-Length over the cap prints nothing" "rc=$RC out=$(printf '%q' "${OUT:0:100}")"
fresh "$(pad '{"plan":"pro"}' $CAP)"; capped
[[ "$RC" == 0 && "$OUT" == '{"plan":"pro"}'*' ' && ${#OUT} == $CAP ]] && pass "oss_capped: a Content-Length of exactly the cap still prints the whole body, rc 0 (control)" \
    || fail "oss_capped: a body at the cap still prints" "rc=$RC out=${#OUT} bytes"
# session start: the stream starts with an active status; curl's cut-off 262144 bytes must not be read as one
fresh '{"status":"active",'; : > "$T/nolen"; : > "$T/stream"; hook /bin/bash "$SS_HOOK"
[[ "$OUT" == *"OSS: Ready - IRON LAWS active"* && "$OUT" != *"(active)"* ]] \
    && pass "session start: a stream curl stops at the cap is an unknown status, never parsed" \
    || fail "session start: a stream curl stops at the cap is an unknown status" "rc=$RC out=${OUT:0:300}"
stopped "session start (curl's own stop)"
# login: an answer with a Content-Length over the cap and a 200 is a failed check
fresh "$(pad '{"plan":"pro"}' $((CAP + 1)))"; login
[[ "$RC" == 1 && -z "$OUT" && "$ERR" == "Error: Couldn't verify the key (network or server problem). Check your connection and run /oss:login again." && "$(saved_key)" == none ]] \
    && pass "login: a 200 with a Content-Length over the cap is a failed check: the network message, the key not saved" \
    || fail "login: a Content-Length over the cap is a failed check" "rc=$RC out=${OUT:0:200} err=${ERR:0:200} key=$(saved_key)"
# login: a 200 whose body is cut short (curl exit 18, the -w status line still printed) is a failed check too
fresh '{"plan":"pro"}'; : > "$T/short"; login
[[ "$RC" == 1 && -z "$OUT" && "$ERR" == "Error: Couldn't verify the key (network or server problem). Check your connection and run /oss:login again." && "$(saved_key)" == none ]] \
    && pass "login: a 200 whose body was cut short (curl exit 18) is a failed check, the key not saved" \
    || fail "login: a cut-short 200 is a failed check" "rc=$RC out=${OUT:0:200} err=${ERR:0:200} key=$(saved_key)"
# fetch-iron-laws: a Content-Length over the cap is too large; a failed read under the cap is still could-not-reach
fresh "$(pad "$LAWS" $((CAP + 1)))"; hook /bin/bash "$P/hooks/fetch-iron-laws.sh"
[[ "$RC" == 63 && -z "$OUT" && "$ERR" == "$LAWS_TOO_BIG" ]] && pass "fetch-iron-laws: laws with a Content-Length over the cap fail as too large (exit 63)" \
    || fail "fetch-iron-laws: a Content-Length over the cap fails as too large" "rc=$RC out=${#OUT} bytes err=${ERR:0:200}"
fresh "$LAWS"; : > "$T/cut28"; hook /bin/bash "$P/hooks/fetch-iron-laws.sh"
[[ "$RC" == 28 && -z "$OUT" && "$ERR" == "Error: Could not reach OSS API (curl exit 28)" ]] \
    && pass "fetch-iron-laws: a failed read under the cap (curl exit 28) still says it could not reach the API" \
    || fail "fetch-iron-laws: a failed read under the cap says could not reach" "rc=$RC out=${#OUT} bytes err=${ERR:0:200}"

# --- oss-iron-laws-sync.sh --install (/oss:login: writes the laws into the project's CLAUDE.md) (T74c) ------------
# It had --max-filesize but no byte stop: a curl that lets a body with no Content-Length past it wrote all of it.
SYNC_LAWS="# IRON LAWS"$'\n'"$(pad 'Law one: tests first.' 600)"
fresh "$SYNC_LAWS"; : > "$T/nolen"; : > "$T/oldcurl"; hook /bin/bash "$P/hooks/oss-iron-laws-sync.sh" --install
[[ "$RC" == 0 && "$(cat "$W/CLAUDE.md" 2>/dev/null)" == *"Law one: tests first."* ]] && pass "iron-laws-sync: small laws with no Content-Length are installed (control)" \
    || fail "iron-laws-sync: small laws are installed" "rc=$RC err=$ERR"
fresh "$SYNC_LAWS"; flood; hook /bin/bash "$P/hooks/oss-iron-laws-sync.sh" --install
[[ "$RC" == 4 && ! -e "$W/CLAUDE.md" && "$ERR" == "oss-iron-laws-sync: rejected: body over 262144 bytes" ]] \
    && pass "iron-laws-sync: flooded laws are a failed fetch: nothing written, the over-the-cap warning as before" \
    || fail "iron-laws-sync: flooded laws are a failed fetch" "rc=$RC claude_md=$([[ -e "$W/CLAUDE.md" ]] && echo yes || echo no) err=${ERR:0:200}"
stopped "iron-laws-sync"

# --- oss-notify.sh --workflow <cmd> start (the analytics POST; its answer is discarded) (T74c) ------------------------
# A detached job limited only by -m 5 read every byte the API sent in those 5 s; now it stops at the cap.
NP="$T/np"; mkdir -p "$NP/hooks" "$NP/watcher/dist/cli"
for n in oss-notify.sh oss-api-curl.sh oss-safe-path.sh; do cp "$HOOKS/$n" "$NP/hooks/$n"; done
: > "$NP/watcher/dist/cli/update-workflow-state.js"   # the hook sends analytics only when this exists
warm_stub "$NP/hooks/oss-log.sh" 'exit 0' && warm_stub "$T/nbin/node" 'exit 0' || abort "the notify stubs warm up" "warm-up did not run"
notify() { hook env PATH="$T/nbin:$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$NP" /bin/bash "$NP/hooks/oss-notify.sh" --workflow build start; }
fresh '{}'; : > "$T/nolen"; : > "$T/oldcurl"; notify
grep -q '^POST /api/v1/analytics/track' "$T/requests.log" && pass "notify: the analytics POST is sent (control)" \
    || fail "notify: the analytics POST is sent" "rc=$RC requests=$(cat "$T/requests.log") err=${ERR:0:200}"
fresh '{}'; flood; notify
[[ "$RC" == 0 ]] && grep -q '^POST /api/v1/analytics/track' "$T/requests.log" && pass "notify: a flooded analytics answer still ends the hook normally" \
    || fail "notify: a flooded analytics answer still ends the hook normally" "rc=$RC requests=$(cat "$T/requests.log")"
stopped "notify"

# --- commands/login.md Step 6: the notification icon download (T74c) -------------------------------------------------
# The prompt's own bash block, as Claude runs it (bash -c, no pipefail), with the shim answering the icon URL from
# the local server. Over 1 MiB or 10 s it is no icon: nothing kept, the plugin's own icon or the note instead.
ICON_CAP=1048576
icon_block() { awk '/Create OSS notification icon/ { f = 1 } f && /^[[:space:]]*```bash/ { b = 1; next } b && /^[[:space:]]*```/ { exit } b' "$HOOKS/../commands/login.md"; }
ICON_SH=$(icon_block)
[[ "$ICON_SH" == *"https://www.oneshotship.com/icon.png"* ]] || abort "login.md's icon block is found" "got: ${ICON_SH:0:200}"
icon() { hook /bin/bash -c "$ICON_SH"; }
ICON="$H/.oss/notification-icon.png"
NOTE="Note: Could not create notification icon. Notifications will work without branding."
fresh 'PNG-T74C'; : > "$T/nolen"; : > "$T/oldcurl"; icon
[[ "$(cat "$ICON" 2>/dev/null)" == PNG-T74C && "$OUT" != *Note* ]] && pass "login icon: a small icon with no Content-Length is saved (control)" \
    || fail "login icon: a small icon is saved" "rc=$RC out=$OUT icon=$(head -c 50 "$ICON" 2>/dev/null)"
fresh 'PNG-T74C'; flood; icon
[[ ! -e "$ICON" && "$OUT" == *"$NOTE"* ]] && pass "login icon: a flooded icon is no icon: nothing kept, the note shown" \
    || fail "login icon: a flooded icon is no icon" "rc=$RC out=${OUT:0:200} icon=$(wc -c < "$ICON" 2>/dev/null) bytes"
grep -q -- "--max-filesize $ICON_CAP" "$T/curl.argv" && grep -qE -- "--max-time [0-9]+" "$T/curl.argv" \
    && pass "login icon: curl gets --max-filesize $ICON_CAP and a --max-time" || fail "login icon: curl gets a size and a time limit" "argv=$(cat "$T/curl.argv")"
fresh "$(pad PNG $((ICON_CAP + 1)))"; icon
[[ ! -e "$ICON" && "$OUT" == *"$NOTE"* ]] && pass "login icon: an icon of $ICON_CAP + 1 bytes (with a Content-Length) is not kept" \
    || fail "login icon: an icon over the cap is not kept" "rc=$RC out=${OUT:0:200} icon=$(wc -c < "$ICON" 2>/dev/null) bytes"
fresh "$(pad PNG $((ICON_CAP + 1)))"; : > "$T/nolen"; : > "$T/oldcurl"; icon
[[ ! -e "$ICON" && "$OUT" == *"$NOTE"* ]] && pass "login icon: an icon of $ICON_CAP + 1 bytes past --max-filesize (old curl) is not kept" \
    || fail "login icon: an icon over the cap past --max-filesize is not kept" "rc=$RC out=${OUT:0:200} icon=$(wc -c < "$ICON" 2>/dev/null) bytes"
fresh "$(pad PNG $ICON_CAP)"; : > "$T/nolen"; : > "$T/oldcurl"; icon
[[ $(wc -c < "$ICON" 2>/dev/null) -eq $ICON_CAP && "$OUT" != *Note* ]] && pass "login icon: an icon of exactly $ICON_CAP bytes is saved" \
    || fail "login icon: an icon at the cap is saved" "rc=$RC out=${OUT:0:200} icon=$(wc -c < "$ICON" 2>/dev/null) bytes"

# T78c: https only, redirects included (the shim lets the local server stand in for https by turning --proto =https
# into =http for the icon URL; --proto-redir is passed as written, so real curl refuses a redirect to http), and a
# byte stop so a curl before 8.4 cannot write more than the cap to ~/.oss for 10 s.
grep -q -- "--proto =https --proto-redir =https" "$T/curl.argv" \
    && pass "login icon: curl is limited to https, redirects included (--proto, --proto-redir =https)" || fail "login icon: curl is limited to https" "argv=$(cat "$T/curl.argv")"
fresh 'PNG-T78C'; : > "$T/redirect"; icon
[[ "$(cat "$ICON" 2>/dev/null)" != PNG-T78C && "$(cat "$T/requests.log")" != *redirected* && "$OUT" == *"$NOTE"* ]] \
    && pass "login icon: a redirect to http is not followed: no icon from it, the note shown" \
    || fail "login icon: a redirect to http is not followed" "rc=$RC out=${OUT:0:200} requests=$(cat "$T/requests.log" | tr '\n' ' ') icon=$(head -c 20 "$ICON" 2>/dev/null)"
fresh 'PNG-T78C'; flood; icon
SENT=''; i=0; while [[ ! -s "$T/sent" && $i -lt 100 ]]; do sleep 0.1; i=$((i + 1)); done; SENT=$(cat "$T/sent" 2>/dev/null)
[[ ! -e "$ICON" && "$SENT" =~ ^[0-9]+$ && "$SENT" -lt 10485760 ]] \
    && pass "login icon: on an old curl (no --max-filesize) the flood is cut near the cap ($SENT of 52428800 bytes sent), nothing kept" \
    || fail "login icon: on an old curl the flood is cut near the cap" "sent=${SENT:-none} icon=$([ -e "$ICON" ] && wc -c < "$ICON") out=${OUT:0:200}"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
