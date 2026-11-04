#!/bin/bash
# OSS Decision Record Hook (PostToolUse, AskUserQuestion)
# Appends one JSON line per answered picker question to the feature's committed record,
# .oss/dev/active/<feature>/decisions.ndjson, or .oss/dev/decisions-unfiled.ndjson when no feature
# is active (radical-observability G1). Writes only through oss_safe_target. Never blocks: exit 0 always.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/oss-safe-path.sh
source "$SCRIPT_DIR/oss-safe-path.sh" 2>/dev/null || exit 0

oss_resolve_project
proj="$_OSS_PROJ"
# plugin hooks run in every repo: one that never used OSS (no .oss folder) gains nothing, not even the jq
# warning below. A linked .oss passes here and is refused, with its one stderr line, by oss_safe_target.
[[ -n "$proj" && -d "$proj/.oss" ]] || exit 0

skip() { echo "oss: decision record skipped, $1" >&2; exit 0; }
command -v jq >/dev/null 2>&1 || skip "jq not found"
in=""
[[ -t 0 ]] || IFS= read -r -d '' -t 2 in || true
[[ $(printf '%s' "$in" | jq -r '.tool_name' 2>/dev/null) == AskUserQuestion ]] || exit 0

# this project's own branch: git variables inherited from the session could point at another repo
branch=$(unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE; cd "$proj" 2>/dev/null && git symbolic-ref --short -q HEAD 2>/dev/null)
# ADR-009 (the IRON LAW #4 branch convention): a <type>/<feature>/<phase> branch names the feature, filed
# under it when that folder is active, else unfiled; any other branch takes the only active folder, else
# none. A name is ^[A-Za-z0-9._-]+$, not starting with "."
name_re='^[A-Za-z0-9_-][A-Za-z0-9._-]*$'
branch_re='^[^/]+/([^/]+)/[^/]'
feature=""
[[ "$branch" =~ $branch_re ]] && feature=${BASH_REMATCH[1]}
[[ "$feature" =~ $name_re && -d "$proj/.oss/dev/active/$feature" ]] || feature=""
if [[ -z "$feature" && ! "$branch" =~ $branch_re ]]; then
    active=("$proj"/.oss/dev/active/*/)
    [[ ${#active[@]} -eq 1 && -d "${active[0]}" ]] && { feature=${active[0]%/}; feature=${feature##*/}; }
    [[ "$feature" =~ $name_re ]] || feature=""
fi
rec=".oss/dev/decisions-unfiled.ndjson"
[[ -n "$feature" ]] && rec=".oss/dev/active/$feature/decisions.ndjson"
# the command from the project's own state file only (a link could point at /dev/zero or outside), and
# only a plain command name: anything else is no command
ws="$proj/.oss/workflow-state.json"
command=""
[[ -L "$ws" ]] || command=$(jq -r '.currentCommand | strings' "$ws" 2>/dev/null)
# (at most 64 characters: the API's rule for the field)
[[ "$command" =~ ^[a-z][a-z-]{0,63}$ ]] || command=""
# kind follows the command the answer was given in (radical-observability Task 11): shipping commands make
# risk calls, planning and building make scope calls, anything else (ideate, or no command) is design.
# The command is only compared as data, never run.
case "$command" in
    ship | ship-team | deploy | release | rollback) kind=risk ;;
    plan | build) kind=scope ;;
    *) kind=design ;;
esac

# the same sha-256 hex whichever tool the box has (macOS: shasum; some Linux: only sha256sum)
sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }
# fp_of: Task 16s: the fingerprint of the key on stdin (16 hex of its sha-256): the key never goes in argv or on disk
fp_of() { sha256 | cut -c1-16; }
command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || exit 0

count=$(printf '%s' "$in" | jq -r '.tool_response.questions | length' 2>/dev/null) || exit 0
lines=""
for ((i = 0; i < count; i++)); do
    id=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')
    if [[ -z "$id" ]]; then # no uuidgen (Linux): a v4 uuid from 16 random bytes
        h=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
        id=${h:0:8}-${h:8:4}-4${h:13:3}-$(printf '%x' $(((0x${h:16:1} & 3) | 8)))${h:17:3}-${h:20:12}
    fi
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    line=$(printf '%s' "$in" | jq -c --argjson i "$i" --arg id "$id" --arg feature "$feature" \
        --arg command "$command" --arg kind "$kind" --arg now "$now" '
        # a multiSelect answer: known labels (longest first) joined by ", ", then any typed text
        def picks($s; $labels):
            if $s == "" then []
            else ([$labels[] | select(. as $l | $s == $l or ($s | startswith($l + ", ")))][0]) as $m
                | if $m == null then [$s] else [$m] + picks($s[($m | length):] | ltrimstr(", "); $labels) end
            end;
        .tool_response as $r | $r.questions[$i] as $q | $r.answers[$q.question] as $a
        | select($a != null)
        | {v: 1, id: $id, feature: (if $feature == "" then null else $feature end), questionKey: null, answerIndex: 1,
           question: $q.question, header: $q.header, options: $q.options,
           recommended: ([$q.options[].label | select(endswith(" (Recommended)")) | .[:-14]][0]),
           choice: (if $q.multiSelect then picks($a; [$q.options[].label] | sort_by(-length)) else $a end), answerText: $a,
           notes: (($r.annotations[$q.question].notes | strings) // null), kind: $kind, command: $command,
           answeredAt: $now, person: {status: "unverified"}, session: .session_id}' 2>/dev/null) || continue
    [[ -n "$line" ]] || continue
    lines+="$line"$'\n'
done
# no answered question: no record, and no folder made for one
[[ -n "$lines" ]] || exit 0
# the committed line is redacted too (one pattern list: watcher/src/services/redaction.ts). If the redactor
# cannot run, or prints fewer lines than it was given, or lines that are not records, nothing is written:
# never an unredacted, short or blank record.
nonblank() { local l c=0; while IFS= read -r l; do [[ -n "$l" ]] && c=$((c + 1)); done <<< "$1"; echo "$c"; }
n=$(nonblank "$lines")
lines=$(printf '%s' "$lines" | node "$SCRIPT_DIR/../watcher/dist/cli/redact-decision.js" 2>/dev/null) \
    && [[ $(nonblank "$lines") -eq $n ]] || skip "the redactor could not run (node, watcher/dist)"
# questionKey: the same question whatever its case or runs of whitespace (lower-cased, collapsed, trimmed),
# hashed AS COMMITTED: a key of the raw text would let anyone guess a redacted secret by hashing candidates
keyed=""
while IFS= read -r l; do
    q=$(printf '%s' "$l" | jq -r '.question | ascii_downcase | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")' 2>/dev/null) || continue
    k=$(printf '%s\n%s' "$feature" "$q" | sha256 | cut -c1-16)
    keyed+=$(printf '%s' "$l" | jq -c --arg k "$k" '.questionKey = $k')$'\n'
done <<< "$lines"
[[ $(nonblank "$keyed") -eq $n ]] || skip "the redactor printed lines that are not records"
lines=$keyed
# refuse: Task 16r: a write the path checks refuse (a linked .oss, feature folder or record) is kept as the last
# refusal in ~/.oss/decisions-refusal.json (600, replaced by a rename, never written through a link), so
# /oss:settings decisions status can show it: the time and a fixed code only, never text from the repo
refuse() {
    oss_refuse_unsafe "$rec"
    local f="$HOME/.oss/decisions-refusal.json" t
    oss_single_link "$f" && t=$(mktemp "$HOME/.oss/.decisions-refusal.XXXXXX" 2>/dev/null) || exit 0
    if ! { jq -nc --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{at: $at, reason: "unsafe_path"}' > "$t" && mv -f "$t" "$f"; }; then
        rm -f "$t"
    fi
    exit 0
}
oss_safe_target "$proj" "$rec" || refuse
file="$_OSS_SAFE_DIR/${rec##*/}"
# one session at a time reads the count and appends (mkdir is atomic; macOS has no flock). The hook is
# async, so a busy record is waited on for ~10 s; a lock older than 30 s (longer than any hold: the record read
# under it is at most 5 MB) was left by a hook that died and is taken over (oss_take_stale: atomic, only an empty,
# real folder). An answer that still cannot be written says so once.
# Task 16r: the lock lives outside the repo, in ~/.oss/locks (700, the person's own, never a link), named by the
# record's physical path (rid: the same 16 hex that names its outbox), so nothing committed can hold it.
rid=$(printf '%s' "$file" | sha256 | cut -c1-16)
# shellcheck source=hooks/oss-api-curl.sh
source "$SCRIPT_DIR/oss-api-curl.sh" 2>/dev/null || skip "oss-api-curl.sh not found"
# shellcheck disable=SC2088 # the ~ is text for the person, never expanded
oss_private_dir "$HOME/.oss/locks" || skip "~/.oss/locks is a symlink or not yours: remove it"
lock="$HOME/.oss/locks/$rid"
# on exit: the locks while they are ours (held, pheld: the oss_lock_id each had when this hook made it, Task 16ak),
# and the push's private folder
held="" pheld="" tmp=""
# shellcheck disable=SC2329 # run by the EXIT trap
cleanup() {
    oss_release_lock "$lock" "$held"
    oss_release_lock "$plock" "$pheld"
    [[ -n "$tmp" ]] && rm -rf "$tmp"
}
trap cleanup EXIT
# the stale takeover: oss_take_stale (oss-api-curl.sh, shared with the settings lock)
hold_lock() {
    local deadline=$((SECONDS + 10))
    until mkdir "$lock" 2>/dev/null; do
        # a hook only ever makes an empty real folder here, so a link, or anything ls lists (a file lists its
        # own name, a folder its content), is committed or foreign. A lock released meanwhile lists nothing.
        # shellcheck disable=SC2088 # the ~ is text for the person, never expanded
        [[ -L "$lock" || -n "$(ls -A "$lock" 2>/dev/null)" ]] && skip "~/.oss/locks/$rid is not a lock folder: remove it"
        oss_take_stale "$lock" 30 && continue
        ((SECONDS < deadline)) || skip "$rec is locked by another session"
        sleep 0.05
    done
    held=$(oss_lock_id "$lock")
    # the path again, now that no other hook can touch it: a link swapped in during the wait is refused
    oss_safe_target "$proj" "$rec" || refuse
}
# release_lock: the lock is no longer ours, so exiting must not remove it (another session may hold it next)
release_lock() { oss_release_lock "$lock" "$held"; held=""; }
# append <lines>: a record whose last line has no newline gets one first, so the new line never glues onto it
append() {
    local add=$1
    [[ -s "$file" && -n "$(tail -c 1 "$file")" ]] && add=$'\n'"$add"
    printf '%s\n' "$add" >> "$file"
}
# Task 15a: the push sends only what this machine wrote. Each answer's id goes, under the same lock, to a
# private outbox outside the repo (~/.oss/decisions-outbox/<16 hex of the record's physical path>.ndjson,
# folder 700, file 600; refused when it is a link, has another hardlink or is not the person's). A line
# committed by anyone else is never in it, so it is never sent under this person's key.
# ob_ok: Task 16d: checked again right before every append to the outbox (oss_single_link, as the record).
# Task 15f: an unfiled answer (no feature) is never sent, so it gets no outbox entry and the hook makes no
# network call for it.
ob=""
ob_ok() { oss_single_link "$ob" && { [[ ! -e "$ob" ]] || [[ -O "$ob" ]]; }; }
if [[ -n "$feature" ]]; then
    ob="$HOME/.oss/decisions-outbox/$rid.ndjson"
    # Task 15c: the person turned the push off on this machine: no outbox entry and no network call, so an
    # answer given while it was off is never sent later
    ! oss_decisions_push_off && oss_private_dir "${ob%/*}" && ob_ok || ob=""
fi
hold_lock
# answerIndex: 1 + the lines this record already holds for the same questionKey. A line that is not JSON
# (a merge-conflict marker, a line cut short), or JSON that is not an object (42, "x", [1]), is not counted
# and is left as it is: the record goes on. Task 16q: the count stops at 100, the API's max, so committed lines
# (which anyone with the repo can add) never make an answer one the API refuses.
old=/dev/null; [[ -f "$file" ]] && old="$file"
# Task 15i: a record over 5 MB is not parsed under the lock (it would hold every other session up): the answer
# is still written, with answerIndex 1
if [[ "$old" != /dev/null ]] && (($(wc -c < "$old") > 5242880)); then
    echo "oss: $rec is over 5 MB, so this answer's answerIndex was not counted" >&2
    old=/dev/null
fi
# The record is parsed once into a count per key, whatever the number of new lines.
lines=$(printf '%s' "$lines" | jq -sc --rawfile old "$old" '
    (reduce ($old | split("\n")[] | fromjson? | objects | .questionKey | strings) as $k ({}; .[$k] += 1)) as $n
    | .[] | .answerIndex = ([1 + ($n[.questionKey] // 0), 100] | min)' 2>/dev/null) || exit 0
append "$lines"
# Task 16a: the body to send is made now, from the line this machine writes, and kept in the outbox entry: the
# push never reads the committed record (which anyone with the repo can change). No body (the redactor exits 1
# on a line that is not JSON, 2 on one the API can never take, or prints nothing) means the answer can never be
# sent: refused at once, never tried.
if [[ -n "$ob" ]]; then
    entries=""
    # Task 16s: each entry names the key it was given under (fp_of the key now in the config; "" when there is
    # none); Task 16w: the push sends it as keyFp and the server, which knows the account's keys, decides
    fp=$(k=$(oss_api_key) && printf '%s' "$k" | fp_of)
    while IFS= read -r l; do
        lid=$(printf '%s' "$l" | jq -r '.id')
        b=$(printf '%s\n' "$l" | node "$SCRIPT_DIR/../watcher/dist/cli/redact-decision.js" --push-body 2>/dev/null) \
            && e=$(printf '%s' "$b" | jq -ce --arg id "$lid" --arg fp "$fp" 'objects | {id: $id, state: "pending", fp: $fp, body: .}' 2>/dev/null) && [[ -n "$e" ]] \
            || e=$(jq -nc --arg id "$lid" '{id: $id, state: "refused", status: 0}')
        entries+="$e"$'\n'
    done <<< "$lines"
    # Task 16d: an outbox that became a link while the answers were made gets nothing, and nothing is sent
    ob_ok && (umask 077; printf "%s" "$entries" >> "$ob") || ob=""
fi
release_lock
# Task 13 / 15b: each outbox answer goes to the OSS API after the repo line is written and the lock released
# (the body --push-body made when the answer was written, the key on curl's stdin through oss_api_curl).
# The API's answer is written to the outbox, never to the committed record (no account email in git, no
# committed line can stop a push): verified (the account id it stamped), refused (never sent again),
# conflict, retry/failed (5xx), withheld (the team push was off, the answer names no key, or the server says
# its key is another account's: never sent again); anything else (403, 429, unreachable) stops this run and the rest wait for the next. Never a
# failure.
[[ -n "$ob" ]] || exit 0
oss_api_creds || exit 0; key=$OSS_KEY url=$OSS_URL   # key and URL from one read (T37)
# one push at a time per outbox (mkdir is atomic): a session that finds it busy leaves its answers pending
# for the next run, so no id is ever sent twice. A push lock older than 2 minutes (a run lasts under a
# minute) was left by a hook that was killed, and is taken over.
plock="$ob.push"
mkdir "$plock" 2>/dev/null || { oss_take_stale "$plock" 120 && mkdir "$plock" 2>/dev/null; } || exit 0
pheld=$(oss_lock_id "$plock")
# the body and the response live in a private folder under ~/.oss/run, removed on exit; a linked ~/.oss/run
# could put them anywhere, so it means no push
tmp=$(oss_private_run_dir decision-push) || exit 0
# Task 15k: a push killed by the hook timeout leaves its folder behind; any older than 10 minutes goes
find "$HOME/.oss/run" -mindepth 1 -maxdepth 1 -type d -name 'decision-push.*' -mmin +10 -exec rm -rf {} + 2>/dev/null
body="$tmp/body" resp="$tmp/resp"
# waiting: the outbox ids whose latest state is pending (or retry: a 5xx on an earlier run), oldest first, each
# with the body stored when this machine wrote the answer (Task 16a) and the key fingerprint it was given under (16s)
waiting() {
    jq -Rnc '[inputs | fromjson? | objects | select((.id | type) == "string" and (.id | test("^[0-9a-f-]{36}$")))]
    | reduce .[] as $e ({order: [], last: {}, body: {}, fp: {}}; (if .last[$e.id] == null then .order += [$e.id] else . end)
        | .last[$e.id] = $e.state | if .body[$e.id] == null and ($e.body | type) == "object" then .body[$e.id] = $e.body | .fp[$e.id] = $e.fp else . end)
    | .last as $last | .body as $b | .fp as $f | .order[] | select($last[.] == "pending" or $last[.] == "retry") | {id: ., body: $b[.], fp: $f[.]}' "$ob" 2>/dev/null
}
# withhold: Task 16b (user decision 2026-10-30): an answer given while the team push is off is never sent, even
# after an owner or admin turns it back on. Every answer waiting now is marked withheld, a final state.
withhold() { waiting | jq -c '{id, state: "withheld"}' > "$tmp/withheld" 2>/dev/null && ob_ok && (umask 077; cat "$tmp/withheld" >> "$ob"); }
# ask CURL_ARGS...: one API call; the answer goes to $resp and its HTTP status to $code, read only up to
# OSS_BODY_MAX bytes (oss_capped, T74c): over it, no answer ($code "", $resp empty) and jq never reads it
ask() {
    local r
    r=$(oss_capped oss_api_curl "$key" -s --max-time 5 --max-filesize "$OSS_BODY_MAX" -w '\n%{http_code}' "$@" 2>/dev/null)
    printf '%s' "${r%$'\n'*}" > "$resp"; code=${r##*$'\n'}
}
# the team decides: only a 200 saying pushEnabled is true sends anything; one saying false withholds what waits
ask "$url/api/v1/decisions/policy"; [[ "$code" == 200 ]] || exit 0
jq -e '.pushEnabled == false' "$resp" >/dev/null 2>&1 && { withhold; exit 0; }
jq -e '.pushEnabled == true' "$resp" >/dev/null 2>&1 || exit 0
todo=$(waiting)
# mark <jq object>: the result of $id goes to the outbox at once, so a run cut short never resends what the
# API already stored. An outbox that is no longer a single-link file of this person's stops the run.
mark() { ob_ok || exit 0; (umask 077; jq -nc --arg id "$id" "$@" >> "$ob"); }
# Task 15e: a run sends at most 8 answers and starts no POST once ~40 s have passed since the hook started,
# well inside the hook timeout; the rest wait for the next run
sent=0
# shellcheck disable=SC2016 # the $id and $a in the marks are jq's, never the shell's
while IFS= read -r e; do
    [[ -n "$e" ]] || continue
    ((sent < 8 && SECONDS < 40)) || break
    id=$(printf '%s' "$e" | jq -r '.id')
    efp=$(printf '%s' "$e" | jq -r '.fp | strings')
    # Task 16a: the body this machine stored; an entry from an older outbox has none and is never sent (the
    # committed record is not read for it). Task 16w: the POST carries the entry's key fingerprint as keyFp (the
    # stored body is not changed), so the server refuses it (409 account_mismatch) under another account's key.
    if ! (umask 077; printf '%s' "$e" | jq -ce --arg fp "$efp" '.body | objects | .keyFp = $fp' > "$body" 2>/dev/null); then
        mark '{id: $id, state: "failed", status: 0}'
        continue
    fi
    # Task 16s (user decision 2026-10-31): an answer that names no key (an older outbox) is withheld, a final state
    if [[ -z "$efp" ]]; then
        mark '{id: $id, state: "withheld"}'
        continue
    fi
    # Task 16am: the person may switch off while a run sends; read the switch again before every POST (the rest
    # stay pending)
    oss_decisions_push_off && break
    sent=$((sent + 1))
    ask -H 'Content-Type: application/json' --data-binary @"$body" "$url/api/v1/decisions"
    case "$code" in
        200 | 201)
            # Task 15g: stored only when the API names the account (a non-empty string id), kept as text stripped
            # of control and zero-width characters (oss_json_field); anything else stops the run, unmarked
            acct=$(jq -c '.account | objects | select(.id | type == "string")' "$resp" 2>/dev/null | oss_json_field id)
            [[ -n "$acct" ]] || break
            mark --arg a "$acct" '{id: $id, state: "verified", account: $a}' ;;
        # Task 13b: an answer the API's schema refuses is marked, so it is never sent again
        400) mark '{id: $id, state: "refused", status: 400}' ;;
        # Task 15f: a 409 conflict (this account already stored a different answer under this id) is kept out
        # of the push and the person is told, without the answer's text. A 409 policy_off (the team opted out)
        # withholds every answer still waiting (Task 16b) and stops the run. A 409 account_mismatch (Task 16w: the
        # answer was given under another account's key) withholds this answer only and goes on, and so does a 409
        # answered_while_off (Task 16aa: the answer predates the team turning recording back on). Any other 409 stops.
        409)
            case "$(oss_json_field error < "$resp" 2>/dev/null)" in
                policy_off) withhold; break ;;
                account_mismatch | answered_while_off) mark '{id: $id, state: "withheld"}' ;;
                conflict)
                    mark '{id: $id, state: "conflict"}'
                    echo "oss: one decision answer was not sent: your OSS account already holds a different answer with the same id" >&2 ;;
                *) break ;;
            esac ;;
        # a 5xx stops the run; the third one an answer gets (one per run) marks it failed, so it no longer
        # holds back newer answers. 429, 403, other 409s and an unreachable API stop the run without counting.
        5??)
            n=$(jq -Rr --arg id "$id" 'fromjson? | select(.id == $id and .state == "retry") | .state' "$ob" 2>/dev/null | wc -l)
            if ((n >= 2)); then mark --argjson s "$code" '{id: $id, state: "failed", status: $s}'
            else mark --argjson s "$code" '{id: $id, state: "retry", status: $s}'; fi
            break ;;
        *) break ;;
    esac
done <<< "$todo"
exit 0
