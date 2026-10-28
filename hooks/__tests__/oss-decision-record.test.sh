#!/bin/bash
# Each answer a person gives in the question picker becomes one line in the feature's record.
#
# @behavior A person answers a question in the picker (a plain pick, a typed "Other" answer, or
#           several ticked options plus typed text). The feature folder gains one line per answered
#           question, holding the full question, its options, the recommended option, what the person
#           chose, the command it was asked in, when, and in which session. Input the hook cannot read
#           (garbage, nothing, another tool, no jq) leaves the record untouched and never fails the
#           session.
# @business-rule radical-observability G1 Task 8 (ADR-001, ADR-003, US-001): every picker answer is
#           recorded by a hook, never by the agent; the person is "unverified" until the API stamps
#           the account; a hook never blocks or fails the session.
#
# The REAL hook from this checkout runs on REAL captured PostToolUse payloads, with a sandbox HOME.
# Usage: ./hooks/__tests__/oss-decision-record.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-decision-record.sh"
FIX="$ROOT/hooks/__tests__/fixtures/ask-user-question"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-decisions.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID
export HOME="$T/home"; mkdir -p "$HOME/.oss"
P="$T/product"; mkdir -p "$P/.oss/dev/active/demo"
(cd "$P" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -b feat/demo/build)
printf '{"currentCommand":"build"}\n' > "$P/.oss/workflow-state.json"
export CLAUDE_PROJECT_DIR="$P"
REC="$P/.oss/dev/active/demo/decisions.ndjson"

# run_hook <payload-file>: a fresh record, then the hook as Claude Code runs it -> RC
run_hook() { rm -f "$REC"; (cd "$P" && "$HOOK" < "$1" 2>"$T/err"); RC=$?; }

# 1. one line per question, with the full field set
name='should append one line per question with the full field set'
run_hook "$FIX/pick.json"
want_keys='["answerIndex","answeredAt","choice","command","feature","header","id","kind","notes","options","person","question","questionKey","recommended","session","v"]'
got=$(jq -c --slurpfile p "$FIX/pick.json" '
    ($p[0].tool_response.questions[0]) as $q
    | [ (keys == '"$want_keys"'),
        (.v == 1),
        (.id | test("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
        (.feature == "demo"),
        (.questionKey | test("^[0-9a-f]{16}$")),
        (.answerIndex == 1),
        (.question == $q.question),
        (.header == $q.header),
        (.options == $q.options),
        (.choice == "Banana"),
        (.notes == null),
        (.kind | type == "string"),
        (.command == "build"),
        (.answeredAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")),
        (.person == {"status":"unverified"}),
        (.session == $p[0].session_id) ]' "$REC" 2>/dev/null)
if [[ $RC -eq 0 && -f "$REC" && $(wc -l < "$REC") -eq 1 && "$got" == "[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true]" ]]; then
    pass "$name"
else
    fail "$name" "rc=$RC checks=$got line=$(cat "$REC" 2>/dev/null)"
fi

# 2. the recommended option, without its suffix; null when none is marked
name='should store the recommended label without the "(Recommended)" suffix, and null when no option has it'
run_hook "$FIX/pick.json"; rec1=$(jq -c '.recommended' "$REC" 2>/dev/null)
jq '.tool_response.questions[0].options[0].label = "Apple"' "$FIX/pick.json" > "$T/norec.json"
run_hook "$T/norec.json"; rec2=$(jq -c '.recommended' "$REC" 2>/dev/null)
[[ "$rec1" == '"Apple"' && "$rec2" == null ]] && pass "$name" || fail "$name" "with suffix=$rec1 without=$rec2"

# 3. "Other": the typed text is the choice
name='should record the typed text as the choice for "Other"'
run_hook "$FIX/other.json"; got=$(jq -c '.choice' "$REC" 2>/dev/null)
[[ "$got" == '"probe other text"' ]] && pass "$name" || fail "$name" "choice=$got"

# 4. two questions -> two lines; a multiSelect choice is the list of picked labels, then typed text
name='should write two lines for a two-question set, with the multiSelect choice as a list'
run_hook "$FIX/multi.json"; got=$(jq -sc '[.[].choice]' "$REC" 2>/dev/null)
want='["probe other text",["Red","Blue","\" both, the red and blue pill.  Just like in the Matrix\""]]'
[[ "$got" == "$want" ]] && pass "$name" || fail "$name" "choices=$got"
jq '.tool_response.answers[.tool_response.questions[1].question] = "Green, with a comma, Blue"' "$FIX/multi.json" > "$T/comma.json"
run_hook "$T/comma.json"; got=$(jq -sc '.[1].choice' "$REC" 2>/dev/null)
[[ "$got" == '["Green, with a comma","Blue"]' ]] && pass "$name (a label holding a comma)" || fail "$name (a label holding a comma)" "choice=$got"
# a label that starts another label ("Green" / "Green, with a comma"), and typed text that starts with a label ("Redish")
jq '.tool_response.questions[1].options = [{"label":"Green","description":"short"}] + .tool_response.questions[1].options
    | .tool_response.answers[.tool_response.questions[1].question] = "Green, with a comma, Green, Redish"' "$FIX/multi.json" > "$T/prefix.json"
run_hook "$T/prefix.json"; got=$(jq -sc '.[1].choice' "$REC" 2>/dev/null)
[[ "$got" == '["Green, with a comma","Green","Redish"]' ]] && pass "$name (labels that start other labels or typed text)" \
    || fail "$name (labels that start other labels or typed text)" "choice=$got"

# 5. unreadable input: nothing written, exit 0
name='should write nothing and exit 0 for unreadable input'
printf 'not json {{{' > "$T/garbage"; : > "$T/empty"
jq '.tool_name = "Bash"' "$FIX/pick.json" > "$T/other-tool.json"
for f in garbage empty other-tool.json; do
    run_hook "$T/$f"
    [[ $RC -eq 0 && ! -e "$REC" ]] && pass "$name ($f)" || fail "$name ($f)" "rc=$RC record=$(cat "$REC" 2>/dev/null)"
done
# no jq on PATH: a bin holding only the basic tools the hook may call; the hook says so itself (oss: ... jq)
NB="$T/nojq-bin"; mkdir -p "$NB"
for t in bash cat cut date dirname git ls mkdir printf shasum tr uuidgen find rm mv chmod perl sha256sum; do
    w=$(command -v "$t" 2>/dev/null) && [[ "$w" == /* ]] && ln -s "$w" "$NB/$t"
done
rm -f "$REC"
(cd "$P" && PATH="$NB" "$NB/bash" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
lines=$(wc -l < "$T/err" | tr -d ' ')
[[ $RC -eq 0 && ! -e "$REC" && "$lines" == 1 && "$(cat "$T/err")" =~ ^oss:.*jq ]] && pass "$name (no jq: one stderr line)" \
    || fail "$name (no jq: one stderr line)" "rc=$RC stderr-lines=$lines stderr=$(cat "$T/err") record=$(cat "$REC" 2>/dev/null)"
# the jq warning is for OSS projects only: every other repo the plugin runs in hears nothing
name='should print nothing in a repo without .oss when jq is missing'
NO="$T/no-oss"; mkdir -p "$NO"
(cd "$NO" && git init -q)
(cd "$NO" && CLAUDE_PROJECT_DIR="$NO" PATH="$NB" "$NB/bash" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
[[ $RC -eq 0 && ! -s "$T/err" && ! -e "$NO/.oss" ]] && pass "$name" || fail "$name" "rc=$RC stderr=$(cat "$T/err")"

# 6. a question the person left unanswered is not a decision: no line for it
name='should skip a question with no entry in answers, and still record the answered one'
for n in 0 1; do
    jq --argjson n "$n" 'del(.tool_response.answers[.tool_response.questions[$n].question])' "$FIX/multi.json" > "$T/half.json"
    run_hook "$T/half.json"; got=$(jq -sc '[.[].question]' "$REC" 2>/dev/null)
    want=$(jq -c --argjson n "$n" '[.tool_response.questions[1 - $n].question]' "$FIX/multi.json")
    [[ $RC -eq 0 && $(wc -l < "$REC") -eq 1 && "$got" == "$want" ]] && pass "$name (question $((n + 1)) unanswered)" \
        || fail "$name (question $((n + 1)) unanswered)" "rc=$RC questions=$got"
done

# 7. the note a person adds to an answer is kept with it; anything but a text note is no note
name='should store the person'"'"'s note on the answer from annotations, and null when there is none'
for c in '{"notes":"because the deadline moved"}|"because the deadline moved"' '{"preview":"x"}|null' '{"notes":42}|null'; do
    ann=${c%%|*}; want=${c#*|}
    jq --argjson a "$ann" '.tool_response.annotations[.tool_response.questions[0].question] = $a' "$FIX/pick.json" > "$T/note.json"
    run_hook "$T/note.json"; got=$(jq -c '.notes' "$REC" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == "$want" ]] && pass "$name ($ann)" || fail "$name ($ann)" "rc=$RC notes=$got"
done

# 8. Linux boxes (the GB10) have no uuidgen, some have no shasum: the answer is still recorded, same key
name='should still write a line when uuidgen or shasum is missing'
# run_hook_without <tool>: the hook on a PATH of only the tools it may call, minus <tool> -> RC
run_hook_without() {
    local B="$T/bin-no-$1" t w
    rm -rf "$B"; mkdir -p "$B"
    for t in bash cat cut date dirname git jq printf tr find ls pwd od head mkdir rmdir sleep shasum sha256sum uuidgen; do
        [[ " $* " == *" $t "* ]] && continue
        w=$(command -v "$t" 2>/dev/null) && [[ "$w" == /* ]] && ln -s "$w" "$B/$t"
    done
    rm -f "$REC"; (cd "$P" && PATH="$B" "$B/bash" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
}
run_hook_without nothing; key=$(jq -r '.questionKey' "$REC" 2>/dev/null)
[[ $RC -eq 0 && "$key" =~ ^[0-9a-f]{16}$ ]] && pass "$name (all tools: the reference key)" || fail "$name (all tools: the reference key)" "rc=$RC key=$key"
for t in uuidgen shasum; do
    run_hook_without "$t"
    got=$(jq -c --arg key "$key" '[(.id | test("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")), .questionKey == $key]' "$REC" 2>/dev/null)
    [[ $RC -eq 0 && $(wc -l < "$REC" 2>/dev/null) -eq 1 && "$got" == "[true,true]" ]] && pass "$name (no $t)" \
        || fail "$name (no $t)" "rc=$RC checks=$got line=$(cat "$REC" 2>/dev/null) stderr=$(cat "$T/err")"
done
# the API takes v4 ids only (z.uuidv4): 16 fallback ids must all carry the version and variant bits
bad=0
for _ in $(seq 16); do
    run_hook_without uuidgen
    jq -e '.id | test("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")' "$REC" >/dev/null 2>&1 || bad=$((bad + 1))
done
[[ $bad -eq 0 ]] && pass "$name (no uuidgen: every fallback id is a v4 uuid)" \
    || fail "$name (no uuidgen: every fallback id is a v4 uuid)" "$bad of 16 ids were not v4"
# no sha-256 tool at all: a line without its key is worse than none
run_hook_without shasum sha256sum
[[ $RC -eq 0 && ! -e "$REC" ]] && pass "$name (no hash tool at all: nothing written)" \
    || fail "$name (no hash tool at all: nothing written)" "rc=$RC record=$(cat "$REC" 2>/dev/null)"

# Task 9 (ADR-009): which file the answer lands in. The feature is the branch's <type>/<feature>/<phase>
# when that folder is active, else the only active folder, else none: .oss/dev/decisions-unfiled.ndjson.
# new_project <branch> [folder...]: a fresh repo on <branch> with those active folders -> Q
new_project() {
    local b=$1 f; shift
    Q=$(mktemp -d "$T/p.XXXXXX")
    (cd "$Q" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B "$b")
    mkdir -p "$Q/.oss/dev/active"
    for f in "$@"; do mkdir -p "$Q/.oss/dev/active/$f"; done
    printf '{"currentCommand":"build"}\n' > "$Q/.oss/workflow-state.json"
}
# run_in_project [payload]: the hook on <payload> (default pick.json) in Q -> RC, stderr in $T/err
run_in_project() { (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "${1:-$FIX/pick.json}" 2>"$T/err"); RC=$?; }
# lines_under <dir>: every decisions file under <dir> with its line count, one per row, sorted
lines_under() { (cd "$1" && find . -name 'decision*.ndjson' -type f -exec wc -l {} + 2>/dev/null | grep -v ' total$' | awk '{print $2 ":" $1}' | sort | tr '\n' ' '); }

name='should write to .oss/dev/active/<feature>/decisions.ndjson for the feature named by the branch'
new_project feat/demo/build demo other; run_in_project
got=$(jq -r '.feature' "$Q/.oss/dev/active/demo/decisions.ndjson" 2>/dev/null)
[[ $RC -eq 0 && "$got" == demo && "$(lines_under "$Q/.oss")" == "./dev/active/demo/decisions.ndjson:1 " ]] && pass "$name" \
    || fail "$name" "rc=$RC feature=$got files=$(lines_under "$Q/.oss")"

name='should take the only active folder when the branch names none'
new_project main solo; run_in_project
got=$(jq -r '.feature' "$Q/.oss/dev/active/solo/decisions.ndjson" 2>/dev/null)
[[ $RC -eq 0 && "$got" == solo && "$(lines_under "$Q/.oss")" == "./dev/active/solo/decisions.ndjson:1 " ]] && pass "$name" \
    || fail "$name" "rc=$RC feature=$got files=$(lines_under "$Q/.oss")"

name='should use .oss/dev/decisions-unfiled.ndjson when no feature is active'
for c in 'no folder|main' 'two folders, the branch names neither|main one two' 'two folders, the branch names a missing one|feat/gone/build one two'; do
    label=${c%%|*}; read -r -a args <<< "${c#*|}"
    new_project "${args[@]}"; run_in_project
    got=$(jq -c '[.feature, (.questionKey | test("^[0-9a-f]{16}$"))]' "$Q/.oss/dev/decisions-unfiled.ndjson" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == '[null,true]' && "$(lines_under "$Q/.oss")" == "./dev/decisions-unfiled.ndjson:1 " ]] && pass "$name ($label)" \
        || fail "$name ($label)" "rc=$RC line=$got files=$(lines_under "$Q/.oss")"
done

# a name outside ^[A-Za-z0-9._-]+$ (or starting with ".") is never a feature: the next rule applies.
# (git refuses a branch component starting with ".", so the branch case uses ";", which git allows.)
name='should refuse a feature name that is not ^[A-Za-z0-9._-]+$ or starts with .'
for c in 'the branch names it|feat/a;b/build|a;b' 'the only folder|main|my feat' 'the only folder|main|a;b'; do
    IFS='|' read -r label b f <<< "$c"
    new_project "$b" "$f"; run_in_project
    got=$(jq -c '.feature' "$Q/.oss/dev/decisions-unfiled.ndjson" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == null && "$(lines_under "$Q/.oss")" == "./dev/decisions-unfiled.ndjson:1 " ]] && pass "$name ($label: $f)" \
        || fail "$name ($label: $f)" "rc=$RC feature=$got files=$(lines_under "$Q/.oss")"
done

# a committed link must never carry the answer out of the project: refuse, say so once, exit 0
name='should refuse to write through a symlinked .oss, .oss/dev, feature folder or decisions file'
# snapshot <dir>: every path under <dir> with the hash of each file
snapshot() { (cd "$1" && find . | sort && find . -type f -exec shasum {} + | sort); }
for link in .oss .oss/dev .oss/dev/active/demo .oss/dev/active/demo/decisions.ndjson; do
    new_project feat/demo/build demo
    O=$(mktemp -d "$T/outside.XXXXXX")
    if [[ "$link" == */decisions.ndjson ]]; then
        printf 'outside\n' > "$O/file"; ln -s "$O/file" "$Q/$link"
    else
        cp -R "$Q/$link/." "$O/"; printf 'outside\n' > "$O/keep"; rm -rf "${Q:?}/$link"; ln -s "$O" "$Q/$link"
    fi
    before=$(snapshot "$O"); run_in_project; after=$(snapshot "$O")
    errs=$(wc -l < "$T/err" | tr -d ' ')
    [[ $RC -eq 0 && "$before" == "$after" && "$errs" == 1 && "$(cat "$T/err")" =~ ^oss:\ refusing ]] && pass "$name ($link)" \
        || fail "$name ($link)" "rc=$RC outside-changed=$([[ "$before" == "$after" ]] && echo no || echo yes) stderr=$(cat "$T/err")"
done

# Task 9b. Plugin hooks run in every repo, and Claude Code always sets CLAUDE_PROJECT_DIR: a repo that
# never used OSS must not gain a .oss from a picker answer.
name='should write nothing, and create no .oss, in a project without a real .oss folder'
for c in 'no .oss at all' '.oss is a regular file'; do
    Q=$(mktemp -d "$T/p.XXXXXX")
    (cd "$Q" && git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m init && git checkout -q -B feat/demo/build)
    [[ "$c" == *file ]] && printf 'not a folder\n' > "$Q/.oss"
    before=$(snapshot "$Q"); run_in_project; after=$(snapshot "$Q")
    [[ $RC -eq 0 && "$before" == "$after" && ( "$c" == *file || ! -s "$T/err" ) ]] && pass "$name ($c)" \
        || fail "$name ($c)" "rc=$RC new=$(diff <(echo "$before") <(echo "$after") | grep '^>' | tr '\n' ' ') stderr=$(cat "$T/err")"
done

# Task 9b: only a <type>/<feature>/<phase> branch names a feature; "foo" or "feat/demo" names none
name='should only take the feature from a branch shaped <type>/<feature>/<phase>'
for c in 'foo|foo bar|unfiled' 'feat/demo|demo bar|unfiled' 'feat/demo/build|demo bar|demo'; do
    IFS='|' read -r b fs want <<< "$c"; read -r -a folders <<< "$fs"
    new_project "$b" "${folders[@]}"; run_in_project
    if [[ "$want" == unfiled ]]; then wantf="./dev/decisions-unfiled.ndjson:1 "; f="$Q/.oss/dev/decisions-unfiled.ndjson"; wantv=null
    else wantf="./dev/active/$want/decisions.ndjson:1 "; f="$Q/.oss/dev/active/$want/decisions.ndjson"; wantv="\"$want\""; fi
    got=$(jq -c '.feature' "$f" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == "$wantv" && "$(lines_under "$Q/.oss")" == "$wantf" ]] && pass "$name ($b)" \
        || fail "$name ($b)" "rc=$RC feature=$got files=$(lines_under "$Q/.oss")"
done

# Task 9b: no answer, no decision: nothing written and no folder made for a record that has no line
name='should create nothing when no question was answered'
jq '.tool_response.answers = {}' "$FIX/pick.json" > "$T/noanswer.json"
for c in 'two active folders' '.oss without .oss/dev'; do
    new_project main one two
    [[ "$c" == *without* ]] && rm -rf "${Q:?}/.oss/dev"
    before=$(snapshot "$Q")
    (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "$T/noanswer.json" 2>"$T/err"); RC=$?
    after=$(snapshot "$Q")
    [[ $RC -eq 0 && "$before" == "$after" ]] && pass "$name ($c)" \
        || fail "$name ($c)" "rc=$RC new=$(diff <(echo "$before") <(echo "$after") | grep '^>' | tr '\n' ' ')"
done

# Task 10 (1:N): every answer to the same question is kept, in order. A question is the feature plus
# its wording, with case and runs of whitespace not counting; answerIndex counts that key's lines.
name='should give a re-asked question with the same wording the same questionKey and answerIndex 2, keeping line 1 unchanged'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project; first=$(head -n 1 "$R" 2>/dev/null)
run_in_project; again=$(head -n 1 "$R" 2>/dev/null)
got=$(jq -sc '[length, .[1].answerIndex, (.[0].questionKey == .[1].questionKey)]' "$R" 2>/dev/null)
[[ $RC -eq 0 && -n "$first" && "$first" == "$again" && "$got" == '[2,2,true]' ]] && pass "$name" \
    || fail "$name" "rc=$RC line1-unchanged=$([[ "$first" == "$again" ]] && echo yes || echo no) [lines,index2,samekey]=$got"

name='should treat wording that differs only in case or whitespace as the same question'
jq '.tool_response.questions[0].question as $q
    | (" \t" + ($q | ascii_upcase | gsub(" "; "  \t\n ")) + " \n") as $v
    | .tool_response.questions[0].question = $v
    | .tool_response.answers = {($v): .tool_response.answers[$q]}' "$FIX/pick.json" > "$T/reworded.json"
want_q=$(jq -c '.tool_response.questions[0].question' "$T/reworded.json")
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project; run_in_project "$T/reworded.json"
got=$(jq -sc '[length, .[1].answerIndex, (.[0].questionKey == .[1].questionKey)]' "$R" 2>/dev/null)
gotq=$(jq -sc '.[1].question' "$R" 2>/dev/null)
[[ $RC -eq 0 && "$got" == '[2,2,true]' && "$gotq" == "$want_q" ]] && pass "$name" \
    || fail "$name" "rc=$RC [lines,index2,samekey]=$got question-as-asked=$([[ "$gotq" == "$want_q" ]] && echo yes || echo "no: $gotq")"

name='should give a question asked in another feature its own key'
new_project feat/demo/build demo other; run_in_project
(cd "$Q" && git checkout -q -B feat/other/build); run_in_project
a=$(jq -c '[.questionKey, .answerIndex]' "$Q/.oss/dev/active/demo/decisions.ndjson" 2>/dev/null)
b=$(jq -c '[.questionKey, .answerIndex]' "$Q/.oss/dev/active/other/decisions.ndjson" 2>/dev/null)
[[ $RC -eq 0 && "$a" == *',1]' && "$b" == *',1]' && "${a%,*}" != "${b%,*}" ]] && pass "$name" \
    || fail "$name" "rc=$RC demo=$a other=$b"

name='should write two whole lines when two sessions answer at the same moment'
bad=0; why=""
for r in $(seq 10); do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "$FIX/pick.json" 2>/dev/null) &
    (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "$FIX/pick.json" 2>/dev/null) &
    wait
    got=$(jq -sc '[.[].answerIndex] | sort' "$R" 2>/dev/null)
    [[ $(wc -l < "$R" 2>/dev/null) -eq 2 && "$got" == '[1,2]' ]] || { bad=$((bad + 1)); why+=" run $r: ${got:-unparsable};"; }
done
[[ $bad -eq 0 ]] && pass "$name (10 races)" || fail "$name (10 races)" "$bad of 10 races went wrong:$why"

# a session that holds the record too long must not stall the picker: wait briefly, then skip quietly
name='should give up quietly, writing nothing, when another session keeps the record locked'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
mkdir "$R.lock"; start=$SECONDS
run_in_project; took=$((SECONDS - start))
[[ $RC -eq 0 && ! -e "$R" && -d "$R.lock" && ! -s "$T/err" && $took -le 5 ]] && pass "$name" \
    || fail "$name" "rc=$RC took=${took}s record=$(cat "$R" 2>/dev/null) lock-kept=$([[ -d "$R.lock" ]] && echo yes || echo no) stderr=$(cat "$T/err")"

name='should count each question of a multi-question set on its own'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project "$FIX/multi.json"; run_in_project "$FIX/multi.json"
got=$(jq -sc '[.[].answerIndex], ([.[].questionKey] | unique | length), (.[0].questionKey == .[2].questionKey), (.[1].questionKey == .[3].questionKey)' "$R" 2>/dev/null | tr '\n' ' ')
[[ $RC -eq 0 && "$got" == '[1,1,2,2] 2 true true ' ]] && pass "$name" || fail "$name" "rc=$RC [indexes] distinct-keys same-q1 same-q2 = $got"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
