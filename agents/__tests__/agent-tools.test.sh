#!/bin/bash
# Tests for agent tool lists (R-266 least-privilege-tools)
#
# Usage: ./agent-tools.test.sh
#
# Env overrides (used by the parser self-check):
#   AGENTS_DIR_OVERRIDE  - directory scanned for agent files (default: agents/)
#   TOOL_GATES_OVERRIDE  - path to tool-gates.json (default: config/tool-gates.json)
#
# Tests:
# 0. Self-check: the parser reports typos, accepts mcp__ names, catches gate Edit
# 1. Every agents/**/*.md has frontmatter name: (AC-006.2)
# 2. Every agent file has frontmatter tools: (AC-002.1)
# 3. No gate agent lists Edit, MultiEdit or NotebookEdit, or "*" (AC-003.1)
# 4. Every tools: entry is a known tool name or mcp__ name (AC-002.2)
# 5. Agents without Edit == gateAgents in config/tool-gates.json (AC-004.6)
# 6. Gate agent descriptions say they review and that fixes go to a builder (AC-003.4)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AGENTS_DIR="${AGENTS_DIR_OVERRIDE:-$REPO_ROOT/agents}"
TOOL_GATES="${TOOL_GATES_OVERRIDE:-$REPO_ROOT/config/tool-gates.json}"

GATE_AGENTS=(code-reviewer security-auditor penetration-tester performance-auditor)
GATE_FORBIDDEN=(Edit MultiEdit NotebookEdit)

# The one list of Claude Code tool names an agent may declare.
# MultiEdit is deliberately absent: it is no longer a Claude Code tool.
KNOWN_TOOLS=(Agent Task Bash Read Write Edit NotebookEdit Grep Glob WebFetch WebSearch
    TodoWrite Skill ToolSearch LSP Monitor TaskStop SendMessage ListAgents)
MCP_PATTERN='^mcp__[A-Za-z0-9_-]+__([A-Za-z0-9_-]+|\*)$'

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
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

# -----------------------------------------------------------------------------
# Parser helpers (also exercised by the self-check against fixtures)
# -----------------------------------------------------------------------------

# List agent files: every *.md under the agents dir, excluding __tests__/
list_agent_files() {
    local dir="$1"
    find "$dir" -type f -name '*.md' -not -path '*/__tests__/*' | LC_ALL=C sort
}

# Print the first frontmatter value for <key>, or nothing.
# Frontmatter is the block between a leading '---' on line 1 and the next '---'.
get_frontmatter_value() {
    local file="$1"
    local key="$2"
    awk -v key="$key" '
        NR == 1 { if ($0 ~ /^---[[:space:]]*$/) { infm = 1; next } else { exit } }
        infm && /^---[[:space:]]*$/ { exit }
        infm && index($0, key ":") == 1 {
            sub("^" key ":[[:space:]]*", "")
            sub(/\r$/, "")
            print
            exit
        }
    ' "$file"
}

has_frontmatter_key() {
    local file="$1"
    local key="$2"
    awk -v key="$key" '
        NR == 1 { if ($0 ~ /^---[[:space:]]*$/) { infm = 1; next } else { exit 1 } }
        infm && /^---[[:space:]]*$/ { exit 1 }
        infm && index($0, key ":") == 1 { found = 1; exit 0 }
        END { exit found ? 0 : 1 }
    ' "$file"
}

# Agent name: frontmatter name:, falling back to the file's basename
agent_name() {
    local file="$1"
    local name
    name=$(get_frontmatter_value "$file" "name")
    if [[ -z "$name" ]]; then
        name=$(basename "$file" .md)
    fi
    echo "$name"
}

# Print one tools: entry per line, trimmed of spaces and surrounding quotes
get_tool_entries() {
    local file="$1"
    local raw entry
    raw=$(get_frontmatter_value "$file" "tools")
    [[ -z "$raw" ]] && return 0
    local IFS=','
    for entry in $raw; do
        entry="${entry#"${entry%%[![:space:]]*}"}"
        entry="${entry%"${entry##*[![:space:]]}"}"
        entry="${entry#[\"\']}"
        entry="${entry%[\"\']}"
        [[ -n "$entry" ]] && printf '%s\n' "$entry"
    done
}

# True if the tools: value is the "all tools" star (quoted or bare)
tools_is_star() {
    local file="$1"
    local entries
    entries=$(get_tool_entries "$file")
    [[ "$entries" == "*" ]]
}

is_known_tool() {
    local entry="$1"
    local known
    for known in "${KNOWN_TOOLS[@]}"; do
        [[ "$entry" == "$known" ]] && return 0
    done
    [[ "$entry" =~ $MCP_PATTERN ]]
}

is_gate_agent() {
    local name="$1"
    local gate
    for gate in "${GATE_AGENTS[@]}"; do
        [[ "$name" == "$gate" ]] && return 0
    done
    return 1
}

# Print "file: entry" for each unknown tools: entry under <dir>
find_unknown_entries() {
    local dir="$1"
    local file entries entry
    while IFS= read -r file; do
        entries=$(get_tool_entries "$file")
        [[ -z "$entries" ]] && continue
        if [[ "$entries" == "*" ]]; then
            continue
        fi
        while IFS= read -r entry; do
            if [[ "$entry" == "*" ]]; then
                # "*" is only valid as the whole value
                echo "${file#"$dir"/}: '*' mixed with other entries"
            elif ! is_known_tool "$entry"; then
                echo "${file#"$dir"/}: $entry"
            fi
        done <<< "$entries"
    done < <(list_agent_files "$dir")
}

# Print "name: problem" for each gate agent with an edit tool or "*" under <dir>
find_gate_edit_violations() {
    local dir="$1"
    local file name entries entry forbidden
    while IFS= read -r file; do
        name=$(agent_name "$file")
        is_gate_agent "$name" || continue
        if tools_is_star "$file"; then
            echo "$name: tools is \"*\" (all tools)"
            continue
        fi
        entries=$(get_tool_entries "$file")
        [[ -z "$entries" ]] && continue
        while IFS= read -r entry; do
            for forbidden in "${GATE_FORBIDDEN[@]}"; do
                [[ "$entry" == "$forbidden" ]] && echo "$name: $entry"
            done
        done <<< "$entries"
    done < <(list_agent_files "$dir")
}

# Print the sorted names of agents whose tools: lacks Edit ("*" counts as Edit)
agents_without_edit() {
    local dir="$1"
    local file entries
    while IFS= read -r file; do
        tools_is_star "$file" && continue
        entries=$(get_tool_entries "$file")
        if ! grep -qx 'Edit' <<< "$entries"; then
            agent_name "$file"
        fi
    done < <(list_agent_files "$dir") | LC_ALL=C sort
}

# =============================================================================
# TEST 0: Parser self-check against fixture agent files
#
# @behavior The checks in this file catch typos, accept MCP names and catch gate edit tools
# @acceptance-criteria Edti is reported unknown; Read, mcp__figma__* passes;
#                      a gate agent with Read, Edit is reported
# =============================================================================
test_parser_self_check() {
    ((TESTS_RUN++))
    local fixtures
    fixtures=$(mktemp -d "${TMPDIR:-/tmp}/agent-tools-selfcheck.XXXXXX")

    printf -- '---\nname: typo-agent\ntools: Edti\n---\nbody\n' > "$fixtures/typo-agent.md"
    printf -- '---\nname: mcp-agent\ntools: Read, mcp__figma__*\n---\nbody\n' > "$fixtures/mcp-agent.md"
    printf -- '---\nname: code-reviewer\ntools: Read, Edit\n---\nbody\n' > "$fixtures/code-reviewer.md"

    local unknown gate problems=()
    unknown=$(find_unknown_entries "$fixtures")
    gate=$(find_gate_edit_violations "$fixtures")

    grep -qx 'typo-agent.md: Edti' <<< "$unknown" \
        || problems+=("'tools: Edti' not reported unknown")
    grep -q '^mcp-agent.md:' <<< "$unknown" \
        && problems+=("'tools: Read, mcp__figma__*' wrongly reported unknown")
    grep -qx 'code-reviewer: Edit' <<< "$gate" \
        || problems+=("gate fixture 'tools: Read, Edit' not reported")

    rm -rf "$fixtures"

    if [[ ${#problems[@]} -eq 0 ]]; then
        pass "parser self-check: typo caught, mcp__ name accepted, gate Edit caught"
    else
        fail "parser self-check" "all three fixture cases behave" "$(printf '%s; ' "${problems[@]}")"
    fi
}

# =============================================================================
# TEST 1: Every agent file has frontmatter name:
#
# @behavior Claude Code loads every .md under agents/ as an agent, so each must be a real agent
# @acceptance-criteria AC-006.2: every agents/**/*.md (except __tests__/) has name:
# =============================================================================
test_every_agent_has_name() {
    local test_name="every agents/**/*.md has frontmatter name: (AC-006.2)"
    ((TESTS_RUN++))
    local file missing=()
    while IFS= read -r file; do
        has_frontmatter_key "$file" "name" || missing+=("${file#"$AGENTS_DIR"/}")
    done < <(list_agent_files "$AGENTS_DIR")

    if [[ ${#missing[@]} -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "name: in every agent file" "${#missing[@]} without name: ${missing[*]}"
    fi
}

# =============================================================================
# TEST 2: Every agent file has frontmatter tools:
#
# @behavior Every agent states which tools it may use (least privilege)
# @acceptance-criteria AC-002.1: every agent file has a tools: line
# =============================================================================
test_every_agent_has_tools() {
    local test_name="every agent file has frontmatter tools: (AC-002.1)"
    ((TESTS_RUN++))
    local file missing=()
    while IFS= read -r file; do
        has_frontmatter_key "$file" "tools" || missing+=("${file#"$AGENTS_DIR"/}")
    done < <(list_agent_files "$AGENTS_DIR")

    if [[ ${#missing[@]} -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "tools: in every agent file" "${#missing[@]} without tools: ${missing[*]}"
    fi
}

# =============================================================================
# TEST 3: No gate agent can edit files
#
# @behavior Review (gate) agents report problems; they never fix code themselves
# @acceptance-criteria AC-003.1: gate agents list no Edit, MultiEdit, NotebookEdit and no "*"
# =============================================================================
test_gate_agents_have_no_edit_tools() {
    local test_name="gate agents list no Edit/MultiEdit/NotebookEdit and no \"*\" (AC-003.1)"
    ((TESTS_RUN++))
    local violations gate missing=()
    for gate in "${GATE_AGENTS[@]}"; do
        [[ -f "$AGENTS_DIR/$gate.md" ]] || missing+=("$gate.md")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        fail "$test_name" "all gate agent files exist" "missing: ${missing[*]}"
        return
    fi

    violations=$(find_gate_edit_violations "$AGENTS_DIR")
    if [[ -z "$violations" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no edit tools on gate agents" "$(tr '\n' ';' <<< "$violations")"
    fi
}

# =============================================================================
# TEST 4: Every tools: entry is a known tool name
#
# @behavior A misspelt tool name silently grants nothing, so typos must fail here
# @acceptance-criteria AC-002.2: each entry is in KNOWN_TOOLS, is "*" alone, or an mcp__ name
# =============================================================================
test_tool_entries_are_known() {
    local test_name="every tools: entry is a known tool or mcp__ name (AC-002.2)"
    ((TESTS_RUN++))
    local unknown
    unknown=$(find_unknown_entries "$AGENTS_DIR")
    if [[ -z "$unknown" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "only known tool names" "$(tr '\n' ';' <<< "$unknown")"
    fi
}

# =============================================================================
# TEST 5: Agents without Edit are exactly the gate set in config/tool-gates.json
#
# @behavior The gate set lives in one place and matches the agent files
# @acceptance-criteria AC-004.6: {agents without Edit} == gateAgents
# =============================================================================
test_no_edit_set_matches_gate_config() {
    local test_name="agents without Edit == gateAgents in tool-gates.json (AC-004.6)"
    ((TESTS_RUN++))
    if [[ ! -f "$TOOL_GATES" ]]; then
        fail "$test_name" "tool-gates.json exists" "not found: $TOOL_GATES"
        return
    fi
    local configured
    if ! configured=$(jq -er '.gateAgents | if type == "array" then .[] else error("not an array") end' \
        "$TOOL_GATES" 2>/dev/null | LC_ALL=C sort); then
        fail "$test_name" "gateAgents array in $TOOL_GATES" "gateAgents missing or not an array"
        return
    fi

    local actual
    actual=$(agents_without_edit "$AGENTS_DIR")
    if [[ "$actual" == "$configured" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "$(tr '\n' ' ' <<< "$configured")" "$(tr '\n' ' ' <<< "$actual")"
    fi
}

# =============================================================================
# TEST 6: Gate agent descriptions say they review and hand fixes to a builder
#
# @behavior The main agent routes fixes to a builder, not back to the reviewer
# @acceptance-criteria AC-003.4: description contains "review" and "builder" (any case)
# =============================================================================
test_gate_descriptions_hand_off_fixes() {
    local test_name="gate descriptions say they review and fixes go to a builder (AC-003.4)"
    ((TESTS_RUN++))
    local gate file desc lower problems=()
    for gate in "${GATE_AGENTS[@]}"; do
        file="$AGENTS_DIR/$gate.md"
        if [[ ! -f "$file" ]]; then
            problems+=("$gate: file missing")
            continue
        fi
        desc=$(get_frontmatter_value "$file" "description")
        lower=$(tr '[:upper:]' '[:lower:]' <<< "$desc")
        [[ "$lower" == *review* ]] || problems+=("$gate: no 'review'")
        [[ "$lower" == *builder* ]] || problems+=("$gate: no 'builder'")
    done

    if [[ ${#problems[@]} -eq 0 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "'review' and 'builder' in each gate description" "$(printf '%s; ' "${problems[@]}")"
    fi
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running agent tools tests..."
echo "======================================="

test_parser_self_check
test_every_agent_has_name
test_every_agent_has_tools
test_gate_agents_have_no_edit_tools
test_tool_entries_are_known
test_no_edit_set_matches_gate_config
test_gate_descriptions_hand_off_fixes

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
