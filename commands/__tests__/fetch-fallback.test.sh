#!/bin/bash
# Tests that a refused or failed prompt fetch never breaks an agent or a skill (T63)
#
# Usage: ./fetch-fallback.test.sh
#        OSS_DECRYPT_UNDER_TEST=/path/to/oss-decrypt ./fetch-fallback.test.sh  (default: ~/.oss/bin/oss-decrypt)
#
# @behavior When an agent or skill cannot get its expert prompt (the API rate limits the user, the network is
#           down, or the user is not logged in), it says so in one line and carries on with the instructions in
#           its own .md file, the way it works today. It never stops dead, never digs the key out of
#           ~/.oss/config.json, never retries in a loop, and never saves a fetched prompt to a file.
# @business-rule Every `oss-decrypt --type T --name N` fetch step in agents/ and skills/ is followed by the one
#           fixed fallback sentence below. No fetch step sends oss-decrypt's output to a file (>, >>, tee, -o):
#           served prompts are never stored on the user's machine (IP protection, dev-15). And the CLI itself,
#           on the 429s the API sends (the per-IP limiter's plain-text body, the trial daily cap), exits non-zero,
#           prints no prompt and no key, and leaves no file behind, so the sentence covers what really happens.
# @boundary The installed oss-decrypt (pinned release) against a python3 http.server on a random 127.0.0.1 port,
#           with a sandbox HOME and OSS_CONFIG_DIR and a fake key. Never the real API, never the real ~/.oss config.
#
# Tests:
# 1. control: the scan finds every agent and skill fetch step (a broken glob cannot pass)
# 2. control: the scan names a missing or misplaced sentence and each way of writing the output to a file
# 3. every fetch step in agents/ and skills/ is followed by the fallback sentence
# 4. no fetch step in agents/ and skills/ writes oss-decrypt output to a file
# 5. oss-decrypt on a per-IP 429, a trial-cap 429, a 401 and a refused connection: non-zero exit, no prompt
#    on stdout, the key in no output, no new file under the sandbox HOME

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the CLI to the real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DECRYPT="${OSS_DECRYPT_UNDER_TEST:-$HOME/.oss/bin/oss-decrypt}"
source "$PLUGIN_ROOT/hooks/__tests__/lib/run-capped.sh"
# The stub API and its sandbox: stopped and removed however this script ends (a closed pipe or ^C included).
T=''; SPID=''
cleanup() { [[ -n "$SPID" ]] && { kill "$SPID" 2>/dev/null; wait "$SPID" 2>/dev/null; }; [[ -n "$T" ]] && rm -rf "${T:?}"; SPID=''; T=''; }
trap cleanup EXIT
trap 'cleanup; exit 1' HUP INT TERM PIPE

# The one fallback sentence, word for word. oss-decrypt prints "Error: <reason>" on stderr and nothing on stdout
# when a fetch fails ("Request failed" for a 429, "Unauthorized", "fetch failed", "Credentials not found...").
SENTENCE="If this command fails for any reason (it prints an \`Error:\` line, for example when rate limited, offline or not logged in), tell the user in one line and carry on with this file's own instructions; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file."
FETCH_DIRS="agents skills"
# T58 migrated 99 agent and skill fetch steps: a scan finding fewer is broken.
MIN_FETCHES=99

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

# fetch_files [root]: every agent and skill markdown file under root (default: the plugin)
fetch_files() {
    local root="${1:-$PLUGIN_ROOT}" d
    for d in $FETCH_DIRS; do
        [[ -d "$root/$d" ]] && find "$root/$d" -name '*.md' -not -path '*/__tests__/*'
    done
}

# problems [root]: "<file>:<line>: <problem>" for each fetch step that lacks the sentence or writes to a file,
# and "<file>:<line>: fetch" for every fetch step (so callers can count them).
problems() {
    local root="${1:-$PLUGIN_ROOT}" file
    fetch_files "$root" | while IFS= read -r file; do
        FF_SENTENCE="$SENTENCE" awk -v F="${file#$root/}" '
            { line[NR] = $0 }
            END {
                s = ENVIRON["FF_SENTENCE"]
                for (i = 1; i <= NR; i++) {
                    if (line[i] !~ /oss-decrypt[ \t]+(--type|-t)[ \t]/) continue
                    print F ":" i ": fetch"
                    cmd = line[i]; sub(/^.*oss-decrypt/, "", cmd); j = i
                    while (line[j] ~ /\\[ \t]*$/ && j < NR) { j++; cmd = cmd " " line[j] }
                    if (cmd ~ />/ || cmd ~ /\|[ \t]*tee/ || cmd ~ /(^|[ \t])(-o|--output)([ \t=]|$)/)
                        print F ":" i ": writes oss-decrypt output to a file"
                    k = j + 1
                    if (line[k] !~ /^[ \t]*```[ \t]*$/) { print F ":" i ": no fallback sentence (the code block does not close after the call)"; continue }
                    k++
                    while (k <= NR && line[k] ~ /^[ \t]*$/) k++
                    if (line[k] != s) print F ":" i ": no fallback sentence right after the fetch block"
                }
            }' "$file"
    done
}

test_control_scan_finds_fetches() {
    local test_name="control: the scan finds at least $MIN_FETCHES fetch steps, some in agents/ and some in skills/"
    ((TESTS_RUN++))
    local all n na ns
    all=$(problems | grep ': fetch$')
    n=$(printf '%s\n' "$all" | grep -c . | tr -d ' ')
    na=$(printf '%s\n' "$all" | grep -c '^agents/' | tr -d ' ')
    ns=$(printf '%s\n' "$all" | grep -c '^skills/' | tr -d ' ')
    if [[ "$n" -ge "$MIN_FETCHES" && "$na" -gt 0 && "$ns" -gt 0 ]]; then
        pass "$test_name ($n: $na agents, $ns skills)"
    else
        fail "$test_name" ">= $MIN_FETCHES, both dirs" "$n ($na agents, $ns skills)"
    fi
}

test_control_scan_names_synthetic() {
    local test_name="control: the scan names a missing or misplaced sentence and >, >>, | tee, -o and a continued >"
    ((TESTS_RUN++))
    local tmp out want missed="" w
    tmp=$(mktemp -d)
    mkdir -p "$tmp/agents" "$tmp/skills"
    printf '# ok\n\n```bash\n~/.oss/bin/oss-decrypt --type agents --name rust-pro\n```\n\n%s\n\nThe CLI fetches it.\n' "$SENTENCE" > "$tmp/agents/good.md"
    printf '# no\n\n```bash\n~/.oss/bin/oss-decrypt --type agents --name rust-pro\n```\n\nThe CLI fetches it.\n' > "$tmp/agents/nosentence.md"
    printf '# late\n\n```bash\n~/.oss/bin/oss-decrypt --type skills --name x\n```\n\nThe CLI fetches it.\n\n%s\n' "$SENTENCE" > "$tmp/skills/late.md"
    printf '```bash\n~/.oss/bin/oss-decrypt --type agents --name a > /tmp/x\n```\n\n%s\n' "$SENTENCE" > "$tmp/agents/redirect.md"
    printf '```bash\n~/.oss/bin/oss-decrypt --type agents --name a >> prompt.md\n```\n\n%s\n' "$SENTENCE" > "$tmp/agents/append.md"
    printf '```bash\n~/.oss/bin/oss-decrypt --type workflows --name b | tee p.md\n```\n\n%s\n' "$SENTENCE" > "$tmp/skills/tee.md"
    printf '```bash\n~/.oss/bin/oss-decrypt --type agents --name c -o p.md\n```\n\n%s\n' "$SENTENCE" > "$tmp/agents/dash-o.md"
    printf '```bash\n~/.oss/bin/oss-decrypt --type agents --name d \\\n  2>/dev/null > p.md\n```\n\n%s\n' "$SENTENCE" > "$tmp/agents/continued.md"
    out=$(problems "$tmp" | grep -v ': fetch$')
    rm -rf "$tmp"
    for want in 'agents/nosentence.md:4: no fallback' 'skills/late.md:4: no fallback' 'agents/redirect.md:2: writes' \
        'agents/append.md:2: writes' 'skills/tee.md:2: writes' 'agents/dash-o.md:2: writes' 'agents/continued.md:2: writes'; do
        [[ "$out" == *"$want"* ]] || missed="$missed [$want]"
    done
    [[ "$out" == *good.md* ]] && missed="$missed [good.md was named]"
    w=$(printf '%s\n' "$out" | grep -c 'continued.md:2: no fallback')
    [[ "$w" -eq 0 ]] || missed="$missed [the continuation hid the closing fence]"
    if [[ -z "$missed" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "each bad file named, good.md not" "missed:$missed; named: ${out:-nothing}"
    fi
}

test_every_fetch_has_fallback() {
    local test_name="every agent and skill fetch step is followed by the fallback sentence"
    ((TESTS_RUN++))
    local out n
    out=$(problems | grep ': no fallback' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        n=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
        fail "$test_name" "the closing fence, then (after blank lines) exactly: $SENTENCE" "$n fetch step(s) without it:"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

test_no_fetch_writes_a_file() {
    local test_name="no agent or skill fetch step writes oss-decrypt output to a file (>, >>, tee, -o)"
    ((TESTS_RUN++))
    local out
    out=$(problems | grep ': writes ' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "output to the conversation only" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') step(s):"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

test_cli_refusals() {
    local test_name="oss-decrypt on a per-IP 429, a trial-cap 429, a 401 and a refused connection fails cleanly"
    ((TESTS_RUN++))
    if [[ ! -x "$DECRYPT" ]]; then
        fail "$test_name" "an oss-decrypt binary at $DECRYPT (or set OSS_DECRYPT_UNDER_TEST)" "not found"
        return
    fi
    local PORT H KEY="test-key-not-real" bad="" label name url out err rc before after reqs
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    H="$T/home"; mkdir -p "$H/.oss"
    # The API: logs "PATH|AUTHORIZATION" per request; credentials for --setup; the two 429 shapes the API sends
    # (express-rate-limit's plain text, and the proposed trial daily cap), a 401; anything else 404.
    cat > "$T/api.py" << 'PY'
import http.server, os, sys, json
d = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(os.path.join(d, 'requests.log'), 'a') as f:
            f.write('%s|%s\n' % (self.path, self.headers.get('Authorization', '')))
        p = self.path.split('?')[0]
        if p == '/api/v1/auth/credentials':
            self.reply(200, {'Content-Type': 'application/json'},
                       json.dumps({'userId': 'u-test', 'salt': 'c2FsdA==', 'hardwareId': 'hw-test'}).encode())
        elif p.endswith('/rate-ip'):
            self.reply(429, {'Content-Type': 'text/plain; charset=utf-8', 'RateLimit-Limit': '100',
                             'RateLimit-Remaining': '0', 'RateLimit-Reset': '600', 'RateLimit-Policy': '100;w=900',
                             'Retry-After': '600'},
                       b'Too many requests from this IP, please try again later.')
        elif p.endswith('/trial-cap'):
            self.reply(429, {'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3600',
                             'X-OSS-Limit': 'trial-daily-names'},
                       b'Daily prompt limit reached for this trial account. Prompts you already fetched today still work. Upgrade at https://www.oneshotship.com/pricing')
        elif p.endswith('/unauth'):
            self.reply(401, {'Content-Type': 'application/json'}, b'{"error":"Invalid API key"}')
        else:
            self.reply(404, {'Content-Type': 'application/json'}, b'{"error":"Not found"}')
    def reply(self, code, hdrs, body):
        self.send_response(code)
        for k, v in hdrs.items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
with open(os.path.join(d, 'portfifo'), 'w') as f: f.write('%d\n' % srv.server_address[1])
srv.serve_forever()
PY
    mkfifo "$T/portfifo"
    exec 5<> "$T/portfifo"   # read-write: neither side's open blocks
    python3 -I "$T/api.py" "$T" </dev/null >/dev/null 2>&1 5<&- &
    SPID=$!
    if ! read -r -t 20 -u 5 PORT || [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
        exec 5<&-
        cleanup
        fail "$test_name" "the local API starts" "no port from the server"
        return
    fi
    exec 5<&-
    # cli <args...>: the CLI with only the sandbox in its environment; sets out, err, rc.
    cli() {
        out=$(run_capped 60 env -i PATH=/usr/bin:/bin HOME="$H" USER=t63 OSS_CONFIG_DIR="$H/.oss" \
            "$DECRYPT" "$@" 2>"$T/err" </dev/null); rc=$?
        err=$(cat "$T/err")
    }
    printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:%s"}\n' "$KEY" "$PORT" > "$H/.oss/config.json"
    cli --setup
    [[ "$rc" -eq 0 && -f "$H/.oss/credentials.enc" ]] || bad="$bad [setup against the stub: rc=$rc $err]"
    for label in "rate-ip" "trial-cap" "unauth" "refused"; do
        name="$label"; url="http://127.0.0.1:$PORT"
        [[ "$label" == refused ]] && { name="rate-ip"; url="http://127.0.0.1:9"; }
        printf '{"apiKey":"%s","apiUrl":"%s"}\n' "$KEY" "$url" > "$H/.oss/config.json"
        before=$(cd "$H" && find . -type f | sort)
        : > "$T/requests.log"
        cli --type agents --name "$name"
        after=$(cd "$H" && find . -type f | sort)
        reqs=$(cat "$T/requests.log")
        [[ "$rc" -ne 0 && "$rc" -ne "$RUN_CAPPED_CAP_RC" && "$rc" -ne "$RUN_CAPPED_LEAK_RC" ]] \
            || bad="$bad [$label: exit $rc, expected a plain non-zero exit]"
        [[ -z "$out" ]] || bad="$bad [$label: stdout not empty: $out]"
        [[ "$out$err" != *"$KEY"* ]] || bad="$bad [$label: the key is in the output]"
        [[ "$err" == Error:* ]] || bad="$bad [$label: stderr is not an Error: line: $err]"
        [[ "$before" == "$after" ]] || bad="$bad [$label: files changed under HOME: $(comm -13 <(echo "$before") <(echo "$after") | tr '\n' ' ')]"
        if [[ "$label" == refused ]]; then
            [[ -z "$reqs" ]] || bad="$bad [refused: the stub was reached]"
        else
            [[ "$reqs" == "/api/v1/prompts/agents/$name|Bearer $KEY" ]] || bad="$bad [$label: the stub did not get the fetch: $reqs]"
        fi
        echo "    $label: exit $rc, stdout '${out}', stderr '${err}'"
    done
    cleanup
    if [[ -z "$bad" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "non-zero exit, empty stdout, an Error: line, no key, no new file, the stub reached" "$bad"
    fi
}

echo "=== A Failed Prompt Fetch Never Breaks an Agent or Skill (T63) ==="
echo ""

test_control_scan_finds_fetches
test_control_scan_names_synthetic
test_every_fetch_has_fallback
test_no_fetch_writes_a_file
test_cli_refusals

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
