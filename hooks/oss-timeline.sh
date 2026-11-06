#!/bin/bash
# OSS feature timeline (radical-observability G2, P-1): one checked line per command, agent run, gate or merge,
# appended to the feature's committed .oss/dev/active/<feature>/timeline.ndjson, or .oss/dev/timeline-unfiled.ndjson
# when no feature folder resolves (P-3: no feature field, never pushed). Sourced, it only defines functions:
#
#   oss_timeline_append KIND FIELDS_JSON   KIND: command, agent, gate, merge or merge-unknown (P-2, local only);
#                                          FIELDS_JSON: that kind's own fields. Adds v, id, ts, kind, feature
#                                          and session (P-8), checks the whole line against the API's strict
#                                          schema (and a pass gate line against P-16), then appends it under the G1
#                                          lock. Returns non-zero and writes nothing on any refusal, with one stderr
#                                          line; 0 and nothing written in a project with no .oss folder.
#
# Run with no verb, it is the PostToolUse hook for Agent|Task (hooks.json): the hook JSON on stdin, one agent line,
# exit 0 always. Run with a verb (command, gate, merge), it writes that verb's line; the gate and merge verbs and
# the hook then start the push detached (oss-notify starts it after its command line). `push` copies the
# feature's waiting lines to the API (B5).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/oss-api-curl.sh
source "$SCRIPT_DIR/oss-api-curl.sh" || return 1 2>/dev/null || exit 1
# shellcheck source=hooks/oss-safe-path.sh
source "$SCRIPT_DIR/oss-safe-path.sh" || return 1 2>/dev/null || exit 1

# oss_tl_bounded <secs> <cmd...>: run a command, killed after <secs>; keeps its output and exit status (ended by the
# bound: non-zero). The merge verb bounds `gh pr view` with it (P-9). The supervisor is inline, the same program as
# oss-session-start.sh's run_bounded and oss-notify.sh's run_with_timeout, byte for byte (one-copy-helpers.test.sh,
# T81): a sourced copy missing mid-update would leave the call with no limit.
oss_tl_bounded() {
    local secs=$1; shift
    if command -v gtimeout &>/dev/null; then gtimeout "$secs" "$@"      # macOS with coreutils installed
    elif command -v timeout &>/dev/null; then timeout "$secs" "$@"      # Linux or macOS with timeout available
    elif [[ -x /usr/bin/perl ]]; then
        # Fallback (stock macOS): one supervisor owns the time limit (T72; the same program as the other two copies, byte
        # for byte: one-copy-helpers.test.sh, T81; inline, so a hook never loses its limit to a missing file). It is the
        # command's parent and runs it in its own process group (like GNU timeout; stdin /dev/null). It never signals
        # that group after reaping the leader (the id may then be reused): it polls the leader with
        # waitpid(WNOHANG) between short sleeps (1 ms doubling to 100 ms; a SIGCHLD cuts them short), and handlers only
        # set flags. At the bound, or once this shell is gone (HUP, INT or TERM to it, or its parent changes), it
        # kills the group, waits for the leader's SIGCHLD, kills the group again while the zombie leader still holds
        # the id (a child forked while the first kill landed, T54c), and only then reaps. It sits in a group of its
        # own, so a KILL to this shell's group still leaves it to end the command's. Exit: the command's, 137 at the
        # bound, 128+n for signal n to it.
        /usr/bin/perl -e '
            my ($s, $pp, $stop, $chld) = (shift, getppid, 0, 0);
            $SIG{CHLD} = sub { $chld = 1 };   # before the fork: an inherited SIG_IGN would let the kernel reap
            my $p = fork; exit 125 unless defined $p;
            if (!$p) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV; exit($!{ENOENT} ? 127 : 126) }
            setpgrp($p, $p); setpgrp(0, 0);
            my %n = (HUP => 1, INT => 2, TERM => 15);
            for my $g (keys %n) { $SIG{$g} = sub { $stop = $n{$g} } }
            sub gkill { kill "KILL", -$p }
            my ($t0, $used, $tick) = (time, 0, 0.001);
            while (1) {
                my $r = waitpid($p, 1);   # 1: WNOHANG
                if ($r == $p) { exit($? & 127 ? 128 + ($? & 127) : $? >> 8) }
                exit 125 if $r == -1;     # not ours to reap (never expected): signal nothing
                last if $stop || $used >= $s || time - $t0 > $s + 1 || getppid != $pp;   # time(): whole seconds, a backstop
                select(undef, undef, undef, $tick); $used += $tick; $tick = $tick < 0.05 ? $tick * 2 : 0.1;
            }
            gkill(); for (1 .. 200) { last if $chld; select(undef, undef, undef, 0.005) }
            gkill(); waitpid($p, 0); exit($stop ? 128 + $stop : 137);
        ' "$secs" "$@" </dev/null
    else
        "$@" </dev/null   # no perl either: unbounded, so nothing is ever signalled (T72)
    fi
}

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
# the bare-key check of the API, copied from holdsBareSecret (AgenticDevWorkflow 574a772,
# packages/api/src/routes/timeline.ts): in a free-pattern field (session, repo, feature, agent, gate, command,
# mergedBy) a run of 32 or more letters and digits with a digit reads as a key body sent without its prefix, and
# the API refuses the line (400 Holds a secret). Refused here, so such a line never reaches the committed file.
def keyless: [scan("[A-Za-z0-9]{32,}")] | all(test("[0-9]") | not);
def free($r): re($r) and keyless;
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
    if $key == "command" then free("[a-z][a-z0-9-]{0,40}")
    elif $key == "status" then IN("start", "complete", "failed")
    elif $key == "agent" then free("[a-z0-9:_-]{1,64}")
    elif $key == "round" then int(1; 20)
    elif $key == "gate" then free("[a-z0-9-]{1,40}")
    elif $key == "verdict" then IN("pass", "fail")
    elif $key == "findings" or $key == "fixed" then counts
    elif $key == "mode" then IN("full", "quick", "no-checks", "team")
    elif $key == "pr" then int(1; 10000000)
    elif $key == "sha" then re("[0-9a-f]{40}")
    elif $key == "mergedAt" then stamp
    elif $key == "mergedBy" then free("[A-Za-z0-9-]{1,39}")
    elif $key == "approval" then approval
    else false end;
# a plugin rule beyond the API (P-16): a gate line says pass only when no critical or high finding is left unfixed
# (a missing count is 0); a fail verdict may carry any counts
def settled: .verdict != "pass" or (. as $g | all("critical", "high"; ($g.findings[.] // 0) <= ($g.fixed[.] // 0)));
def fields_ok($kind): own[$kind] as $o | type == "object" and $o != null
    and (keys - $o.req - $o.opt == []) and ($o.req - keys == [])
    and all(to_entries[]; .key as $k | .value | field($k))
    and ($kind != "gate" or settled);
def base_ok: .v == 1 and (.id | uuid4) and (.ts | stamp) and (.session | free("[A-Za-z0-9-]{1,64}"))
    and ((has("feature") | not) or (.feature | free("(?!\\.)[A-Za-z0-9._-]{1,128}")));
'

# _oss_tl_sha256: sha-256 of stdin, with shasum (macOS) or sha256sum (Linux)
_oss_tl_sha256() { if command -v shasum >/dev/null 2>&1; then shasum -a 256; else sha256sum; fi; }

oss_timeline_append() (
    export LC_ALL=C   # the bash patterns below are byte ranges, whatever the locale
    kind="${1:-}" fields="${2:-}"
    refuse() { echo "oss: timeline line refused, $1" >&2; exit 1; }
    oss_resolve_project
    proj="$_OSS_PROJ"
    # a repo that never used OSS gains nothing, not even a stderr line
    [[ -n "$proj" && -d "$proj/.oss" ]] || exit 0
    # no repo: the project resolved to $HOME, whose ~/.oss is the person's own settings, never a timeline
    _oss_phys_dir "$proj" && p="$_OSS_PD" && _oss_phys_dir "$HOME" && [[ "$p" != "$_OSS_PD" ]] || exit 0
    command -v jq >/dev/null 2>&1 || refuse "jq not found"
    command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1 || refuse "no sha-256 tool"
    case "$kind" in command | agent | gate | merge | merge-unknown) ;; *) refuse "unknown kind" ;; esac

    # P-8: the hook input's session_id (OSS_TL_SESSION), else CLAUDE_CODE_SESSION_ID, else "unknown"
    session=unknown
    for c in "${OSS_TL_SESSION:-}" "${CLAUDE_CODE_SESSION_ID:-}"; do
        [[ "$c" =~ ^[A-Za-z0-9-]{1,64}$ ]] && { session=$c; break; }
    done
    oss_resolve_feature "$proj"
    feature="$_OSS_FEATURE"
    ((${#feature} <= 128)) || feature=""   # longer than the API's feature pattern allows: filed as unfiled
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
    [[ -n "$line" ]] || refuse "$kind fields outside the API schema or the plugin gate rule (P-16)"

    oss_safe_target "$proj" "$rec" || { oss_refuse_unsafe "$rec"; exit 1; }
    file="$_OSS_SAFE_DIR/${rec##*/}"
    # the G1 lock: ~/.oss/locks/<rid> (700, the person's own), named by the file's physical path, waited on for
    # 10 s; one older than 30 s was left by a writer that died and is taken over (oss_take_stale)
    rid=$(printf '%s' "$file" | _oss_tl_sha256 | cut -c1-16)
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
    # another person's file is never appended to (`test -O`: the tests' other-user seam)
    [[ ! -e "$file" ]] || test -O "$file" || refuse "$rec is not yours"
    # the unfiled file stops growing at 1 MB (it is never pushed or trimmed)
    [[ -n "$feature" || -z "$(find "$file" -prune -size +1048575c 2>/dev/null)" ]] || exit 0
    # the outbox entry (B5), made from the line this machine writes: the push never reads the committed file
    entry=$(jq -c --arg fp "$(k=$(oss_api_key) && printf '%s' "$k" | _oss_tl_sha256 | cut -c1-16)" \
        '{id, state: "pending", fp: $fp, body: .}' <<< "$line")
    # a file whose last line has no newline gets one first, so the new line never glues onto it
    [[ -s "$file" && -n "$(tail -c 1 "$file")" ]] && line=$'\n'"$line"
    printf '%s\n' "$line" >> "$file" || exit 1
    # B5, as G1's outbox: the line's id and body go, under the same lock, to a private outbox outside the repo
    # (~/.oss/timeline-outbox/<rid>.ndjson, folder 700, file 600; refused when it is a link, has another hard link
    # or is not the person's). Never for an unfiled line (P-3) or a merge-unknown one (P-2), and never while the
    # person's push switch is off (P-7), so a line written while it was off is never sent later.
    [[ -n "$feature" && "$kind" != merge-unknown ]] || exit 0
    oss_decisions_push_off && exit 0
    ob="$HOME/.oss/timeline-outbox/$rid.ndjson"
    oss_private_dir "${ob%/*}" && _oss_tl_ob_ok "$ob" && (umask 077; printf '%s\n' "$entry" >> "$ob")
    exit 0
)

# _oss_tl_ob_ok OUTBOX: absent, or a single-link regular file of the person's own (`test -O`: the tests' other-user
# seam). Checked before every append to it.
_oss_tl_ob_ok() { oss_single_link "$1" && { [[ ! -e "$1" ]] || test -O "$1"; }; }

# _oss_tl_push_bg: starts `oss-timeline.sh push` detached, in a process group of its own (so killing the hook's
# group, or a caller waiting on it, never cuts a POST short or waits for one), stdin, stdout and stderr closed.
# The push bounds itself: 8 POSTs of 15 s at most, none started after 40 s.
_oss_tl_push_bg() {
    if [[ -x /usr/bin/perl ]]; then
        /usr/bin/perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV' "$SCRIPT_DIR/oss-timeline.sh" push </dev/null >/dev/null 2>&1 &
    else
        "$SCRIPT_DIR/oss-timeline.sh" push </dev/null >/dev/null 2>&1 &
    fi
}

# _oss_tl_push: B5, G1's push over every timeline outbox on this machine (~/.oss/timeline-outbox/*.ndjson, each the
# person's own single file, under its own push lock), so a branch switch or the ship archive never strands a line:
# each entry holds its own body and fp. Each waiting line (pending, or retry) goes at most once per run to
# POST /api/v1/timeline as the body stored when it was written, plus keyFp, the fingerprint of the key it was
# written under; the reply is written to its outbox, never to the committed file. Exit 0 always.
_oss_tl_push() (
    export LC_ALL=C
    oss_resolve_project
    proj="$_OSS_PROJ"
    [[ -n "$proj" && -d "$proj/.oss" ]] || exit 0
    command -v jq >/dev/null 2>&1 || exit 0
    obd="$HOME/.oss/timeline-outbox"
    [[ -d "$obd" && ! -L "$obd" ]] || exit 0
    ob_ok() { _oss_tl_ob_ok "$ob"; }
    oss_decisions_push_off && exit 0
    oss_api_creds || exit 0; key=$OSS_KEY url=$OSS_URL   # key and URL from one read (T37)
    # waiting [TRIED]: the outbox ids whose latest state is pending or retry, oldest first, each with its stored body
    # and fp; ids in TRIED (" id id ") are left out, so no line is sent twice in a run
    waiting() {
        jq -Rnc --arg t "${1:-}" '[inputs | fromjson? | objects | select((.id | type) == "string" and (.id | test("\\A[0-9a-f-]{36}\\z")))]
        | reduce .[] as $e ({order: [], last: {}, body: {}, fp: {}}; (if .last[$e.id] == null then .order += [$e.id] else . end)
            | .last[$e.id] = $e.state | if .body[$e.id] == null and ($e.body | type) == "object" then .body[$e.id] = $e.body | .fp[$e.id] = $e.fp else . end)
        | .last as $last | .body as $b | .fp as $f | .order[] | select($last[.] == "pending" or $last[.] == "retry")
        | . as $i | select($t | contains(" " + $i + " ") | not) | {id: ., body: $b[.], fp: $f[.]}' "$ob" 2>/dev/null
    }
    plock="" pheld="" lk="" lheld="" tmp="" policy=""
    # shellcheck disable=SC2329 # run by the EXIT trap
    cleanup() { oss_release_lock "$lk" "$lheld"; oss_release_lock "$plock" "$pheld"; [[ -n "$tmp" ]] && rm -rf "$tmp"; }
    trap cleanup EXIT
    tmp=$(oss_private_run_dir timeline-push) || exit 0
    find "$HOME/.oss/run" -mindepth 1 -maxdepth 1 -type d -name 'timeline-push.*' -mmin +10 -exec rm -rf {} + 2>/dev/null
    body="$tmp/body" resp="$tmp/resp"
    # every write to an outbox that fails (read-only, full disk) stops the run, so nothing is sent twice
    withhold() { waiting | jq -c '{id, state: "withheld"}' > "$tmp/withheld" 2>/dev/null && ob_ok && (umask 077; cat "$tmp/withheld" >> "$ob"); }
    ask() { oss_ask 15 "$resp" "$key" "$@" 2>/dev/null; }
    mark() { ob_ok || exit 0; (umask 077; jq -nc --arg id "$id" "$@" >> "$ob") || exit 0; }
    # retry: any reply that is not final (a 5xx, 401, 403, 404, 413, 422, 429, an unknown 409, a 2xx naming no
    # account, a timeout, no answer); the third one a line gets marks it failed, so it never waits forever
    retry() {
        local n s=0
        [[ "$code" =~ ^[0-9]{3}$ ]] && s=$((10#$code))
        n=$(jq -Rr --arg id "$id" 'fromjson? | select(.id == $id and .state == "retry") | .state' "$ob" 2>/dev/null | wc -l)
        if ((n >= 2)); then mark --argjson s "$s" '{id: $id, state: "failed", status: $s}'
        else mark --argjson s "$s" '{id: $id, state: "retry", status: $s}'; fi
    }
    # compact: the outbox keeps only the entries of ids not yet in a final state (verified, refused, withheld,
    # conflict, failed), rewritten in place under the writer's lock (~/.oss/locks/<rid>, tried once: a busy lock
    # leaves the file as it is), so a push never re-reads a whole history
    compact() {
        oss_private_dir "$HOME/.oss/locks" || return 0
        lk="$HOME/.oss/locks/$(basename "$ob" .ndjson)"
        mkdir "$lk" 2>/dev/null || { lk=""; return 0; }
        lheld=$(oss_lock_id "$lk")
        jq -Rnc '[inputs | fromjson? | objects] | (reduce .[] as $e ({}; .[$e.id | tostring] = $e.state)) as $last
            | .[] | select($last[.id | tostring] | IN("verified", "refused", "withheld", "conflict", "failed") | not)' \
            "$ob" > "$tmp/keep" 2>/dev/null && (($(wc -l < "$tmp/keep") < $(wc -l < "$ob"))) && ob_ok && cat "$tmp/keep" > "$ob"
        oss_release_lock "$lk" "$lheld"; lk="" lheld=""
    }
    sent=0 tried=" " compacted=" "
    # Pushes start detached and may overlap: one that finds an outbox's push lock busy leaves its lines pending, so
    # the holder looks again after a pass that sent something, while new lines wait and the run's bounds allow.
    while ((sent < 8 && SECONDS < 40)); do
        more=""
        for ob in "$obd"/*.ndjson; do
            [[ -f "$ob" ]] && ob_ok || continue
            plock="$ob.push"
            mkdir "$plock" 2>/dev/null || { oss_take_stale "$plock" 120 && mkdir "$plock" 2>/dev/null; } || { plock=""; continue; }
            pheld=$(oss_lock_id "$plock")
            # once per outbox per run, before it sends: what this run marks stays readable until the next run
            obid=$(basename "$ob" .ndjson)
            [[ "$compacted" == *" $obid "* ]] || { compact; compacted="$compacted$obid "; }
            todo=$(waiting "$tried")
            # the team decides, as for decisions (P-7), asked once per run: only a 200 saying pushEnabled is true
            # sends anything; false withholds every waiting line
            if [[ -n "$todo" && -z "$policy" ]]; then
                ask "$url/api/v1/decisions/policy"; [[ "$code" == 200 ]] || exit 0
                if jq -e '.pushEnabled == false' "$resp" >/dev/null 2>&1; then policy=off
                elif jq -e '.pushEnabled == true' "$resp" >/dev/null 2>&1; then policy=on
                else exit 0; fi
            fi
            if [[ -n "$todo" && "$policy" == off ]]; then withhold || exit 0; todo=""; fi
            # shellcheck disable=SC2016 # the $id and $a in the marks are jq's, never the shell's
            while IFS= read -r e; do
                [[ -n "$e" ]] || continue
                ((sent < 8 && SECONDS < 40)) || exit 0
                id=$(printf '%s' "$e" | jq -r '.id')
                tried="$tried$id "
                efp=$(printf '%s' "$e" | jq -r '.fp | strings')
                if ! (umask 077; printf '%s' "$e" | jq -ce --arg fp "$efp" '.body | objects | .keyFp = $fp' > "$body" 2>/dev/null); then
                    mark '{id: $id, state: "failed", status: 0}'
                    continue
                fi
                # a line written with no key in the config names no key: withheld, a final state
                if [[ -z "$efp" ]]; then
                    mark '{id: $id, state: "withheld"}'
                    continue
                fi
                oss_decisions_push_off && exit 0
                sent=$((sent + 1)) more=1
                ask -H 'Content-Type: application/json' --data-binary @"$body" "$url/api/v1/timeline"
                case "$code" in
                    200 | 201)
                        acct=$(jq -c '.account | objects | select(.id | type == "string")' "$resp" 2>/dev/null | oss_json_field id)
                        if [[ -n "$acct" ]]; then mark --arg a "$acct" '{id: $id, state: "verified", account: $a}'; else retry; fi ;;
                    # the API's schema (or its secret check) refused the line: never sent again, and said once
                    400)
                        mark '{id: $id, state: "refused", status: 400}'
                        echo "oss: timeline line $id was refused by the OSS API (400) and will not be sent again" >&2 ;;
                    409)
                        case "$(oss_json_field error < "$resp" 2>/dev/null)" in
                            policy_off) policy=off; withhold || exit 0; break ;;
                            account_mismatch | answered_while_off) mark '{id: $id, state: "withheld"}' ;;
                            conflict)
                                mark '{id: $id, state: "conflict"}'
                                echo "oss: timeline line $id was not sent: your OSS account already holds a different line with the same id" >&2 ;;
                            *) retry ;;
                        esac ;;
                    *) retry ;;
                esac
            done <<< "$todo"
            oss_release_lock "$plock" "$pheld"; plock="" pheld=""
        done
        [[ -n "$more" ]] || exit 0
    done
    exit 0
)

[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0

case "${1:-}" in
    # oss-timeline.sh push [--detach]: B5, copy this feature's waiting lines to the API (_oss_tl_push); --detach
    # starts it in the background and returns at once (oss-notify, after its command line)
    push) if [[ "${2:-}" == --detach ]]; then _oss_tl_push_bg; else _oss_tl_push; fi; exit 0 ;;
    # oss-timeline.sh command NAME STATUS: oss-notify's --workflow NAME start|complete|failed (B2); both values
    # are checked by the line's own rules
    command) oss_timeline_append command "$(jq -nc --arg c "${2:-}" --arg s "${3:-}" '{command: $c, status: $s}' 2>/dev/null)"; exit ;;
    # oss-timeline.sh gate ROUND GATE VERDICT FINDINGS FIXED MODE: only from oss-value.sh timeline gate (B4a), which
    # read the values from value files and checked them; FINDINGS and FIXED in the form "critical=0 high=2" (or
    # empty). The line's own rules check every field again.
    gate)
        # shellcheck disable=SC2016 # jq's $ variables, not the shell's
        oss_timeline_append gate "$(jq -nc --argjson r "${2:-}" --arg g "${3:-}" --arg v "${4:-}" --arg f "${5:-}" \
            --arg x "${6:-}" --arg m "${7:-}" 'def counts: [splits(" ") | select(. != "") | split("=")
                | {(.[0]): (.[1] | tonumber)}] | add // {};
            {round: $r, gate: $g, verdict: $v, findings: ($f | counts), fixed: ($x | counts), mode: $m}' 2>/dev/null)"
        rc=$?; _oss_tl_push_bg; exit "$rc" ;;
    # oss-timeline.sh merge APPROVAL: only from oss-value.sh timeline merge (B4b), which read APPROVAL from
    # approval.txt and checked it (merge-flag, chat-instruction, none or decision:<uuid>). decision:<uuid> counts only
    # when that id is a line's id in this feature's G1 record (decisions.ndjson, read only as a single-link regular
    # file, and only its first 1 MB); otherwise the approval is refused: exit 1, and only a local merge-unknown line
    # is written, so a real merge always leaves a trace (Task 12; an empty APPROVAL, which oss-value passes for a
    # refused approval.txt, gives the same line). The PR facts come from `gh pr view`
    # for the current branch, bounded at 10 s (P-9), run with every GIT_* variable unset (the session's could name
    # another repo); nothing from a value file reaches gh's argv. No gh, a failed or hung gh, a PR that is not merged,
    # or facts outside the merge schema (a bot login, a null mergeCommit, a mergedAt before 2020) give a local
    # merge-unknown line (P-2), with the PR number when it is valid. The line's own rules check every field again.
    merge)
        oss_resolve_project
        refused=""
        if [[ "${2:-}" == decision:* ]]; then
            oss_resolve_feature "$_OSS_PROJ"
            drec="$_OSS_PROJ/.oss/dev/active/$_OSS_FEATURE/decisions.ndjson"
            # the record is read only up to 1 MB
            [[ -n "$_OSS_FEATURE" ]] && oss_is_regular "$drec" && oss_single_link "$drec" \
                && [[ -n "$(head -c 1048576 "$drec" | jq -nR --arg id "${2#decision:}" \
                    'first(inputs | fromjson? | objects | select(.id == $id)) | 1' 2>/dev/null)" ]] \
                || { echo "oss: timeline merge refused, the decision is not in this feature's decision record" >&2; refused=1; }
        fi
        out=""
        command -v gh >/dev/null 2>&1 \
            && out=$(cd "${_OSS_PROJ:-.}" && for v in $(compgen -e); do [[ $v != GIT_* ]] || unset "$v"; done \
                && oss_tl_bounded 10 gh pr view --json number,mergeCommit,mergedAt,mergedBy 2>/dev/null) \
            || out=""
        # shellcheck disable=SC2016 # jq's $ variables, not the shell's
        fields=$(printf '%s' "$out" | jq -c --arg a "${2:-}" --arg r "$refused" "$_OSS_TL_RULES"'
            (if $a | startswith("decision:") then {type: "decision", decisionId: $a[9:]} else {type: $a} end) as $ap
            | {pr: .number, sha: .mergeCommit.oid, mergedAt: .mergedAt, mergedBy: .mergedBy.login, approval: $ap} as $m
            | if $r == "" and ($m | fields_ok("merge")) then ["merge", $m]
              else ["merge-unknown", (if .number | field("pr") then {pr: .number} else {} end)] end' 2>/dev/null) || fields=""
        [[ -n "$fields" ]] || fields='["merge-unknown",{}]'
        oss_timeline_append "$(jq -r '.[0]' <<< "$fields")" "$(jq -c '.[1]' <<< "$fields")"
        rc=$?; [[ -z "$refused" ]] || rc=1; _oss_tl_push_bg; exit "$rc" ;;
    # no verb: the PostToolUse hook for Agent|Task (B3), the hook JSON on stdin. One agent line with the type,
    # lower-cased (P-5), and the running command when the project's own workflow-state.json names one. Never
    # disturbs the tool run: exit 0 whatever happens.
    "")
        export LC_ALL=C
        in=""
        [[ -t 0 ]] || IFS= read -r -d '' -t 2 in < <(head -c 1048576) || true   # at most 1 MB, at most 2 s
        tool=$(printf '%s' "$in" | jq -r '.tool_name | strings' 2>/dev/null)
        [[ "$tool" == Agent || "$tool" == Task ]] || exit 0
        agent=$(printf '%s' "$in" | jq -r '.tool_input.subagent_type | strings | ascii_downcase' 2>/dev/null)
        [[ "$agent" =~ ^[a-z0-9:_-]{1,64}$ ]] || { echo "oss: timeline agent line skipped, type outside the API pattern" >&2; exit 0; }
        # the command from the project's own state file, only when it is a regular file (never a link or a
        # FIFO, T32) and only a plain command name: anything else is no command
        oss_resolve_project
        ws="$_OSS_PROJ/.oss/workflow-state.json" cmd=""
        oss_is_regular "$ws" && oss_single_link "$ws" && [[ -z "$(find "$ws" -prune -size +65536c 2>/dev/null)" ]] \
            && cmd=$(head -c 65536 "$ws" | jq -r '.currentCommand | strings' 2>/dev/null)
        [[ "$cmd" =~ ^[a-z][a-z0-9-]{0,40}$ ]] || cmd=""
        # P-8: the hook's session_id first; the writer falls back to CLAUDE_CODE_SESSION_ID, then "unknown"
        OSS_TL_SESSION=$(printf '%s' "$in" | jq -r '.session_id | strings' 2>/dev/null) \
            oss_timeline_append agent "$(jq -nc --arg a "$agent" --arg c "$cmd" \
                '{agent: $a} + (if $c == "" then {} else {command: $c} end)')"
        _oss_tl_push_bg
        exit 0 ;;
esac
echo "usage: oss-timeline.sh command NAME STATUS | push [--detach] | gate ROUND GATE VERDICT FINDINGS FIXED MODE | merge APPROVAL, or no verb with PostToolUse JSON on stdin (or source it for oss_timeline_append)" >&2
exit 2
