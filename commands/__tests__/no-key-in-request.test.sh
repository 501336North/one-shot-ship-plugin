#!/bin/bash
# Tests that no shipped prompt asks Claude to put the API key in a request, and that every prompt fetch names a
# prompt the API serves (T58)
#
# Usage: ./no-key-in-request.test.sh
#
# @behavior Every agent, skill and command gets its expert prompt through `~/.oss/bin/oss-decrypt --type T --name N`
#           (or a hook that sends the key on curl's stdin), so the fetch works without Claude ever seeing the key.
# @business-rule The API key is a secret Claude never handles: no prompt tells Claude to write it into a header or a
#           URL (Authorization: Bearer {apiKey} and the like). The agent/skill/workflow routes only ever return
#           ciphertext, so a hand-made request could not work anyway. And a fetch is only as good as its name: each
#           oss-decrypt type/name pair must be one the deployed API serves (served-prompt-names.txt, copied from
#           the API repo, never guessed).
#
# Tests:
# 1. control: the classifier flags each hand-made keyed request form
# 2. control: the classifier passes the oss-decrypt call, the quiet check and the helper call
# 3. control: the scan finds every shipped prompt dir (a broken glob cannot pass)
# 4. control: a synthetic prompt file with a Bearer line is named by the scan
# 5. no shipped prompt puts the key in a request (each offender named with its line)
# 6. control: the served-name list holds every type, and its known names
# 7. control: the decrypt scan finds the existing calls and names a synthetic bad type and a bad name
# 8. every oss-decrypt --type T --name N in a shipped prompt is a type and name the API serves
# 9. the CLAUDE.md template comes only through oss-claude-md-template.sh (/api/v1/prompts/claude-md); no prompt
#    names /api/v1/prompts/templates/claude-md, which the API does not serve (404)

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not matter here; this test reads no config.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVED="$SCRIPT_DIR/served-prompt-names.txt"

# The shipped prompt dirs: Claude Code loads commands/, agents/ and skills/ markdown (as no-key-printing.test.sh).
PROMPT_DIRS="commands agents skills"
MIN_FILES=150
# The oss-decrypt calls already in the tree before T58 (commands/*.md and two agents): a scan finding fewer is broken.
MIN_DECRYPT_CALLS=50

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

# keys_request <line>: true when the line tells Claude to put the key in a request by hand: a Bearer token that is
# a placeholder or variable, an Authorization or API-key header naming the key, or the key in a URL query.
keys_request() {
    local line="$1"
    local bearer='[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+(\{|\$|<|\[)'
    local auth_hdr='[Aa]uthorization[[:space:]]*:[^|]*([Aa][Pp][Ii]_?[Kk][Ee][Yy]|\{key\}|\$KEY)'
    local key_hdr='[Xx]-[Aa][Pp][Ii]-[Kk][Ee][Yy]'
    local key_query='[?&]([Aa][Pp][Ii]_?[Kk][Ee][Yy]|key|token|access_token)='
    [[ "$line" =~ $bearer || "$line" =~ $auth_hdr || "$line" =~ $key_hdr || "$line" =~ $key_query ]]
}

# prompt_files [root]: every shipped markdown prompt file under root (default: the plugin)
prompt_files() {
    local root="${1:-$PLUGIN_ROOT}" d
    for d in $PROMPT_DIRS; do
        [[ -d "$root/$d" ]] && find "$root/$d" -name '*.md' -not -path '*/__tests__/*'
    done
}

# offenders [root]: "<repo-relative file>:<line>: <text>" for each line that puts the key in a request
offenders() {
    local root="${1:-$PLUGIN_ROOT}" hit file num text
    prompt_files "$root" | while IFS= read -r file; do
        grep -niE 'bearer|authorization|api-key|key=|token=' "$file" | while IFS= read -r hit; do
            num="${hit%%:*}"
            text="${hit#*:}"
            if keys_request "$text"; then
                echo "${file#$root/}:$num: $text"
            fi
        done
    done
}

# decrypt_calls [root]: "<file>:<line> <type> <name>" for each oss-decrypt --type T --name N in a shipped prompt
decrypt_calls() {
    local root="${1:-$PLUGIN_ROOT}" file hit num rest re='oss-decrypt[[:space:]]+--type[[:space:]]+([^[:space:]`"]+)[[:space:]]+--name[[:space:]]+([^[:space:]`"]+)'
    prompt_files "$root" | while IFS= read -r file; do
        grep -nE 'oss-decrypt[[:space:]]+--type' "$file" | while IFS= read -r hit; do
            num="${hit%%:*}"
            rest="${hit#*:}"
            while [[ "$rest" =~ $re ]]; do
                echo "${file#$root/}:$num ${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
                rest="${rest#*"${BASH_REMATCH[0]}"}"
            done
        done
    done
}

# unserved [root]: each decrypt call whose type is not one of the four prompt types or whose name the API does not serve
unserved() {
    local where type name
    decrypt_calls "${1:-$PLUGIN_ROOT}" | while read -r where type name; do
        case "$type" in
            commands | workflows | skills | agents) ;;
            *) echo "$where: --type $type is not commands, workflows, skills or agents"; continue ;;
        esac
        grep -qxF "$type $name" "$SERVED" || echo "$where: --type $type --name $name is not a name the API serves"
    done
}

test_control_flags_keyed_requests() {
    local test_name="control: the classifier flags every hand-made keyed request form"
    ((TESTS_RUN++))
    local missed="" l
    local samples=(
        '  Authorization: Bearer {apiKey}'
        '   - Template: `${API_BASE}/api/v1/prompts/templates/claude-md` (with `Authorization: Bearer ${API_KEY}`)'
        'curl -H "Authorization: Bearer $API_KEY" https://x/api'
        'Send the header Authorization: bearer <your api key>'
        'Authorization: Bearer [apiKey]'
        'Authorization: {apiKey}'
        'X-API-Key: {apiKey}'
        'URL: https://one-shot-ship-api.onrender.com/api/v1/prompts/agents/x?apiKey={apiKey}'
        'GET https://x/api/v1/workflows?api_key=$API_KEY'
    )
    for l in "${samples[@]}"; do
        keys_request "$l" || missed="$missed [$l]"
    done
    if [[ -z "$missed" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "all ${#samples[@]} samples flagged" "not flagged:$missed"
    fi
}

test_control_safe_is_clean() {
    local test_name="control: the oss-decrypt call, the quiet check and the stdin helper are clean"
    ((TESTS_RUN++))
    local flagged="" l
    local samples=(
        '~/.oss/bin/oss-decrypt --type agents --name rust-pro'
        'grep -q '"'"'"apiKey"'"'"' "$HOME/.oss/config.json" && echo "API key configured"'
        'oss_api_curl "$OSS_KEY" -s -m 10 "$OSS_URL/api/v1/workflows"'
        '~/.oss/hooks/oss-claude-md-template.sh'
        'The CLI fetches the encrypted prompt from the API and decrypts it locally using your stored credentials.'
        'URL: https://one-shot-ship-api.onrender.com/api/v1/workflows?page=2'
    )
    for l in "${samples[@]}"; do
        keys_request "$l" && flagged="$flagged [$l]"
    done
    if [[ -z "$flagged" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no sample flagged" "flagged:$flagged"
    fi
}

test_control_scan_finds_files() {
    local test_name="control: the scan finds more than $MIN_FILES prompt files, some in each shipped dir"
    ((TESTS_RUN++))
    local total d n missing=""
    total=$(prompt_files | wc -l | tr -d ' ')
    for d in $PROMPT_DIRS; do
        n=$(prompt_files | grep -c "^$PLUGIN_ROOT/$d/")
        [[ "$n" -gt 0 ]] || missing="$missing $d"
    done
    if [[ "$total" -gt "$MIN_FILES" && -z "$missing" ]]; then
        pass "$test_name ($total files)"
    else
        fail "$test_name" "> $MIN_FILES files, some in each of: $PROMPT_DIRS" "$total files; empty dirs:${missing:- none}"
    fi
}

test_control_scan_names_synthetic() {
    local test_name="control: the scan names a synthetic Bearer file and skips an oss-decrypt one"
    ((TESTS_RUN++))
    local tmp out
    tmp=$(mktemp -d)
    mkdir -p "$tmp/agents" "$tmp/skills"
    printf '# x\n\n```\nURL: https://x/api/v1/prompts/agents/x\nHeaders:\n  Authorization: Bearer {apiKey}\n```\n' > "$tmp/agents/keyed.md"
    printf '# y\n\n```bash\n~/.oss/bin/oss-decrypt --type agents --name rust-pro\n```\n' > "$tmp/skills/decrypt.md"
    out=$(offenders "$tmp")
    rm -rf "$tmp"
    if [[ "$out" == "agents/keyed.md:6: "* && "$out" != *decrypt.md* ]]; then
        pass "$test_name"
    else
        fail "$test_name" "only agents/keyed.md:6 named" "${out:-nothing named}"
    fi
}

test_no_prompt_keys_a_request() {
    local test_name="no shipped prompt puts the API key in a request header or URL"
    ((TESTS_RUN++))
    local out n files
    out=$(offenders | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        n=$(echo "$out" | wc -l | tr -d ' ')
        files=$(echo "$out" | cut -d: -f1 | sort -u | wc -l | tr -d ' ')
        fail "$test_name" "no keyed request (use ~/.oss/bin/oss-decrypt --type T --name N, or a hook through oss_api_curl)" \
            "$n line(s) in $files file(s):"
        echo "$out" | sed 's/^/    /'
    fi
}

test_control_served_list() {
    local test_name="control: the served-name list holds all four types and known names"
    ((TESTS_RUN++))
    local t missing="" known
    for t in agents skills commands workflows; do
        grep -q "^$t [a-z0-9-]*$" "$SERVED" 2>/dev/null || missing="$missing $t"
    done
    for known in 'agents rust-pro' 'agents security-auditor' 'skills london-tdd' 'commands build' \
        'workflows deploy-production' 'workflows build'; do
        grep -qxF "$known" "$SERVED" 2>/dev/null || missing="$missing [$known]"
    done
    if [[ -z "$missing" ]]; then
        pass "$test_name ($(grep -c '^[a-z]' "$SERVED") names)"
    else
        fail "$test_name" "every type and known name in $SERVED" "missing:$missing"
    fi
}

test_control_decrypt_scan() {
    local test_name="control: the decrypt scan finds the existing calls and names a bad type and a bad name"
    ((TESTS_RUN++))
    local n tmp out
    n=$(decrypt_calls | wc -l | tr -d ' ')
    tmp=$(mktemp -d)
    mkdir -p "$tmp/agents"
    printf '```bash\n~/.oss/bin/oss-decrypt --type agents --name rust-pro\n~/.oss/bin/oss-decrypt --type prompts --name build\n~/.oss/bin/oss-decrypt --type agents --name no-such-agent\n```\n' > "$tmp/agents/calls.md"
    out=$(unserved "$tmp")
    rm -rf "$tmp"
    if [[ "$n" -ge "$MIN_DECRYPT_CALLS" && "$out" == *"agents/calls.md:3: --type prompts"* \
        && "$out" == *"agents/calls.md:4: --type agents --name no-such-agent"* && "$out" != *"calls.md:2:"* ]]; then
        pass "$test_name ($n calls)"
    else
        fail "$test_name" ">= $MIN_DECRYPT_CALLS calls; lines 3 and 4 named, line 2 not" "$n calls; named: ${out:-nothing}"
    fi
}

test_every_decrypt_name_is_served() {
    local test_name="every oss-decrypt --type T --name N in a shipped prompt is served by the API"
    ((TESTS_RUN++))
    local out n
    out=$(unserved | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        n=$(echo "$out" | wc -l | tr -d ' ')
        fail "$test_name" "only types and names listed in served-prompt-names.txt" "$n call(s):"
        echo "$out" | sed 's/^/    /'
    fi
}

test_template_through_hook() {
    local test_name="the CLAUDE.md template comes through oss-claude-md-template.sh, never the 404 route"
    ((TESTS_RUN++))
    local dead
    dead=$(prompt_files | xargs grep -n 'prompts/templates/claude-md' 2>/dev/null | sed "s|^$PLUGIN_ROOT/||")
    if [[ -z "$dead" ]] && grep -q '^[[:space:]]*~/\.oss/hooks/oss-claude-md-template\.sh$' "$PLUGIN_ROOT/skills/ideate.md"; then
        pass "$test_name"
    else
        fail "$test_name" "skills/ideate.md runs ~/.oss/hooks/oss-claude-md-template.sh; no prompts/templates/claude-md" \
            "${dead:-skills/ideate.md does not run the hook}"
    fi
}

echo "=== No API Key in a Request, Every Fetch Served (T58) ==="
echo ""

test_control_flags_keyed_requests
test_control_safe_is_clean
test_control_scan_finds_files
test_control_scan_names_synthetic
test_no_prompt_keys_a_request
test_control_served_list
test_control_decrypt_scan
test_every_decrypt_name_is_served
test_template_through_hook

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
