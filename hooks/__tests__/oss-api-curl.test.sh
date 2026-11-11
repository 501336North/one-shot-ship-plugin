#!/bin/bash
# Tests for hooks/oss-api-curl.sh - the one place hooks hand the API key to curl.
#
# @behavior Every hook that calls the OSS API authenticates without the API key ever
#           appearing in a process command line (visible to every local user via `ps`).
# @business-rule The key is passed to curl on stdin (`curl --config -`), never in argv.
#           One shared helper answers "how do we send the key", so no hook can drift
#           back to `-H "Authorization: Bearer $KEY"` (IRON LAW #1b provenance).
#
# Usage: ./hooks/__tests__/oss-api-curl.test.sh

set -uo pipefail
# The hooks read the API key and URL from $OSS_CONFIG_DIR/config.json: a developer's exported
# override must not lead them to the real key and the real API (T19).
unset OSS_CONFIG_DIR OSS_MANIFEST_URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$HOOKS_DIR/oss-api-curl.sh"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; echo "  Expected: $2"; echo "  Got: $3"; ((TESTS_FAILED++)); }

FAKE_KEY='fake-key-feedfacecafe0042'

setup() { # T/home with config, T/bin/curl shim recording argv + --config stdin
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/bin" "$T/shim"
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    cat > "$T/bin/curl" << SHIM
#!/bin/bash
S="$T/shim"
printf '%s\n' "\$*" >> "\$S/argv"
prev=""
for a in "\$@"; do
    if [[ ( "\$prev" == "--config" || "\$prev" == "-K" ) && "\$a" == "-" ]]; then cat >> "\$S/stdin"; fi
    prev="\$a"
done
printf '# IRON LAWS\nbody\n\n200'
SHIM
    chmod +x "$T/bin/curl"
}
teardown() { rm -rf "$T"; }

key_in_argv() { grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && echo y || echo n; }
key_in_cfg()  { grep -qF "Authorization: Bearer $FAKE_KEY" "$T/shim/stdin" 2>/dev/null && echo y || echo n; }

# --- the helper itself ---------------------------------------------------------------------
test_helper_key_on_stdin() {
    local name="helper: key goes to curl's --config stdin, never argv; other args pass through"; ((TESTS_RUN++)); setup
    local out
    out=$(PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/x' _ "$HELPER" "$FAKE_KEY" 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y && "$(cat "$T/shim/argv" 2>/dev/null)" == *"https://example.invalid/x"* && "$out" == *"IRON LAWS"* ]]; then pass "$name"
    else fail "$name" "argv=n config=y url passed, stdout returned" "argv=$(key_in_argv) config=$(key_in_cfg) out=${out//$FAKE_KEY/<KEY>}"; fi
    teardown
}

test_helper_escapes_and_refuses() {
    local name="helper: quotes/backslashes are escaped for curl config; a key with a newline is refused"; ((TESTS_RUN++)); setup
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" 'a"b\c' >/dev/null 2>&1
    local esc=n; grep -qF 'Authorization: Bearer a\"b\\c"' "$T/shim/stdin" 2>/dev/null && esc=y
    rm -f "$T/shim/argv"
    local rc=0
    PATH="$T/bin:$PATH" bash -c 'source "$1"; oss_api_curl "$2" -s https://example.invalid/' _ "$HELPER" $'bad\nkey' >/dev/null 2>&1 || rc=$?
    if [[ "$esc" == y && $rc -ne 0 && ! -f "$T/shim/argv" ]]; then pass "$name"
    else fail "$name" "escaped config line; newline key → non-zero, no curl" "escaped=$esc rc=$rc curl_called=$([[ -f $T/shim/argv ]] && echo y || echo n)"; fi
    teardown
}

# --- every hook site routes through the helper (provenance guard) -----------------------------
test_no_hook_puts_key_in_argv() {
    local name="guard: no tracked hook interpolates a variable into an Authorization: Bearer header"; ((TESTS_RUN++))
    local offenders
    offenders=$(cd "$HOOKS_DIR/.." && git ls-files 'hooks/*.sh' | grep -v '^hooks/__tests__/' | grep -v '^hooks/oss-api-curl.sh$' \
        | xargs grep -nE 'Bearer[[:space:]]+\$' 2>/dev/null)
    if [[ -z "$offenders" ]]; then pass "$name"
    else fail "$name" "no matches" "$offenders"; fi
}

# --- the private folder for bodies and responses -----------------------------------------------
# @behavior A request body (redacted answers, a policy change) and the API's response are written only
#           inside a folder no other local user can read, and never where a symlink points.
# @business-rule One helper answers "where do request files go": a new folder under ~/.oss/run, both 700;
#           a symlinked ~/.oss/run is refused (rc 1), a folder that cannot be made is rc 2.
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
test_private_run_dir() {
    local name="helper: oss_private_run_dir makes a 700 folder under a 700 ~/.oss/run and prints it"; ((TESTS_RUN++)); setup
    local out rc
    out=$(HOME="$T/home" bash -c 'source "$1"; oss_private_run_dir probe' _ "$HELPER" 2>&1); rc=$?
    if [[ $rc -eq 0 && "$out" == "$T/home/.oss/run/probe."* && -d "$out" && ! -L "$out" \
        && "$(mode_of "$out")" == 700 && "$(mode_of "$T/home/.oss/run")" == 700 ]]; then pass "$name"
    else fail "$name" "rc 0, a 700 folder in a 700 $T/home/.oss/run" "rc=$rc out=$out"; fi
    teardown
}
test_private_run_dir_refuses() {
    local name="helper: oss_private_run_dir refuses a symlinked ~/.oss/run (1) and an unmakeable one (2)"; ((TESTS_RUN++)); setup
    local rc1 rc2 out1 out2
    mkdir -p "$T/elsewhere"
    ln -s "$T/elsewhere" "$T/home/.oss/run"
    out1=$(HOME="$T/home" bash -c 'source "$1"; oss_private_run_dir probe' _ "$HELPER" 2>/dev/null); rc1=$?
    rm "$T/home/.oss/run"
    : > "$T/home/.oss/run" # a file where the folder should be: mkdir fails
    out2=$(HOME="$T/home" bash -c 'source "$1"; oss_private_run_dir probe' _ "$HELPER" 2>/dev/null); rc2=$?
    if [[ $rc1 -eq 1 && -z "$out1" && -z "$(ls -A "$T/elsewhere")" && $rc2 -eq 2 && -z "$out2" ]]; then pass "$name"
    else fail "$name" "link: rc 1, nothing made; unmakeable: rc 2" "rc1=$rc1 out1=$out1 elsewhere=$(ls -A "$T/elsewhere") rc2=$rc2 out2=$out2"; fi
    teardown
}

test_private_run_dir_not_yours() {
    # Task 15k: a ~/.oss/run owned by someone else (here root's own run folder, reached through a ~/.oss that
    # points at its parent) could hand the bodies to that owner: refused (1), nothing made
    local name="helper: oss_private_run_dir refuses a ~/.oss/run that is not the user's (1)"; ((TESTS_RUN++)); setup
    local parent="" out rc
    if [[ -d /private/var/run && ! -L /private/var/run ]]; then parent=/private/var; elif [[ -d /run && ! -L /run ]]; then parent=/; fi
    rm -rf "$T/home/.oss"; ln -s "$parent" "$T/home/.oss"
    out=$(HOME="$T/home" bash -c 'source "$1"; oss_private_run_dir probe' _ "$HELPER" 2>/dev/null); rc=$?
    if [[ -n "$parent" && ! -O "$parent/run" && $rc -eq 1 && -z "$out" ]]; then pass "$name"
    else fail "$name" "rc 1, nothing printed" "parent=$parent rc=$rc out=$out"; fi
    teardown
}
test_private_run_dir_tightens() {
    # Task 15k: a ~/.oss/run made earlier with a looser mode is made 700 again
    local name="helper: oss_private_run_dir makes an existing 755 ~/.oss/run 700"; ((TESTS_RUN++)); setup
    local out rc
    mkdir -m 755 "$T/home/.oss/run"
    out=$(HOME="$T/home" bash -c 'source "$1"; oss_private_run_dir probe' _ "$HELPER" 2>/dev/null); rc=$?
    if [[ $rc -eq 0 && -d "$out" && "$(mode_of "$T/home/.oss/run")" == 700 ]]; then pass "$name"
    else fail "$name" "rc 0, ~/.oss/run 700" "rc=$rc mode=$(mode_of "$T/home/.oss/run")"; fi
    teardown
}

# --- behavioural, per site --------------------------------------------------------------------
check_site() { # $1 label, then the command to run under the temp HOME/PATH
    local label="$1"; shift
    local name="site: $label sends the key via the helper (not argv)"; ((TESTS_RUN++)); setup
    (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" OSS_SKIP_HEALTH_CHECK='' run_capped 30 "$@" </dev/null >/dev/null 2>&1)
    if [[ "$(key_in_argv)" == n && "$(key_in_cfg)" == y ]]; then pass "$name"
    else fail "$name" "argv=n config=y" "argv=$(key_in_argv) config=$(key_in_cfg) calls=$(wc -l < "$T/shim/argv" 2>/dev/null || echo 0)"; fi
    teardown
}
test_settings_set_not_yours() {
    # Task 16u: oss_settings_set applies the one settings.json rule (oss_settings_mergeable): a file that is
    # not the user's (simulated through `test -O`, the repo's other-user seam) is refused, byte-identical
    local name="helper: oss_settings_set refuses a settings.json that is not the user's, leaving it byte-identical"; ((TESTS_RUN++)); setup
    local f="$T/home/.oss/settings.json" before rc
    printf '{"decisionsPush":true}\n' > "$f"; before=$(cat "$f")
    OSS_T_FOREIGN="$f" HOME="$T/home" bash -c 'test() { if [[ "${1:-}" == -O && "${2:-}" == "$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
        source "$1"; oss_settings_set decisionsPush false' _ "$HELPER" 2>/dev/null; rc=$?
    if [[ $rc -eq 1 && "$(cat "$f")" == "$before" ]]; then pass "$name"
    else fail "$name" "rc 1, file unchanged" "rc=$rc file=$(cat "$f")"; fi
    teardown
}
test_settings_set_private() {
    # Task 16ac: settings.json holds provider apiKeys, so every writer leaves it 600 (owner only), whatever mode
    # it had; a 644 file from an older login is made private, and every other setting is kept
    local name="helper: oss_settings_set leaves a 644 settings.json at 600, every other setting kept"; ((TESTS_RUN++)); setup
    local f="$T/home/.oss/settings.json" rc
    printf '{"apiKeys":{"openrouter":"sk-or-x"},"decisionsPush":true}\n' > "$f"; chmod 644 "$f"
    HOME="$T/home" bash -c 'source "$1"; oss_settings_set decisionsPush false' _ "$HELPER" 2>/dev/null; rc=$?
    if [[ $rc -eq 0 && "$(mode_of "$f")" == 600 && "$(jq -c . "$f")" == '{"apiKeys":{"openrouter":"sk-or-x"},"decisionsPush":false}' ]]; then pass "$name"
    else fail "$name" "rc 0, mode 600, apiKeys kept" "rc=$rc mode=$(mode_of "$f") file=$(cat "$f")"; fi
    teardown
}
# --- Task 16ad: every settings.json writer takes one lock, ~/.oss/locks/settings ---------------------
# @behavior A person turns the decision push off while another OSS writer is saving settings.json; their off
#           switch is never lost, because no writer reads, merges and renames while another one is doing so.
# @business-rule One mkdir lock (~/.oss/locks/settings, its folder 700 and never a link) around read-merge-rename;
#           a writer that cannot take it in time refuses and writes nothing (never unlocked); a lock older than
#           30 s is stale and taken over; a lock path that is a link or not a folder is refused.
settings_lock_case() { # -> f (settings.json with apiKeys + decisionsPush true), L (the lock path), before
    f="$T/home/.oss/settings.json"; L="$T/home/.oss/locks/settings"
    printf '{"apiKeys":{"openrouter":"sk-or-x"},"decisionsPush":true}\n' > "$f"; chmod 600 "$f"; before=$(cat "$f")
    mkdir -p -m 700 "$T/home/.oss/locks"
}
set_off() { HOME="$T/home" OSS_SETTINGS_LOCK_WAIT=1 bash -c 'source "$1"; oss_settings_set decisionsPush false' _ "$HELPER" 2>/dev/null; }
test_settings_lock_held() {
    local name="helper: oss_settings_set waits for a held settings lock, then refuses, the file byte-identical"; ((TESTS_RUN++)); setup
    local f L before rc t0 waited
    settings_lock_case; mkdir "$L"
    t0=$(date +%s); set_off; rc=$?; waited=$(($(date +%s) - t0))
    if [[ $rc -ne 0 && "$(cat "$f")" == "$before" && -d "$L" && $waited -ge 1 && -z "$(ls -A "$T/home/.oss" | grep '^\.settings')" ]]; then pass "$name"
    else fail "$name" "rc!=0, unchanged, lock kept, waited >=1 s" "rc=$rc waited=$waited file=$(cat "$f") lock=$([[ -d $L ]] && echo y || echo n)"; fi
    teardown
}
test_settings_lock_released() {
    local name="helper: oss_settings_set takes the settings lock and removes it after the write"; ((TESTS_RUN++)); setup
    local f L before rc
    settings_lock_case; set_off; rc=$?
    if [[ $rc -eq 0 && "$(jq -r .decisionsPush "$f")" == false && ! -e "$L" && "$(mode_of "$T/home/.oss/locks")" == 700 ]]; then pass "$name"
    else fail "$name" "rc 0, off written, no lock left, locks 700" "rc=$rc file=$(cat "$f") lock=$(ls -d "$L" 2>&1) locks=$(mode_of "$T/home/.oss/locks")"; fi
    teardown
}
test_settings_lock_stale() {
    local name="helper: a settings lock older than 30 s is taken over and the write lands"; ((TESTS_RUN++)); setup
    local f L before rc
    settings_lock_case; mkdir "$L"; touch -t "$(date -v-2M +%Y%m%d%H%M.%S 2>/dev/null || date -d '-2 min' +%Y%m%d%H%M.%S)" "$L"
    set_off; rc=$?
    if [[ $rc -eq 0 && "$(jq -r .decisionsPush "$f")" == false && "$(jq -r .apiKeys.openrouter "$f")" == sk-or-x && ! -e "$L" ]]; then pass "$name"
    else fail "$name" "rc 0, off written, stale lock gone" "rc=$rc file=$(cat "$f") lock=$(ls -ld "$L" 2>&1)"; fi
    teardown
}
# --- Task 16ag: a stale takeover never removes the lock another writer took over first ------------------
# @behavior Two writers find the same stale settings lock; the first takes it over and holds a fresh one; the
#           second must not remove that fresh lock, or both write at once and a decisionsPush:false is lost.
# @business-rule A stale lock is removed only if it is still that very lock (inode + mtime), through a guard
#           folder named after it (one taker per stale lock); otherwise the writer waits, then refuses.
test_settings_lock_takeover_race() {
    local name="helper: a stale settings lock replaced by another writer's fresh lock mid-takeover is left alone, nothing written"; ((TESTS_RUN++)); setup
    local f L before rc fresh
    settings_lock_case; mkdir "$L"; touch -t "$(date -v-2M +%Y%m%d%H%M.%S 2>/dev/null || date -d '-2 min' +%Y%m%d%H%M.%S)" "$L"
    # seam: right after this writer first reads the stale lock's identity, another writer takes it over
    # (removes it and makes its own, fresh) - the window between the identity read and the removal
    HOME="$T/home" OSS_SETTINGS_LOCK_WAIT=1 bash -c '
        source "$1"; D=$2
        stat() {
            command stat "$@"; local r=$?
            if [[ $r -eq 0 && ! -e "$D.swapped" ]]; then
                : > "$D.swapped"; rmdir "$D/locks/settings" && mkdir "$D/locks/settings" \
                    && { command stat -c %i "$D/locks/settings" 2>/dev/null || command stat -f %i "$D/locks/settings"; } > "$D.fresh"
            fi
            return $r
        }
        oss_settings_set decisionsPush false' _ "$HELPER" "$T/home/.oss" 2>/dev/null; rc=$?
    fresh=$(cat "$T/home/.oss.fresh" 2>/dev/null)
    if [[ $rc -ne 0 && "$(cat "$f")" == "$before" && -d "$L" && -n "$fresh" && "$(stat -c %i "$L" 2>/dev/null || stat -f %i "$L")" == "$fresh" ]]; then pass "$name"
    else fail "$name" "rc!=0, file unchanged, the other writer's fresh lock kept" "rc=$rc file=$(cat "$f") fresh=$fresh lock=$(ls -ldi "$L" 2>&1)"; fi
    teardown
}
# --- Task 16ak: only the holder releases the settings lock --------------------------------------------
# @behavior A writer that held the settings lock so long that another writer took it over must not, on its way
#           out, remove the new holder's lock: a third writer would then write alongside the second one and a
#           decisionsPush:false could be lost.
# @business-rule A lock is released only while it is still the very lock this writer made (oss_lock_id,
#           recorded right after its own mkdir); a lock someone else made is left in place.
test_settings_lock_release_only_own() {
    local name="helper: a settings holder whose lock was taken over leaves the new holder's lock in place on exit"; ((TESTS_RUN++)); setup
    local f L before rc fresh
    settings_lock_case
    # seam: while this writer holds the lock, another writer replaces it with its own fresh lock (made before the
    # old one is removed, so it cannot reuse the old inode)
    HOME="$T/home" OSS_SETTINGS_LOCK_WAIT=1 bash -c '
        source "$1"; L=$2
        oss_settings_locked bash -c '\''mv "$1" "$1.old" && mkdir "$1" && rmdir "$1.old" \
            && { stat -c %i "$1" 2>/dev/null || stat -f %i "$1"; } > "$1.fresh"'\'' _ "$L"' _ "$HELPER" "$L" 2>/dev/null; rc=$?
    fresh=$(cat "$L.fresh" 2>/dev/null)
    if [[ $rc -eq 0 && -d "$L" && -n "$fresh" && "$(stat -c %i "$L" 2>/dev/null || stat -f %i "$L")" == "$fresh" ]]; then pass "$name"
    else fail "$name" "rc 0, the new holder's lock kept" "rc=$rc fresh=$fresh lock=$(ls -ldi "$L" 2>&1)"; fi
    teardown
}
test_settings_lock_not_a_folder() {
    local name="helper: a settings lock that is a link or a file, or a linked ~/.oss/locks, is refused, nothing written"; ((TESTS_RUN++)); setup
    local f L before rc got="" kind O t0 took
    for kind in link file locks-link; do
        settings_lock_case; O=$(mktemp -d "$T/outside.XXXXXX")
        case $kind in
            link) ln -s "$O" "$L" ;;
            file) : > "$L" ;;
            locks-link) rm -rf "$T/home/.oss/locks"; ln -s "$O" "$T/home/.oss/locks" ;;
        esac
        # refused at once, not after waiting out the lock (a 5 s wait, answered in under 3 s)
        t0=$(date +%s)
        HOME="$T/home" OSS_SETTINGS_LOCK_WAIT=5 bash -c 'source "$1"; oss_settings_set decisionsPush false' _ "$HELPER" 2>/dev/null; rc=$?
        took=$(($(date +%s) - t0))
        [[ $rc -ne 0 && $took -lt 3 && "$(cat "$f")" == "$before" && -z "$(ls -A "$O")" ]] || got="$got $kind:rc=$rc,took=${took}s,file=$(cat "$f"),outside=$(ls -A "$O" | tr '\n' ' ')"
        rm -rf "$L" "$T/home/.oss/locks"
    done
    if [[ -z "$got" ]]; then pass "$name"; else fail "$name" "each refused, file unchanged, nothing outside" "$got"; fi
    teardown
}
# --- Task 70c: every settings.json writer follows a link (user: "Follow the link everywhere", "owner-only") ---
# @behavior A person whose dotfiles manager links ~/.oss/settings.json saves a setting; the linked file gets it,
#           the links stay links, and the file ends owner-only (600) like a plain settings.json.
# @business-rule oss_settings_update writes the file the link leads to (at most 8 links): a new file is renamed
#           over it in its own folder (never half-written), always 600; a link to nothing, a loop or a link to
#           something that is not a plain file is refused, nothing written, never a hang.
upd() { HOME="$T/home" run_capped 20 bash -c 'source "$1"; shift; oss_settings_update "$@"' _ "$HELPER" "$@" 2>/dev/null; }
ino_of() { stat -c %i "$1" 2>/dev/null || stat -f %i "$1"; }
test_settings_update_follows_link() {
    local name="helper: oss_settings_update writes through a two-hop link: content, a new file, links kept, 600, no temp"
    ((TESTS_RUN++)); setup
    local D="$T/dotfiles" f="$T/home/.oss/settings.json" ino0 rc
    mkdir -p "$D"; printf '{"apiKeys":{"openrouter":"sk-or-x"}}\n' > "$D/settings.json"; chmod 640 "$D/settings.json"
    ln -s settings.json "$D/hop"; ln -s "$D/hop" "$f"; ino0=$(ino_of "$D/settings.json")
    upd --arg v 1 '.x = $v'; rc=$?
    if [[ $rc -eq 0 && "$(jq -c . "$D/settings.json")" == '{"apiKeys":{"openrouter":"sk-or-x"},"x":"1"}' \
        && "$(ino_of "$D/settings.json")" != "$ino0" && -L "$f" && "$(readlink "$f")" == "$D/hop" \
        && "$(readlink "$D/hop")" == settings.json && "$(mode_of "$D/settings.json")" == 600 \
        && "$(ls -A "$D" | tr '\n' ' ')" == "hop settings.json " && "$(ls -A "$T/home/.oss" | tr '\n' ' ')" == "config.json locks settings.json " ]]; then pass "$name"
    else fail "$name" "rc 0, target updated, new inode, links kept, 600, no temp" \
        "rc=$rc file=$(cat "$D/settings.json") mode=$(mode_of "$D/settings.json") dot=$(ls -A "$D" | tr '\n' ' ') oss=$(ls -A "$T/home/.oss" | tr '\n' ' ')"; fi
    teardown
}
test_settings_update_refuses_bad_link() {
    local what f rc
    for what in 'link loop' 'dangling link' 'link to a FIFO' 'link to a folder' 'nine links'; do
        local name="helper: oss_settings_update refuses, writing nothing and never hanging ($what)"
        ((TESTS_RUN++)); setup; f="$T/home/.oss/settings.json"
        case $what in
            'link loop') ln -s "$T/loop" "$f"; ln -s "$f" "$T/loop" ;;
            'dangling link') ln -s "$T/target" "$f" ;;
            'link to a FIFO') mkfifo "$T/target"; ln -s "$T/target" "$f" ;;
            'link to a folder') mkdir "$T/target"; ln -s "$T/target" "$f" ;;
            'nine links') printf '{}\n' > "$T/l9"; for i in 8 7 6 5 4 3 2 1; do ln -s "l$((i + 1))" "$T/l$i"; done; ln -s "$T/l1" "$f" ;;
        esac
        upd '.x = 1'; rc=$?
        if [[ $rc -eq 1 && -L "$f" && -z "$(find "$T" -name '.*settings*' -o -name '.l9.*' -o -name '.target.*' | head -1)" \
            && ( $what != 'nine links' || "$(cat "$T/l9")" == '{}' ) ]]; then pass "$name"
        else fail "$name" "rc 1, nothing written" "rc=$rc left=$(find "$T" -name '.*' | tr '\n' ' ')"; fi
        teardown
    done
}
test_sites() {
    check_site "fetch-iron-laws.sh" bash "$HOOKS_DIR/fetch-iron-laws.sh"
    check_site "oss-fetch-team-iron-laws.sh" bash "$HOOKS_DIR/oss-fetch-team-iron-laws.sh"
    # oss-push-metrics.sh is no longer a site: plugin-main-fixes D2 deleted it (no-metrics-push.test.sh).
}

# T21 (security S3): a config jq cannot parse still yields the key to a grep, so its apiUrl must not fall back
# to the default API: the key meant for the configured (dev) API would go to production. No request at all.
check_unparsable_no_call() { # $1 label, then the command
    local label="$1"; shift
    local name="site: $label makes no request when config.json cannot be parsed"; ((TESTS_RUN++)); setup
    printf '{"apiKey": "%s", "apiUrl": "https://dev.example.invalid",}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" OSS_SKIP_HEALTH_CHECK='' run_capped 30 "$@" </dev/null >/dev/null 2>&1)
    if [[ ! -f "$T/shim/argv" ]]; then pass "$name"
    else fail "$name" "no curl call" "calls=$(wc -l < "$T/shim/argv") argv=$(sed "s/$FAKE_KEY/<KEY>/g" "$T/shim/argv" | head -3)"; fi
    teardown
}
test_unparsable_sites() {
    check_unparsable_no_call "fetch-iron-laws.sh" bash "$HOOKS_DIR/fetch-iron-laws.sh"
    # oss-push-metrics.sh is no longer a site: plugin-main-fixes D2 deleted it (no-metrics-push.test.sh).
}

echo "Running oss-api-curl.sh tests..."
echo "======================================="
test_helper_key_on_stdin
test_helper_escapes_and_refuses
test_no_hook_puts_key_in_argv
test_private_run_dir
test_private_run_dir_refuses
test_private_run_dir_not_yours
test_private_run_dir_tightens
test_settings_set_not_yours
test_settings_set_private
test_settings_lock_held
test_settings_lock_released
test_settings_lock_stale
test_settings_lock_takeover_race
test_settings_lock_not_a_folder
test_settings_lock_release_only_own
test_settings_update_follows_link
test_settings_update_refuses_bad_link
test_sites
test_unparsable_sites
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
