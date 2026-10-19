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

# 4. no shell line in any wrapper carries a model-filled placeholder (R1-1, ship round 2 R2-2)
# A placeholder is {word} or <word> in any case (word: letters, digits, _ and -), after ${...}
# $name and curl's %{name} are stripped. Shell lines: every line in a fenced block (``` or ~~~,
# bare = shell) whose language is not a data/code one below; outside fences, every inline `span`
# that runs a hook or a command, and any line that runs an oss-log/oss-notify/oss-value hook.
# In a heredoc body <word> is markup (a plist), so only {word} counts there.
# Prints "<file>:<lineno>:<line>".
placeholder_lines() {
    awk '
        function ph(s) {
            gsub(/[$%][{][^}]*[}]/, "", s); gsub(/\$[A-Za-z_][A-Za-z0-9_]*/, "", s)
            return s ~ /[{][A-Za-z_][A-Za-z0-9_-]*[}]/ || (hd == "" && s ~ /<[A-Za-z_][A-Za-z0-9_-]*>/)
        }
        FNR == 1 { fence = ""; sh = 0; hd = "" }
        match($0, /^[[:space:]]*(```|~~~)/) {
            m = substr($0, RSTART + RLENGTH - 3, 3); rest = substr($0, RSTART + RLENGTH)
            sub(/^[`~]*[[:space:]]*/, "", rest)
            if (fence == "") {
                fence = m; split(tolower(rest), w, /[^a-z0-9_+-]/)
                sh = (w[1] !~ /^(json|yaml|yml|markdown|md|typescript|ts|javascript|js|text|txt|diff)$/)
                next
            }
            if (m == fence && rest ~ /^[[:space:]]*$/) { fence = ""; sh = 0; hd = ""; next }
        }
        fence != "" {
            t = $0; gsub(/[[:space:]]/, "", t); if (hd != "" && t == hd) { hd = ""; next }
            if (sh && ph($0)) print FILENAME ":" FNR ":" $0
            if (hd == "" && match($0, /<<-?[[:space:]]*["\047]?[A-Za-z_]+/)) { hd = substr($0, RSTART, RLENGTH); sub(/^<<-?[[:space:]]*["\047]?/, "", hd) }
            next
        }
        $0 ~ /oss-(log|notify|value)\.sh/ { if (ph($0)) print FILENAME ":" FNR ":" $0; next }
        {
            n = split($0, sp, "`")
            for (i = 2; i < n; i += 2)
                if (sp[i] ~ /oss-[a-z-]+\.(sh|js)|bin\/oss-|~\/\.oss|\$HOME\/\.oss|(^|[^A-Za-z])(git|gh|node|kubectl) / && ph(sp[i])) { print FILENAME ":" FNR ":" $0; break }
        }' "$@"
}
# detector control: every shell spelling below is flagged once; ${HOME}, a json fence, prose <b>
# a heredoc's <dict> markup and prose `spans` that run nothing are not.
ctl=$(mktemp -d)
cat > "$ctl/c.md" <<'FIXTURE'
```bash
echo "${HOME}" "$HOME" -w "%{http_code}"
cat > p.plist << EOF
<dict>
<string>{inside}</string>
EOF
x "{test_file}"
y "{TestFile}"
z "{task-id}"
w "skipped: <reason>"
```
```
bare "{count}"
```
~~~bash
tilde "{x}"
~~~
```Bash
cap "{y}"
```
```bash title="x"
info "{z}"
```
Run `~/.oss/hooks/oss-log.sh test red FAIL "{msg}"` now.
run ~/.oss/hooks/oss-log.sh test red FAIL "{MSG}"
```json
{"a": "{x}"}
```
Prose with <b>bold</b>, a `{span}` and a `/oss-audio <option>` that run nothing.
FIXTURE
n=$(placeholder_lines "$ctl/c.md" | wc -l | tr -d ' '); rm -rf "$ctl"
[[ "$n" == 11 ]] && pass "the placeholder detector flags every shell spelling and nothing else (11)" || fail "the placeholder detector flags every shell spelling and nothing else" "flagged $n, want 11"
bad=$(placeholder_lines "$COMMANDS_DIR"/*.md)
[[ -z "$bad" ]] && pass "no shell line in any wrapper has a model-filled placeholder" \
    || fail "no shell line in any wrapper has a model-filled placeholder" "$(printf '%s\n' "$bad" | wc -l | tr -d ' ') lines in $(printf '%s\n' "$bad" | cut -d: -f1 | sort -u | wc -l | tr -d ' ') files: $(printf '%s\n' "$bad" | sed "s|$COMMANDS_DIR/||" | cut -d: -f1,2 | tr '\n' ' ')"

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
