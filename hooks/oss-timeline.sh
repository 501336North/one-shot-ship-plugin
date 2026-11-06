#!/bin/bash
# OSS feature timeline (radical-observability G2, P-1): one checked line per command, agent run, gate or merge,
# appended to the feature's committed .oss/dev/active/<feature>/timeline.ndjson, or .oss/dev/timeline-unfiled.ndjson
# when no feature folder resolves (P-3: no feature field, never pushed). Sourced, it only defines functions:
#
#   oss_timeline_append KIND FIELDS_JSON   KIND: command, agent, gate, merge or merge-unknown (P-2, local only);
#                                          FIELDS_JSON: that kind's own fields. Adds v, id, ts, kind, feature
#                                          and session (P-8), checks the whole line against the API's strict
#                                          schema, then appends it under the G1 lock. Returns non-zero and
#                                          writes nothing on any refusal, with one stderr line; 0 and nothing
#                                          written in a project with no .oss folder.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/oss-api-curl.sh
source "$SCRIPT_DIR/oss-api-curl.sh" || return 1 2>/dev/null || exit 1
# shellcheck source=hooks/oss-safe-path.sh
source "$SCRIPT_DIR/oss-safe-path.sh" || return 1 2>/dev/null || exit 1

# The one table of field rules, a copy of the API's schema (AgenticDevWorkflow
# packages/api/src/services/timeline/schema.ts): per kind its required and optional own fields, then the check of
# each field. Every string is a closed pattern or a fixed choice, matched whole (\A..\z: a "$" would let a
# trailing newline through), so no free text reaches a line (AC-G2-001.3, P-4).
# shellcheck disable=SC2016 # jq's $ variables, not the shell's
_OSS_TL_RULES='
def re($r): type == "string" and test("\\A(?:" + $r + ")\\z");
def int($lo; $hi): type == "number" and . == floor and . >= $lo and . <= $hi;
def stamp: re("[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]+)?Z")
    and . >= "2020";
def uuid4: re("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}");
def counts: type == "object" and all(to_entries[];
    (.key | IN("critical", "high", "medium", "low", "info")) and (.value | int(0; 1000)));
def approval: type == "object" and
    if .type == "decision" then keys == ["decisionId", "type"] and (.decisionId | uuid4)
    elif (.type | IN("merge-flag", "chat-instruction", "none")) then keys == ["type"]
    else false end;
def own: {
    command: {req: ["command", "status"], opt: []},
    agent: {req: ["agent"], opt: ["command"]},
    gate: {req: ["round", "gate", "verdict", "findings", "fixed", "mode"], opt: []},
    merge: {req: ["pr", "sha", "mergedAt", "mergedBy", "approval"], opt: []},
    "merge-unknown": {req: [], opt: ["pr"]}};
def field($key):
    if $key == "command" then re("[a-z][a-z0-9-]{0,40}")
    elif $key == "status" then IN("start", "complete", "failed")
    elif $key == "agent" then re("[a-z0-9:_-]{1,64}")
    elif $key == "round" then int(1; 20)
    elif $key == "gate" then re("[a-z0-9-]{1,40}")
    elif $key == "verdict" then IN("pass", "fail")
    elif $key == "findings" or $key == "fixed" then counts
    elif $key == "mode" then IN("full", "quick", "no-checks", "team")
    elif $key == "pr" then int(1; 10000000)
    elif $key == "sha" then re("[0-9a-f]{40}")
    elif $key == "mergedAt" then stamp
    elif $key == "mergedBy" then re("[A-Za-z0-9-]{1,39}")
    elif $key == "approval" then approval
    else false end;
def fields_ok($kind): own[$kind] as $o | type == "object" and $o != null
    and (keys - $o.req - $o.opt == []) and ($o.req - keys == [])
    and all(to_entries[]; .key as $k | .value | field($k));
def base_ok: .v == 1 and (.id | uuid4) and (.ts | stamp) and (.session | re("[A-Za-z0-9-]{1,64}"))
    and ((has("feature") | not) or (.feature | re("(?!\\.)[A-Za-z0-9._-]{1,128}")));
'

oss_timeline_append() (
    export LC_ALL=C   # the bash patterns below are byte ranges, whatever the locale
    kind="${1:-}" fields="${2:-}"
    refuse() { echo "oss: timeline line refused, $1" >&2; exit 1; }
    oss_resolve_project
    proj="$_OSS_PROJ"
    # a repo that never used OSS gains nothing, not even a stderr line
    [[ -n "$proj" && -d "$proj/.oss" ]] || exit 0
    command -v jq >/dev/null 2>&1 || refuse "jq not found"
    sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }
    command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || refuse "no sha-256 tool"
    case "$kind" in command | agent | gate | merge | merge-unknown) ;; *) refuse "unknown kind" ;; esac

    # P-8: the hook input's session_id (OSS_TL_SESSION), else CLAUDE_CODE_SESSION_ID, else "unknown"
    session=unknown
    for c in "${OSS_TL_SESSION:-}" "${CLAUDE_CODE_SESSION_ID:-}"; do
        [[ "$c" =~ ^[A-Za-z0-9-]{1,64}$ ]] && { session=$c; break; }
    done
    oss_resolve_feature "$proj"
    feature="$_OSS_FEATURE"
    rec=".oss/dev/timeline-unfiled.ndjson"
    [[ -n "$feature" ]] && rec=".oss/dev/active/$feature/timeline.ndjson"
    # the uuid and time as G1's decision record makes them
    id=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')
    if [[ -z "$id" ]]; then # no uuidgen (Linux): a v4 uuid from 16 random bytes
        h=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
        id=${h:0:8}-${h:8:4}-4${h:13:3}-$(printf '%x' $(((0x${h:16:1} & 3) | 8)))${h:17:3}-${h:20:12}
    fi
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # checked before any path is touched, so a refused line makes no folder either
    line=$(jq -nc --arg kind "$kind" --arg id "$id" --arg ts "$ts" --arg feature "$feature" --arg session "$session" \
        --argjson f "$fields" "$_OSS_TL_RULES"'
        select($f | fields_ok($kind))
        | ({v: 1, id: $id, ts: $ts, kind: $kind} + (if $feature == "" then {} else {feature: $feature} end)
            + {session: $session} + $f)
        | select(base_ok)' 2>/dev/null)
    [[ -n "$line" ]] || refuse "$kind fields outside the API schema"

    oss_safe_target "$proj" "$rec" || { oss_refuse_unsafe "$rec"; exit 1; }
    file="$_OSS_SAFE_DIR/${rec##*/}"
    # the G1 lock: ~/.oss/locks/<rid> (700, the person's own), named by the file's physical path, waited on for
    # 10 s; one older than 30 s was left by a writer that died and is taken over (oss_take_stale)
    rid=$(printf '%s' "$file" | sha256 | cut -c1-16)
    # shellcheck disable=SC2088 # the ~ is text for the person, never expanded
    oss_private_dir "$HOME/.oss/locks" || refuse "~/.oss/locks is a symlink or not yours: remove it"
    lock="$HOME/.oss/locks/$rid" held=""
    # shellcheck disable=SC2329 # run by the EXIT trap
    release() { oss_release_lock "$lock" "$held"; }
    trap release EXIT
    deadline=$((SECONDS + 10))
    until mkdir "$lock" 2>/dev/null; do
        # shellcheck disable=SC2088 # the ~ is text for the person, never expanded
        [[ -L "$lock" || -n "$(ls -A "$lock" 2>/dev/null)" ]] && refuse "~/.oss/locks/$rid is not a lock folder: remove it"
        oss_take_stale "$lock" 30 && continue
        ((SECONDS < deadline)) || refuse "$rec is locked by another session"
        sleep 0.05
    done
    held=$(oss_lock_id "$lock")
    # the path again, now that no other writer can touch it: a link swapped in during the wait is refused
    oss_safe_target "$proj" "$rec" || { oss_refuse_unsafe "$rec"; exit 1; }
    # a file whose last line has no newline gets one first, so the new line never glues onto it
    [[ -s "$file" && -n "$(tail -c 1 "$file")" ]] && line=$'\n'"$line"
    printf '%s\n' "$line" >> "$file"
)

[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

echo "usage: oss-timeline.sh (verbs come in later tasks; source it for oss_timeline_append)" >&2
exit 2
