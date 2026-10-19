#!/bin/bash
# Tests that no command wrapper asks the model to put its own text into a `failed` notify line
#
# Usage: ./no-model-text-in-failed.test.sh
#
# @behavior When a /oss:<cmd> run fails, its failure is reported once, and the model never
#           pastes a reason it wrote into a shell command (a ' or $( in it would run as shell).
# @business-rule US-005 / FOLLOWUPS 77 (plugin-value-flags): no wrapper `failed` notify line has
#           a {PLACEHOLDER} for the model to fill.
# @business-rule A wrapper whose served prompt already sends the failure notice has no failed
#           notify step of its own (the same failure was logged twice).
# @business-rule oss-custom has no served failure notice (team prompts), so it reports through
#           the fixed oss-value.sh lines: the model writes reason.txt with the Write tool.
#
# Matching is literal (awk index / grep -F): ugrep mishandles `$` mid-pattern.

set -uo pipefail

COMMANDS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Wrappers whose served prompt (commands/<w>.md, or agents/code-simplifier.md) sends
# `--workflow <w> failed` itself. Measured against the API prompts on 2026-10-20.
DUPLICATES="acceptance adr api-design auto build code-simplifier contract data-model debug green ideate integration iterate mock onboard quick red refactor requirements review ship ui-review ui-ux visual-qa visual-test xray"

DIR_LINE='test -x "$HOME/.oss/hooks/oss-value.sh" && "$HOME/.oss/hooks/oss-value.sh" dir'
CUSTOM_LINE='"$HOME/.oss/hooks/oss-value.sh" failed custom'

TESTS_RUN=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; TESTS_RUN=$((TESTS_RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; TESTS_RUN=$((TESTS_RUN + 1)); TESTS_FAILED=$((TESTS_FAILED + 1)); }

# Print "<file>:<lineno>:<line>" for every oss-notify.sh line (either spelling) whose event is failed.
failed_lines() {
    awk -v a='~/.oss/hooks/oss-notify.sh --workflow ' -v b='$HOME/.oss/hooks/oss-notify.sh" --workflow ' '
        {
            i = index($0, a); n = a
            if (i == 0) { i = index($0, b); n = b }
            if (i == 0) next
            split(substr($0, i + length(n)), p, " ")
            if (p[2] == "failed") print FILENAME ":" FNR ":" $0
        }' "$@"
}

all=$(failed_lines "$COMMANDS_DIR"/*.md)

# Detection floor: plan.md and context-report.md keep a fixed `failed '{}'` line, so a detector
# that finds none is broken, not passing.
n=$(printf '%s\n' "$all" | grep -c 'failed' )
[[ "$n" -ge 2 ]] && pass "the detector finds the fixed failed lines that remain ($n)" || fail "the detector finds the fixed failed lines that remain" "found $n"

# 1. no failed notify line carries a {PLACEHOLDER}
bad=$(printf '%s\n' "$all" | grep -E '\{[A-Za-z_][A-Za-z0-9_|]*\}')
[[ -z "$bad" ]] && pass "no wrapper failed notify line has a {PLACEHOLDER}" || fail "no wrapper failed notify line has a {PLACEHOLDER}" "$(printf '%s\n' "$bad" | sed "s|$COMMANDS_DIR/||" | tr '\n' '|')"

# 2. duplicates send no failed notify of their own
for w in $DUPLICATES; do
    f="$COMMANDS_DIR/$w.md"
    if [[ ! -f "$f" ]]; then fail "$w.md has no failed notify step" "file missing"
    elif [[ -n "$(failed_lines "$f")" ]]; then fail "$w.md has no failed notify step" "$(failed_lines "$f" | cut -d: -f2- | tr '\n' '|')"
    else pass "$w.md has no failed notify step (its served prompt sends it)"; fi
done

# 3. oss-custom reports through the two fixed helper lines and nothing else
f="$COMMANDS_DIR/oss-custom.md"
[[ "$(grep -cxF -- "$DIR_LINE" "$f")" == 1 && "$(grep -cxF -- "$CUSTOM_LINE" "$f")" == 1 ]] \
    && pass "oss-custom.md has exactly the two fixed oss-value.sh lines" \
    || fail "oss-custom.md has exactly the two fixed oss-value.sh lines" "dir=$(grep -cxF -- "$DIR_LINE" "$f") failed=$(grep -cxF -- "$CUSTOM_LINE" "$f")"
[[ -z "$(failed_lines "$f")" ]] && pass "oss-custom.md has no failed notify line" || fail "oss-custom.md has no failed notify line" "$(failed_lines "$f" | cut -d: -f2-)"
grep -qF 'Write tool' "$f" && grep -qF 'reason.txt' "$f" \
    && pass "oss-custom.md tells the model to write reason.txt with the Write tool" \
    || fail "oss-custom.md tells the model to write reason.txt with the Write tool" "instruction missing"

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
