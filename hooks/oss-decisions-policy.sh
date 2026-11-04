#!/bin/bash
# oss-decisions-policy.sh status|on|off - the switches for the decision push (/oss:settings decisions).
# off always turns the push off for this person on this machine (decisionsPush in ~/.oss/settings.json, read by
# the decision record hook before any network call), and for the team too when the API lets them (owner or
# admin); on reverses both; status shows both. Prints ONE plain line for the person.

case "$#:${1:-}" in 1:status | 1:on | 1:off) ;; *) echo "Usage: /oss:settings decisions off|on|status"; exit 2 ;; esac
sub=$1
command -v jq >/dev/null 2>&1 || { echo "jq is needed for this; install it and try again"; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=hooks/oss-api-curl.sh
source "$SCRIPT_DIR/oss-api-curl.sh"
# shellcheck source=hooks/oss-safe-path.sh
source "$SCRIPT_DIR/oss-safe-path.sh" # oss_single_link, for the off marker (Task 16al)
done_line="Decision push is now $sub for you on this machine"
if [[ "$sub" == status ]]; then
    rf="$HOME/.oss/decisions-refusal.json"
    # T67: only a regular file is read (a FIFO would hang status); anything else shows no note
    at=""; oss_is_regular "$rf" && at=$(jq -r 'select(.reason == "unsafe_path") | .at | strings' "$rf" 2>/dev/null)
    [[ "$at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
        && echo "Decision record: an answer was last refused at $at, because .oss, its feature folder or the record file is a symlink; it was not recorded or sent"
fi
# the personal switch first: it needs no account, no team and no network
if [[ "$sub" != status ]]; then
    want=false; [[ "$sub" == on ]] && want=true
    # Task 16c: done only when the switch reads back as asked (off, and off for that reason; or on). Task 16al: off
    # writes the off marker first; on removes it only once settings.json says true. CR-R6-F2: a failure says how the
    # switch really reads now, and "nothing changed" only when nothing did
    marked=""
    if [[ "$want" == false ]]; then
        oss_push_off_write && marked=1 && oss_settings_set decisionsPush false && oss_decisions_push_off && [[ -z "$_OSS_SETTINGS_UNREADABLE" ]]
    else
        oss_settings_set decisionsPush true && rm -f "$(oss_push_off_marker)" && ! oss_decisions_push_off
    fi || {
        # T70b: say why settings.json cannot be written when it is no regular file, and how to fix it
        why=$(oss_settings_why); why=${why:+, because $why}
        # shellcheck disable=SC2088
        if [[ -n "$marked" ]] && oss_decisions_push_off; then
            echo "Decision push is off on this machine (kept in ~/.oss/decisions-push-off); ~/.oss/settings.json could not be updated$why"
        elif [[ "$want" == true ]] && oss_decisions_push_off; then
            echo "Decision push is still off on this machine; it could not be turned on$why"
        else
            echo "Could not save your setting in ~/.oss/settings.json; nothing changed$why"
        fi
        exit 1
    }
fi
# team_unknown <reason>: the team's setting could not be read or changed; the personal one stands
team_unknown() {
    if [[ "$sub" == status ]]; then echo "$1"; else echo "$done_line; your team's setting is unchanged. $1"; fi
    exit 1
}
# the key and the URL from ONE read of the config (oss_api_creds, T37); plain http to a local API needs the opt-in (T20)
oss_api_creds; key=$OSS_KEY url=$OSS_URL
[[ -n "$key" ]] || team_unknown "Run /oss:login first"
[[ "$OSS_URL_RC" == 2 ]] && team_unknown "$(oss_loopback_refused)"
[[ -n "$url" ]] || team_unknown "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"
# the body and the response live in a private folder under ~/.oss/run, removed on exit (as the decision
# record hook keeps them); a linked or foreign ~/.oss/run could put them anywhere, so it means no request
tmp=""
trap '[[ -n "$tmp" ]] && rm -rf "$tmp"' EXIT
# shellcheck disable=SC2088 # the ~ is text for the person, never expanded
tmp=$(oss_private_run_dir decisions-policy) || case $? in
    1) team_unknown "~/.oss/run is a symlink or not yours: remove it and try again" ;;
    *) team_unknown "Could not make a private folder in ~/.oss/run" ;;
esac
put=()
if [[ "$sub" != status ]]; then
    (umask 077; printf '{"pushEnabled":%s}\n' "$want" > "$tmp/body")
    put=(-X PUT -H 'Content-Type: application/json' --data-binary @"$tmp/body")
fi
# the answer is read only up to OSS_BODY_MAX bytes (oss_capped, T74c): over it, no answer (code "", resp empty)
r=$(oss_capped oss_api_curl "$key" -s --max-time 10 --max-filesize "$OSS_BODY_MAX" -w '\n%{http_code}' ${put[@]+"${put[@]}"} "$url/api/v1/decisions/policy")
printf '%s' "${r%$'\n'*}" > "$tmp/resp"; code=${r##*$'\n'}
[[ "$code" == 401 ]] && team_unknown "OSS refused your key; run /oss:login again"
# a member: their own switch changed, the team's cannot (owner or admin only); that is an answer, not an error
[[ "$code" == 403 && "$sub" != status ]] \
    && { echo "$done_line; your team's setting is unchanged (only a team owner or admin can change it)"; exit 0; }
team=""
if [[ "$code" == 404 && $(oss_json_field error < "$tmp/resp") == no_team ]]; then
    team=none
else
    # only a 200 holding a boolean pushEnabled is an answer
    state=$(jq -r '.pushEnabled | booleans' "$tmp/resp" 2>/dev/null)
    [[ "$code" == 200 && ( "$state" == true || "$state" == false ) ]] || team_unknown "Could not reach OSS"
    team=off; [[ "$state" == true ]] && team=on
    # the GET says whether you are in a team; an older API that does not say leaves it unknown (no team claim)
    if [[ "$sub" == status ]]; then
        member=$(jq -r '.team | booleans' "$tmp/resp" 2>/dev/null)
        [[ "$member" == false ]] && team=none
        [[ -z "$member" && "$team" == on ]] && team=unknown
    fi
fi
if [[ "$sub" != status ]]; then
    if [[ "$team" == none ]]; then echo "$done_line (you are not in a team)"; else echo "$done_line and $team for your team"; fi
elif oss_decisions_push_off; then
    case "$team" in none) other="; you are not in a team" ;; unknown) other="" ;; *) other="; your team's setting is $team" ;; esac
    why=""
    # shellcheck disable=SC2088 # the ~ is text for the person, never expanded
    [[ -n "$_OSS_SETTINGS_UNREADABLE" ]] && why=", because ~/.oss/settings.json could not be read"
    echo "Decision push: off for you on this machine$why (answers stay in your repo only)$other"
elif [[ "$team" == unknown ]]; then
    echo "Decision push: on for you on this machine (answers are sent redacted to OSS)"
elif [[ "$team" == on ]]; then
    echo "Decision push: on for you on this machine and on for your team (answers are sent redacted to OSS)"
elif [[ "$team" == off ]]; then
    echo "Decision push: on for you on this machine but off for your team (answers stay in your repo only)"
else
    echo "Decision push: on for you on this machine; you are not in a team (answers are sent redacted to your own OSS account)"
fi
exit 0
