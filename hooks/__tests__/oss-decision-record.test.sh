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
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK="$ROOT/hooks/oss-decision-record.sh"
FIX="$ROOT/hooks/__tests__/fixtures/ask-user-question"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-decisions.XXXXXX)" && pwd -P)
HOLDER=""  # the pid of a stand-in session holding a lock: never outlives the test
trap '[[ -n "$HOLDER" ]] && kill "$HOLDER" 2>/dev/null; rm -rf "$T"' EXIT
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
want_keys='["answerIndex","answerText","answeredAt","choice","command","feature","header","id","kind","notes","options","person","question","questionKey","recommended","session","v"]'
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
        (.answerText == "Banana"),
        (.notes == null),
        (.kind | type == "string"),
        (.command == "build"),
        (.answeredAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")),
        (.person == {"status":"unverified"}),
        (.session == $p[0].session_id) ]' "$REC" 2>/dev/null)
if [[ $RC -eq 0 && -f "$REC" && $(wc -l < "$REC") -eq 1 && "$got" == "[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true]" ]]; then
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
    for t in bash cat cut date dirname git jq printf tr find ls pwd od head tail mkdir rmdir sleep shasum sha256sum uuidgen node; do
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

# Task 10c (ship round 1): a busy record is waited on (the hook is async, so waiting blocks nothing), and
# an answer that still cannot be written is never dropped silently: one stderr line says so.
# (no upper time bound: under load a wall-clock ceiling flakes; giving up at all is what the stderr line proves)
name='should wait about 10 seconds, then write nothing and say so once, when another session keeps the record locked'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
# the lock is made 2 s old: the worst case of a second boundary falling between making it and the wait
then_s=$(($(date +%s) - 2))
stamp=$(date -r "$then_s" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$then_s" +%Y%m%d%H%M.%S)
mkdir "$R.lock" && touch -t "$stamp" "$R.lock"
# the other session is alive: it keeps its lock fresh, as a live holder does, so the lock never turns stale
bash -c 'while :; do touch -c "$1"; sleep 1; done' oss-lock-holder "$R.lock" & HOLDER=$!
start=$SECONDS
run_in_project; took=$((SECONDS - start))
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; HOLDER=""
[[ $RC -eq 0 && ! -e "$R" && -d "$R.lock" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* && $took -ge 8 ]] && pass "$name" \
    || fail "$name" "rc=$RC took=${took}s record=$(cat "$R" 2>/dev/null) lock-kept=$([[ -d "$R.lock" ]] && echo yes || echo no) stderr=$(cat "$T/err")"

# a lock released between a failed mkdir and the look at it is not "a foreign lock": every answer lands
name='should record every answer, with no stderr, when eight sessions answer at once'
bad=0; why=""
for r in $(seq 10); do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    for _ in $(seq 8); do (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "$FIX/pick.json" 2>>"$T/err8.$r") & done
    wait
    got=$(jq -sc '[.[].answerIndex] | sort' "$R" 2>/dev/null)
    [[ "$got" == '[1,2,3,4,5,6,7,8]' && ! -s "$T/err8.$r" ]] || { bad=$((bad + 1)); why+=" run $r: ${got:-none} $(sort -u "$T/err8.$r" | tr '\n' ' ');"; }
done
[[ $bad -eq 0 ]] && pass "$name (10 races)" || fail "$name (10 races)" "$bad of 10 went wrong:$why"

# a lock path the hook could never take (a committed file, symlink or non-empty folder) stops recording in
# every clone: say so at once, never wait it out in silence
name='should say so at once, and write nothing, when the lock path is a file, a symlink or a non-empty folder'
for kind in file symlink folder; do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    case $kind in
        file) printf 'x\n' > "$R.lock" ;;
        symlink) mkdir "$T/lockdir.$kind.$$" 2>/dev/null; ln -s "$T/lockdir.$kind.$$" "$R.lock" ;;
        folder) mkdir "$R.lock"; : > "$R.lock/.gitkeep" ;;
    esac
    start=$SECONDS; run_in_project; took=$((SECONDS - start))
    [[ $RC -eq 0 && ! -e "$R" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* && $took -le 2 ]] && pass "$name ($kind)" \
        || fail "$name ($kind)" "rc=$RC took=${took}s record=$(cat "$R" 2>/dev/null) stderr=$(cat "$T/err")"
done

# a lock that turns stale while the hook waits is taken over, whenever in the wait that happens
name='should take over a lock that becomes older than 10 seconds while the hook is waiting'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
then_s=$(($(date +%s) - 6))
stamp=$(date -r "$then_s" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$then_s" +%Y%m%d%H%M.%S)
mkdir "$R.lock" && touch -t "$stamp" "$R.lock"
run_in_project
got=$(jq -c '.answerIndex' "$R" 2>/dev/null)
[[ $RC -eq 0 && "$got" == 1 && ! -e "$R.lock" && ! -s "$T/err" ]] && pass "$name" \
    || fail "$name" "rc=$RC answerIndex=$got lock-left=$([[ -e "$R.lock" ]] && echo yes || echo no) stderr=$(cat "$T/err")"

name='should count each question of a multi-question set on its own'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project "$FIX/multi.json"; run_in_project "$FIX/multi.json"
got=$(jq -sc '[.[].answerIndex], ([.[].questionKey] | unique | length), (.[0].questionKey == .[2].questionKey), (.[1].questionKey == .[3].questionKey)' "$R" 2>/dev/null | tr '\n' ' ')
[[ $RC -eq 0 && "$got" == '[1,1,2,2] 2 true true ' ]] && pass "$name" || fail "$name" "rc=$RC [indexes] distinct-keys same-q1 same-q2 = $got"

# Task 10b (ADR-003/004): a record never silently stops. A line that is not JSON (a merge-conflict
# marker, a line cut short) is left as it is, and answers keep being recorded after it.
name='should still record, counting only the valid lines, when the record holds a line that is not JSON'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project; valid=$(head -n 1 "$R" 2>/dev/null)
printf '%s\n%s\n%s\n' "$valid" '<<<<<<< HEAD' "${valid:0:40}" > "$R"; before=$(cat "$R")
run_in_project
got=$(tail -n 1 "$R" | jq -c '[.answerIndex, .questionKey == ($v | fromjson).questionKey]' --arg v "$valid" 2>/dev/null)
[[ $RC -eq 0 && -n "$valid" && $(wc -l < "$R") -eq 4 && "$(head -n 3 "$R")" == "$before" && "$got" == '[2,true]' ]] && pass "$name" \
    || fail "$name" "rc=$RC lines=$(wc -l < "$R" | tr -d ' ') bad-lines-kept=$([[ "$(head -n 3 "$R")" == "$before" ]] && echo yes || echo no) [index,samekey]=$got"

# a line that is valid JSON but not an object (a lone 42, "x" or [1]) is not a decision either: it is
# skipped like any other foreign line, and the record goes on
name='should still record when the record holds a JSON line that is not an object'
for junk in '42' '"x"' '[1]'; do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    run_in_project; valid=$(head -n 1 "$R" 2>/dev/null)
    printf '%s\n%s\n' "$valid" "$junk" > "$R"; before=$(cat "$R")
    run_in_project
    got=$(tail -n 1 "$R" | jq -c '.answerIndex' 2>/dev/null)
    [[ $RC -eq 0 && -n "$valid" && $(wc -l < "$R") -eq 3 && "$(head -n 2 "$R")" == "$before" && "$got" == 2 ]] && pass "$name ($junk)" \
        || fail "$name ($junk)" "rc=$RC lines=$(wc -l < "$R" | tr -d ' ') answerIndex=$got"
done

# a hook killed while holding the lock leaves its folder behind: once it is old, the next answer takes it
# over, or every later answer would be skipped forever. (A fresh lock is still waited on, then skipped:
# see "should give up quietly" above.)
name='should take over a lock left by a crashed hook once it is older than 10 seconds'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
then_s=$(($(date +%s) - 60))
stamp=$(date -r "$then_s" +%Y%m%d%H%M.%S 2>/dev/null || date -d "@$then_s" +%Y%m%d%H%M.%S)
mkdir "$R.lock" && touch -t "$stamp" "$R.lock"
run_in_project
got=$(jq -c '.answerIndex' "$R" 2>/dev/null)
[[ $RC -eq 0 && "$got" == 1 && ! -e "$R.lock" && ! -s "$T/err" ]] && pass "$name" \
    || fail "$name" "rc=$RC answerIndex=$got lock-left=$([[ -e "$R.lock" ]] && echo yes || echo no) stderr=$(cat "$T/err")"

# Task 10d (ship round 1): the path is checked again once the lock is held. A link swapped in while the
# hook waited for the lock is refused, and nothing outside the project changes.
name='should refuse a record that turned into a symlink while the hook waited for the lock'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
O=$(mktemp -d "$T/outside.XXXXXX"); printf 'outside\n' > "$O/file"
mkdir "$R.lock"
( sleep 1; ln -s "$O/file" "$R"; rmdir "$R.lock" ) &
run_in_project; wait
[[ $RC -eq 0 && "$(cat "$O/file")" == outside && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" =~ ^oss:\ refusing ]] && pass "$name" \
    || fail "$name" "rc=$RC outside=$(cat "$O/file" | tr '\n' ' ') stderr=$(cat "$T/err")"

# a record whose last line has no newline (an editor, a cut-short write) gets one first: lines never glue
name='should start a new line when the record does not end in a newline'
new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
run_in_project; valid=$(head -n 1 "$R" 2>/dev/null)
printf '%s' "$valid" > "$R"
run_in_project
got=$(jq -sc '[.[].answerIndex]' "$R" 2>/dev/null)
[[ $RC -eq 0 && -n "$valid" && "$(head -n 1 "$R")" == "$valid" && "$got" == '[1,2]' ]] && pass "$name" \
    || fail "$name" "rc=$RC indexes=$got first-line-kept=$([[ "$(head -n 1 "$R")" == "$valid" ]] && echo yes || echo no)"

# Task 11: the kind of an answer follows the command it was given in. Shipping commands make risk calls,
# planning and building make scope calls, everything else (ideate, or no command at all) is design.
name='should tag answers given during ship, ship-team, deploy, release or rollback as risk; plan or build as scope; anything else as design'
for c in ship:risk ship-team:risk deploy:risk release:risk rollback:risk plan:scope build:scope ideate:design empty:design missing:design; do
    cmd=${c%%:*}; want=${c#*:}
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    case "$cmd" in
        empty) printf '{"currentCommand":""}\n' > "$Q/.oss/workflow-state.json" ;;
        missing) rm -f "$Q/.oss/workflow-state.json" ;;
        *) jq -n --arg c "$cmd" '{currentCommand: $c}' > "$Q/.oss/workflow-state.json" ;;
    esac
    run_in_project
    got=$(jq -r '.kind' "$R" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == "$want" ]] && pass "$name ($cmd -> $want)" || fail "$name ($cmd -> $want)" "rc=$RC kind=$got"
done

# Task 11b (ship round 1): the command comes only from a real workflow-state file in the project, and only
# when it is a plain command name. A link (to /dev/zero, which never ends, or to a file outside) is ignored.
name='should ignore a workflow-state.json that is a symlink, and finish'
for target in /dev/zero outside; do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    rm -f "$Q/.oss/workflow-state.json"
    if [[ $target == outside ]]; then O=$(mktemp -d "$T/outside.XXXXXX"); printf '{"currentCommand":"ship"}\n' > "$O/ws.json"; target="$O/ws.json"; fi
    ln -s "$target" "$Q/.oss/workflow-state.json"
    (cd "$Q" && CLAUDE_PROJECT_DIR="$Q" "$(command -v timeout || command -v gtimeout)" 20 "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
    got=$(jq -c '[.command, .kind]' "$R" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == '["","design"]' ]] && pass "$name (${target##*/})" || fail "$name (${target##*/})" "rc=$RC [command,kind]=$got"
done

name='should keep the command only when it is a plain name like ship or ship-team'
for c in '{"currentCommand":{"a":1}}' '{"currentCommand":"ship; rm -rf /"}' '{"currentCommand":"Ship"}' '{"currentCommand":"ship"}{"currentCommand":"build"}'; do
    new_project feat/demo/build demo; R="$Q/.oss/dev/active/demo/decisions.ndjson"
    printf '%s\n' "$c" > "$Q/.oss/workflow-state.json"
    run_in_project
    got=$(jq -c '[.command, .kind]' "$R" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == '["","design"]' ]] && pass "$name ($c)" || fail "$name ($c)" "rc=$RC [command,kind]=$got"
done

# Task 9c (ship round 1): the feature comes from this project's own branch, git never talks on stderr, and
# a branch that names a feature with no folder files as unfiled rather than under someone else's folder.
name='should take the branch from this project even when GIT_DIR and GIT_WORK_TREE point at another repo'
new_project feat/other/build other; Other=$Q
new_project feat/demo/build demo other; R="$Q/.oss/dev/active/demo/decisions.ndjson"
(cd "$Q" && GIT_DIR="$Other/.git" GIT_WORK_TREE="$Other" CLAUDE_PROJECT_DIR="$Q" "$HOOK" < "$FIX/pick.json" 2>"$T/err"); RC=$?
got=$(jq -r '.feature' "$R" 2>/dev/null)
[[ $RC -eq 0 && "$got" == demo ]] && pass "$name" || fail "$name" "rc=$RC feature=$got files=$(lines_under "$Q/.oss")"

name='should print nothing from git in an OSS project that is not a git repo'
Q=$(mktemp -d "$T/p.XXXXXX"); mkdir -p "$Q/.oss/dev/active/solo"
run_in_project
[[ $RC -eq 0 && ! -s "$T/err" && "$(lines_under "$Q/.oss")" == "./dev/active/solo/decisions.ndjson:1 " ]] && pass "$name" \
    || fail "$name" "rc=$RC stderr=$(cat "$T/err") files=$(lines_under "$Q/.oss")"

name='should file as unfiled, not under the only active folder, when the branch names a feature that has no folder'
new_project feat/mine/build teammate-feature; run_in_project
[[ $RC -eq 0 && "$(lines_under "$Q/.oss")" == "./dev/decisions-unfiled.ndjson:1 " ]] && pass "$name" \
    || fail "$name" "rc=$RC files=$(lines_under "$Q/.oss")"

# Task 8c (ship round 1): one malformed question is skipped without a jq error on stderr, and the other
# questions in the same set are still recorded
name='should skip a malformed question quietly and still record the others'
for c in 'options missing|del(.tool_response.questions[1].options)' 'a label that is not a string|.tool_response.questions[1].options[0].label = 7' 'a multiSelect answer sent as a list|.tool_response.answers[.tool_response.questions[1].question] = ["Red","Blue"]'; do
    label=${c%%|*}; jq "${c#*|}" "$FIX/multi.json" > "$T/bad.json"
    run_hook "$T/bad.json"
    got=$(jq -sc '[.[].choice]' "$REC" 2>/dev/null)
    [[ $RC -eq 0 && "$got" == '["probe other text"]' && ! -s "$T/err" ]] && pass "$name ($label)" \
        || fail "$name ($label)" "rc=$RC choices=$got stderr=$(cat "$T/err")"
done

# labels can contain ", ", so splitting a multiSelect answer can be ambiguous: the exact string is kept
name='should keep the answer text exactly as given next to the parsed choice'
run_hook "$FIX/multi.json"
got=$(jq -sc --slurpfile p "$FIX/multi.json" '[.[] | .answerText == $p[0].tool_response.answers[.question]] ' "$REC" 2>/dev/null)
[[ $RC -eq 0 && "$got" == '[true,true]' ]] && pass "$name" || fail "$name" "rc=$RC checks=$got"

# Task 12a (ship round 1, user decision 2026-10-28): the committed line is redacted too. A token typed into
# an "Other" answer or a note never reaches the repo. (The token is built from parts: no literal is committed.)
name='should write a typed GitHub token in an Other answer and a note as [REDACTED] in the committed line'
tok="gh""p_$(printf 'A1b2C3d4%.0s' 1 2 3 4 5)"
jq --arg t "$tok" '.tool_response.questions[0].question as $q
    | .tool_response.answers[$q] = ("use " + $t + " for now")
    | .tool_response.annotations[$q] = {notes: ("token " + $t)}' "$FIX/other.json" > "$T/secret.json"
run_hook "$T/secret.json"
got=$(jq -c '[.choice, .answerText, .notes]' "$REC" 2>/dev/null)
[[ $RC -eq 0 && "$got" == '["use [REDACTED] for now","use [REDACTED] for now","token [REDACTED]"]' ]] && ! grep -q "$tok" "$REC" && pass "$name" \
    || fail "$name" "rc=$RC fields=$(printf '%s' "$got" | sed "s/$tok/<TOKEN>/g") stderr=$(cat "$T/err")"

name='should write no line, and say so once, when the redactor cannot run'
run_hook_without node
[[ $RC -eq 0 && ! -e "$REC" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* ]] && pass "$name (no node)" \
    || fail "$name (no node)" "rc=$RC record=$(cat "$REC" 2>/dev/null) stderr=$(cat "$T/err")"

# stand_in_node <name> <body>: a bin of the tools the hook may call, with a bash stand-in for node -> B
stand_in_node() {
    local t w; B="$T/bin-node-$1"; rm -rf "$B"; mkdir -p "$B"
    for t in bash cat cut date dirname git jq printf tr find ls pwd od head tail mkdir rmdir sleep shasum sha256sum uuidgen; do
        w=$(command -v "$t" 2>/dev/null) && [[ "$w" == /* ]] && ln -s "$w" "$B/$t"
    done
    printf '#!/bin/bash\n%s\n' "$2" > "$B/node"; chmod +x "$B/node"
}
# Task 12b (ship round 2): a redactor that prints less than it was given (a broken main-module check
# printed nothing and exited 0) is a failure: no line, one stderr line. Never a blank or partial record.
name='should write no line, and say so once, when the redactor prints fewer lines than it was given'
stand_in_node quiet 'cat >/dev/null; exit 0'
for f in pick multi; do
    rm -f "$REC"; (cd "$P" && PATH="$B" "$B/bash" "$HOOK" < "$FIX/$f.json" 2>"$T/err"); RC=$?
    [[ $RC -eq 0 && ! -e "$REC" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* ]] && pass "$name ($f)" \
        || fail "$name ($f)" "rc=$RC record=$(od -c "$REC" 2>/dev/null | head -2 | tr '\n' ' ') stderr=$(cat "$T/err")"
done

# Task 12k (ship round 3): the line count is exact, through keying. A redactor that drops some of its lines,
# or prints the right number of lines that are not records, writes nothing: never a short or blank record.
name='should write no line, and say so once, when the redactor drops some of its lines'
stand_in_node first-only 'head -n 1'
rm -f "$REC"; (cd "$P" && PATH="$B" "$B/bash" "$HOOK" < "$FIX/multi.json" 2>"$T/err"); RC=$?
[[ $RC -eq 0 && ! -e "$REC" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* ]] && pass "$name" \
    || fail "$name" "rc=$RC record=$(od -c "$REC" 2>/dev/null | head -2 | tr '\n' ' ') stderr=$(cat "$T/err")"

name='should write no blank line when the redactor prints the right count of lines that are not records'
stand_in_node not-records 'i=0; while IFS= read -r _; do if ((i++ % 2)); then echo "{\"question\":42}"; else echo "not json {{"; fi; done'
for f in pick multi; do
    run_hook "$FIX/pick.json"; before=$(od -c "$REC" 2>/dev/null)
    (cd "$P" && PATH="$B" "$B/bash" "$HOOK" < "$FIX/$f.json" 2>"$T/err"); RC=$?
    after=$(od -c "$REC" 2>/dev/null)
    [[ $RC -eq 0 && -n "$before" && "$before" == "$after" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* ]] && pass "$name ($f)" \
        || fail "$name ($f)" "rc=$RC record-changed=$([[ "$before" == "$after" ]] && echo no || echo "yes: $(tail -c 40 "$REC" | od -c | tr '\n' ' ')") stderr=$(cat "$T/err")"
done

# Task 12p (ship round 4): the count after keying is exact, not "at least one". A redactor whose lines are
# partly records and partly not writes nothing: never a record missing some of the answers it was given.
name='should write no line when some redactor lines are records and some are not'
stand_in_node half-records 'IFS= read -r l; printf "%s\n" "$l"; while IFS= read -r _; do echo "not json"; done'
run_hook "$FIX/pick.json"; before=$(od -c "$REC" 2>/dev/null)
(cd "$P" && PATH="$B" "$B/bash" "$HOOK" < "$FIX/multi.json" 2>"$T/err"); RC=$?
after=$(od -c "$REC" 2>/dev/null)
[[ $RC -eq 0 && -n "$before" && "$before" == "$after" && $(wc -l < "$T/err") -eq 1 && "$(cat "$T/err")" == "oss: decision record skipped, "* ]] && pass "$name" \
    || fail "$name" "rc=$RC record-changed=$([[ "$before" == "$after" ]] && echo no || echo "yes: $(tail -n 1 "$REC" | cut -c1-80)") stderr=$(cat "$T/err")"

# a plugin reached through a symlinked folder (a linked dev checkout, a linked home) still records
name='should record through a plugin path that is a symlink'
ln -s "$ROOT" "$T/linked-plugin"
rm -f "$REC"; (cd "$P" && "$T/linked-plugin/hooks/oss-decision-record.sh" < "$FIX/pick.json" 2>"$T/err"); RC=$?
got=$(jq -c '.choice' "$REC" 2>/dev/null)
[[ $RC -eq 0 && "$got" == '"Banana"' && $(wc -l < "$REC") -eq 1 && ! -s "$T/err" ]] && pass "$name" \
    || fail "$name" "rc=$RC choice=$got record=$(od -c "$REC" 2>/dev/null | head -2 | tr '\n' ' ') stderr=$(cat "$T/err")"

# Task 12d (ship round 2): questionKey hashes the question AS COMMITTED (redacted). A key taken from the raw
# text let anyone holding the record guess a redacted password offline by hashing candidates.
name='should derive questionKey from the redacted question, so the key is no oracle for the secret'
pw="summer""2024"
jq --arg pw "$pw" '.tool_response.questions[0].question as $q
    | ("Should I set DB_PASSWORD=" + $pw + " on staging?") as $v
    | .tool_response.questions[0].question = $v
    | .tool_response.answers = {($v): .tool_response.answers[$q]}' "$FIX/pick.json" > "$T/pwq.json"
run_hook "$T/pwq.json"
norm() { jq -r 'ascii_downcase | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")'; }
committed_q=$(jq -r '.question' "$REC" 2>/dev/null)
key=$(jq -r '.questionKey' "$REC" 2>/dev/null)
want=$(printf '%s\n%s' demo "$(jq -c '.question' "$REC" | norm)" | shasum -a 256 | cut -c1-16)
raw=$(printf '%s\n%s' demo "$(printf '"Should I set DB_PASSWORD=%s on staging?"' "$pw" | norm)" | shasum -a 256 | cut -c1-16)
[[ $RC -eq 0 && "$committed_q" != *"$pw"* && "$key" == "$want" && "$key" != "$raw" ]] && pass "$name" \
    || fail "$name" "rc=$RC secret-in-question=$([[ "$committed_q" == *"$pw"* ]] && echo yes || echo no) key=$key want=$want raw-key=$raw"

# Task 12i (ship round 3): answerText, choice and recommended are derived from the option labels and the
# typed answer, and "Password: <letters>" is a secret only where it ends its text. A value caught in one
# field is redacted in every field of the line. (The letters are built from parts.)
pwl="Vexing""Quark"
name="should redact a label's secret in answerText, choice and recommended too"
jq --arg l "Password: $pwl" '.tool_response.questions[1].question as $q
    | .tool_response.questions[1].options = [{label: $l, description: "x"}, {label: "Other", description: "y"}]
    | .tool_response.answers[$q] = ($l + ", Other")' "$FIX/multi.json" > "$T/xfield1.json"
run_hook "$T/xfield1.json"
got=$(jq -sc '.[1] | [.choice, .answerText]' "$REC" 2>/dev/null)
[[ $RC -eq 0 && -s "$REC" && "$got" == '[["Password: [REDACTED]","Other"],"Password: [REDACTED], Other"]' ]] && ! grep -q "$pwl" "$REC" && pass "$name" \
    || fail "$name" "rc=$RC fields=$(printf '%s' "$got" | sed "s/$pwl/<SECRET>/g") leaked=$(grep -c "$pwl" "$REC" 2>/dev/null)"

name='should redact a recommended label'"'"'s secret in the label and the choice too'
jq --arg l "Password: $pwl (Recommended)" '.tool_response.questions[0].question as $q
    | .tool_response.questions[0].options[0].label = $l
    | .tool_response.answers[$q] = $l' "$FIX/pick.json" > "$T/xfield2.json"
run_hook "$T/xfield2.json"
got=$(jq -c '[.options[0].label, .choice, .answerText, .recommended]' "$REC" 2>/dev/null)
want='["Password: [REDACTED] (Recommended)","Password: [REDACTED] (Recommended)","Password: [REDACTED] (Recommended)","Password: [REDACTED]"]'
[[ $RC -eq 0 && "$got" == "$want" ]] && ! grep -q "$pwl" "$REC" && pass "$name" \
    || fail "$name" "rc=$RC fields=$(printf '%s' "$got" | sed "s/$pwl/<SECRET>/g") leaked=$(grep -c "$pwl" "$REC" 2>/dev/null)"

# Task 12o (ship round 4): a value removed from one field is removed from the others exactly as it was
# matched, even when the label glues it to a header value ("Basic <token>;password: <letters>").
name="should redact a label's secret in every field when it is glued to a header value"
tok="ZnWoz2XR""G493o"
for glue in ';password: ' ',password: '; do
    l="Authorization: Basic $tok${glue}$pwl"
    jq --arg l "$l" '.tool_response.questions[1].question as $q
        | .tool_response.questions[1].options = [{label: $l, description: "x"}, {label: "Other", description: "y"}]
        | .tool_response.answers[$q] = ($l + ", Other")' "$FIX/multi.json" > "$T/glue1.json"
    run_hook "$T/glue1.json"
    multi_leaks=$(grep -c "$pwl" "$REC" 2>/dev/null); multi_rc=$RC; multi_lines=$(wc -l < "$REC" 2>/dev/null)
    jq --arg l "$l (Recommended)" '.tool_response.questions[0].question as $q
        | .tool_response.questions[0].options[0].label = $l
        | .tool_response.answers[$q] = $l' "$FIX/pick.json" > "$T/glue2.json"
    run_hook "$T/glue2.json"
    single_leaks=$(grep -c "$pwl" "$REC" 2>/dev/null); single_fields=$(jq -c '[.options[0].label, .choice, .answerText, .recommended]' "$REC" 2>/dev/null)
    [[ $multi_rc -eq 0 && $RC -eq 0 && ${multi_lines:-0} -ge 1 && -s "$REC" && "$multi_leaks" == 0 && "$single_leaks" == 0 ]] && pass "$name ($glue)" \
        || fail "$name ($glue)" "rc=$multi_rc/$RC multi-leaks=$multi_leaks single-leaks=$single_leaks fields=$(printf '%s' "$single_fields" | sed "s/$pwl/<SECRET>/g")"
done

# Task 12t (ship round 6): the record never keeps what the patterns alone remove. Stripping another field's
# value before the patterns run can eat the key a pattern needs ("<jwt>.secret" leaves "token=[REDACTED]=<v>").
# (Every value is fake and built from parts.)
name='should never keep text the patterns alone would redact'
sjwt="ey""J""abcdefghij.ey""J""abcdefghij.abcdefghij"; sbot="xo""xb-1234567890-AbcdEfGhIjKl"
vlong="QwErTyUiOp""AsDfGhJkLz""XcVbNmPl"; vmid="QwErTyUiOp""AsDfGhJkLz""XcVb"; vshort="QwEr""TyUi"
for shape in "?token=$sjwt.secret=$vlong&mode=1|$vlong" "secret=${sbot}password=$vmid&mode=1|$vmid" "Bearer $vshort&token=Bearer x|$vshort"; do
    text=${shape%|*}; v=${shape##*|}
    jq --arg t "$text" '.tool_response.questions[1].question as $q
        | .tool_response.questions[1].options = [{label: "Canary", description: "x"}, {label: "Other", description: "y"}]
        | .tool_response.answers[$q] = ("Canary, " + $t)' "$FIX/multi.json" > "$T/alone1.json"
    run_hook "$T/alone1.json"
    leaks=$(grep -c "$v" "$REC" 2>/dev/null); lines=$(wc -l < "$REC" 2>/dev/null)
    [[ $RC -eq 0 && ${lines:-0} -ge 1 && "$leaks" == 0 ]] && pass "$name (${text:0:8})" \
        || fail "$name (${text:0:8})" "rc=$RC lines=$lines leaks=$leaks answer=$(jq -sc '.[1].answerText' "$REC" 2>/dev/null | sed "s/$v/<V>/g")"
done

# Task 12g (ship round 2): a tool_response that is not an object prints no jq error into the session
name='should print no jq error when tool_response is not an object'
for r in '"x"' 'true' '{"questions":true}'; do
    jq -n --argjson r "$r" '{tool_name: "AskUserQuestion", tool_response: $r}' > "$T/notobj.json"
    run_hook "$T/notobj.json"
    [[ $RC -eq 0 && ! -e "$REC" && ! -s "$T/err" ]] && pass "$name ($r)" || fail "$name ($r)" "rc=$RC stderr=$(cat "$T/err")"
done

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
