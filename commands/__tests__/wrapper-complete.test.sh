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
# @business-rule A failed run stays failed: the completion step tells the
#           model to send `complete` on success only.
# @business-rule The completion step is the next step after "Execute the
#           Fetched Prompt", so the model reaches it before reference
#           sections, and its line is inside a ```bash fence.
# @business-rule Steps are numbered 1, 2, 3, ... with no gaps or repeats.
# @business-rule Every "Execute the Fetched Prompt" step says what to do.
#
# Matching is literal (awk index / grep -F): ugrep mishandles `$` mid-pattern.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMANDS_DIR="$SCRIPT_DIR/.."
NOTIFY='~/.oss/hooks/oss-notify.sh'

# Wrappers that gained a fixed completion step (FOLLOWUPS 76).
FIXED_WORKFLOWS="a11y audit bench chaos cost deploy docs experiment feature-flag incident license load monitor postmortem privacy release retro rollback smoke stage tech-debt test trace"

# The first line of every fixed completion section (F1).
GUARD='On success only. If the command failed (the prompt sent `failed`), do not send `complete`.'

# Print "<lineno> <in_bash_fence 0|1> <line>" for every line, so callers can
# tell headings and fenced lines apart without re-parsing fences.
annotate() {
    awk '
        /^[ \t]*```/ {
            if (fence) { fence = 0; bash = 0 } else { fence = 1; bash = ($0 ~ /^[ \t]*```bash[ \t]*$/) }
            print NR, 0, $0; next
        }
        { print NR, (fence && bash) ? 1 : 0, $0 }' "$1"
}

# Print "<lineno> <heading>" for each `## ` heading outside code fences.
h2_headings() {
    awk '
        /^[ \t]*```/ { fence = !fence; next }
        !fence && /^## / { print NR, $0 }' "$1"
}

# Print the line number of the fixed completion line for <w>.
completion_line_no() {
    awk -v e="$NOTIFY --workflow $2 complete '{}'" '$0 == e { print NR; exit }' "$1"
}

# Print the line number of the `## ` heading of the section that holds line <n>.
heading_line_of() {
    h2_headings "$1" | awk -v n="$2" '$1 < n { h = $1 } END { print h + 0 }'
}

# Print the line number of the first `## ` heading naming the Execute step.
execute_heading_line() {
    h2_headings "$1" | awk 'index($0, "Execute the Fetched Prompt") { print $1; exit }'
}

# Print the lines of the `## ` section whose heading is at line <n>.
section_at() {
    local next
    next=$(h2_headings "$1" | awk -v n="$2" '$1 > n { print $1; exit }')
    awk -v s="$2" -v e="${next:-999999}" 'NR >= s && NR < e' "$1"
}
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

# The notify script, in either spelling, anywhere on the line (any indent).
NOTIFY_FORMS=('~/.oss/hooks/oss-notify.sh' '$HOME/.oss/hooks/oss-notify.sh')

# Fewest wrappers that send a start line today; detection that finds fewer
# is broken, not passing.
MIN_START_WRAPPERS=55

# Print "<workflow> <event>" for every notify line in the file.
notify_events() {
    awk -v a="${NOTIFY_FORMS[0]} --workflow " -v b="${NOTIFY_FORMS[1]} --workflow " '
        {
            i = index($0, a); n = a
            if (i == 0) { i = index($0, b); n = b }
            if (i == 0) next
            split(substr($0, i + length(n)), parts, " ")
            print parts[1], parts[2]
        }' "$1"
}

# Print each workflow name that has a `--workflow <w> start` notify line.
start_workflows() {
    notify_events "$1" | awk '$2 == "start" { print $1 }' | sort -u
}

# Exit 0 if the file has a `--workflow <w> complete|merged` notify line.
has_completion() {
    notify_events "$1" | awk -v w="$2" '
        $1 == w && ($2 == "complete" || $2 == "merged") { found = 1 }
        END { exit found ? 0 : 1 }'
}

# =============================================================================
# TEST 1: every wrapper that starts a workflow also completes it
# =============================================================================
test_start_has_completion() {
    local missing=()
    local f w starters=0
    for f in "$COMMANDS_DIR"/*.md; do
        [[ -n "$(start_workflows "$f")" ]] && ((starters++))
        for w in $(start_workflows "$f"); do
            if ! has_completion "$f" "$w"; then
                missing+=("$(basename "$f" .md):$w")
            fi
        done
    done

    ((TESTS_RUN++))
    if [[ $starters -ge $MIN_START_WRAPPERS ]]; then
        pass "at least $MIN_START_WRAPPERS wrappers send a start line"
    else
        fail "at least $MIN_START_WRAPPERS wrappers send a start line" \
            ">= $MIN_START_WRAPPERS" "$starters"
    fi

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

# =============================================================================
# TEST 3 (F1): each completion section opens with the success-only guard
# =============================================================================
test_completion_guard() {
    local w f n h first
    for w in $FIXED_WORKFLOWS; do
        f="$COMMANDS_DIR/$w.md"
        ((TESTS_RUN++))
        n=$(completion_line_no "$f" "$w")
        h=$(heading_line_of "$f" "${n:-0}")
        first=$(section_at "$f" "$h" | awk 'NR > 1 && NF { print; exit }')
        if [[ "$first" == "$GUARD" ]]; then
            pass "$w.md completion step sends complete on success only"
        else
            fail "$w.md completion step sends complete on success only" \
                "$GUARD" "${first:-<nothing>}"
        fi
    done
}

# =============================================================================
# TEST 4 (F2): the completion step comes right after the Execute step, and its
# line is inside a ```bash fence
# =============================================================================
test_completion_placement() {
    local w f n h x next fenced
    for w in $FIXED_WORKFLOWS; do
        f="$COMMANDS_DIR/$w.md"
        ((TESTS_RUN++))
        n=$(completion_line_no "$f" "$w")
        h=$(heading_line_of "$f" "${n:-0}")
        x=$(execute_heading_line "$f")
        next=$(h2_headings "$f" | awk -v x="${x:-0}" '$1 > x { print $1; exit }')
        fenced=$(annotate "$f" | awk -v n="${n:-0}" '$1 == n { print $2 }')
        if [[ -z "$x" || "$next" != "$h" ]]; then
            fail "$w.md completion step follows the Execute step" \
                "next heading after line ${x:-?} is the completion heading (line $h)" \
                "next heading at line ${next:-none}"
        elif [[ "$fenced" != 1 ]]; then
            fail "$w.md completion step follows the Execute step" \
                "completion line inside a \`\`\`bash fence" "line $n not fenced"
        else
            pass "$w.md completion step follows the Execute step"
        fi
    done
}

# =============================================================================
# TEST 5 (F2): step headings are numbered 1, 2, 3, ... with no repeats
# =============================================================================
test_step_numbering() {
    local w f got
    for w in $FIXED_WORKFLOWS; do
        f="$COMMANDS_DIR/$w.md"
        ((TESTS_RUN++))
        got=$(h2_headings "$f" | awk '
            $2 == "##" && $3 == "Step" {
                k++; num = $4; sub(/:.*/, "", num)
                if (num + 0 != k || num !~ /^[0-9]+$/) { print "Step " num " where Step " k " expected"; exit }
            }')
        if [[ -z "$got" ]]; then
            pass "$w.md steps are numbered in sequence"
        else
            fail "$w.md steps are numbered in sequence" "1, 2, 3, ..." "$got"
        fi
    done
}

# =============================================================================
# TEST 6 (F9): every "Execute the Fetched Prompt" step has a body
# =============================================================================
test_execute_body() {
    local empty=() f
    for f in "$COMMANDS_DIR"/*.md; do
        awk '
            /^[ \t]*```/ && on { found = 1 }
            /^[ \t]*```/ { fence = !fence }
            !fence && /^#+ / {
                if (on) exit
                if (/^## / && index($0, "Execute the Fetched Prompt")) { on = 1; seen = 1; next }
            }
            on && NF { found = 1 }
            END { exit (seen && !found) ? 1 : 0 }' "$f" || empty+=("$(basename "$f" .md)")
    done

    ((TESTS_RUN++))
    if [[ ${#empty[@]} -eq 0 ]]; then
        pass "every Execute the Fetched Prompt step has a body"
    else
        fail "every Execute the Fetched Prompt step has a body" \
            "no empty Execute step" "${#empty[@]} empty: ${empty[*]}"
    fi
}

echo "=========================================="
echo "Wrapper completion status tests"
echo "=========================================="

test_start_has_completion
test_fixed_completion_lines
test_completion_guard
test_completion_placement
test_step_numbering
test_execute_body

echo ""
echo "=========================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
echo "=========================================="

[[ $TESTS_FAILED -eq 0 ]]
