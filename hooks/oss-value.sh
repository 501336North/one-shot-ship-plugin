#!/usr/bin/env bash
# oss-value.sh - the one plugin script that owns the per-repo value folder (G21 cut 1, ADR-001).
#
#   oss-value.sh dir                print the physical ~/.oss/run/<key> for the cwd's repo (outside any
#                                   repo ~/.oss/run/home), cleared of the value files; nothing printed
#                                   and rc != 0 when unsafe.
#   oss-value.sh failed <workflow>  send reason.txt from that folder, cleaned, as the workflow's
#                                   failed notice to the project the cwd is in; then delete it.
#   oss-value.sh error <cmd:name>   emit message.txt, hint.txt and error.txt (5 fields) through
#                                   oss-error.js as an OSSError from <cmd:name>; then delete them.
#   oss-value.sh read <name>        print <name>.txt (key style prompt model workflow category name
#                                   notify_style voice sound verbosity custom) when it matches that
#                                   name's rule in _ov_cmd_read; deleted once read.
#   oss-value.sh agent <workflow> start|complete
#                                   log agent.txt (the specialist's name) through oss-log.sh agent
#                                   with a fixed task text, for the status line; deleted once read.
#   oss-value.sh root               print the plugin root named by ~/.oss/plugin-root, checked (any cwd).
#   oss-value.sh decrypt [custom]   ~/.oss/bin/oss-decrypt --type <category> --name <name> from category.txt
#                                   + name.txt (or --type custom --name <custom.txt>), checked as read does.
#   oss-value.sh models-set         the plugin's models.js set <type> <prompt> <model> from prompt.txt + model.txt.
#   oss-value.sh cli <script> <args>  one of the fixed plugin CLI calls (webhook-setup setup [--port N],
#                                   webhook-toggle on, update-workflow-state init) from the plugin root.
#   oss-value.sh status | workflows | workflow
#                                   GET /api/v1/auth/verify, /api/v1/workflows, or /api/v1/workflows/<workflow.txt>/editor
#                                   with the configured key on curl's stdin; print only what /oss:status and
#                                   /oss:workflows display (T60).
#   oss-value.sh usage              GET /api/v1/analytics/usage the same way; print this month's total and the 10 most
#                                   used command types, or one "Usage: unavailable right now" line and rc 0 (T69).
#   oss-value.sh timeline gate      one gate line on the feature timeline (oss-timeline.sh gate) from round.txt
#                                   gate.txt verdict.txt findings.txt fixed.txt mode.txt, each held to its rule in
#                                   _ov_cmd_timeline; all six deleted once read, accepted or refused (G2 B4a).
#   oss-value.sh timeline merge     one merge line (oss-timeline.sh merge, the PR facts from gh) with the approval
#                                   from approval.txt (merge-flag, chat-instruction, none or decision:<uuid v4>;
#                                   none when missing); deleted once read, accepted or refused (G2 B4b).
#   oss-value.sh queue-push         POST type.txt, source.txt and prompt.txt (checked) to /api/v1/queue the same way;
#                                   print "Queued: <id>", or one Error: line on stderr and rc 1 (T87).
# (Saving the API key is hooks/oss-login.sh, NOT a verb here: this script is allowlisted, a key
# change must always ask - R5-8. oss-login.sh sources this file for its functions.)
# Each value hand-off is ONE call spelled ~/.oss/hooks/oss-value.sh <verb> (the allowed prefix): a
# $(...) && chain asks for approval even when every part is allowed (ship round 5, R5-1).
#
# `dir` is the served value-folder command, step for step, except the key (toplevel + git dir, ship
# round 1 R1-3); `failed` is the served failure-notice reader and `error` the served oss-error
# emitter (same code and severity lists). Phase B moves the served copies onto this script.
set -u

case "${HOME:-}" in /*) ;; *) echo "oss-value: HOME is not an absolute path; refusing" >&2; exit 1 ;; esac

_OV_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "$_OV_HERE/oss-safe-path.sh" ]]; then
    echo "oss-value: oss-safe-path.sh missing beside $_OV_HERE/oss-value.sh; refusing" >&2
    exit 1
fi
source "$_OV_HERE/oss-safe-path.sh"

_ov_usage() { echo "usage: oss-value.sh dir | failed <workflow> | error cmd:<name> | read <name> | agent <workflow> start|complete | root | decrypt [custom] | models-set | cli <script> <args> | status | usage | workflows | workflow | queue-push | timeline gate|merge" >&2; exit 2; }

_OV_RUN="$HOME/.oss/run"

# The cwd's repo, never one named by the environment; cd to its toplevel. Outside any repo
# _OV_TOP is empty: the one per-user folder (ship round 4, R4-1).
_ov_repo() {
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
    _OV_TOP=$(git rev-parse --show-toplevel 2>/dev/null) || { _OV_TOP=""; return 0; }
    cd "$_OV_TOP" >/dev/null
}
# Toplevel + git dir, so a .git file naming another repo's git dir gets its own key; an empty
# lookup is refused, never hashed. (The served prompts still hash the git dir alone: Phase B.)
# Outside any repo the key is "home" (never 16 hex, so it cannot meet a repo's folder).
_ov_key() {
    local g k
    test -n "$_OV_TOP" || { echo home; return 0; }
    g=$(git rev-parse --absolute-git-dir) && test -n "$g" \
    && k=$(printf '%s\n%s\n' "$_OV_TOP" "$g" | git hash-object --stdin | cut -c1-16) && test "${#k}" = 16 && printf '%s\n' "$k"
}
_ov_safe() { test ! -L "$1" && test -O "$1"; }   # the served not-link + owner checks

# Lookup only (no create): sets _OV_DIR to the physical ~/.oss/run/<key> when both folders pass
# the checks. Reused by the verbs that read a value file.
_ov_dir() {
    _OV_DIR=""
    _ov_repo && _ov_safe "$_OV_RUN" || return 1
    local k g && k=$(_ov_key) && g="$_OV_RUN/$k" && _ov_safe "$g" \
    && _OV_DIR=$(CDPATH= cd -P -- "$g" >/dev/null && pwd -P)
}

_ov_cmd_dir() {
    _ov_repo \
    && mkdir -p -m 700 "$HOME/.oss" "$_OV_RUN" && _ov_safe "$_OV_RUN" && chmod 700 "$_OV_RUN" \
    && { find "$_OV_RUN" -mindepth 2 -maxdepth 2 -type f -name '*.txt' -mtime +7 -delete; find "$_OV_RUN" -mindepth 1 -maxdepth 1 -type d -empty -mtime +1 -delete || true; } 2>/dev/null \
    && local k && k=$(_ov_key) && mkdir -p -m 700 "$_OV_RUN/$k" && _ov_dir && chmod 700 "$_OV_DIR" && touch "$_OV_DIR" \
    && local p="$_OV_DIR" \
    && rm -f "$p/feature.txt" "$p/numbers.txt" "$p/date.txt" "$p/reason.txt" "$p/message.txt" "$p/hint.txt" "$p/error.txt" \
             "$p/agent.txt" "$p/key.txt" "$p/style.txt" "$p/prompt.txt" "$p/model.txt" "$p/workflow.txt" "$p/category.txt" "$p/name.txt" \
             "$p/notify_style.txt" "$p/voice.txt" "$p/sound.txt" "$p/verbosity.txt" "$p/custom.txt" "$p/type.txt" "$p/source.txt" \
             "$p/round.txt" "$p/gate.txt" "$p/verdict.txt" "$p/findings.txt" "$p/fixed.txt" "$p/mode.txt" "$p/approval.txt" \
    && printf '%s\n' "$p"
}

# The shared rule (oss_resolve_project in oss-safe-path.sh) from <cwd>: CLAUDE_PROJECT_DIR, this
# session's pointer, the nearest real .oss up to the first .git entry, or $HOME (the global ~/.oss,
# never ~/.oss/current-project).
_ov_walk() { oss_resolve_project "$1"; _OV_PROJ=${_OSS_PROJ:-$HOME}; }

# "<inode> <link count>": of the opened file for /dev/fd/N, else of the path itself (not followed).
_ov_st() { case "$1" in /dev/fd/*) stat -L -c '%i %h' "$1" 2>/dev/null || stat -L -f '%i %l' "$1" ;; *) stat -c '%i %h' "$1" 2>/dev/null || stat -f '%i %l' "$1" ;; esac; }
# Opens <file> in _OV_DIR on fd 3, then checks the opened file IS that path: not a link, a regular
# file, link count 1 (the served checks), same inode - so a swap between check and read is refused.
_ov_open() {
    local f="$_OV_DIR/$1" s
    test ! -L "$f" && test -f "$f" && { exec 3< "$f"; } 2>/dev/null \
    && test ! -L "$f" && test -f "$f" && s=$(_ov_st /dev/fd/3) && test "$s" = "$(_ov_st "$f")" && test "${s#* }" = 1
}
# Checked <file>, kept to the served charset, at most 200 characters -> _OV_VAL.
_ov_read_value() {
    _ov_open "$1" && _OV_VAL=$(LC_ALL=C tr -cd 'A-Za-z0-9 ._,:()/-' <&3 | cut -c1-200); local r=$?; exec 3<&-; return $r
}

# <file> <regex> [max-age]: the checked file, read whole, deleted at once (valid or not: a key never
# lingers), then held to <regex> -> _OV_VAL. A refused open leaves the path alone. With max-age (seconds),
# an opened file last written longer ago is refused too: value folders are per repo, not per session.
_ov_take() {
    _OV_VAL=""; _ov_open "$1" || { { exec 3<&-; } 2>/dev/null; return 1; }   # braces: a bare exec 2>/dev/null would silence the caller
    local v m; v=$(cat <&3); m=$(stat -L -c %Y /dev/fd/3 2>/dev/null || stat -L -f %m /dev/fd/3); exec 3<&-; rm -f "$_OV_DIR/$1"
    [[ -z "${3:-}" ]] || { [[ "$m" =~ ^[0-9]+$ ]] && (( $(date +%s) - m <= $3 )); } || return 1
    [[ "$v" =~ $2 ]] && _OV_VAL=$v
}

# <name>: <name>.txt from _OV_DIR held to that name's rule -> _OV_VAL (deleted once read). The one
# list of per-name rules: read and the verbs that act on a value (decrypt, models-set) use it.
_ov_get() {
    local re
    case "${1:-}" in
        key) re='^[A-Za-z0-9_-]{8,200}$' ;;
        style) re='^(visual|audio|sound|none)$' ;;
        prompt) re='^[a-z0-9_./:-]{1,100}$' ;;
        model) re='^[A-Za-z0-9_./:-]{1,100}$' ;;   # isValidModelId's ids (upper case too); no `..` (below)
        workflow) re='^[a-z0-9_.:-]{1,100}$' ;;   # then held to oss_valid_workflow_name (below): no `.`/`..` (T74)
        category|name) re='^[a-z0-9_-]{1,100}$' ;;
        notify_style) re='^(visual|audio|sound|none)$' ;;   # /oss:settings' own lists
        voice) re='^(Samantha|Daniel|Karen|Moira)$' ;;
        sound) re='^(Glass|Ping|Purr|Pop)$' ;;
        verbosity) re='^(all|important|errors-only)$' ;;
        custom) re='^[a-z0-9-]{1,100}$' ;;   # oss-custom Step 0 = isSafeTeamCommandName
        *) false ;;
    esac && _ov_take "$1.txt" "$re" && case "$1:$_OV_VAL" in model:*..*) _OV_VAL=""; false ;;
        workflow:*) oss_valid_workflow_name "$_OV_VAL" || { _OV_VAL=""; false; } ;; esac
}

_ov_cmd_read() {
    _ov_dir && _ov_get "${1:-}" && printf '%s\n' "$_OV_VAL" \
    || { echo "oss-value: read: refused (unknown name, or the value file missing, unsafe or not a valid ${1:-value})" >&2; return 1; }
}

# decrypt [custom]: oss-decrypt with category.txt + name.txt (or custom.txt as a custom name), each
# held to its read rule, in the caller's folder - one allowed call instead of a $(read) && chain.
_ov_cmd_decrypt() {
    local o t n
    oss_phys_cwd; o="$_OSS_CWD"
    _ov_dir && case "$#:${1:-}" in
        0:) _ov_get category && t=$_OV_VAL && _ov_get name && n=$_OV_VAL ;;
        1:custom) t=custom && _ov_get custom && n=$_OV_VAL ;;
        *) false ;;
    esac || { echo "oss-value: decrypt: refused (bad argument, or a value file missing, unsafe or not a valid name)" >&2; return 1; }
    cd "$o" && exec "$HOME/.oss/bin/oss-decrypt" --type "$t" --name "$n"
}

# models-set: models.js set <type> <name> <model> from prompt.txt + model.txt (/oss:x -> commands
# oss:x, oss:x -> agents, else skills: the /oss:models set rule), from the checked plugin root.
_ov_cmd_models_set() {
    local p m t n
    _ov_dir && _ov_get prompt && p=$_OV_VAL && _ov_get model && m=$_OV_VAL && _ov_root \
    || { echo "oss-value: models-set: refused (prompt.txt or model.txt missing, unsafe or not valid, or no plugin root)" >&2; return 1; }
    case "$p" in /oss:*) t=commands; n=${p#/} ;; oss:*) t=agents; n=$p ;; *) t=skills; n=$p ;; esac
    exec node "$_OV_ROOT/watcher/dist/cli/models.js" set "$t" "$n" "$m"
}

# cli <script> <args>: one of the fixed plugin CLI calls the wrappers make, from the checked plugin root.
_ov_cmd_cli() {
    case "$#:${1:-}:${2:-}:${3:-}" in
        2:webhook-setup:setup:|2:webhook-toggle:on:|2:update-workflow-state:init:) ;;
        4:webhook-setup:setup:--port) case "$4" in ''|*[!0-9]*|??????*) false ;; esac ;;
        *) false ;;
    esac && _ov_root && test -f "$_OV_ROOT/watcher/dist/cli/$1.js" \
    || { echo "oss-value: cli: refused (not one of the fixed plugin CLI calls, or no plugin root)" >&2; return 1; }
    exec node "$_OV_ROOT/watcher/dist/cli/$1.js" "${@:2}"
}

# <verb> <path> <jq filter> <js>: GET <path> from the API the OSS config names, the key from the same read
# (oss_api_creds) on curl's stdin (oss_api_curl, never argv); print the 200 body through <filter> (one JSON
# object; C0 and OSS_JQ_INVISIBLE stripped from every string), so /oss:status and /oss:workflows run one
# allowed call and never handle the key (T60).
# Without jq (optional at session start), node runs <js>, the same filter: a function body of o (the one JSON
# object) returning the lines to print, with h (jq's .k: null on null, an error on a non-object), d (jq's // ""),
# t (jq's truthiness), c and cl as in jq. c strips C0 and the oss_invisible set (oss-api-curl.sh, T45, T52) after
# tostring (JSON.stringify, with DEL escaped as jq's tojson does). L first turns lone surrogate halves into U+FFFD
# (a no-u regex), so a strip between a lone high and a lone low half cannot join them into an astral invisible (T52b).
# Neither: one line saying how to get jq (T64).
_OV_JS_PRE='const S=new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069\\u2028\\u2029\\p{Cf}\\ufe00-\\ufe0f\\u{e0000}-\\u{e0fff}\\u034f\\u115f\\u1160\\u3164\\uffa0\\u2800\\u17b4-\\u17b5\\u180b-\\u180d\\u180f\\u2065\\ufff0-\\ufff8\\p{Default_Ignorable_Code_Point}]","gu"),
    L=new RegExp("[\\ud800-\\udbff](?![\\udc00-\\udfff])|(?<![\\ud800-\\udbff])[\\udc00-\\udfff]","g");
const h=(v,k)=>{if(v===null)return null;if(typeof v!=="object"||Array.isArray(v))throw 0;return Object.prototype.hasOwnProperty.call(v,k)?v[k]:null;};
const t=v=>v!==null&&v!==false, d=v=>t(v)?v:"";
const c=v=>(typeof v==="string"?v:JSON.stringify(v).replace(new RegExp("\\x7f","g"),"\\u007f")).replace(L,"\ufffd").replace(S,"");
const cl=v=>typeof v==="string"?c(v):Array.isArray(v)?v.map(cl):v!==null&&typeof v==="object"?Object.fromEntries(Object.entries(v).map(([k,x])=>[c(k),cl(x)])):v;
let o;try{o=JSON.parse(require("fs").readFileSync(0,"utf8"));}catch(e){process.exit(1);}
if(o===null||typeof o!=="object"||Array.isArray(o))process.exit(1);
let r;try{r=(o=>{'
_OV_JS_POST='})(o);}catch(e){process.exit(1);}
process.stdout.write(r.map(x=>x+"\n").join(""));'
_ov_api() {
    local r rc code body
    source "$_OV_HERE/oss-api-curl.sh" 2>/dev/null || { echo "oss-value: $1: oss-api-curl.sh missing" >&2; return 1; }
    command -v jq >/dev/null || command -v node >/dev/null \
    || { echo "oss-value: $1: this needs jq (or node), and neither is installed. Install jq (brew install jq) or ask your admin" >&2; return 1; }
    oss_api_creds
    case $OSS_URL_RC in
        0) ;;
        2) oss_loopback_refused >&2; return 1 ;;
        *) echo "oss-value: $1: apiUrl in your OSS config is not an https URL. Run: /oss:login" >&2; return 1 ;;
    esac
    [[ -n "$OSS_KEY" ]] || { echo "oss-value: $1: No API key found. Run: /oss:login" >&2; return 1; }
    # The hooks' one body cap, oss_capped (T74, T81): over OSS_BODY_MAX bytes, whether curl or the byte stop ends
    # the read, nothing and rc 63; these answers are a few KB.
    r=$(oss_capped oss_api_curl "$OSS_KEY" -s -m 15 --max-filesize "$OSS_BODY_MAX" -w '\n%{http_code}' "$OSS_URL$2")
    rc=$?
    (( rc != 63 )) || { echo "oss-value: $1: the API sent over $OSS_BODY_MAX bytes" >&2; return 1; }
    (( rc == 0 )) || { echo "oss-value: $1: could not reach the API at $OSS_URL" >&2; return 1; }
    code=${r##*$'\n'}; body=${r%$'\n'*}
    [[ "$code" == 200 ]] || { echo "oss-value: $1: the API answered HTTP $code (401: run /oss:login; 403: subscription expired)" >&2; return 1; }
    if command -v jq >/dev/null; then
        printf '%s' "$body" | jq -rs "$OSS_JQ_INVISIBLE"'def c: tostring | gsub("[\u0000-\u001f" + oss_invisible + "]"; "");
        def cl: if type == "string" then c elif type == "array" then map(cl) elif type == "object" then with_entries(.key |= c | .value |= cl) else . end;
        if length == 1 and (.[0] | type) == "object" then .[0] | '"$3"' else error("not one JSON object") end'
    else
        printf '%s' "$body" | node -e "$_OV_JS_PRE$4$_OV_JS_POST"
    fi 2>/dev/null || { echo "oss-value: $1: the API sent an answer that is not the expected JSON" >&2; return 1; }
}

_OV_JS_STATUS='return ["Account: "+c(d(h(o,"email"))), "Plan: "+c(d(h(o,"plan"))), "Status: "+c(d(h(o,"subscriptionStatus")))]
    .concat(t(h(o,"trialEndsAt")) ? ["Trial ends: "+c(h(o,"trialEndsAt"))] : []);'
_ov_cmd_status() {
    _ov_api status /api/v1/auth/verify '"Account: \(.email // "" | c)", "Plan: \(.plan // "" | c)", "Status: \(.subscriptionStatus // "" | c)",
        (if .trialEndsAt then "Trial ends: \(.trialEndsAt | c)" else empty end)' "$_OV_JS_STATUS"
}

# usage (T69): the route's fields (AgenticDevWorkflow analytics.ts:211-216), most used type first, at most 10 lines
# of types. Best-effort: any failure (no key, HTTP error, timeout, not the expected JSON) is one honest line and rc 0,
# so /oss:status still shows the account section.
_OV_JS_USAGE='const n=h(o,"totalCommands"), b=h(o,"commandsByType"), p=h(o,"periodStart");
    if (typeof n!=="number"||b===null||typeof b!=="object"||Array.isArray(b)||!Object.values(b).every(x=>typeof x==="number")) throw 0;
    const e=Object.entries(b).sort((x,y)=>y[1]-x[1]||(x[0]<y[0]?-1:x[0]>y[0]?1:0));
    return ["Total commands: "+n+(t(p)?" (since "+Array.from(c(p)).slice(0,10).join("")+")":"")]
        .concat(e.slice(0,10).map(([k,v])=>"  "+c(k)+": "+v), e.length>10?["  ("+(e.length-10)+" more command types)"]:[]);'
_ov_cmd_usage() {
    local o
    o=$(_ov_api usage /api/v1/analytics/usage 'if (.totalCommands | type) == "number" and (.commandsByType | type) == "object" and all(.commandsByType[]; type == "number")
        then "Total commands: \(.totalCommands)\(if .periodStart then " (since \(.periodStart | c | .[0:10]))" else "" end)",
            (.commandsByType | to_entries | sort_by(-.value, .key) | (.[:10][] | "  \(.key | c): \(.value)"), (if length > 10 then "  (\(length - 10) more command types)" else empty end))
        else error("not the usage fields") end' "$_OV_JS_USAGE" 2>/dev/null) && printf '%s\n' "$o" || echo "Usage: unavailable right now"
}

_OV_JS_WORKFLOWS='const w=h(o,"workflows");
    if (w===null||typeof w!=="object") throw 0;
    return (Array.isArray(w)?w:Object.values(w)).map(x=>c(h(x,"name"))+" "+(h(x,"customized")===true?"CUSTOM":"DEFAULT"));'
_ov_cmd_workflows() {
    _ov_api workflows /api/v1/workflows '.workflows[] | "\(.name | c) \(if .customized == true then "CUSTOM" else "DEFAULT" end)"' "$_OV_JS_WORKFLOWS"
}

# workflow: the name from workflow.txt (the read rule; argv is never used), its plain editor config.
_OV_JS_WORKFLOW='const f={}; for (const k of ["name","chain","agents","parallel_agents","task_loop","quality_gates","on_pass","checkpoint"]) f[k]=h(o,k);
    return [JSON.stringify(cl(f),null,2)];'
_ov_cmd_workflow() {
    _ov_dir && _ov_get workflow \
    || { echo "oss-value: workflow: refused (workflow.txt missing, unsafe or not a valid workflow name)" >&2; return 1; }
    _ov_api workflow "/api/v1/workflows/$_OV_VAL/editor" '{name, chain, agents, parallel_agents, task_loop, quality_gates, on_pass, checkpoint} | cl' "$_OV_JS_WORKFLOW"
}

# queue-push (T87): /oss:queue add --shared without Claude handling the key. type.txt, source.txt and prompt.txt
# are each opened checked (_ov_open), copied (at most <max> + 64 bytes) into a private folder in the value folder
# and deleted, valid or not; then checked (_ov_qp_check), sent as one JSON body built by jq from those files (never
# on a command line) to POST /api/v1/queue (the route's createSchema: type, source, prompt) with the key on curl's
# stdin, and the copies removed. Prints only the new item's id, cleaned (oss_json_field) and held to an id's
# charset, or one Error: line on stderr and rc 1.
_ov_qp_max() { case $1 in type) echo 16 ;; source) echo 2000 ;; prompt) echo 20000 ;; esac; }   # bytes, each file
# <name> <line|text>: the copy of <name>.txt -> _OV_VAL (trailing line breaks dropped), or its Error: line. line: one
# line, no tab or control character; text: line breaks and tabs only. C0, DEL and C1 (UTF-8 C2 80-9F) are refused.
_ov_qp_check() {
    local f="$_OV_QT/$1" e="Error: $1.txt" m; m=$(_ov_qp_max "$1")
    local keep='\012\040-\176\200-\377' bad="must be one line of text, with no tab or control character"
    [[ $2 == text ]] && keep="\011$keep" bad="has a control character (only line breaks and tabs are allowed)"
    [[ -f "$f" ]] || { echo "$e is missing or not a plain file in the value folder (write it to the folder ~/.oss/hooks/oss-value.sh dir prints)" >&2; return 1; }
    (( $(wc -c < "$f") <= m + 64 )) || { echo "$e is over $m bytes" >&2; return 1; }
    (( $(LC_ALL=C tr -d "$keep" < "$f" | wc -c) == 0 )) && ! LC_ALL=C grep -q $'\xc2[\x80-\x9f]' "$f" || { echo "$e $bad" >&2; return 1; }
    _OV_VAL=$(cat "$f")
    [[ -n "$_OV_VAL" ]] || { echo "$e is empty" >&2; return 1; }
    (( $(printf '%s' "$_OV_VAL" | wc -c) <= m )) || { echo "$e is over $m bytes" >&2; return 1; }
    [[ $2 == text || "$_OV_VAL" != *$'\n'* ]] || { echo "$e $bad" >&2; return 1; }
}
_ov_qp_send() {
    local n m r rc code id
    for n in type source prompt; do
        m=$(( $(_ov_qp_max "$n") + 65 ))   # a value file's read bound (not an API body: those go through oss_capped)
        _ov_open "$n.txt" && head -c "$m" <&3 > "$_OV_QT/$n"; { exec 3<&-; } 2>/dev/null
    done
    rm -f "$_OV_DIR/type.txt" "$_OV_DIR/source.txt" "$_OV_DIR/prompt.txt"
    _ov_qp_check type line && case "$_OV_VAL" in feature|issue|review) ;; *) echo "Error: type.txt must be exactly feature, issue or review" >&2; false ;; esac \
    && _ov_qp_check source line && _ov_qp_check prompt text || return 1
    command -v jq >/dev/null || { echo "Error: /oss:queue --shared needs jq, which is not installed. Install jq (brew install jq) or ask your admin" >&2; return 1; }
    source "$_OV_HERE/oss-api-curl.sh" 2>/dev/null || { echo "Error: oss-api-curl.sh is missing; restart Claude Code to reinstall the OSS hooks" >&2; return 1; }
    oss_api_creds
    case $OSS_URL_RC in
        0) ;;
        2) echo "Error: $(oss_loopback_refused)" >&2; return 1 ;;
        *) echo "Error: apiUrl in your OSS config is not an https URL. Run: /oss:login" >&2; return 1 ;;
    esac
    [[ -n "$OSS_KEY" ]] || { echo "Error: not logged in to OSS (no API key found). Run: /oss:login" >&2; return 1; }
    jq -n --rawfile t "$_OV_QT/type" --rawfile s "$_OV_QT/source" --rawfile p "$_OV_QT/prompt" \
        '{type: ($t | sub("\n+\\z"; "")), source: ($s | sub("\n+\\z"; "")), prompt: ($p | sub("\n+\\z"; ""))}' > "$_OV_QT/body.json" 2>/dev/null \
    || { echo "Error: could not build the request (jq failed)" >&2; return 1; }
    r=$(oss_capped oss_api_curl "$OSS_KEY" -s -m 15 --max-filesize "$OSS_BODY_MAX" -H 'Content-Type: application/json' \
        --data-binary "@$_OV_QT/body.json" -w '\n%{http_code}' "$OSS_URL/api/v1/queue")
    rc=$?
    (( rc != 63 )) || { echo "Error: the OSS API sent an answer over $OSS_BODY_MAX bytes; run /oss:queue status to check whether the item was queued" >&2; return 1; }
    (( rc == 0 )) || { echo "Error: Couldn't reach the OSS API at $OSS_URL (no connection, or no answer within 15 seconds); check your connection, then run /oss:queue status before trying again" >&2; return 1; }
    code=${r##*$'\n'}
    [[ "$code" == 2?? ]] && id=$(printf '%s' "${r%$'\n'*}" | oss_json_field id 2>/dev/null) \
    && [[ "$id" =~ ^[A-Za-z0-9_-]{1,100}$ ]] && { printf 'Queued: %s\n' "$id"; return 0; }
    case "$code" in
        2??) echo "Error: the OSS API sent an unexpected answer; run /oss:queue status to check whether the item was queued" ;;
        401) echo "Error: the OSS API says your API key is invalid. Run: /oss:login" ;;
        403) echo "Error: your OSS subscription is not active (HTTP 403). Renew at https://www.oneshotship.com/pricing" ;;
        429) echo "Error: the OSS API rate limited this request; try again later" ;;
        404) echo "Error: your account is in no team, and the shared queue needs one (HTTP 404); add the item without --shared to keep it in your own queue" ;;
        *) echo "Error: the OSS API answered HTTP $code; the item was not queued, try again later" ;;
    esac >&2
    return 1
}
_ov_cmd_queue_push() {
    local rc
    _ov_dir && _OV_QT=$(mktemp -d "$_OV_DIR/.queue-push.XXXXXX") \
    || { echo "Error: the value folder is missing or unsafe; run ~/.oss/hooks/oss-value.sh dir, write type.txt, source.txt and prompt.txt there, then run this again" >&2; return 1; }
    _ov_qp_send; rc=$?
    rm -rf "$_OV_QT"
    return $rc
}

_ov_cmd_agent() {
    local o t
    oss_phys_cwd; o="$_OSS_CWD"
    oss_valid_workflow_name "${1:-}" \
    && case "${2:-}" in start) t="starting: delegated task" ;; complete) t="completed: delegated task" ;; *) false ;; esac \
    && _ov_dir && _ov_take agent.txt '^[a-z][a-z0-9:-]{0,60}$' \
    || { echo "oss-value: agent: refused (bad workflow or start|complete, or agent.txt missing, unsafe or not an agent name)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-log.sh" agent "$1" "$_OV_VAL" "$t"
}

# timeline gate (G2 B4a): the six gate value files, each taken (_ov_take: read and deleted, valid or not) and held
# to its rule, then one oss-timeline.sh gate line. Every file is taken before any verdict, so a refusal leaves none.
# Counts: critical, high, medium, low, info (the API's severityCounts), each 0..1000, each at most once, or none.
_OV_COUNTS='^((critical|high|medium|low|info)=(0|[1-9][0-9]{0,2}|1000)( (critical|high|medium|low|info)=(0|[1-9][0-9]{0,2}|1000))*)?$'
_ov_cmd_timeline() {
    local o n re ok=1 v=() k seen
    oss_phys_cwd; o="$_OSS_CWD"
    [[ "${1:-}" == gate || "${1:-}" == merge ]] && _ov_dir \
        || { echo "oss-value: timeline: refused (not timeline gate or merge, or no safe value folder)" >&2; return 1; }
    if [[ $1 == merge ]]; then   # B4b: approval.txt (taken: read and deleted, valid or not), none when there is none
        _OV_VAL=none
        if [[ -e "$_OV_DIR/approval.txt" || -L "$_OV_DIR/approval.txt" ]]; then
            _ov_take approval.txt '^(merge-flag|chat-instruction|none|decision:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$' 600 \
                || { echo "oss-value: timeline merge: refused (approval.txt unsafe, older than 10 minutes or outside its rule)" >&2; return 1; }
        fi
        _ov_walk "$o"
        CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-timeline.sh" merge "$_OV_VAL"
        return
    fi
    for n in round gate verdict findings fixed mode; do
        case $n in
            round) re='^([1-9]|1[0-9]|20)$' ;;
            gate) re='^[a-z0-9-]{1,40}$' ;;   # P-6: a standard gate name or an agent name without its prefix
            verdict) re='^(pass|fail)$' ;;
            findings|fixed) re=$_OV_COUNTS ;;
            mode) re='^(full|quick|no-checks|team)$' ;;
        esac
        _ov_take "$n.txt" "$re" 600 || ok=0
        v+=("$_OV_VAL")
    done
    for n in "${v[3]}" "${v[4]}"; do   # no severity named twice
        seen=" "
        for k in $n; do k=${k%%=*}; [[ "$seen" == *" $k "* ]] && ok=0; seen="$seen$k "; done
    done
    (( ok )) || { echo "oss-value: timeline gate: refused (a value file missing, unsafe, older than 10 minutes or outside its rule)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-timeline.sh" gate "${v[@]}"
}

_ov_cmd_failed() {
    local o r
    oss_phys_cwd; o="$_OSS_CWD"
    oss_valid_workflow_name "${1:-}" && _ov_dir && _ov_read_value reason.txt && r="$_OV_VAL" \
    || { echo "oss-value: failed: refused (bad workflow name, or reason.txt missing or unsafe)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" "$_OV_HERE/oss-notify.sh" --workflow "$1" failed "$(printf '{"reason": "%s", "blocker": "%s"}' "$r" "$r")" \
    && rm -f "$_OV_DIR/reason.txt"
}

# The plugin root named by ~/.oss/plugin-root (not a link, owned, absolute, one line, a folder)
# -> _OV_ROOT. The one place the plugin root is checked: error and root use it.
_ov_root() {
    _OV_ROOT=""; local r
    _ov_safe "$HOME/.oss/plugin-root" && r=$(cat "$HOME/.oss/plugin-root" 2>/dev/null) && case "$r" in /*) ;; *) false ;; esac \
    && test "$(printf '%s' "$r" | wc -l)" -eq 0 && test -d "$r" && _OV_ROOT=$r
}

_ov_cmd_root() {
    _ov_root && printf '%s\n' "$_OV_ROOT" \
    || { echo "oss-value: root: refused (~/.oss/plugin-root missing, a link, not absolute, not one line or not a folder)" >&2; return 1; }
}

_ov_cmd_error() {
    local o R m h e c s y k a x
    oss_phys_cwd; o="$_OSS_CWD"
    case "${1:-}" in cmd:*) ;; *) false ;; esac && oss_valid_workflow_name "${1#cmd:}" \
    && _ov_root && R=$_OV_ROOT && test -f "$R/watcher/dist/cli/oss-error.js" \
    && _ov_dir && _ov_read_value message.txt && m="$_OV_VAL" && _ov_read_value hint.txt && h="$_OV_VAL" \
    && _ov_open error.txt && e=$(LC_ALL=C tr -c 'A-Za-z0-9-' ' ' <&3 | cut -c1-120) && exec 3<&- \
    && read -r c s y k a x <<< "$e" && test -z "$x" \
    && case "$c" in OSS-API-001|OSS-API-002|OSS-API-003|OSS-AUTH-001|OSS-AUTH-002|OSS-AUTH-003|OSS-CONFIG-001|OSS-CONFIG-002|OSS-GIT-001|OSS-GIT-002|OSS-GIT-003|OSS-TDD-001|OSS-TDD-002|OSS-TDD-003|OSS-WORKFLOW-001|OSS-WORKFLOW-002|OSS-WORKFLOW-901|OSS-WORKFLOW-902) ;; *) false ;; esac \
    && case "$s" in CRITICAL|HIGH|MEDIUM|LOW) ;; *) false ;; esac && case "$y" in true|false) ;; *) false ;; esac \
    && case "$k" in cheap|expensive) ;; *) false ;; esac && case "$a" in ''|*[!0-9]*) false ;; esac \
    || { echo "oss-value: error: refused (bad source, plugin root, value file or error.txt field)" >&2; return 1; }
    _ov_walk "$o"
    CLAUDE_PROJECT_DIR="$_OV_PROJ" node "$R/watcher/dist/cli/oss-error.js" --code "$c" --severity "$s" --message "$m" --source "$1" \
        --retry-eligible "$y" --retry-cost "$k" --retry-hint "$h" --attempt "$a" \
    && rm -f "$_OV_DIR/message.txt" "$_OV_DIR/hint.txt" "$_OV_DIR/error.txt"
}

[[ "${BASH_SOURCE[0]}" == "$0" ]] || return 0   # sourced (oss-login.sh): the functions only, no verb
case "${1:-}" in
    dir) _ov_cmd_dir ;;
    error) _ov_cmd_error "${2:-}" ;;
    failed) _ov_cmd_failed "${2:-}" ;;
    read) _ov_cmd_read "${2:-}" ;;
    agent) _ov_cmd_agent "${2:-}" "${3:-}" ;;
    root) _ov_cmd_root ;;
    decrypt) shift; _ov_cmd_decrypt "$@" ;;
    models-set) _ov_cmd_models_set ;;
    cli) shift; _ov_cmd_cli "$@" ;;
    status) _ov_cmd_status ;;
    usage) _ov_cmd_usage ;;
    workflows) _ov_cmd_workflows ;;
    workflow) _ov_cmd_workflow ;;
    queue-push) _ov_cmd_queue_push ;;
    timeline) _ov_cmd_timeline "${2:-}" ;;
    *) _ov_usage ;;
esac
