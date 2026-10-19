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
# @business-rule Ship round 1, R1-1: NO shell line in any wrapper has a {PLACEHOLDER} for the model
#           to fill (lifecycle notify lines send a fixed '{}'; oss-log.sh takes no free text).
#           Shell lines = every line inside a ```bash/sh fence, plus any other line that runs an
#           oss-log/oss-notify/oss-value hook. ${VAR} shell expansions are not placeholders.
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

# 4. no shell line in any wrapper carries a {PLACEHOLDER} (R1-1)
# Print "<file>:<lineno>:<line>" for every shell line with a {UPPER_CASE} placeholder.
placeholder_lines() {
    awk '
        FNR == 1 { fence = 0; sh = 0 }
        /^[[:space:]]*```/ { if (!fence) { fence = 1; sh = ($0 ~ /```(bash|sh|shell|zsh)[[:space:]]*$/) } else { fence = 0; sh = 0 }; next }
        {
            shell = (fence && sh) || (!fence && $0 ~ /oss-(log|notify|value)\.sh/)
            if (shell && $0 ~ /(^|[^$])\{[A-Z_][A-Z0-9_]*\}/) print FILENAME ":" FNR ":" $0
        }' "$@"
}
# detector control: it flags a placeholder in a bash fence and an inline hook line, not ${HOME}
ctl=$(mktemp -d); printf '```bash\necho "${HOME}"\nx "{TEST_FILE}"\n```\nrun ~/.oss/hooks/oss-log.sh test red FAIL "{MSG}"\n```json\n{"a": "{NOT_SHELL}"}\n```\n' > "$ctl/c.md"
n=$(placeholder_lines "$ctl/c.md" | wc -l | tr -d ' '); rm -rf "$ctl"
[[ "$n" == 2 ]] && pass "the placeholder detector flags fenced and inline shell lines only (2)" || fail "the placeholder detector flags fenced and inline shell lines only" "flagged $n, want 2"
bad=$(placeholder_lines "$COMMANDS_DIR"/*.md)
[[ -z "$bad" ]] && pass "no shell line in any wrapper has a {PLACEHOLDER}" \
    || fail "no shell line in any wrapper has a {PLACEHOLDER}" "$(printf '%s\n' "$bad" | wc -l | tr -d ' ') lines in $(printf '%s\n' "$bad" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') files: $(printf '%s\n' "$bad" | sed "s|$COMMANDS_DIR/||" | cut -d: -f1,2 | tr '\n' ' ')"

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
