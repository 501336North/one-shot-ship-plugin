#!/bin/bash
# The switches for the decision push: /oss:settings decisions status|on|off.
#
# @behavior A person types /oss:settings decisions off (or on, or status) and reads ONE plain line.
#           off always stops the push for them on this machine, and also for their team when they are
#           its owner or admin; on reverses both. status says both settings truthfully. A member or a
#           person with no team is never refused: they are told their own setting changed and the team's
#           did not. A subcommand it does not know changes nothing.
# @business-rule radical-observability Task 14 (decided 2026-10-29) and Task 15c (decided 2026-10-30): every
#           picker answer is pushed, redacted, to the OSS account by default; each person has a personal
#           switch on their machine; a team opts out through the API, and only its owner or admin may change
#           that. status never tells a person with no team (the GET's "team": false) that their team's
#           setting is on (Task 15n). The key never appears in a process command line, and the request body never outlives the
#           command. The settings file is merged, never overwritten.
#
# The REAL script from this checkout runs against a fake OSS API (fake-oss-api.sh, a curl first on
# PATH), with a sandbox HOME and an obviously fake key.
# Usage: ./hooks/__tests__/oss-decisions-policy.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# The fake API (fake-oss-api.sh) stands at a plain-http loopback apiUrl: that needs the opt-in (T20).
export OSS_ALLOW_HTTP_LOOPBACK=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/hooks/oss-decisions-policy.sh"
# shellcheck source=hooks/__tests__/fake-oss-api.sh
source "$ROOT/hooks/__tests__/fake-oss-api.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-decisions-policy.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
FAKE_KEY='fake-oss-key-0000feedface0042'
H="$T/home"; mkdir -p "$H/.oss"
printf '{"apiKey":"%s","apiUrl":"http://127.0.0.1:9"}\n' "$FAKE_KEY" > "$H/.oss/config.json"
API="$T/api-fake"; fake_api_install "$API"

# reset: a fresh fake API (no calls, empty queues), no ~/.oss/run and no settings.json
reset() { rm -rf "$API/api" "$H/.oss/run" "$H/.oss/settings.json" "$H/.oss/decisions-push-off"; mkdir -p "$API/api"; }
# personal: the personal switch as the settings file holds it ("" when unset)
personal() { jq -r '.decisionsPush | if . == null then "" else tostring end' "$H/.oss/settings.json" 2>/dev/null; }
# answer <line>...: the fake's next answers to .../decisions/policy, one "<status> <body>" per call
answer() { printf '%s\n' "$@" > "$API/api/queue.policy"; }
# policy <args>: the script as /oss:settings runs it -> OUT (stdout), RC
policy() { OUT=$(HOME="$H" PATH="$API/bin:$PATH" "$SCRIPT" "$@" 2>"$T/err" </dev/null); RC=$?; }
calls() { [[ -f "$API/api/calls" ]] && wc -l < "$API/api/calls" | tr -d ' ' || echo 0; }

UNCH="your team's setting is unchanged."
# 1. status says both switches truthfully, and never "on for your team" to a person with no team. The real
#    GET answers 200 for everyone and says whether the caller is in a team ("team"); it never answers 404.
name='should show the personal and the team setting'
ON="Decision push: on for you on this machine"
OFF="Decision push: off for you on this machine (answers stay in your repo only)"
for c in '|200 {"pushEnabled":true,"team":true}|'"$ON"' and on for your team (answers are sent redacted to OSS)' \
         '|200 {"pushEnabled":false,"team":true}|'"$ON"' but off for your team (answers stay in your repo only)' \
         '|200 {"pushEnabled":true,"team":false}|'"$ON"'; you are not in a team (answers are sent redacted to your own OSS account)' \
         'true|200 {"pushEnabled":true,"team":true}|'"$ON"' and on for your team (answers are sent redacted to OSS)' \
         'true|200 {"pushEnabled":true,"team":false}|'"$ON"'; you are not in a team (answers are sent redacted to your own OSS account)' \
         'false|200 {"pushEnabled":true,"team":true}|'"$OFF"'; your team'"'"'s setting is on' \
         'false|200 {"pushEnabled":false,"team":true}|'"$OFF"'; your team'"'"'s setting is off' \
         'false|200 {"pushEnabled":true,"team":false}|'"$OFF"'; you are not in a team' \
         '|200 {"pushEnabled":true}|'"$ON"' (answers are sent redacted to OSS)' \
         'false|200 {"pushEnabled":true}|'"$OFF" \
         '|200 {"pushEnabled":false}|'"$ON"' but off for your team (answers stay in your repo only)'; do
    IFS='|' read -r mine a want <<< "$c"
    reset; [[ -n "$mine" ]] && printf '{"decisionsPush":%s}\n' "$mine" > "$H/.oss/settings.json"
    answer "$a"; policy status
    [[ $RC -eq 0 && "$OUT" == "$want" && "$(calls)" == 1 ]] && ! grep -q -- 'PUT' "$API/api/argv.1" && pass "$name (personal ${mine:-unset}, $a)" \
        || fail "$name (personal ${mine:-unset}, $a)" "rc=$RC out=$OUT calls=$(calls)"
done

# 1b. Task 16c: a settings file that cannot be read as exactly one JSON object means the push is off, and
#     status says why
name='should say the push is off for you because the settings file could not be read'
UNREAD="Decision push: off for you on this machine, because ~/.oss/settings.json could not be read (answers stay in your repo only)"
for c in 'trailing comma|{"decisionsPush":true,}' 'top-level false|false' 'two documents|{"decisionsPush":true}{}' 'mode 000|{"decisionsPush":true}'; do
    IFS='|' read -r what content <<< "$c"
    if [[ $what == 'mode 000' && $(id -u) == 0 ]]; then echo "  (skipped: $what, running as root)"; continue; fi
    reset; printf '%s\n' "$content" > "$H/.oss/settings.json"; [[ $what == 'mode 000' ]] && chmod 000 "$H/.oss/settings.json"
    answer '200 {"pushEnabled":true,"team":true}'; policy status
    chmod 600 "$H/.oss/settings.json"
    [[ $RC -eq 0 && "$OUT" == "$UNREAD; your team's setting is on" ]] && pass "$name ($what)" || fail "$name ($what)" "rc=$RC out=$OUT"
done

# 2. off is one PUT of {"pushEnabled": false}, its body in a file, the key only on curl's config stdin
name='should turn the push off for you and your team with a PUT of {"pushEnabled": false}, with the key never in argv'
reset; answer '200 {"pushEnabled":false}'; policy off
sent=$(jq -c . "$API/api/body.1" 2>/dev/null)
[[ $RC -eq 0 && "$OUT" == "Decision push is now off for you on this machine and off for your team" && "$(personal)" == false && "$(calls)" == 1 && "$sent" == '{"pushEnabled":false}' ]] \
    && grep -q -- '-X PUT' "$API/api/argv.1" && grep -qF 'http://127.0.0.1:9/api/v1/decisions/policy' "$API/api/argv.1" \
    && ! grep -qF "$FAKE_KEY" "$API"/api/argv.* && grep -qF "Authorization: Bearer $FAKE_KEY" "$API/api/config.1" \
    && pass "$name" || fail "$name" "rc=$RC out=$OUT personal=$(personal) calls=$(calls) body=$sent"

# 3. on is the same PUT with true
name='should turn the push back on for you and your team'
reset; printf '{"decisionsPush":false}\n' > "$H/.oss/settings.json"; answer '200 {"pushEnabled":true}'; policy on
sent=$(jq -c . "$API/api/body.1" 2>/dev/null)
[[ $RC -eq 0 && "$OUT" == "Decision push is now on for you on this machine and on for your team" && "$(personal)" == true && "$(calls)" == 1 && "$sent" == '{"pushEnabled":true}' ]] \
    && grep -q -- '-X PUT' "$API/api/argv.1" && pass "$name" || fail "$name" "rc=$RC out=$OUT personal=$(personal) calls=$(calls) body=$sent"

# 4. a member who is not the owner or an admin: their own switch changes, the team's does not, and they are told
name='should switch a member'"'"'s own push and say the team setting is unchanged on a 403'
for sub in off on; do
    reset; answer '403 {"error":"forbidden"}'; policy "$sub"
    want=false; [[ $sub == on ]] && want=true
    [[ $RC -eq 0 && "$OUT" == "Decision push is now $sub for you on this machine; your team's setting is unchanged (only a team owner or admin can change it)" && "$(personal)" == "$want" ]] \
        && pass "$name ($sub)" || fail "$name ($sub)" "rc=$RC out=$OUT personal=$(personal)"
done

# 5. a person with no team: their own switch is the whole story
name='should switch the push for a person with no team, and say they are not in a team'
for sub in off on; do
    reset; answer '404 {"error":"no_team"}'; policy "$sub"
    want=false; [[ $sub == on ]] && want=true
    [[ $RC -eq 0 && "$OUT" == "Decision push is now $sub for you on this machine (you are not in a team)" && "$(personal)" == "$want" ]] \
        && pass "$name ($sub)" || fail "$name ($sub)" "rc=$RC out=$OUT personal=$(personal)"
done

# 6. not logged in: status asks for a login; off still turns the push off on this machine, and calls nothing
name='should ask for /oss:login when there is no key, call nothing, and still switch the push off on this machine'
cp "$H/.oss/config.json" "$T/config.keep"
for cfg in none '{"apiUrl":"http://127.0.0.1:9"}' '{"apiKey":""}'; do
    for sub in status off; do
        reset
        if [[ "$cfg" == none ]]; then rm -f "$H/.oss/config.json"; else printf '%s\n' "$cfg" > "$H/.oss/config.json"; fi
        policy "$sub"
        if [[ $sub == status ]]; then want="Run /oss:login first" wantp=""; else want="Decision push is now off for you on this machine; $UNCH Run /oss:login first" wantp=false; fi
        [[ $RC -eq 1 && "$OUT" == "$want" && "$(calls)" == 0 && "$(personal)" == "$wantp" ]] && pass "$name ($sub, config: $cfg)" \
            || fail "$name ($sub, config: $cfg)" "rc=$RC out=$OUT calls=$(calls) personal=$(personal)"
    done
done
cp "$T/config.keep" "$H/.oss/config.json"
# a key the API refuses (revoked, rotated) needs a new login, not a retry
name='should ask for a new /oss:login when the API refuses the key (401)'
for sub in status off; do
    reset; answer '401 {"error":"unauthorized"}'; policy "$sub"
    want="OSS refused your key; run /oss:login again"; [[ $sub == off ]] && want="Decision push is now off for you on this machine; $UNCH $want"
    [[ $RC -eq 1 && "$OUT" == "$want" ]] && pass "$name ($sub)" || fail "$name ($sub)" "rc=$RC out=$OUT"
done
# an apiUrl the key may not go to: no call at all, and the person is told what is wrong
name='should refuse an apiUrl the key may not go to, and call nothing'
printf '{"apiKey":"%s","apiUrl":"http://evil.example.invalid"}\n' "$FAKE_KEY" > "$H/.oss/config.json"
reset; policy off
[[ $RC -eq 1 && "$OUT" == "Decision push is now off for you on this machine; $UNCH apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment" \
    && "$(calls)" == 0 && "$(personal)" == false ]] && pass "$name" || fail "$name" "rc=$RC out=$OUT calls=$(calls)"
cp "$T/config.keep" "$H/.oss/config.json"
# T20 (merge of origin/main 91c808e): plain http to a local API without the opt-in is refused, no call, and the
# person is told the switch that allows it (oss_loopback_refused, the same line every other key-sending command prints)
name='should refuse a plain-http local apiUrl without OSS_ALLOW_HTTP_LOOPBACK=1, name the opt-in, and call nothing'
for sub in status off; do
    reset; OSS_ALLOW_HTTP_LOOPBACK='' policy "$sub"
    want="OSS: apiUrl is plain http to a local API, refused; set OSS_ALLOW_HTTP_LOOPBACK=1 to allow it."
    [[ $sub == off ]] && want="Decision push is now off for you on this machine; $UNCH $want"
    [[ $RC -eq 1 && "$OUT" == "$want" && "$(calls)" == 0 ]] && pass "$name ($sub)" || fail "$name ($sub)" "rc=$RC out=$OUT calls=$(calls)"
done
# without jq neither switch can be read or merged, so nothing is flipped blind
name='should ask for jq when it is missing, and change nothing'
NB="$T/nojq-bin"; mkdir -p "$NB"
for t in bash cat cp dirname grep head mkdir mktemp mv rm sed stat tail tr wc chmod; do
    w=$(command -v "$t" 2>/dev/null) && [[ "$w" == /* ]] && ln -s "$w" "$NB/$t"
done
reset; answer '200 {"pushEnabled":false}'
OUT=$(HOME="$H" PATH="$API/bin:$NB" "$NB/bash" "$SCRIPT" off 2>"$T/err" </dev/null); RC=$?
[[ $RC -eq 1 && "$OUT" == "jq is needed for this; install it and try again" && "$(calls)" == 0 && ! -e "$H/.oss/settings.json" ]] && pass "$name" \
    || fail "$name" "rc=$RC out=$OUT calls=$(calls)"

# 7. OSS down, failing, or answering something that is not a policy: never a team setting the API did not
#    confirm (the personal switch, which is local, has still changed)
name='should say the team setting is unchanged when OSS is unreachable or returns 5xx'
for a in '000 x' '500 {"error":"internal"}' '503 <html>busy</html>' '200 <html>not json</html>' '200 {"pushEnabled":"yes"}'; do
    for sub in status off on; do
        reset; answer "$a"; policy "$sub"
        want="Could not reach OSS"; [[ $sub != status ]] && want="Decision push is now $sub for you on this machine; $UNCH $want"
        [[ $RC -eq 1 && "$OUT" == "$want" && "$(calls)" == 1 ]] && pass "$name ($sub, $a)" \
            || fail "$name ($sub, $a)" "rc=$RC out=$OUT calls=$(calls)"
    done
done

# 7b. the settings file is shared with every other OSS setting: merged, never overwritten, never written
#     through a link, and left alone when it is not valid JSON
# Task 16ac: the file holds provider apiKeys, so every writer leaves it 600 (owner only), whatever mode it had
name='should keep every other setting, and leave the file 600, when it saves the personal switch'
reset; printf '{"notifications":{"style":"audio","voice":"Daniel"},"logs":{"maxArchiveCount":3}}\n' > "$H/.oss/settings.json"; chmod 640 "$H/.oss/settings.json"
answer '200 {"pushEnabled":false}'; policy off
got=$(jq -c . "$H/.oss/settings.json" 2>/dev/null); mode=$(stat -c %a "$H/.oss/settings.json" 2>/dev/null || stat -f %Lp "$H/.oss/settings.json")
[[ $RC -eq 0 && "$got" == '{"notifications":{"style":"audio","voice":"Daniel"},"logs":{"maxArchiveCount":3},"decisionsPush":false}' && "$mode" == 600 ]] \
    && pass "$name" || fail "$name" "rc=$RC settings=$got mode=$mode"
reset; answer '200 {"pushEnabled":false}'; policy off
mode=$(stat -c %a "$H/.oss/settings.json" 2>/dev/null || stat -f %Lp "$H/.oss/settings.json")
[[ $RC -eq 0 && "$(jq -c . "$H/.oss/settings.json" 2>/dev/null)" == '{"decisionsPush":false}' && "$mode" == 600 ]] && pass "$name (no file yet: made 600)" \
    || fail "$name (no file yet: made 600)" "rc=$RC settings=$(cat "$H/.oss/settings.json" 2>/dev/null) mode=$mode"
# CR-R6-F2: off has already written the off marker by then, so the push IS off: the person is told so, never
# "nothing changed"
KEPT="Decision push is off on this machine (kept in ~/.oss/decisions-push-off); ~/.oss/settings.json could not be updated"
name='should refuse to save through a linked or unreadable settings file, leave it alone and call nothing'
for kind in link notjson notobject twodocs; do
    reset; O=$(mktemp -d "$T/outside.XXXXXX"); printf '{"x":1}\n' > "$O/s.json"
    case $kind in
        link) ln -s "$O/s.json" "$H/.oss/settings.json" ;;
        notjson) printf 'not json {\n' > "$H/.oss/settings.json" ;;
        notobject) printf '[1]\n' > "$H/.oss/settings.json" ;;
        twodocs) printf '{"x":1}\n{"y":2}\n' > "$H/.oss/settings.json" ;;
    esac
    before=$(cat "$H/.oss/settings.json"); policy off
    [[ $RC -eq 1 && "$OUT" == "$KEPT" && "$(calls)" == 0 \
        && "$(cat "$O/s.json")" == '{"x":1}' && "$(cat "$H/.oss/settings.json")" == "$before" ]] && pass "$name ($kind)" \
        || fail "$name ($kind)" "rc=$RC out=$OUT calls=$(calls) outside=$(cat "$O/s.json")"
    rm -f "$H/.oss/settings.json"
done

# Task 16c: the done line is printed only once the switch reads back as what was asked (a save that did not
# land, here an mv that does nothing, is a failure, and the team is not touched)
name='should fail, and call nothing, when the saved switch does not read back as asked'
STILL="Decision push is still off on this machine; it could not be turned on"
MB="$T/nomv-bin"; mkdir -p "$MB"; printf '#!/bin/bash\nexit 0\n' > "$MB/mv"; chmod +x "$MB/mv"
for sub in off on; do
    reset; was=true; [[ $sub == on ]] && was=false
    printf '{"decisionsPush":%s}\n' "$was" > "$H/.oss/settings.json"; answer '200 {"pushEnabled":true}'
    OUT=$(HOME="$H" PATH="$API/bin:$MB:$PATH" "$SCRIPT" "$sub" 2>"$T/err" </dev/null); RC=$?
    want="Could not save your setting in ~/.oss/settings.json; nothing changed"; [[ $sub == on ]] && want="$STILL"
    [[ $RC -eq 1 && "$OUT" == "$want" && "$(calls)" == 0 && "$(personal)" == "$was" ]] \
        && pass "$name ($sub)" || fail "$name ($sub)" "rc=$RC out=$OUT calls=$(calls) personal=$(personal)"
    rm -f "$H"/.oss/.settings.json.*
done

# Task 16al: the personal off switch also lives in its own single-writer marker, ~/.oss/decisions-push-off, so
# no other settings.json writer (one suspended past the lock's stale limit, renaming an older file over it) can
# turn it back on
# @behavior A person who said "decisions off" stays off whatever another OSS writer later does to settings.json.
# @business-rule off writes the marker (600, through a temp file and a rename, never through a link); on removes
#           it; the switch reads off while the marker path holds anything at all.
MK="$H/.oss/decisions-push-off"
name='should write the off marker (600, a regular file) on off, and stay off when an older settings.json is renamed over'
for older in '{"decisionsPush":true}' '{"notifications":{"style":"none"}}'; do
    reset; answer '200 {"pushEnabled":false}' '200 {"pushEnabled":true,"team":true}'; policy off; rc_off=$RC
    printf '%s\n' "$older" > "$H/.oss/old.json"; mv -f "$H/.oss/old.json" "$H/.oss/settings.json"
    policy status
    [[ $rc_off -eq 0 && -f "$MK" && ! -L "$MK" && "$(stat -c %a "$MK" 2>/dev/null || stat -f %Lp "$MK")" == 600 && $RC -eq 0 \
        && "$OUT" == "$OFF; your team's setting is on" ]] && pass "$name ($older)" \
        || fail "$name ($older)" "rc-off=$rc_off marker=$(ls -l "$MK" 2>&1) rc=$RC out=$OUT"
done
name='should remove the off marker on on, and read on again'
reset; answer '200 {"pushEnabled":false}' '200 {"pushEnabled":true}' '200 {"pushEnabled":true,"team":true}'; policy off; policy on; rc_on=$RC; policy status
[[ $rc_on -eq 0 && ! -e "$MK" && ! -L "$MK" && "$(personal)" == true && "$OUT" == "$ON and on for your team (answers are sent redacted to OSS)" ]] && pass "$name" \
    || fail "$name" "rc-on=$rc_on marker=$(ls -l "$MK" 2>&1) personal=$(personal) out=$OUT"
name='should read off, and write nothing through it, when the off marker is a symlink or not a regular file'
for kind in link dir; do
    reset; O=$(mktemp -d "$T/outside.XXXXXX"); printf 'keep\n' > "$O/target"
    case $kind in link) ln -s "$O/target" "$MK" ;; dir) mkdir "$MK" ;; esac
    printf '{"decisionsPush":true}\n' > "$H/.oss/settings.json"
    answer '200 {"pushEnabled":true,"team":true}'; policy status; st=$OUT
    answer '200 {"pushEnabled":false}'; policy off; rc_off=$RC
    [[ "$st" == "$OFF; your team's setting is on" && $rc_off -ne 0 && "$(cat "$O/target")" == keep ]] && pass "$name ($kind)" \
        || fail "$name ($kind)" "status=$st rc-off=$rc_off target=$(cat "$O/target")"
    rm -rf "$MK"
done
# CR-R6-F2: when a step after the first fails, the person reads the switch as it really is now, and status agrees
# @behavior "decisions off" whose settings.json write fails still turns the push off (the marker holds it), and
#           says so; "decisions on" whose marker cannot be removed says the push is still off.
# @business-rule the line a person reads never contradicts what status then says; "nothing changed" only when
#           nothing did.
name='should say the push is off, never that nothing changed, when off cannot update settings.json'
for kind in unmergeable lock; do
    reset; mkdir -p "$H/.oss/locks"; chmod 700 "$H/.oss/locks"
    case $kind in unmergeable) printf 'not json {\n' > "$H/.oss/settings.json" ;; lock) mkdir -m 700 "$H/.oss/locks/settings" ;; esac
    answer '200 {"pushEnabled":true,"team":true}'; OSS_SETTINGS_LOCK_WAIT=0 policy off; rc_off=$RC; said=$OUT
    rm -rf "$H/.oss/locks/settings" "$H/.oss/settings.json"; policy status
    [[ $rc_off -eq 1 && "$said" == "$KEPT" && "$said" != *'nothing changed'* && "$OUT" == "$OFF; your team's setting is on" ]] \
        && pass "$name ($kind)" || fail "$name ($kind)" "rc-off=$rc_off said=$said status=$OUT"
done
name='should say the push is still off when on cannot remove the off marker'
reset; mkdir "$MK"; : > "$MK/x"; answer '200 {"pushEnabled":true,"team":true}'; policy on; rc_on=$RC; said=$OUT
policy status
[[ $rc_on -eq 1 && "$said" == "$STILL" && "$(personal)" == true && "$OUT" == "$OFF; your team's setting is on" ]] && pass "$name" \
    || fail "$name" "rc-on=$rc_on said=$said personal=$(personal) status=$OUT"
rm -rf "$MK"
name='should show off in status when only the off marker says so'
reset; : > "$MK"; chmod 600 "$MK"; answer '200 {"pushEnabled":true,"team":false}'; policy status
[[ $RC -eq 0 && "$OUT" == "$OFF; you are not in a team" ]] && pass "$name" || fail "$name" "rc=$RC out=$OUT"
rm -f "$MK"

# 8. anything but status, on or off (alone) is a usage error, before any call
name='should refuse an unknown subcommand with exit 2 and call nothing'
for args in '' maybe OFF '--off' 'off on' 'status x'; do
    reset
    # shellcheck disable=SC2086 # the words of each case are the arguments
    policy $args
    [[ $RC -eq 2 && "$OUT" == "Usage: /oss:settings decisions off|on|status" && "$(calls)" == 0 && ! -e "$H/.oss/settings.json" ]] && pass "$name ('$args')" \
        || fail "$name ('$args')" "rc=$RC out=$OUT calls=$(calls)"
done

# 9. the body is made 600 in a private folder under ~/.oss/run, and nothing is left there afterwards,
#    whatever the answer
name='should leave no body file behind'
for a in '200 {"pushEnabled":false}' '403 {"error":"forbidden"}' '000 x'; do
    reset; answer "$a"; policy off
    where=$(cat "$API/api/bodypath.1" 2>/dev/null); mode=$(cat "$API/api/mode.1" 2>/dev/null)
    left=$(find "$H/.oss/run" -mindepth 1 2>/dev/null)
    [[ "$where" == "$H/.oss/run/"?*/* && "$mode" == 600 && -d "$H/.oss/run" && -z "$left" ]] && pass "$name ($a)" \
        || fail "$name ($a)" "rc=$RC body-at=$where mode=$mode left=$left"
done
# a linked ~/.oss/run could put the body anywhere: refused, no call, nothing written through the link
reset; O=$(mktemp -d "$T/outside.XXXXXX"); ln -s "$O" "$H/.oss/run"; policy off
# shellcheck disable=SC2088 # the ~ is the text the person reads
[[ $RC -eq 1 && "$OUT" == "Decision push is now off for you on this machine; your team's setting is unchanged. ~/.oss/run is a symlink or not yours: remove it and try again" && "$(calls)" == 0 && -z "$(ls -A "$O")" ]] \
    && pass "$name (a symlinked ~/.oss/run: refused)" \
    || fail "$name (a symlinked ~/.oss/run: refused)" "rc=$RC out=$OUT calls=$(calls) outside=$(ls -A "$O" | tr '\n' ' ')"
rm -f "$H/.oss/run"
# no private folder can be made (~/.oss not writable): no request, and nothing written in the wrong place
reset; chmod 500 "$H/.oss"; policy status; chmod 700 "$H/.oss"
[[ $RC -eq 1 && "$OUT" == "Could not make a private folder in ~/.oss/run" && "$(calls)" == 0 ]] \
    && pass "$name (no private folder: no request)" || fail "$name (no private folder: no request)" "rc=$RC out=$OUT calls=$(calls)"
# and off cannot save the personal switch there either: nothing changed, nothing sent
reset; chmod 500 "$H/.oss"; policy off; chmod 700 "$H/.oss"
[[ $RC -eq 1 && "$OUT" == "Could not save your setting in ~/.oss/settings.json; nothing changed" && "$(calls)" == 0 ]] \
    && pass "$name (~/.oss not writable: off changes nothing)" || fail "$name (~/.oss not writable: off changes nothing)" "rc=$RC out=$OUT calls=$(calls)"

# 10. the docs a person reads before trusting OSS say what leaves the machine and how to stop it
name='README should say picker answers are sent, redacted and capped, and how to turn that off'
section=$(awk '/^## Does my code leave my machine\?/{on=1; next} on && /^## /{exit} on' "$ROOT/README.md")
missing=""
for w in '/oss:settings decisions off' redacted capped 'never code' 'owner or admin' BYOCCA 'on this machine' \
         'given while the push is off are never sent' 'cannot be read'; do
    [[ "$section" == *"$w"* ]] || missing+="'$w' "
done
[[ -z "$missing" ]] && pass "$name" || fail "$name" "the section lacks: $missing"
name='settings.md help should name the decisions subcommand and run this script'
S="$ROOT/commands/settings.md"
help_block=$(awk '/^## Step 0/{on=1} on && /^## Implementation/{exit} on' "$S")
usage=$(awk '/^## Help/{on=1} on && /^# \/oss:settings/{exit} on' "$S")
missing=""
# a markdown table cell escapes its pipes
[[ "$usage" == *'| `decisions off\|on\|status` |'* ]] || missing+="usage-table "
for w in '/oss:settings decisions off' '/oss:settings decisions on' '/oss:settings decisions status' 'DECISION RECORD' redacted capped 'owner or admin' 'on this machine' \
         'given while the push is off are never sent' 'cannot be read'; do
    [[ "$help_block" == *"$w"* ]] || missing+="help:'$w' "
done
# Task 15d: the person's word picks one of three literal commands; typed text never reaches Bash
step=$(awk '/^## Step 0.5/{on=1; next} on && /^## /{exit} on' "$S")
for c in off on status; do
    grep -qxF "~/.oss/hooks/oss-decisions-policy.sh $c" <<< "$step" || missing+="literal-$c "
done
[[ "$step" == *'Usage: /oss:settings decisions off|on|status'* ]] || missing+="usage-line-for-anything-else "
[[ "$step" != *'as typed'* && "$step" != *'# or:'* ]] || missing+="still-passes-typed-text "
# shellcheck disable=SC2088 # the literal path the command tells Claude to run
grep -qF '~/.oss/hooks/oss-decisions-policy.sh' "$S" || missing+="the-script-call "
[[ -z "$missing" ]] && pass "$name" || fail "$name" "missing: $missing"

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
