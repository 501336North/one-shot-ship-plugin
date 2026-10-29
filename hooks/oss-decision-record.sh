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
[[ "$command" =~ ^[a-z][a-z-]*$ ]] || command=""
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
oss_safe_target "$proj" "$rec" || { oss_refuse_unsafe "$rec"; exit 0; }
file="$_OSS_SAFE_DIR/${rec##*/}"
# one session at a time reads the count and appends (mkdir is atomic; macOS has no flock). The hook is
# async, so a busy record is waited on for ~10 s; a lock older than 10 s was left by a hook that died and is
# taken over (rmdir: only an empty, real folder). An answer that still cannot be written says so once.
lock="$file.lock"
deadline=$((SECONDS + 10))
until mkdir "$lock" 2>/dev/null; do
    # a hook only ever makes an empty real folder here, so a link, or anything ls lists (a file lists its own
    # name, a folder its content), is committed or foreign. A lock released meanwhile lists nothing.
    [[ -L "$lock" || -n "$(ls -A "$lock" 2>/dev/null)" ]] && skip "$rec.lock is not a lock folder: remove it"
    m=$(stat -c %Y "$lock" 2>/dev/null || stat -f %m "$lock" 2>/dev/null)
    [[ "$m" =~ ^[0-9]+$ ]] && (($(date +%s) - m > 10)) && rmdir "$lock" 2>/dev/null && continue
    ((SECONDS < deadline)) || skip "$rec is locked by another session"
    sleep 0.05
done
trap 'rmdir "$lock" 2>/dev/null' EXIT
# the path again, now that no other hook can touch it: a link swapped in during the wait is refused
oss_safe_target "$proj" "$rec" || { oss_refuse_unsafe "$rec"; exit 0; }
# answerIndex: 1 + the lines this record already holds for the same questionKey. A line that is not JSON
# (a merge-conflict marker, a line cut short), or JSON that is not an object (42, "x", [1]), is not counted
# and is left as it is: the record goes on.
old=/dev/null; [[ -f "$file" ]] && old="$file"
# The record is parsed once into a count per key, whatever the number of new lines.
lines=$(printf '%s' "$lines" | jq -sc --rawfile old "$old" '
    (reduce ($old | split("\n")[] | fromjson? | objects | .questionKey | strings) as $k ({}; .[$k] += 1)) as $n
    | .[] | .answerIndex = 1 + ($n[.questionKey] // 0)' 2>/dev/null) || exit 0
# a record whose last line has no newline gets one first, so the new line never glues onto it
[[ -s "$file" && -n "$(tail -c 1 "$file")" ]] && lines=$'\n'"$lines"
printf '%s\n' "$lines" >> "$file"
exit 0
