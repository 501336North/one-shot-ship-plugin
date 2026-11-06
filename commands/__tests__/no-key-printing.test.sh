#!/bin/bash
# Tests that no shipped prompt file prints the customer's API key into the chat (T57)
#
# Usage: ./no-key-printing.test.sh
#
# @behavior Every /oss command, agent and skill checks for an API key without printing
#           the key into the session transcript.
# @business-rule The API key is a secret: a prompt's auth check answers "configured" or
#           "not found" (the quiet check G10 put in visual-test.md), never echoes the
#           config line or field that holds the key (T57).
#
# Tests:
# 1. control: the classifier flags each known printing line (grep/cat/jq on the key)
# 2. control: the classifier passes the quiet check and the Bearer {apiKey} header text
# 3. control: the scan finds every shipped prompt dir (a broken glob cannot pass)
# 4. control: a synthetic prompt file with a printing line is named by the scan
# 5. no shipped prompt file prints the key (each offender named with its line)

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR must not matter here; this test reads no config.
unset OSS_CONFIG_DIR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# The shipped prompt dirs: Claude Code loads commands/, agents/ and skills/ markdown (plugin.json
# names no other prompt dir; hooks ship no .md).
PROMPT_DIRS="commands agents skills"
MIN_FILES=150

QUIET_CHECK='test -f "$HOME/.oss/config.json" && grep -qE '"'"'"apiKey"[[:space:]]*:[[:space:]]*"[A-Za-z0-9_-]'"'"' "$HOME/.oss/config.json" && echo "API key configured"'

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

# prints_key <line>: true when the shell line would print the key (or the config line holding it).
# A value captured into a variable (VAR=$(...)) or sent to /dev/null prints nothing.
prints_key() {
    local line="$1"
    # stdout to /dev/null (">" or "&>", not "2>"): 2>/dev/null alone still prints the key
    local captured='=\$\(' silenced='(^|[^2])>[[:space:]]*/dev/null'
    local grep_key='(^|[^[:alnum:]_-])grep[[:space:]][^|;&]*apiKey'
    local grep_quiet='(^|[^[:alnum:]_-])grep[[:space:]]+(-[[:alpha:]]+[[:space:]]+)*-[[:alpha:]]*[qc]'
    local cat_config='(^|[^[:alnum:]_-])cat[[:space:]][^|;&]*config\.json'
    local jq_key='(^|[^[:alnum:]_-])jq[[:space:]].*apiKey'
    [[ "$line" =~ $captured ]] && return 1
    [[ "$line" =~ $silenced ]] && return 1
    if [[ "$line" =~ $grep_key ]] && ! [[ "$line" =~ $grep_quiet ]]; then return 0; fi
    [[ "$line" =~ $cat_config ]] && return 0
    [[ "$line" =~ $jq_key ]] && return 0
    return 1
}

# prompt_files [root]: every shipped markdown prompt file under root (default: the plugin)
prompt_files() {
    local root="${1:-$PLUGIN_ROOT}" d
    for d in $PROMPT_DIRS; do
        [[ -d "$root/$d" ]] && find "$root/$d" -name '*.md' -not -path '*/__tests__/*'
    done
}

# offenders [root]: "<repo-relative file>:<line>: <text>" for each key-printing line
offenders() {
    local root="${1:-$PLUGIN_ROOT}" hit file rest num text
    prompt_files "$root" | while IFS= read -r file; do
        grep -nE 'apiKey|config\.json' "$file" | while IFS= read -r hit; do
            num="${hit%%:*}"
            text="${hit#*:}"
            if prints_key "$text"; then
                rest="${file#$root/}"
                echo "$rest:$num: $text"
            fi
        done
    done
}

test_control_flags_printing() {
    local test_name="control: the classifier flags every printing form"
    ((TESTS_RUN++))
    local missed="" l
    local samples=(
        'cat ~/.oss/config.json 2>/dev/null | grep apiKey'
        'grep apiKey ~/.oss/config.json'
        'grep "apiKey" ~/.oss/config.json'
        'grep -i "apiKey" "$HOME/.oss/config.json"'
        'grep -o '"'"'"apiKey"[^,]*'"'"' ~/.oss/config.json'
        'cat ~/.oss/config.json'
        'cat "$HOME/.oss/config.json"'
        'jq -r .apiKey ~/.oss/config.json'
        'jq '"'"'.apiKey'"'"' "$HOME/.oss/config.json"'
        'cat ~/.oss/config.json | jq -r ".apiKey"'
    )
    for l in "${samples[@]}"; do
        prints_key "$l" || missed="$missed [$l]"
    done
    if [[ -z "$missed" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "all ${#samples[@]} samples flagged" "not flagged:$missed"
    fi
}

test_control_quiet_is_clean() {
    local test_name="control: the quiet check and non-printing lines are clean"
    ((TESTS_RUN++))
    local flagged="" l
    local samples=(
        "$QUIET_CHECK"
        '  Authorization: Bearer {apiKey}'
        '    API_KEY=$(grep -o '"'"'"apiKey"[[:space:]]*:[[:space:]]*"[^"]*"'"'"' ~/.oss/config.json | sed '"'"'s/x/y/'"'"')'
        'grep -c apiKey ~/.oss/config.json'
        'jq -e .apiKey ~/.oss/config.json >/dev/null'
        '1. Read API key from `~/.oss/config.json`'
    )
    for l in "${samples[@]}"; do
        prints_key "$l" && flagged="$flagged [$l]"
    done
    if [[ -z "$flagged" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no sample flagged" "flagged:$flagged"
    fi
}

test_control_scan_finds_files() {
    local test_name="control: the scan finds more than $MIN_FILES prompt files in each shipped dir"
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
    local test_name="control: the scan names a synthetic printing file and skips a quiet one"
    ((TESTS_RUN++))
    local tmp out
    tmp=$(mktemp -d)
    mkdir -p "$tmp/agents" "$tmp/skills"
    printf '# x\n\n```bash\ncat ~/.oss/config.json 2>/dev/null | grep apiKey\n```\n' > "$tmp/agents/leaky.md"
    printf '# y\n\n```bash\n%s\n```\n' "$QUIET_CHECK" > "$tmp/skills/quiet.md"
    out=$(offenders "$tmp")
    rm -rf "$tmp"
    if [[ "$out" == "agents/leaky.md:4: "* && "$out" != *quiet.md* ]]; then
        pass "$test_name"
    else
        fail "$test_name" "only agents/leaky.md:4 named" "${out:-nothing named}"
    fi
}

test_no_prompt_prints_key() {
    local test_name="no shipped prompt file prints the API key"
    ((TESTS_RUN++))
    local out n
    out=$(offenders | sort)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        n=$(echo "$out" | wc -l | tr -d ' ')
        fail "$test_name" "no key-printing line (use: $QUIET_CHECK)" "$n printing line(s):"
        echo "$out" | sed 's/^/    /'
    fi
}

echo "=== No API Key Printing in Shipped Prompts (T57) ==="
echo ""

test_control_flags_printing
test_control_quiet_is_clean
test_control_scan_finds_files
test_control_scan_names_synthetic
test_no_prompt_prints_key

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
