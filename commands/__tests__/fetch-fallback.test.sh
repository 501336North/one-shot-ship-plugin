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
# 6. (T73) control: the scan finds every command fetch step in commands/*.md
# 7. (T73) control: the command scan names a missing, late or misplaced STOP rule, a file write, a config.json read
# 8. (T73) every command fetch step (commands/*.md, oss-decrypt --type or oss-value.sh decrypt) is followed by
#    the one-line STOP rule; trust.md is checked by its own tests below (T73b)
# 11. (T73b) control: the trust scan finds the four network fetch fences of trust.md (verify, both list tiers, decrypt)
# 12. (T73b) every trust.md network fetch fence is followed by the stop rule for rate limit, offline and login
# 13. (T73b) trust.md never says "Do not stop the audit" outside the prompt-specific rule
# 9. (T73) no command fetch step writes oss-decrypt output to a file
# 10. (T73) no command fetch step tells Claude to read ~/.oss/config.json

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

# T73: each command that fetches its prompt has a command-shaped rule: tell the user in one line and STOP. A command
# has no local instructions to carry on with, so it stops where an agent or skill carries on.
COMMAND_SENTENCE="If this command fails for any reason (it prints an \`Error:\` line, for example when rate limited, offline or not logged in), tell the user in one line what happened (rate limited, offline, or not logged in, so run /oss:login) and STOP this command; do not read ~/.oss/config.json, do not retry in a loop, and do not save the fetched prompt to a file."
# commands/trust.md is checked by trust_problems with its own sentence (T73b): its audit loop has a different
# failure rule from the other commands, so it is not checked against COMMAND_SENTENCE.
TRUST_FILE="commands/trust.md"
# The trust sentence, word for word. The CLI prints "Error: <message>" on stderr and exit 1 for every failure
# (packages/cli-decrypt/src/cli.ts). Its messages: "Prompt not found" (404), "Unauthorized" (401), "Credentials not
# found. Run setup first." (no login), "fetch failed" (offline), "Request failed" (a plain-text 429, or any other
# non-JSON error). Only the first and an "Invalid prompt" message are about one prompt; the rest stop the audit.
TRUST_SENTENCE='If this command fails, tell the user in one line what happened and STOP the audit, reporting the prompts checked so far: `Error: fetch failed` means offline; `Error: Unauthorized` or `Error: Credentials not found` means not logged in (run /oss:login); `Error: Request failed` means rate limited or the API is unavailable, which the CLI cannot tell apart. The only failures specific to one prompt are `Error: Prompt not found`, an `Error: Invalid prompt` message and `oss-value: decrypt: refused`: record that prompt as DECRYPT_FAIL and go on to the next one. Any other failure stops the audit as well. Never retry in a loop, never read ~/.oss/config.json, and never save a prompt to a file.'
# trust.md network fetch fences: --verify-manifest, --list-prompts (standard and full tier) and the oss-value decrypt.
MIN_TRUST_FETCHES=4
# 57 commands fetch a prompt: 56 use oss-decrypt --type (oss-custom's line 100 is the oss-value wrapper) and trust.md
# uses the oss-value wrapper. 62 fetch steps in all, found in ```bash blocks.
MIN_COMMAND_FETCHES=62
MIN_COMMAND_FILES=57

# command_problems [root]: "<file>:<line>: fetch" for every command fetch step (a line in a fenced block that runs
# oss-decrypt --type or the oss-value.sh decrypt wrapper), then "<file>:<line>: no rule right after the fetch block",
# "<file>:<line>: writes oss-decrypt output to a file", or "<file>:<line>: reads config.json in the fetch step".
command_problems() {
    local root="${1:-$PLUGIN_ROOT}" file
    for file in "$root"/commands/*.md; do
        [[ -f "$file" ]] || continue
        FF_CSENTENCE="$COMMAND_SENTENCE" FF_TSENTENCE="$TRUST_SENTENCE" awk -v F="${file#$root/}" -v TF="$TRUST_FILE" '
            { line[NR] = $0 }
            END {
                s = ENVIRON["FF_CSENTENCE"]
                t = ENVIRON["FF_TSENTENCE"]
                for (i = 1; i <= NR; i++) {
                    if (line[i] !~ /^[ \t]*```/) continue
                    j = i + 1
                    while (j <= NR && line[j] !~ /^[ \t]*```[ \t]*$/) j++
                    for (f = i + 1; f < j; f++) {
                        if (line[f] !~ /oss-decrypt[ \t]+(--type|-t)[ \t]/ && line[f] !~ /oss-value\.sh[ \t]+decrypt/) continue
                        print F ":" f ": fetch"
                        cmd = line[f]; g = f
                        while (line[g] ~ /\\[ \t]*$/ && g < j - 1) { g++; cmd = cmd " " line[g] }
                        if (cmd ~ />/ || cmd ~ /\|[ \t]*tee/ || cmd ~ /(^|[ \t])(-o|--output)([ \t=]|$)/)
                            print F ":" f ": writes oss-decrypt output to a file"
                        k = j + 1
                        while (k <= NR && line[k] ~ /^[ \t]*$/) k++
                        if (line[k] != s && F != TF) print F ":" f ": no rule right after the fetch block"
                        for (r = f + 1; r <= NR && line[r] !~ /^## /; r++)
                            if (line[r] ~ /config\.json/ && line[r] != s && line[r] != t)
                                print F ":" r ": reads config.json in the fetch step"
                    }
                    i = j
                }
            }' "$file"
    done
}

test_control_command_scan_finds_fetches() {
    local test_name="control: the scan finds at least $MIN_COMMAND_FETCHES command fetch steps in at least $MIN_COMMAND_FILES files"
    ((TESTS_RUN++))
    local all n nf
    all=$(command_problems | grep ': fetch$')
    n=$(printf '%s\n' "$all" | grep -c . | tr -d ' ')
    nf=$(printf '%s\n' "$all" | cut -d: -f1 | sort -u | grep -c . | tr -d ' ')
    if [[ "$n" -ge "$MIN_COMMAND_FETCHES" && "$nf" -ge "$MIN_COMMAND_FILES" ]]; then
        pass "$test_name ($n steps in $nf files)"
    else
        fail "$test_name" ">= $MIN_COMMAND_FETCHES steps, >= $MIN_COMMAND_FILES files" "$n steps in $nf files"
    fi
}

test_control_command_scan_names_synthetic() {
    local test_name="control: the command scan names a missing, late or misplaced rule, a file write, a config.json read, and no prose mention"
    ((TESTS_RUN++))
    local tmp out want missed="" fetch="~/.oss/bin/oss-decrypt --type workflows --name x"
    tmp=$(mktemp -d)
    mkdir -p "$tmp/commands"
    printf '# ok\n\n```bash\n%s\n```\n\n%s\n\nThe CLI fetches it.\n' "$fetch" "$COMMAND_SENTENCE" > "$tmp/commands/good.md"
    printf '# no\n\n```bash\n%s\n```\n\nThe CLI fetches it.\n' "$fetch" > "$tmp/commands/norule.md"
    printf '# late\n\n```bash\n%s\n```\n\nOne.\n\nTwo.\n\nThree.\n\n%s\n' "$fetch" "$COMMAND_SENTENCE" > "$tmp/commands/late.md"
    printf '# redir\n\n```bash\n%s > prompt.md\n```\n\n%s\n' "$fetch" "$COMMAND_SENTENCE" > "$tmp/commands/redirect.md"
    printf '# tee\n\n```bash\n%s | tee p.md\n```\n\n%s\n' "$fetch" "$COMMAND_SENTENCE" > "$tmp/commands/tee.md"
    printf '# cfg\n\n```bash\n%s\n```\n\n%s\n\nRead ~/.oss/config.json for the key.\n\n## Step 6\n' "$fetch" "$COMMAND_SENTENCE" > "$tmp/commands/configread.md"
    printf '# prose\n\nThe CLI runs `oss-decrypt --type workflows --name x` in prose.\n' > "$tmp/commands/prose.md"
    out=$(command_problems "$tmp" | grep -v ': fetch$')
    rm -rf "$tmp"
    for want in 'commands/norule.md:*: no rule' 'commands/late.md:*: no rule' 'commands/redirect.md:*: writes' \
        'commands/tee.md:*: writes' 'commands/configread.md:*: reads config.json'; do
        [[ "$out" == *$want* ]] || missed="$missed [$want]"
    done
    [[ "$out" == *good.md* || "$out" == *prose.md* ]] && missed="$missed [good.md or prose.md was named]"
    if [[ -z "$missed" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "each bad command named, good.md and prose.md not" "missed:$missed; named: ${out:-nothing}"
    fi
}

test_every_command_fetch_has_rule() {
    local test_name="every command fetch step (but trust.md, checked below) is followed by the one-line STOP rule"
    ((TESTS_RUN++))
    local out n
    out=$(command_problems | grep ': no rule' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        n=$(printf '%s\n' "$out" | wc -l | tr -d ' ')
        fail "$test_name" "the closing fence, then (after blank lines) exactly: $COMMAND_SENTENCE" "$n fetch step(s) without it:"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

test_no_command_fetch_writes_a_file() {
    local test_name="no command fetch step writes oss-decrypt output to a file (>, >>, tee, -o)"
    ((TESTS_RUN++))
    local out
    out=$(command_problems | grep ': writes ' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "output to the conversation only" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') step(s):"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

test_no_command_fetch_reads_config() {
    local test_name="no command fetch step tells Claude to read ~/.oss/config.json (the rule itself excepted)"
    ((TESTS_RUN++))
    local out
    out=$(command_problems | grep ': reads config.json' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no config.json mention between a fetch and the next ## heading" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') line(s):"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

# trust_problems [root]: for commands/trust.md only (T73b). "<file>:<line>: network fetch" for each fence that runs
# --verify-manifest, --list-prompts or the oss-value decrypt wrapper, "... no stop rule right after the fetch block"
# when the trust sentence does not follow that fence, and "... unqualified continue" for a "Do not stop the audit"
# line that is not qualified by "Prompt not found".
trust_problems() {
    local root="${1:-$PLUGIN_ROOT}"
    local file="$root/$TRUST_FILE"
    [[ -f "$file" ]] || return 0
    FF_TSENTENCE="$TRUST_SENTENCE" awk -v F="$TRUST_FILE" '
        { line[NR] = $0 }
        END {
            s = ENVIRON["FF_TSENTENCE"]
            for (i = 1; i <= NR; i++) {
                if (line[i] !~ /^[ \t]*```/) continue
                j = i + 1
                while (j <= NR && line[j] !~ /^[ \t]*```[ \t]*$/) j++
                found = 0
                for (f = i + 1; f < j; f++) {
                    if (line[f] !~ /oss-decrypt[ \t]+--(verify-manifest|list-prompts)/ && line[f] !~ /oss-value\.sh[ \t]+decrypt/) continue
                    if (found) continue
                    found = 1
                    print F ":" f ": network fetch"
                    k = j + 1
                    while (k <= NR && line[k] ~ /^[ \t]*$/) k++
                    if (line[k] != s) print F ":" f ": no stop rule right after the fetch block"
                }
                i = j
            }
            for (r = 1; r <= NR; r++)
                if (line[r] ~ /Do not stop the audit/ && line[r] !~ /Prompt not found/)
                    print F ":" r ": unqualified continue"
        }' "$file"
}

test_control_trust_scan_finds_fetches() {
    local test_name="control: the trust scan finds at least $MIN_TRUST_FETCHES network fetch fences (verify, both list tiers, decrypt)"
    ((TESTS_RUN++))
    local n
    n=$(trust_problems | grep -c ': network fetch$' | tr -d ' ')
    if [[ "$n" -ge "$MIN_TRUST_FETCHES" ]]; then
        pass "$test_name ($n)"
    else
        fail "$test_name" ">= $MIN_TRUST_FETCHES" "$n"
    fi
}

test_trust_fetch_has_stop_rule() {
    local test_name="every trust.md network fetch (verify, list, decrypt) is followed by the stop-on-rate-limit/offline/login rule"
    ((TESTS_RUN++))
    local out
    out=$(trust_problems | grep ': no stop rule' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "the closing fence, then (after blank lines) exactly the trust sentence" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') fence(s) without it:"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

test_trust_no_unqualified_continue() {
    local test_name="trust.md never says to go on past a failure unless it is one prompt's (no unqualified 'Do not stop the audit')"
    ((TESTS_RUN++))
    local out
    out=$(trust_problems | grep ': unqualified continue$' | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no 'Do not stop the audit' outside the prompt-specific rule" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') line(s):"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

# trust_report_problems [root]: the trust report region (Step 6 to Method Attribution) must cover the stopped-early path
# (T73b). Prints one line per problem.
trust_report_problems() {
    local root="${1:-$PLUGIN_ROOT}"
    local file="$root/$TRUST_FILE"
    [[ -f "$file" ]] || return 0
    local region
    region=$(awk '
        /^## Step 6:/ { on = 1 }
        /^## Method Attribution/ { on = 0 }
        on { print }' "$file")
    local n
    n=$(printf '%s\n' "$region" | grep -c 'Stopped early: <')
    [[ "$n" -ge 2 ]] || echo "$TRUST_FILE: the stopped-early line 'Stopped early: <reason>' is missing from the terminal summary or the markdown report ($n of 2)"
    printf '%s\n' "$region" | grep -q 'Steps 2, 4 or 5a' || echo "$TRUST_FILE: the stopped-early path names no steps (Steps 2, 4 or 5a)"
    printf '%s\n' "$region" | grep -q 'After all prompts are audited' && echo "$TRUST_FILE: Step 6 still says 'After all prompts are audited' with no stopped-early path"
    printf '%s\n' "$region" | grep 'prompts passed all checks' | grep -v 'audited prompts passed all checks' | sed "s#^#$TRUST_FILE: unqualified pass claim: #"
    return 0
}

test_trust_report_covers_stopped_early() {
    local test_name="trust.md's report (Step 6, terminal and markdown, Summary) covers a stopped-early audit and never claims a full pass"
    ((TESTS_RUN++))
    local out
    out=$(trust_report_problems)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "a stopped-early line in both reports, the Steps named, no unqualified full-audit claim" "$(printf '%s\n' "$out" | wc -l | tr -d ' ') problem(s):"
        printf '%s\n' "$out" | sed 's/^/    /'
    fi
}

echo "=== A Failed Prompt Fetch Never Breaks an Agent or Skill (T63) ==="
echo ""

test_control_scan_finds_fetches
test_control_scan_names_synthetic
test_every_fetch_has_fallback
test_no_fetch_writes_a_file
test_cli_refusals

test_control_command_scan_finds_fetches
test_control_command_scan_names_synthetic
test_every_command_fetch_has_rule
test_no_command_fetch_writes_a_file
test_no_command_fetch_reads_config
test_control_trust_scan_finds_fetches
test_trust_fetch_has_stop_rule
test_trust_no_unqualified_continue
test_trust_report_covers_stopped_early

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
