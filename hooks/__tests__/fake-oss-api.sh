#!/bin/bash
# fake-oss-api.sh - a stand-in for the OSS API, as a `curl` first on PATH. Source it; don't run it.
#
#   fake_api_install "$D"         # makes $D/bin/curl and its state folder $D/api
#   PATH="$D/bin:$PATH" ...       # every curl call is answered by the fake
#
# It answers per URL from a scripted queue, one line per call, "<status> <body>":
#   $D/api/queue.policy      GET  .../api/v1/decisions/policy  (empty queue: 200 {"pushEnabled":true,"team":false})
#                            (the real GET answers 200 for everyone, "team" saying whether the caller is in one;
#                            only the PUT answers 404 no_team)
#   $D/api/queue.decisions   POST .../api/v1/decisions         (empty queue: 201 with a fake account)
#   $D/api/queue.timeline    POST .../api/v1/timeline          (empty queue: 201 with a fake account)
# A status of 000 is an unreachable API: curl prints 000 for -w and exits 7, as real curl does.
# It writes the -w code to stdout and the body to the -o file (or stdout), like real curl (a \n in -w is a newline).
#
# It records, for call N: $D/api/calls (one "<queue> <url>" line per call), argv.N (its argv),
# config.N (what it read from `--config -`), and for `--data-binary @file`: body.N (the file's content AT
# CALL TIME), bodypath.N (where it was) and mode.N (its permission bits). With FAKE_SNAP set to a file, the
# first call copies that file to $D/api/snap (what the file held before any network call). With FAKE_SNAP_EACH
# set to a file, every call N copies it to $D/api/each.N (what it held when request N went out).
# Every POST body is also appended, as one line, to $D/api/bodies (safe when two hooks call at once).
# FAKE_DELAY_DECISIONS=<s>: each POST to .../api/v1/decisions takes that long to answer.
# FAKE_ON_CALL=<script>: run as `<script> N` at the start of call N (to change files while a hook is mid-run).
# FAKE_ACCOUNT_FPS="<fp> ...": the key fingerprints of the caller's account, as the real POST checks them (Task
# 16w): a POST whose body has a keyFp not in the list answers 409 account_mismatch (no queue line is used); one
# with no keyFp, or with no FAKE_ACCOUNT_FPS set, answers from the queue as before.
# FAKE_OFF_BEFORE="<ISO time>": the team's re-enable cutoff, as the real POST checks it (Task 16aa): a POST whose
# body has an answeredAt earlier than it answers 409 answered_while_off (no queue line is used).

fake_api_install() {
    mkdir -p "$1/bin" "$1/api"
    cat > "$1/bin/curl" << 'SHIM'
#!/bin/bash
A="$(cd "$(dirname "$0")/../api" && pwd)"
n=1; [[ -f "$A/calls" ]] && n=$(($(wc -l < "$A/calls") + 1))
[[ $n -eq 1 && -n "${FAKE_SNAP:-}" ]] && { cat "$FAKE_SNAP" > "$A/snap" 2>/dev/null || : > "$A/snap"; }
printf '%s\n' "$*" > "$A/argv.$n"
[[ -n "${FAKE_ON_CALL:-}" ]] && "$FAKE_ON_CALL" "$n"
[[ -n "${FAKE_SNAP_EACH:-}" ]] && { cat "$FAKE_SNAP_EACH" > "$A/each.$n" 2>/dev/null || : > "$A/each.$n"; }
out="" fmt="" url="" body="" prev=""
for a in "$@"; do
    case "$prev" in
        --config | -K) [[ "$a" == - ]] && cat > "$A/config.$n" ;;
        -o) out=$a ;;
        -w) fmt=$a ;;
        --data-binary) body=${a#@} ;;
    esac
    case "$a" in http://* | https://*) url=$a ;; esac
    prev=$a
done
if [[ -n "$body" ]]; then
    cp "$body" "$A/body.$n"; printf '%s\n' "$body" > "$A/bodypath.$n"
    stat -c %a "$body" > "$A/mode.$n" 2>/dev/null || stat -f %Lp "$body" > "$A/mode.$n"
    printf '%s\n' "$(tr -d '\n' < "$body")" >> "$A/bodies"
fi
case "$url" in
    */api/v1/decisions/policy) q=policy; dflt='200 {"pushEnabled":true,"team":false}' ;;
    */api/v1/decisions) q=decisions; sleep "${FAKE_DELAY_DECISIONS:-0}"; dflt='201 {"account":{"id":"acct-fake-1","email":"dev@example.invalid"}}' ;;
    */api/v1/timeline) q=timeline; dflt='201 {"account":{"id":"acct-fake-1"}}' ;;
    *) q=other; dflt='404 {"error":"not_found"}' ;;
esac
printf '%s %s\n' "$q" "$url" >> "$A/calls"
line=""
if [[ "$q" == decisions && -n "${FAKE_ACCOUNT_FPS:-}" && -n "$body" ]]; then
    kfp=$(jq -r '.keyFp | strings' "$body" 2>/dev/null)
    [[ -n "$kfp" && " $FAKE_ACCOUNT_FPS " != *" $kfp "* ]] && line='409 {"error":"account_mismatch"}'
fi
if [[ -z "$line" && "$q" == decisions && -n "${FAKE_OFF_BEFORE:-}" && -n "$body" ]]; then
    jq -e --arg c "$FAKE_OFF_BEFORE" '.answeredAt < $c' "$body" > /dev/null 2>&1 && line='409 {"error":"answered_while_off"}'
fi
if [[ -z "$line" && -s "$A/queue.$q" ]]; then
    line=$(head -n 1 "$A/queue.$q"); tail -n +2 "$A/queue.$q" > "$A/queue.$q.t"; mv "$A/queue.$q.t" "$A/queue.$q"
fi
[[ -n "$line" ]] || line=$dflt
code=${line%% *}; resp=${line#* }
if [[ "$code" == 000 ]]; then [[ -n "$fmt" ]] && printf '%b' "${fmt//%\{http_code\}/000}"; exit 7; fi
if [[ -n "$out" ]]; then printf '%s' "$resp" > "$out"; else printf '%s' "$resp"; fi
[[ -n "$fmt" ]] && printf '%b' "${fmt//%\{http_code\}/$code}"
exit 0
SHIM
    chmod +x "$1/bin/curl"
}
