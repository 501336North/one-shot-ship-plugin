#!/bin/bash
# Tests that every command wrapper which starts a workflow also completes it
#
# Usage: ./wrapper-complete.test.sh
#
# @behavior When a user runs a /oss:<cmd> wrapper, the status line shows the
#           workflow as done at the end, not "running" forever.
# @business-rule A wrapper that sends `--workflow <w> start` must also send
#           `--workflow <w> complete` (or `merged`) for the same <w>.
# @business-rule A completion line added for a wrapper with no result data is
#           the fixed `complete '{}'` form: no `{...}` placeholder, so no
#           model-filled value ever enters the shell.
#
# Matching is literal (awk index / grep -F): ugrep mishandles `$` mid-pattern.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_DIR="$SCRIPT_DIR/.."
NOTIFY='~/.oss/hooks/oss-notify.sh'

# Wrappers that gained a fixed completion step (FOLLOWUPS 76).
FIXED_WORKFLOWS="a11y audit bench chaos cost deploy docs experiment feature-flag incident license load monitor postmortem privacy release retro rollback smoke stage tech-debt test trace"

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

# Print each workflow name that has a `--workflow <w> start` notify line.
start_workflows() {
    awk -v n="$NOTIFY --workflow " '
        index($0, n) == 1 {
            rest = substr($0, length(n) + 1)
            split(rest, parts, " ")
            if (parts[2] == "start") print parts[1]
        }' "$1" | sort -u
}

# Exit 0 if the file has a `--workflow <w> complete|merged` notify line.
has_completion() {
    awk -v c="$NOTIFY --workflow $2 complete " -v m="$NOTIFY --workflow $2 merged " '
        index($0, c) == 1 || index($0, m) == 1 { found = 1 }
        END { exit found ? 0 : 1 }' "$1"
}

# =============================================================================
# TEST 1: every wrapper that starts a workflow also completes it
# =============================================================================
test_start_has_completion() {
    local missing=()
    local f w
    for f in "$COMMANDS_DIR"/*.md; do
        for w in $(start_workflows "$f"); do
            if ! has_completion "$f" "$w"; then
                missing+=("$(basename "$f" .md):$w")
            fi
        done
    done

    ((TESTS_RUN++))
    if [[ ${#missing[@]} -eq 0 ]]; then
        pass "every wrapper that sends start also sends complete or merged"
    else
        fail "every wrapper that sends start also sends complete or merged" \
            "no wrapper missing a completion" \
            "${#missing[@]} missing: ${missing[*]}"
    fi
}

# =============================================================================
# TEST 2: each added completion line is exactly the fixed '{}' form
# =============================================================================
test_fixed_completion_lines() {
    local w f expected bad_count
    for w in $FIXED_WORKFLOWS; do
        f="$COMMANDS_DIR/$w.md"
        expected="$NOTIFY --workflow $w complete '{}'"
        ((TESTS_RUN++))
        if ! grep -qxF -- "$expected" "$f"; then
            fail "$w.md has the fixed completion line" "$expected" "line not found"
            continue
        fi
        # No other completion line for this workflow may carry a placeholder.
        bad_count=$(awk -v c="$NOTIFY --workflow $w complete " -v e="$expected" '
            index($0, c) == 1 && $0 != e { n++ }
            END { print n + 0 }' "$f")
        if [[ "$bad_count" -ne 0 ]]; then
            fail "$w.md has the fixed completion line" "only '{}' completion lines" \
                "$bad_count completion line(s) with a placeholder"
        else
            pass "$w.md has the fixed completion line"
        fi
    done
}

echo "=========================================="
echo "Wrapper completion status tests"
echo "=========================================="

test_start_has_completion
test_fixed_completion_lines

echo ""
echo "=========================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
echo "=========================================="

[[ $TESTS_FAILED -eq 0 ]]
