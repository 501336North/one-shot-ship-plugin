#!/bin/bash
# Tests that the visionos-developer prompts and /oss:status promise only what their steps deliver (T61)
#
# Usage: ./prompt-promises.test.sh
#
# @behavior A customer who runs /oss:status sees only the account and usage fields the API returns, and a customer who
#           runs the visionos-developer agent or skill is not told that Apple documentation snippets (RAG) were
#           fetched for them.
# @business-rule A prompt's words are a promise. oss-decrypt sends no context parameter, so the visionos fetch
#           never returns RAG snippets (the old WebFetch got ciphertext). /auth/verify returns no usage fields, so
#           /oss:status may show usage only from the usage verb, which reads GET /api/v1/analytics/usage (T69). A
#           prompt that promises more misleads paying customers.
#
# Tests:
# 1. control: the RAG/snippet/context-parameter pattern flags each promise form, and passes plain text
# 2. control: the status and usage label maps and their field lists are present and consistent
# 3. both visionos prompt files make no RAG, snippet, ?context= or Apple-documentation promise
# 4. commands/status.md shows only labels that /auth/verify or (when it runs the usage verb) usage fields back
# 5. commands/status.md prose promises no workflow data, and no usage data unless it runs the usage verb
# 6. the usage verb reads GET /api/v1/analytics/usage and only that route's fields (T69)

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not matter here; this test reads no config.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

VISIONOS_FILES="agents/visionos-developer.md skills/visionos-developer.md"
STATUS_FILE="commands/status.md"

# Fields /auth/verify returns. Source: AgenticDevWorkflow packages/api/src/routes/auth.ts:470-479 (the
# res.status(200).json body of GET /verify, line 440), as on origin/main 8041b35 (route last changed in 82a5e49).
VERIFY_FIELDS="valid userId email plan subscriptionStatus trialEndsAt planExpiresAt maxCustomCommands"

# The labels /oss:status may print, each backed by a verify field (oss-value.sh _ov_cmd_status, line 201).
STATUS_LABELS="Account=email Plan=plan Status=subscriptionStatus Trial_ends=trialEndsAt"

# Fields GET /api/v1/analytics/usage returns (T69). Source: AgenticDevWorkflow packages/api/src/routes/analytics.ts:211-216
# (the res.status(200).json body of router.get('/usage'), line 173; mounted at /api/v1/analytics, index.ts:140).
USAGE_FIELDS="totalCommands commandsByType currentPeriod periodStart"
# The labels the usage section may print, each backed by a usage field (oss-value.sh _ov_cmd_usage). Allowed only
# when status.md runs the usage verb. The per-type lines are indented (commandsByType keys), so they are not labels.
USAGE_LABELS="Total_commands=totalCommands"
USAGE_CALL='~/.oss/hooks/oss-value.sh usage'
# jq names in _ov_cmd_usage that are not API fields (to_entries' own keys).
JQ_LOCAL_FIELDS="key value"
# Labels that are a fixed link in the template, not an API field.
STATIC_LABELS="Dashboard"

# Promise patterns that must not appear in a visionos prompt.
VISIONOS_BANNED='\?context=|context=|\brag\b|snippet|apple documentation|apple docs|6,500'

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

# visionos_promise <line>: true when the line promises RAG, snippets or a context parameter.
visionos_promise() {
    local line
    line=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
    printf '%s\n' "$line" | grep -qE "$VISIONOS_BANNED"
}

# visionos_offenders: "<file>:<line>: <text>" for each visionos promise
visionos_offenders() {
    local f hit num text
    for f in $VISIONOS_FILES; do
        grep -niE "$VISIONOS_BANNED" "$PLUGIN_ROOT/$f" | while IFS= read -r hit; do
            num="${hit%%:*}"
            text="${hit#*:}"
            echo "$f:$num: $text"
        done
    done
}

# runs_usage: status.md runs the usage verb, exactly as allowlisted, in a bash block
runs_usage() {
    awk '/^```bash/{on=1; next} /^```/{on=0} on' "$PLUGIN_ROOT/$STATUS_FILE" | grep -qxF "$USAGE_CALL"
}

# in_list <word> <list>: <word> is one of the words in <list>
in_list() {
    local w
    for w in $2; do [[ "$w" == "$1" ]] && return 0; done
    return 1
}

# status_label_offenders: "<line>: <label>" for each label in the status display block that is not backed
# by a verify field, or by a usage field when status.md runs the usage verb (a label outside the label maps and
# STATIC_LABELS, or a mapped field the API does not return)
status_label_offenders() {
    local block label key field ok usage=""
    runs_usage && usage=1
    block=$(awk '/^## Step 2/{on=1; next} /^## /{on=0} on' "$PLUGIN_ROOT/$STATUS_FILE")
    printf '%s\n' "$block" | grep -E '^[A-Za-z][A-Za-z ]*:' | while IFS= read -r line; do
        label="${line%%:*}"
        label=$(printf '%s' "$label" | sed 's/[[:space:]]*$//')
        key=$(printf '%s' "$label" | tr ' ' '_')
        ok=""
        for field in $STATIC_LABELS; do
            [[ "$label" == "$field" ]] && ok=1
        done
        for pair in $STATUS_LABELS; do
            if [[ "${pair%%=*}" == "$key" ]]; then
                field="${pair#*=}"
                for f in $VERIFY_FIELDS; do
                    [[ "$f" == "$field" ]] && ok=1
                done
            fi
        done
        for pair in $USAGE_LABELS; do
            [[ -n "$usage" && "${pair%%=*}" == "$key" ]] && in_list "${pair#*=}" "$USAGE_FIELDS" && ok=1
        done
        [[ -n "$ok" ]] || echo "$label"
    done
}

# status_prose_offenders: lines of status.md that promise workflow data, or usage data when status.md does not run
# the usage verb. The Help template's **Usage:** and **Workflow Position:** headings and the "## Example Usage"
# heading are not claims.
status_prose_offenders() {
    local pat='usage|workflow'
    runs_usage && pat='workflow'
    grep -niE "$pat" "$PLUGIN_ROOT/$STATUS_FILE" \
        | grep -vE '\*\*Usage:\*\*|\*\*Workflow Position:\*\*|^[0-9]+:## Example Usage$'
}

# usage_verb_offenders: what is wrong with oss-value.sh's _ov_cmd_usage: missing, not reading the usage route,
# or naming a field (".name" in its jq) that the route does not return
usage_verb_offenders() {
    local body f
    body=$(awk '/^_ov_cmd_usage\(\) *\{/{on=1} on{print} on&&/^\}/{exit}' "$PLUGIN_ROOT/hooks/oss-value.sh")
    [[ -n "$body" ]] || { echo "no _ov_cmd_usage in hooks/oss-value.sh"; return; }
    printf '%s\n' "$body" | grep -qF ' /api/v1/analytics/usage ' || echo "does not GET /api/v1/analytics/usage"
    for f in $(printf '%s\n' "$body" | grep -oE '\.[A-Za-z_][A-Za-z0-9_]*' | sed 's/^\.//' | sort -u); do
        in_list "$f" "$USAGE_FIELDS $JQ_LOCAL_FIELDS" || echo "reads .$f, not a usage field"
    done
    for f in totalCommands commandsByType; do
        printf '%s\n' "$body" | grep -qF ".$f" || echo "never reads .$f"
    done
}

test_control_flags_promises() {
    local test_name="control: the pattern flags each RAG, snippet and context promise and passes plain text"
    ((TESTS_RUN++))
    local missed="" flagged="" l
    local bad=(
        'Expert spatial computing developer powered by live Apple documentation via RAG.'
        'context=hand+tracking+ARKit'
        'How do I track hands? → context=hand+tracking+ARKit'
        'Relevant Apple documentation snippets'
        'The RAG-enhanced visionos-developer agent provides:'
        'Current API knowledge from 6,500+ Apple docs'
    )
    local good=(
        'Expert spatial computing developer specializing in RealityKit and ARKit.'
        'Identify the user'"'"'s specific VisionOS question or task.'
        '~/.oss/bin/oss-decrypt --type agents --name visionos-developer'
    )
    for l in "${bad[@]}"; do
        visionos_promise "$l" || missed="$missed [$l]"
    done
    for l in "${good[@]}"; do
        visionos_promise "$l" && flagged="$flagged [$l]"
    done
    if [[ -z "$missed" && -z "$flagged" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "every promise flagged, no plain text flagged" "not flagged:${missed:- none} | wrongly flagged:${flagged:- none}"
    fi
}

test_control_status_map_consistent() {
    local test_name="control: every status label maps to a field that /auth/verify returns, every usage label to a usage field"
    ((TESTS_RUN++))
    local bad="" pair field f found
    for pair in $USAGE_LABELS; do
        in_list "${pair#*=}" "$USAGE_FIELDS" || bad="$bad [$pair]"
    done
    [[ -n "$USAGE_FIELDS" && -n "$USAGE_LABELS" ]] || bad="$bad [empty usage field or label list]"
    for pair in $STATUS_LABELS; do
        field="${pair#*=}"
        found=""
        for f in $VERIFY_FIELDS; do
            [[ "$f" == "$field" ]] && found=1
        done
        [[ -n "$found" ]] || bad="$bad [$pair]"
    done
    if [[ -z "$bad" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "each mapped field in the verify list" "unmapped:$bad"
    fi
}

test_visionos_no_rag_promise() {
    local test_name="both visionos prompts promise no RAG, snippets or context parameter"
    ((TESTS_RUN++))
    local out
    out=$(visionos_offenders)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no RAG, snippet, ?context= or Apple-documentation promise" "$(echo "$out" | wc -l | tr -d ' ') line(s):"
        echo "$out" | sed 's/^/    /'
    fi
}

test_status_labels_backed() {
    local test_name="status.md shows only labels that /auth/verify fields (or, when it runs the usage verb, usage fields) back"
    ((TESTS_RUN++))
    local out
    out=$(status_label_offenders)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "Account, Plan, Status, Trial ends (and the static Dashboard link)" "unbacked label(s): $(echo "$out" | tr '\n' ',' | sed 's/,$//')"
    fi
}

test_status_prose_no_usage() {
    local test_name="status.md prose promises no workflow data, and no usage data unless it runs the usage verb"
    ((TESTS_RUN++))
    local out
    out=$(status_prose_offenders)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no usage or workflow claim" "$(echo "$out" | wc -l | tr -d ' ') line(s):"
        echo "$out" | sed 's/^/    /'
    fi
}

test_usage_verb_backed() {
    local test_name="the usage verb reads GET /api/v1/analytics/usage and only that route's fields (T69)"
    ((TESTS_RUN++))
    local out
    out=$(usage_verb_offenders)
    if [[ -z "$out" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "_ov_cmd_usage GETs /api/v1/analytics/usage and reads only: $USAGE_FIELDS" "$(echo "$out" | tr '\n' ';')"
    fi
}

echo "=== Prompt Promises Match Their Steps (T61, T69) ==="
echo ""

test_control_flags_promises
test_control_status_map_consistent
test_visionos_no_rag_promise
test_status_labels_backed
test_status_prose_no_usage
test_usage_verb_backed

echo ""
echo "=== Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed ==="

[[ $TESTS_FAILED -eq 0 ]]
