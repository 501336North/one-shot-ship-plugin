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
# (the dir line twice since ship round 4, R4-2: Step 5 also hands the command name over by custom.txt)
[[ "$(grep -cxF -- "$DIR_LINE" "$f")" == 2 && "$(grep -cxF -- "$CUSTOM_LINE" "$f")" == 1 ]] \
    && pass "oss-custom.md has the fixed dir line (Step 5 and Step 7) and one fixed failed line" \
    || fail "oss-custom.md has the fixed dir line (Step 5 and Step 7) and one fixed failed line" "dir=$(grep -cxF -- "$DIR_LINE" "$f") failed=$(grep -cxF -- "$CUSTOM_LINE" "$f")"
[[ -z "$(failed_lines "$f")" ]] && pass "oss-custom.md has no failed notify line" || fail "oss-custom.md has no failed notify line" "$(failed_lines "$f" | cut -d: -f2-)"
grep -qF 'Write tool' "$f" && grep -qF 'reason.txt' "$f" \
    && pass "oss-custom.md tells the model to write reason.txt with the Write tool" \
    || fail "oss-custom.md tells the model to write reason.txt with the Write tool" "instruction missing"

# 4. no shell line in any wrapper carries a model-filled placeholder (R1-1, R2-2, ship round 3 R3-6/R3-7)
# A placeholder is, in any case, {word} or <word> where word may hold letters, digits, _ - space . : |
# (not starting or ending with a space), or an upper-case [WORD] / [TWO WORDS]; found after balanced
# ${...} (innermost first, so ${X:-{reason}} keeps its {reason}), $name and \$ are stripped, and
# %{name} only on a curl -w/--write-out line. Shell lines: every line in a fenced block (``` or ~~~,
# bare = shell) whose language is not a data/code one below; outside fences, every inline `span`
# that runs a hook or a command, and any line that runs an oss-log/oss-notify/oss-value hook.
# In a heredoc body <word> is markup (a plist) unless the heredoc feeds a shell (bash/sh/zsh <<).
# ```http fences (request shapes) are scanned too, with {apiKey} (from config) allowed by name; the
# fixed log tag [CHAIN] is allowed by name; a /oss:<cmd> usage line in a fence is not shell.
# In a shell fence, a $NAME / ${NAME} / $1 that the same fence never assigns (NAME=, read, for,
# local, export, declare) is model-filled text too; allowed: HOME, PWD, BASH_SOURCE (ship round 4,
# R4-2: no known-open exceptions are left). Prints "<file>:<lineno>:<line>".
placeholder_lines() {
    awk '
        function strip(s,   o) {
            gsub(/\\\$/, "", s)
            do { o = s; gsub(/\$[{][^{}]*[}]/, "", s) } while (s != o)
            if (s ~ /curl/ && s ~ /(^|[[:space:]])(-w|--write-out)[[:space:]]/) gsub(/%[{][^{}]*[}]/, "", s)
            gsub(/\$[A-Za-z_][A-Za-z0-9_]*/, "", s)
            return s
        }
        function ph(s, ang, http) {
            s = strip(s); gsub(/\[CHAIN\]/, "", s); if (http) gsub(/[{]apiKey[}]/, "", s)
            return s ~ /[{][A-Za-z_]([A-Za-z0-9_ .:|-]*[A-Za-z0-9_])?[}]/ \
                || (ang && s ~ /<[A-Za-z_]([A-Za-z0-9_ .:|-]*[A-Za-z0-9_])?>/) \
                || s ~ /\[[A-Z][A-Z0-9_]+( [A-Z0-9_]+)*\]/
        }
        function assigns(l,   t, n, w, i, k) {
            t = l
            while (match(t, /(^|[^A-Za-z0-9_$])[A-Za-z_][A-Za-z0-9_]*\+?=/)) { n = substr(t, RSTART, RLENGTH); sub(/^[^A-Za-z_]/, "", n); sub(/\+?=$/, "", n); asg[n] = 1; t = substr(t, RSTART + RLENGTH) }
            t = l; while (match(t, /for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*[[:space:]]+in/)) { n = substr(t, RSTART, RLENGTH); sub(/^for[[:space:]]+/, "", n); sub(/[[:space:]]+in$/, "", n); asg[n] = 1; t = substr(t, RSTART + RLENGTH) }
            t = l; while (match(t, /(read|local|export|declare)([[:space:]]+-[A-Za-z]+)*([[:space:]]+[A-Za-z_][A-Za-z0-9_]*)+/)) { n = substr(t, RSTART, RLENGTH); k = split(n, w, /[[:space:]]+/); for (i = 2; i <= k; i++) if (w[i] !~ /^-/) asg[w[i]] = 1; t = substr(t, RSTART + RLENGTH) }
        }
        # prints nothing; returns 1 when the line uses a $NAME/${NAME}/$1 the fence never assigns
        function unbound(l,   s, nm, bad) {
            s = l; gsub(/\\\$/, "", s); gsub(/\047[^\047]*\047/, "", s); bad = 0
            while (match(s, /\$[{]?([A-Za-z_][A-Za-z0-9_]*|[0-9])/)) {
                nm = substr(s, RSTART, RLENGTH); sub(/^\$[{]?/, "", nm); s = substr(s, RSTART + RLENGTH)
                if (nm in asg || nm == "HOME" || nm == "PWD" || nm == "BASH_SOURCE") continue
                bad = 1
            }
            return bad
        }
        function flush(   i) {
            for (i = 1; i <= nb; i++) {
                if (bp[i]) { print FILENAME ":" bl[i] ":" buf[i]; continue }
                if (sh != 1 || bq[i]) continue
                if (unbound(buf[i])) print FILENAME ":" bl[i] ":" buf[i]
            }
            nb = 0; split("", asg)
        }
        FNR == 1 { fence = ""; sh = 0; hd = ""; hq = 0; hs = 0; nb = 0 }
        match($0, /^[[:space:]]*(```|~~~)/) {
            m = substr($0, RSTART + RLENGTH - 3, 3); rest = substr($0, RSTART + RLENGTH)
            sub(/^[`~]*[[:space:]]*/, "", rest)
            if (fence == "") {
                fence = m; split(tolower(rest), w, /[^a-z0-9_+-]/)
                sh = (w[1] == "http") ? 2 : (w[1] !~ /^(json|yaml|yml|markdown|md|typescript|ts|javascript|js|text|txt|diff)$/)
                next
            }
            if (m == fence && rest ~ /^[[:space:]]*$/) { flush(); fence = ""; sh = 0; hd = ""; next }
        }
        fence != "" {
            if (!sh || $0 ~ /^[[:space:]]*\/oss([:-]|[[:space:]]|$)/) next   # a /oss:<cmd> usage line is typed to Claude, not run
            t = $0; gsub(/[[:space:]]/, "", t)
            nb++; buf[nb] = $0; bl[nb] = FNR; bq[nb] = (hd != "" && hq)
            if (hd != "" && t == hd) { hd = ""; bp[nb] = 0; next }
            bp[nb] = ph($0, hd == "" || hs, sh == 2)
            if (sh == 1 && !bq[nb]) assigns($0)
            if (hd == "" && match($0, /<<-?[[:space:]]*["\047]?[A-Za-z_]+/)) {
                hd = substr($0, RSTART, RLENGTH); hq = (hd ~ /["\047]/); sub(/^<<-?[[:space:]]*["\047]?/, "", hd)
                hs = ($0 ~ /(^|[^A-Za-z0-9_\/-])(bash|sh|zsh|ksh)([[:space:]]+-[A-Za-z]+)*[[:space:]]*<</)
            }
            next
        }
        $0 ~ /oss-(log|notify|value)\.sh/ { if (ph($0, 1, 0)) print FILENAME ":" FNR ":" $0; next }
        {
            n = split($0, sp, "`")
            for (i = 2; i < n; i += 2)
                if (sp[i] ~ /oss-[a-z-]+\.(sh|js)|bin\/oss-|~\/\.oss|\$HOME\/\.oss|(^|[^A-Za-z])(git|gh|node|kubectl) / && ph(sp[i], 1, 0)) { print FILENAME ":" FNR ":" $0; break }
        }' "$@"
}
# detector control: every line marked "# flag" below is flagged once; every other line is not
# (${HOME}, curl -w %{...}, a json/text fence, prose <b>, a heredoc <dict>, prose `spans` that run
# nothing, jq '{a: $x}', [ -f x ], tr '[A-Z]', <in >out, assigned and allowed variables, {apiKey},
# a /oss: usage line, the [CHAIN] log tag).
ctl=$(mktemp -d)
cat > "$ctl/c.md" <<'FIXTURE'
```bash
echo "${HOME}" "$HOME" "$PWD" && curl -s -w "%{http_code}" x
cat > p.plist << EOF
<dict>
<string>{inside}</string>
EOF
x "{test_file}"
y "{TestFile}"
z "{task-id}"
w "skipped: <reason>"
sp "{test file}"
dot "{task.file}"
col "<file:line>"
msg "<commit message>"
pipe "{reason|none}"
br "[MESSAGE]"
br2 "[TASK NAME]"
def "${X:-{reason}}"
pf printf "%{x}"
bash <<EOF
run "<reason>"
EOF
echo "$UNSET_THING"
echo "$1"
X=1; for f in a b; do read -r L; echo "$X $f $L ${X}"; done
jq -n --arg k v '{type: $k}' && [ -f x ] && tr -d '[A-Z]' && sort <in >out && echo "[ok]"
/oss:a11y [OPTIONS] [PATH]
~/.oss/hooks/oss-log.sh write build "[CHAIN] executing a chain command"
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
```http
GET https://example.invalid/api/v1/workflows/{workflowName}
Authorization: Bearer {apiKey}
```
```text
display "{shown}" $NOT_SHELL [MESSAGE]
```
Run `~/.oss/hooks/oss-log.sh test red FAIL "{msg}"` now.
run ~/.oss/hooks/oss-log.sh test red FAIL "{MSG}"
```json
{"a": "{x}"}
```
Prose with <b>bold</b>, a `{span}` and a `/oss-audio <option>` that run nothing.
FIXTURE
want=$(grep -cE '^<string>|^(x|y|z|w|sp|dot|col|msg|pipe|br|br2|def|pf|run|bare|tilde|cap|info|GET) |^echo "\$(UNSET_THING|1)"|^Run `|^run ~' "$ctl/c.md" | tr -d ' ')
got=$(placeholder_lines "$ctl/c.md")
n=$(printf '%s\n' "$got" | grep -c . | tr -d ' ')
[[ "$want" == 24 && "$n" == 24 ]] && pass "the placeholder detector flags every shell spelling and nothing else (24)" \
    || fail "the placeholder detector flags every shell spelling and nothing else" "flagged $n, want 24 (fixture marks $want): $(printf '%s\n' "$got" | cut -d: -f2 | tr '\n' ' ')"
rm -rf "$ctl"

bad=$(placeholder_lines "$COMMANDS_DIR"/*.md)
[[ -z "$bad" ]] && pass "no shell line in any wrapper has a model-filled placeholder or unassigned variable" \
    || fail "no shell line in any wrapper has a model-filled placeholder or unassigned variable" "$(printf '%s\n' "$bad" | wc -l | tr -d ' ') lines: $(printf '%s\n' "$bad" | sed "s|$COMMANDS_DIR/||" | cut -d: -f1,2 | tr '\n' ' ')"

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
