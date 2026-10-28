#!/bin/bash
# OSS Decision Record Hook (PostToolUse, AskUserQuestion)
# Appends one JSON line per answered picker question to the feature's committed record,
# .oss/dev/active/<feature>/decisions.ndjson (radical-observability G1). Never blocks: exit 0 always.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/oss-safe-path.sh
source "$SCRIPT_DIR/oss-safe-path.sh" 2>/dev/null || exit 0

command -v jq >/dev/null 2>&1 || { echo "oss: decision record skipped, jq not found" >&2; exit 0; }
in=""
[[ -t 0 ]] || IFS= read -r -d '' -t 2 in || true
[[ $(printf '%s' "$in" | jq -r '.tool_name' 2>/dev/null) == AskUserQuestion ]] || exit 0

oss_resolve_project
proj="$_OSS_PROJ"
branch=$(cd "$proj" 2>/dev/null && git symbolic-ref --short -q HEAD)
feature=$(printf '%s' "$branch" | cut -d/ -f2)
[[ -n "$feature" && -d "$proj/.oss/dev/active/$feature" ]] || exit 0
command=$(jq -r '.currentCommand // empty' "$proj/.oss/workflow-state.json" 2>/dev/null)

count=$(printf '%s' "$in" | jq -r '.tool_response.questions | length') || exit 0
for ((i = 0; i < count; i++)); do
    question=$(printf '%s' "$in" | jq -r --argjson i "$i" '.tool_response.questions[$i].question') || continue
    qkey=$(printf '%s\n%s' "$feature" "$question" | shasum -a 256 | cut -c1-16)
    id=$(uuidgen | tr '[:upper:]' '[:lower:]')
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    line=$(printf '%s' "$in" | jq -c --argjson i "$i" --arg id "$id" --arg feature "$feature" \
        --arg qkey "$qkey" --arg command "$command" --arg now "$now" '
        # a multiSelect answer: known labels (longest first) joined by ", ", then any typed text
        def picks($s; $labels):
            if $s == "" then []
            else ([$labels[] | select(. as $l | $s == $l or ($s | startswith($l + ", ")))][0]) as $m
                | if $m == null then [$s] else [$m] + picks($s[($m | length):] | ltrimstr(", "); $labels) end
            end;
        .tool_response as $r | $r.questions[$i] as $q | $r.answers[$q.question] as $a
        | {v: 1, id: $id, feature: $feature, questionKey: $qkey, answerIndex: 1,
           question: $q.question, header: $q.header, options: $q.options,
           recommended: ([$q.options[].label | select(endswith(" (Recommended)")) | .[:-14]][0]),
           choice: (if $q.multiSelect then picks($a; [$q.options[].label] | sort_by(-length)) else $a end),
           notes: null, kind: "decision", command: $command,
           answeredAt: $now, person: {status: "unverified"}, session: .session_id}') || continue
    printf '%s\n' "$line" >> "$proj/.oss/dev/active/$feature/decisions.ndjson"
done
exit 0
