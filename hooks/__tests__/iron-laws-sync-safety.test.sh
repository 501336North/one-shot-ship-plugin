#!/bin/bash
# Safety tests for oss-iron-laws-sync.sh (ship gate round 1, R1-R6).
#
# The sync runs at EVERY Claude Code session start in customer projects, so a defect here
# rewrites customer files. Each test drives the real script in a temp HOME + temp project
# with a curl shim on PATH (no network), and asserts on files and the shim's recorded argv.
#
# @behavior Session start may only refresh an existing, well-formed IRON LAWS block in the
#           project's own CLAUDE.md; --install (from /oss:login) may create or append one block.
# @business-rule The sync never damages, duplicates, or redirects writes from a user's file,
#           never stores a bad API response, never blocks session start, and never puts the
#           API key on a command line.
#
# Usage: ./hooks/__tests__/iron-laws-sync-safety.test.sh

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/run-capped.sh"   # the one time cap a test may use (T49)
# HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
HOOK_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/oss-iron-laws-sync.sh"
source "$SCRIPT_DIR/lib/warm-stub.sh"
# oss-decrypt --verify-body is a stub that hashes its stdin against the fixture servedHash (R-273 D12). Warmed
# once here; each sandbox HOME links to it, and VB holds its record (verify.stdin, verify.calls) and the fixture.
source "$SCRIPT_DIR/lib/verify-body-stub.sh"
VB=$(mktemp -d); VB=$(cd "$VB" && pwd -P)
trap 'rm -rf "$VB"' EXIT
verify_body_stub "$VB/bin/oss-decrypt" "$VB" || echo "oss-decrypt stub did not warm" >&2
old_decrypt_stub "$VB/old/oss-decrypt" "$VB" || echo "old oss-decrypt stub did not warm" >&2
SPLIT_FIXTURE="$SCRIPT_DIR/fixtures/iron-laws-split"

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; ((TESTS_PASSED++)); }
fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

START='<!-- IRON LAWS START - Do not edit manually, updated by /oss:login -->'
END='<!-- IRON LAWS END -->'
FAKE_KEY='fake-key-0123456789abcdef'

# --- fixture --------------------------------------------------------------------------------
# T/home   HOME with .oss/config.json
# T/proj   CLAUDE_PROJECT_DIR
# T/bin    curl shim
# T/shim   shim control: body (the laws: the ?split=1 reply's base), team (its team part), raw (served as is,
#          instead of the JSON reply), pin (the fixture servedHash is already set: don't derive it from body),
#          code, sleep; records argv (one line per call) and stdin
# T/home/.oss/bin/oss-decrypt  the verifying stub (VB)
setup() {
    T=$(mktemp -d)
    T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/bin" "$T/proj" "$T/bin" "$T/shim"
    ln -s "$VB/bin/oss-decrypt" "$T/home/.oss/bin/oss-decrypt"
    rm -f "$VB/verify.stdin" "$VB/verify.calls" "$VB/verify.exit" "$VB/served-hashes"
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    # Warmed, so the macOS first-exec scan of the new file is not inside the sync's timed call.
    warm_stub "$T/bin/curl" "$(cat << SHIM
S="$T/shim"
printf '%s\n' "\$*" >> "\$S/argv"
prev=""
for a in "\$@"; do
    if [[ ( "\$prev" == "--config" || "\$prev" == "-K" ) && "\$a" == "-" ]]; then cat >> "\$S/stdin"; fi
    prev="\$a"
done
[[ -f "\$S/sleep" ]] && sleep "\$(cat "\$S/sleep")"
[[ -f "\$S/reply" ]] && cat "\$S/reply"
printf '\n%s\n' "\$(cat "\$S/code" 2>/dev/null || echo 200)"
exit 0
SHIM
)" || echo "setup: curl shim did not warm" >&2
    valid_body > "$T/shim/body"
    prep_reply
}
teardown() { rm -rf "$T"; }

# prep_reply: what the shim serves, made here (the shim may run on a PATH without jq): the ?split=1 JSON
# {base: body[, team: team]}, or raw as is. Unless pinned, the fixture manifest signs exactly body.
prep_reply() {
    local S="$T/shim"
    if [[ -f "$S/raw" ]]; then cp "$S/raw" "$S/reply"
    elif [[ -f "$S/team" ]]; then jq -n --rawfile b "$S/body" --rawfile t "$S/team" '{base: $b, team: $t}' > "$S/reply"
    else jq -n --rawfile b "$S/body" '{base: $b}' > "$S/reply"; fi
    [[ -f "$S/pin" ]] || served_hash "$VB" shared/iron-laws "$S/body"
}

# A realistic laws body: a heading, "IRON LAW", and well over 500 bytes.
valid_body() {
    printf '# IRON LAWS - FRESH FROM API\n\n## IRON LAW #1: TDD\n\nNo production code without a failing test first.\n'
    local i
    for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
        printf 'Rule line %s: write the failing test, watch it fail, then write minimal code.\n' "$i"
    done
}

block_file() { # a CLAUDE.md with user content around one well-formed block
    printf '%s\n' "# My Project" "" "User rules above." "" "$START" "# OLD IRON LAWS" "$END" "" "User rules below." > "$1"
}

stale() { touch -t 202601010000 "$T/home/.oss/.iron-laws-last-check"; rm -f "$T/home/.oss/.iron-laws-backoff"; }

# run_sync [args...]  -> sets RC, OUT, ERR; project dir defaults to T/proj
run_sync() {
    local proj="${PROJ:-$T/proj}"
    prep_reply
    RC=0
    (cd "$T" && OSS_ALLOW_HTTP_LOOPBACK=1 HOME="$T/home" OSS_CONFIG_DIR="${CFG_DIR:-}" CLAUDE_PROJECT_DIR="$proj" PATH="$T/bin:$PATH" \
        run_capped 30 bash "$HOOK_SCRIPT" "$@" </dev/null >"$T/out" 2>"$T/err") || RC=$?
    OUT=$(cat "$T/out"); ERR=$(cat "$T/err")
}
curl_calls() { [[ -f "$T/shim/argv" ]] && wc -l < "$T/shim/argv" | tr -d ' ' || echo 0; }
count_line() { grep -cxF -- "$1" "$2" 2>/dev/null || true; }
sum() { cksum < "$1"; }

# =============================================================================================
# R1 Session-start safety model
# =============================================================================================
test_refresh_never_creates() {
    local name="R1: session start (no flag) never creates CLAUDE.md"; ((TESTS_RUN++)); setup
    run_sync
    if [[ ! -e "$T/proj/CLAUDE.md" && "$(curl_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "no CLAUDE.md, no curl call" "exists=$([[ -e $T/proj/CLAUDE.md ]] && echo y || echo n) curl_calls=$(curl_calls)"; fi
    teardown
}

test_refresh_never_appends() {
    local name="R1: session start leaves a CLAUDE.md without markers byte-identical"; ((TESTS_RUN++)); setup
    printf '# Mine\n\nNo laws here.\n' > "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md")
    run_sync
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" && "$(curl_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "unchanged, no curl call" "changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) curl_calls=$(curl_calls)"; fi
    teardown
}

test_install_creates() {
    local name="R1: --install creates CLAUDE.md with exactly one block"; ((TESTS_RUN++)); setup
    run_sync --install
    local s e; s=$(count_line "$START" "$T/proj/CLAUDE.md"); e=$(count_line "$END" "$T/proj/CLAUDE.md")
    if [[ $RC -eq 0 && "$s" == "1" && "$e" == "1" ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "exit 0, 1 START, 1 END, fresh body" "rc=$RC start=$s end=$e err=$ERR"; fi
    teardown
}

test_install_appends_once() {
    local name="R1: --install appends one block and keeps the user's content"; ((TESTS_RUN++)); setup
    printf '# Mine\n\nKeep me.\n' > "$T/proj/CLAUDE.md"
    run_sync --install
    local s; s=$(count_line "$START" "$T/proj/CLAUDE.md")
    if [[ "$s" == "1" ]] && grep -q "Keep me." "$T/proj/CLAUDE.md" && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "1 block + original content" "start=$s"; fi
    teardown
}

# $1 = label, $2 = how to make the link (run inside T/proj), $3 = path of the target to watch
check_symlink_refused() {
    local label="$1" mk="$2" target="$3" mode
    for mode in refresh install; do
        local name="R1: symlinked CLAUDE.md ($label, $mode) → target untouched, no write"; ((TESTS_RUN++)); setup
        local tgt="${target//@T@/$T}"
        if [[ "$label" != dangling ]]; then
            if [[ $mode == refresh ]]; then block_file "$tgt"; else printf '# victim\n' > "$tgt"; fi
        fi
        local before="absent"; [[ -e "$tgt" ]] && before=$(sum "$tgt")
        (cd "$T/proj" && eval "${mk//@T@/$T}")
        stale
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        local after="absent"; [[ -e "$tgt" ]] && after=$(sum "$tgt")
        if [[ "$after" == "$before" && -L "$T/proj/CLAUDE.md" && "$(curl_calls)" == "0" ]]; then pass "$name"
        else fail "$name" "target unchanged, link intact, no curl" "target_changed=$([[ $after == "$before" ]] && echo n || echo y) link=$([[ -L $T/proj/CLAUDE.md ]] && echo y || echo n) curl=$(curl_calls)"; fi
        teardown
    done
}
test_symlinks_refused() {
    check_symlink_refused absolute 'ln -s "@T@/victim.md" CLAUDE.md' '@T@/victim.md'
    check_symlink_refused relative 'ln -s ../victim.md CLAUDE.md' '@T@/victim.md'
    check_symlink_refused dangling 'ln -s "@T@/created-by-sync.md" CLAUDE.md' '@T@/created-by-sync.md'
}

test_not_regular_file_refused() {
    local name="R1: CLAUDE.md that is a directory → no write"; ((TESTS_RUN++)); setup
    mkdir "$T/proj/CLAUDE.md"
    run_sync --install
    if [[ -d "$T/proj/CLAUDE.md" && -z "$(ls -A "$T/proj/CLAUDE.md")" && "$(curl_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "exit 0, dir untouched, no curl" "rc=$RC curl=$(curl_calls)"; fi
    teardown
}

test_home_refused() {
    local name="R1: CLAUDE_PROJECT_DIR = \$HOME is refused (no ~/CLAUDE.md written)"; ((TESTS_RUN++)); setup
    PROJ="$T/home" run_sync --install
    if [[ ! -e "$T/home/CLAUDE.md" && "$(curl_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "no ~/CLAUDE.md, no curl" "exists=$([[ -e $T/home/CLAUDE.md ]] && echo y || echo n) curl=$(curl_calls)"; fi
    teardown
}

test_parent_symlink_to_home_refused() {
    local name="R1: project dir that is a symlink resolving to \$HOME is refused"; ((TESTS_RUN++)); setup
    ln -s "$T/home" "$T/linkproj"
    block_file "$T/home/CLAUDE.md"; local before; before=$(sum "$T/home/CLAUDE.md"); stale
    PROJ="$T/linkproj" run_sync
    PROJ="$T/linkproj" run_sync --install
    if [[ "$(sum "$T/home/CLAUDE.md")" == "$before" && "$(curl_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "~/CLAUDE.md unchanged, no curl" "changed=$([[ "$(sum "$T/home/CLAUDE.md")" == "$before" ]] && echo n || echo y) curl=$(curl_calls)"; fi
    teardown
}

# =============================================================================================
# R2 Exact markers
# =============================================================================================
test_start_without_end_untouched() {
    local mode
    for mode in refresh install; do
        local name="R2: START without END → byte-identical ($mode)"; ((TESTS_RUN++)); setup
        printf '%s\n' "# Mine" "$START" "# old laws" "## Everything below is user content" "Keep this." > "$T/proj/CLAUDE.md"
        local before; before=$(sum "$T/proj/CLAUDE.md"); stale
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" && -n "$ERR" ]]; then pass "$name"
        else fail "$name" "byte-identical + stderr warning" "changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) err=$ERR"; fi
        teardown
    done
}

test_prose_marker_substring_untouched() {
    local name="R2: prose mentioning 'IRON LAWS START' (no real block) → byte-identical"; ((TESTS_RUN++)); setup
    printf '%s\n' "# Mine" "The sync looks for the IRON LAWS START comment." "Important rule after the prose." > "$T/proj/CLAUDE.md"
    local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    run_sync
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]]; then pass "$name"
    else fail "$name" "byte-identical" "content now: $(head -c 300 "$T/proj/CLAUDE.md")"; fi
    teardown
}

test_prose_plus_block_only_block_changes() {
    local name="R2: prose with a marker substring next to a real block → only the block changes"; ((TESTS_RUN++)); setup
    printf '%s\n' "# Mine" "Note: IRON LAWS START / IRON LAWS END comments are managed." "$START" "# OLD" "$END" "Tail rule." > "$T/proj/CLAUDE.md"
    stale; run_sync
    if grep -qF "Note: IRON LAWS START / IRON LAWS END comments are managed." "$T/proj/CLAUDE.md" \
        && grep -q "Tail rule." "$T/proj/CLAUDE.md" && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md" \
        && ! grep -q "# OLD" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "prose + tail kept, block refreshed" "$(cat "$T/proj/CLAUDE.md" | head -c 400)"; fi
    teardown
}

test_body_with_end_marker_no_growth() {
    local name="R2: API body containing marker lines → no growth over 3 refreshes"; ((TESTS_RUN++)); setup
    { valid_body; printf '%s\n' "$END" "smuggled tail" "$START"; } > "$T/shim/body"
    block_file "$T/proj/CLAUDE.md"
    local sizes="" i
    for i in 1 2 3; do stale; run_sync; sizes+="$(wc -c < "$T/proj/CLAUDE.md" | tr -d ' ') "; done
    local s e; s=$(count_line "$START" "$T/proj/CLAUDE.md"); e=$(count_line "$END" "$T/proj/CLAUDE.md")
    read -r a b c <<< "$sizes"
    if [[ "$a" == "$b" && "$b" == "$c" && "$s" == "1" && "$e" == "1" ]]; then pass "$name"
    else fail "$name" "same size x3, 1 START, 1 END" "sizes=$sizes start=$s end=$e"; fi
    teardown
}

test_two_blocks_untouched() {
    local name="R2: two blocks → byte-identical"; ((TESTS_RUN++)); setup
    printf '%s\n' "# Mine" "$START" "a" "$END" "middle" "$START" "b" "$END" "tail" > "$T/proj/CLAUDE.md"
    local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    run_sync
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]]; then pass "$name"
    else fail "$name" "byte-identical" "changed"; fi
    teardown
}

# =============================================================================================
# R3 Body validation and negative cache
# =============================================================================================
check_rejected_body() { # $1 label, $2 code; body already in T/shim/body
    local label="$1" code="$2"
    local name="R3: $label → block unchanged, stdout empty, not marked fresh, 1h backoff"; ((TESTS_RUN++))
    printf '%s' "$code" > "$T/shim/code"
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    run_sync
    local first_out="$OUT" lc_fresh=n
    [[ -n "$(find "$T/home/.oss/.iron-laws-last-check" -newer "$T/shim/body" 2>/dev/null)" ]] && lc_fresh=y
    run_sync   # within the backoff window: must not call curl again
    local calls; calls=$(curl_calls)
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" && -z "$first_out" && "$lc_fresh" == n && "$calls" == "1" ]]; then pass "$name"
    else fail "$name" "unchanged, no stdout, stamp not fresh, 1 curl call over 2 runs" \
        "changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) stdout_bytes=${#first_out} fresh_stamp=$lc_fresh curl_calls=$calls"; fi
    teardown
}
test_rejected_bodies() {
    setup; : > "$T/shim/body"; check_rejected_body "empty 200" 200
    setup; printf '<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head><body>%s IRON LAW</body></html>\n' "$(head -c 800 /dev/zero | tr '\0' x)" > "$T/shim/body"; check_rejected_body "HTML page served as 200" 200
    setup; printf '<html><body><h1>502 Bad Gateway</h1></body></html>\n' > "$T/shim/body"; check_rejected_body "HTML 502 page" 502
    setup; { valid_body; head -c 16777216 /dev/zero | tr '\0' 'a'; printf '\n'; } > "$T/shim/body"; check_rejected_body "16MB body" 200
    setup; { printf '# Something else\n\n'; head -c 900 /dev/zero | tr '\0' 'z'; printf '\n'; } > "$T/shim/body"; check_rejected_body "body without IRON LAW" 200
    setup; printf '# IRON LAWS\nshort\n' > "$T/shim/body"; check_rejected_body "body under 500 bytes" 200
}

test_markdown_with_angle_placeholders_accepted() {
    local name="R3: real laws with placeholders like '<body explaining WHY>' are not mistaken for HTML"; ((TESTS_RUN++)); setup
    { valid_body; printf '%s\n' '```' '<type>(<scope>): <subject>' '' '<body explaining WHY and impact>' '```'; } > "$T/shim/body"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if grep -qF "<body explaining WHY and impact>" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "block refreshed" "err=$ERR"; fi
    teardown
}

test_valid_write_marks_fresh() {
    local name="R3: a validated write marks the cache fresh and clears the backoff"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; touch -t 202601010000 "$T/home/.oss/.iron-laws-backoff"
    run_sync
    local fresh=n; [[ -n "$(find "$T/home/.oss/.iron-laws-last-check" -newer "$T/shim/body" 2>/dev/null)" ]] && fresh=y
    if grep -q "FRESH FROM API" "$T/proj/CLAUDE.md" && [[ "$fresh" == y && ! -e "$T/home/.oss/.iron-laws-backoff" ]]; then pass "$name"
    else fail "$name" "refreshed, fresh stamp, no backoff" "fresh=$fresh backoff=$([[ -e $T/home/.oss/.iron-laws-backoff ]] && echo y || echo n)"; fi
    teardown
}

test_curl_size_and_time_caps() {
    local name="R3/R4: curl gets --max-filesize 262144, --connect-timeout 2, -m 4"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    local a; a=$(cat "$T/shim/argv" 2>/dev/null)
    if [[ "$a" == *"--max-filesize 262144"* && "$a" == *"--connect-timeout 2"* && ( "$a" == *"-m 4"* || "$a" == *"--max-time 4"* ) ]]; then pass "$name"
    else fail "$name" "caps in argv" "argv=${a//$FAKE_KEY/<KEY>}"; fi
    teardown
}

# =============================================================================================
# R5 apiKey never in argv
# =============================================================================================
test_key_off_argv() {
    local name="R5: API key absent from curl argv, sent via --config on stdin"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    local in_argv=n in_cfg=n in_out=n
    grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && in_argv=y
    grep -qF "Authorization: Bearer $FAKE_KEY" "$T/shim/stdin" 2>/dev/null && in_cfg=y
    [[ "$OUT$ERR" == *"$FAKE_KEY"* ]] && in_out=y
    if [[ "$in_argv" == n && "$in_cfg" == y && "$in_out" == n ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "argv=n config=y printed=n, refreshed" "argv=$in_argv config=$in_cfg printed=$in_out"; fi
    teardown
}

# =============================================================================================
# R6 Robust rewrite
# =============================================================================================
test_dash_lines_kept() {
    local name="R6: user lines '-n' and '-e' survive a refresh"; ((TESTS_RUN++)); setup
    printf '%s\n' "# Mine" "-n" "-e" "$START" "old" "$END" "-n" > "$T/proj/CLAUDE.md"
    stale; run_sync
    local n; n=$(count_line "-n" "$T/proj/CLAUDE.md")
    if [[ "$n" == "2" && "$(count_line "-e" "$T/proj/CLAUDE.md")" == "1" ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "2x '-n', 1x '-e', refreshed" "n=$n e=$(count_line "-e" "$T/proj/CLAUDE.md")"; fi
    teardown
}

test_mode_kept() {
    local name="R6: file mode 0644 kept across a refresh"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; chmod 0644 "$T/proj/CLAUDE.md"; stale; run_sync
    local m; m=$(stat -c %a "$T/proj/CLAUDE.md" 2>/dev/null || stat -f %Lp "$T/proj/CLAUDE.md")
    if [[ "$m" == "644" ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "644, refreshed" "mode=$m"; fi
    teardown
}

test_concurrent_installs_one_block() {
    local name="R6: 3 concurrent --install runs → exactly one block"; ((TESTS_RUN++)); setup
    printf '# Mine\n\nKeep me.\n' > "$T/proj/CLAUDE.md"
    printf '0.5' > "$T/shim/sleep"
    local i pids=()
    for i in 1 2 3; do
        (cd "$T" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/proj" PATH="$T/bin:$PATH" \
            run_capped 30 bash "$HOOK_SCRIPT" --install </dev/null >/dev/null 2>&1) & pids+=($!)
    done
    wait "${pids[@]}"
    local s e; s=$(count_line "$START" "$T/proj/CLAUDE.md"); e=$(count_line "$END" "$T/proj/CLAUDE.md")
    if [[ "$s" == "1" && "$e" == "1" ]] && grep -q "Keep me." "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "1 START, 1 END, content kept" "start=$s end=$e"; fi
    teardown
}

# The sync waits for a held lock by sleeping between tries. A `sleep` stub first on PATH is the
# handshake: on the first sleep it records whether CLAUDE.md was already written, then releases the
# lock. So "no write while locked" is checked at the moment the sync is known to be waiting, not
# after a fixed delay, and the test then waits for the sync itself to exit. A sync that never waits
# (ignores the lock) never sleeps, so the lock is never released by the stub: that is a failure too.
test_lock_held_blocks_write() {
    local name="R6: a sync holding the lock blocks the write until it is released"; ((TESTS_RUN++)); setup
    mkdir "$T/home/.oss/.iron-laws-sync.lock"
    warm_stub "$T/lockbin/sleep" "$(cat << 'STUB'
if [[ ! -e "$LOCK_PROBE" && -d "$LOCK_HELD" ]]; then
    { [[ -e "$CLAUDE_PROJECT_DIR/CLAUDE.md" ]] && echo y || echo n; } > "$LOCK_PROBE"
    rmdir "$LOCK_HELD"
fi
exec /bin/sleep "$@"
STUB
)" || echo "lock test: sleep stub did not warm" >&2
    (cd "$T" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/proj" PATH="$T/lockbin:$T/bin:$PATH" \
        LOCK_HELD="$T/home/.oss/.iron-laws-sync.lock" LOCK_PROBE="$T/lock-probe" \
        run_capped 30 bash "$HOOK_SCRIPT" --install </dev/null >/dev/null 2>&1)
    local early; early=$(cat "$T/lock-probe" 2>/dev/null || echo never-waited)
    local later=n; [[ "$(count_line "$START" "$T/proj/CLAUDE.md")" == "1" ]] && later=y
    if [[ "$early" == n && "$later" == y && ! -e "$T/home/.oss/.iron-laws-sync.lock" ]]; then pass "$name"
    else fail "$name" "waited with no write while locked, one block after release, lock removed" "written_while_locked=$early block_after=$later"; fi
    teardown
}

test_stale_lock_cleared() {
    local name="R6: a stale lock (>30s, crashed sync) is cleared and the write proceeds"; ((TESTS_RUN++)); setup
    mkdir "$T/home/.oss/.iron-laws-sync.lock"; touch -t 202601010000 "$T/home/.oss/.iron-laws-sync.lock"
    run_sync --install
    if [[ "$(count_line "$START" "$T/proj/CLAUDE.md")" == "1" && ! -e "$T/home/.oss/.iron-laws-sync.lock" ]]; then pass "$name"
    else fail "$name" "one block, lock gone" "rc=$RC err=$ERR"; fi
    teardown
}

test_json_config_parsed() {
    local name="R6: config.json parsed as JSON (spaces, newlines, escapes)"; ((TESTS_RUN++)); setup
    printf '{\n  "apiUrl" : "https://example.invalid",\n  "apiKey"   :   "abc\\/def\\u0041-%s"\n}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if grep -qF "Authorization: Bearer abc/defA-$FAKE_KEY" "$T/shim/stdin" 2>/dev/null; then pass "$name"
    else fail "$name" "decoded key 'abc/defA-…' in curl config" "stdin=$(sed "s/$FAKE_KEY/<KEY>/" "$T/shim/stdin" 2>/dev/null | head -3)"; fi
    teardown
}

# =============================================================================================
# S1 Legacy marker (ship gate round 2)
# /oss:ideate wrote "<!-- IRON LAWS START -->" + the END line from 2026-02-27 (#146) to 03-18 (#161).
# =============================================================================================
LEGACY_START='<!-- IRON LAWS START -->'

test_legacy_block_canonicalised() {
    local mode
    for mode in refresh install; do
        local name="S1: legacy START marker ($mode) → one canonical block, user content kept"; ((TESTS_RUN++)); setup
        printf '%s\n' "# My Project" "Above." "$LEGACY_START" "# OLD IRON LAWS" "$END" "Below." > "$T/proj/CLAUDE.md"
        stale
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        local f="$T/proj/CLAUDE.md" s l e
        s=$(count_line "$START" "$f"); l=$(count_line "$LEGACY_START" "$f"); e=$(count_line "$END" "$f")
        if [[ $RC -eq 0 && "$s" == "1" && "$l" == "0" && "$e" == "1" ]] && grep -q "FRESH FROM API" "$f" \
            && ! grep -q "# OLD IRON LAWS" "$f" && grep -qx "Above." "$f" && grep -qx "Below." "$f"; then pass "$name"
        else fail "$name" "rc 0, 1 canonical START, 0 legacy, 1 END, fresh body, user lines kept" "rc=$RC start=$s legacy=$l end=$e err=$ERR"; fi
        teardown
    done
}

# =============================================================================================
# S4 CRLF and trailing whitespace on marker lines (ship gate round 2)
# =============================================================================================
count_norm() { tr -d '\r' < "$2" | sed 's/[[:space:]]*$//' | grep -cxF -- "$1" || true; }
all_crlf() { # every line ends in \r\n
    local total crlf; total=$(wc -l < "$1" | tr -d ' '); crlf=$(grep -c $'\r$' "$1" || true)
    [[ "$total" -gt 0 && "$total" == "$crlf" ]]
}

test_crlf_block_refreshed_in_place() {
    local mode
    for mode in refresh install; do
        local name="S4: CRLF CLAUDE.md with one block ($mode) → one block refreshed, still CRLF"; ((TESTS_RUN++)); setup
        printf '%s\r\n' "# Mine" "Above." "$START" "# OLD IRON LAWS" "$END" "Below." > "$T/proj/CLAUDE.md"
        stale
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        local f="$T/proj/CLAUDE.md" s e crlf=n
        s=$(count_norm "$START" "$f"); e=$(count_norm "$END" "$f"); all_crlf "$f" && crlf=y
        if [[ $RC -eq 0 && "$s" == "1" && "$e" == "1" && "$crlf" == y ]] && grep -q "FRESH FROM API" "$f" \
            && ! grep -q "# OLD IRON LAWS" "$f" && grep -q "^Below."$'\r'"$" "$f"; then pass "$name"
        else fail "$name" "rc 0, 1 START, 1 END, every line CRLF, refreshed, user lines kept" "rc=$RC start=$s end=$e crlf=$crlf err=$ERR"; fi
        teardown
    done
}

test_trailing_space_marker_counts() {
    local mode
    for mode in refresh install; do
        local name="S4: marker lines with trailing spaces/tabs ($mode) → treated as the block"; ((TESTS_RUN++)); setup
        printf '%s\n' "# Mine" "$START  " "# OLD IRON LAWS" "$END"$'\t' "Below." > "$T/proj/CLAUDE.md"
        stale
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        local f="$T/proj/CLAUDE.md" s e
        s=$(count_norm "$START" "$f"); e=$(count_norm "$END" "$f")
        if [[ $RC -eq 0 && "$s" == "1" && "$e" == "1" ]] && grep -q "FRESH FROM API" "$f" && ! grep -q "# OLD IRON LAWS" "$f"; then pass "$name"
        else fail "$name" "rc 0, 1 START, 1 END, refreshed" "rc=$RC start=$s end=$e err=$ERR"; fi
        teardown
    done
}

test_crlf_install_appends_crlf() {
    local name="S4: --install on a CRLF CLAUDE.md without a block appends a CRLF block"; ((TESTS_RUN++)); setup
    printf '%s\r\n' "# Mine" "Keep me." > "$T/proj/CLAUDE.md"
    run_sync --install
    local f="$T/proj/CLAUDE.md" crlf=n; all_crlf "$f" && crlf=y
    if [[ $RC -eq 0 && "$(count_norm "$START" "$f")" == "1" && "$crlf" == y ]] && grep -q "FRESH FROM API" "$f"; then pass "$name"
    else fail "$name" "rc 0, one block, every line CRLF" "rc=$RC start=$(count_norm "$START" "$f") crlf=$crlf"; fi
    teardown
}

# =============================================================================================
# S3 config parsing without node, without jq (ship gate round 2; T30: the hook reads the key with
# oss_api_key, the reader oss_api_url uses: jq, else node, else no key). The key is never printed and never in argv.
# =============================================================================================
# hide_tools <names...>: sets HIDDEN_PATH to the system dirs minus those tools (plus T/bin's curl).
hide_tools() {
    local d f b skip h
    mkdir -p "$T/sys"
    for d in /usr/bin /bin /usr/sbin /sbin; do
        for f in "$d"/*; do
            b=${f##*/}; skip=n
            for h in "$@"; do [[ "$b" == "$h" || "$b" == "$h".* || "$b" == "$h"[0-9]* ]] && skip=y; done
            [[ $skip == n && ! -e "$T/sys/$b" ]] && ln -s "$f" "$T/sys/$b"
        done
    done
    HIDDEN_PATH="$T/bin:$T/sys"
}
# The JSON text "fake\"quo\\te-KEY" decodes to fake"quo\te-KEY, which curl's config file
# receives re-escaped as fake\"quo\\te-KEY.
ESC_JSON="fake\\\"quo\\\\te-$FAKE_KEY"
ESC_CURLCFG="Authorization: Bearer fake\\\"quo\\\\te-$FAKE_KEY"
run_hidden() { # like run_sync, with PATH=HIDDEN_PATH
    prep_reply
    RC=0
    (cd "$T" && HOME="$T/home" OSS_CONFIG_DIR="" CLAUDE_PROJECT_DIR="$T/proj" PATH="$HIDDEN_PATH" \
        run_capped 30 bash "$HOOK_SCRIPT" "$@" </dev/null >"$T/out" 2>"$T/err") || RC=$?
    OUT=$(cat "$T/out"); ERR=$(cat "$T/err")
}

test_key_without_node() {
    local name="S3: node absent → jq reads the key (incl. escaped quote and backslash), key never in argv or output"; ((TESTS_RUN++)); setup
    printf '{\n  "apiUrl": "https://example.invalid",\n  "apiKey": "%s"\n}\n' "$ESC_JSON" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale
    hide_tools node python python3
    run_hidden
    local key_in_argv=n printed=n
    grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && key_in_argv=y
    [[ "$OUT$ERR" == *"$FAKE_KEY"* ]] && printed=y
    if grep -qF "$ESC_CURLCFG" "$T/shim/stdin" 2>/dev/null && [[ $key_in_argv == n && $printed == n ]] \
        && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "decoded key in curl config, key not in argv/output" "key_in_argv=$key_in_argv printed=$printed err=${ERR//$FAKE_KEY/<KEY>}"; fi
    teardown
}

test_key_without_jq() {
    local name="S3: jq absent → node reads the key (incl. escaped quote and backslash), key never in argv or output"; ((TESTS_RUN++)); setup
    printf '{\n  "apiUrl" : "https://example.invalid",\n  "apiKey"  :  "%s",\n  "userId": "u1"\n}\n' "$ESC_JSON" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale
    hide_tools jq node python python3; ln -s "$(command -v node)" "$T/sys/node"
    run_hidden
    if grep -qF "$ESC_CURLCFG" "$T/shim/stdin" 2>/dev/null && [[ "$OUT$ERR" != *"$FAKE_KEY"* ]] \
        && ! grep -qF "$FAKE_KEY" "$T/shim/argv" 2>/dev/null && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "decoded key in curl config, key not printed, refreshed" "rc=$RC err=${ERR//$FAKE_KEY/<KEY>} stdin=$(sed "s/$FAKE_KEY/<KEY>/" "$T/shim/stdin" 2>/dev/null | head -2)"; fi
    teardown
}

test_no_reader_fails_closed() {
    local name="S3: neither jq nor node → no key: no curl call, file unchanged"; ((TESTS_RUN++)); setup
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    hide_tools jq node python python3
    run_hidden
    if [[ "$(curl_calls)" == "0" && "$(sum "$T/proj/CLAUDE.md")" == "$before" && "$OUT$ERR" != *"$FAKE_KEY"* ]]; then pass "$name"
    else fail "$name" "no curl, unchanged, key not printed" "curl=$(curl_calls) err=${ERR//$FAKE_KEY/<KEY>}"; fi
    teardown
}

# =============================================================================================
# S2 --install exit codes: /oss:login stops Step 4 on either, with a different message
#    3 = refused, CLAUDE.md is unsafe to write   4 = no valid laws to write (login/API/body)
# =============================================================================================
test_install_refusal_exit_3() {
    local label
    for label in symlink directory home malformed; do
        local name="S2: --install refuses ($label) → exit 3, nothing written"; ((TESTS_RUN++)); setup
        local proj="$T/proj"
        case $label in
            symlink) printf '# victim\n' > "$T/victim.md"; ln -s "$T/victim.md" "$T/proj/CLAUDE.md" ;;
            directory) mkdir "$T/proj/CLAUDE.md" ;;
            home) proj="$T/home" ;;
            malformed) printf '%s\n' "# Mine" "$START" "no end" > "$T/proj/CLAUDE.md" ;;
        esac
        local before="absent"; [[ -f "$proj/CLAUDE.md" ]] && before=$(sum "$proj/CLAUDE.md")
        PROJ="$proj" run_sync --install
        local after="absent"; [[ -f "$proj/CLAUDE.md" ]] && after=$(sum "$proj/CLAUDE.md")
        if [[ $RC -eq 3 && "$after" == "$before" && -n "$ERR" && -z "$OUT" ]]; then pass "$name"
        else fail "$name" "exit 3, unchanged, reason on stderr, no stdout" "rc=$RC changed=$([[ $after == "$before" ]] && echo n || echo y) err=$ERR"; fi
        teardown
    done
}

test_install_no_laws_exit_4() {
    local label
    for label in curl-error http-500 no-key; do
        local name="S2: --install gets no valid laws ($label) → exit 4, nothing written"; ((TESTS_RUN++)); setup
        printf '# Mine\n' > "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md")
        case $label in
            curl-error) printf '#!/bin/bash\nexit 7\n' > "$T/bin/curl" ;;
            http-500) printf '500' > "$T/shim/code" ;;
            no-key) printf '{"userId": "u1"}\n' > "$T/home/.oss/config.json" ;;
        esac
        run_sync --install
        if [[ $RC -eq 4 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -n "$ERR" && -z "$OUT" ]]; then pass "$name"
        else fail "$name" "exit 4, unchanged, reason on stderr, no stdout" "rc=$RC err=$ERR"; fi
        teardown
    done
}

# =============================================================================================
# T4g The key goes only to the configured API, with that config's key
# @behavior The fetch goes to <apiUrl>/api/v1/prompts/shared/iron-laws, apiUrl and apiKey both read
#           from the one OSS config file (OSS_CONFIG_DIR, else ~/.oss); no apiUrl → the default API;
#           an apiUrl the CLI would refuse → no request, nothing written (refresh exits 0, --install 4).
# @business-rule The API key is only ever sent to the API the user configured.
# =============================================================================================
LAWS_PATH="/api/v1/prompts/shared/iron-laws?split=1"   # R-273 D12: base and team apart
sent_key() { grep -qF "Authorization: Bearer $1\"" "$T/shim/stdin" 2>/dev/null; }
argv_line() { tr '\n' '|' < "$T/shim/argv" 2>/dev/null; }

test_api_url_from_config() {
    local name="T4g: apiUrl in the config → the one fetch goes there with the config's key, never to onrender"; ((TESTS_RUN++)); setup
    printf '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9"}' > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if [[ $RC -eq 0 && "$(curl_calls)" == 1 && "$(argv_line)" == *" http://127.0.0.1:9$LAWS_PATH|" && "$(argv_line)" != *onrender* ]] \
        && sent_key fake-key-K && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "1 call to http://127.0.0.1:9$LAWS_PATH with fake-key-K, block refreshed" "rc=$RC calls=$(curl_calls) argv=$(argv_line) err=$ERR"; fi
    teardown
}

test_oss_config_dir_key_and_url() {
    local name="T4g: OSS_CONFIG_DIR set → its key (KB) and apiUrl; ~/.oss's key (KA) never sent"; ((TESTS_RUN++)); setup
    printf '{"apiKey":"fake-key-KA"}' > "$T/home/.oss/config.json"
    mkdir -p "$T/alt"; printf '{"apiKey":"fake-key-KB","apiUrl":"http://127.0.0.1:9"}' > "$T/alt/config.json"
    block_file "$T/proj/CLAUDE.md"; stale; CFG_DIR="$T/alt" run_sync
    if [[ $RC -eq 0 && "$(curl_calls)" == 1 && "$(argv_line)" == *" http://127.0.0.1:9$LAWS_PATH|" ]] \
        && sent_key fake-key-KB && ! grep -qF fake-key-KA "$T/shim/stdin" "$T/shim/argv"; then pass "$name"
    else fail "$name" "1 call to 127.0.0.1:9 carrying fake-key-KB only" "rc=$RC calls=$(curl_calls) argv=$(argv_line) sent=$(grep -o 'Bearer [^"]*' "$T/shim/stdin" 2>/dev/null)"; fi
    teardown
}

test_refused_api_url_no_request() {
    local mode
    for mode in refresh install; do
        local name="T4g: apiUrl the CLI refuses (http://evil.example), $mode → no request, nothing written, warned"; ((TESTS_RUN++)); setup
        printf '{"apiKey":"fake-key-K","apiUrl":"http://evil.example"}' > "$T/home/.oss/config.json"
        local want=0
        if [[ $mode == refresh ]]; then block_file "$T/proj/CLAUDE.md"; stale; else printf '# Mine\n' > "$T/proj/CLAUDE.md"; want=4; fi
        local before; before=$(sum "$T/proj/CLAUDE.md")
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        if [[ $RC -eq $want && "$(curl_calls)" == 0 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -n "$ERR" && -z "$OUT" ]]; then pass "$name"
        else fail "$name" "exit $want, no curl call, unchanged, reason on stderr" "rc=$RC calls=$(curl_calls) argv=$(argv_line) err=$ERR"; fi
        teardown
    done
}

test_no_api_url_default_host() {
    local name="T4g: control: no apiUrl in the config → the default API"; ((TESTS_RUN++)); setup
    printf '{"apiKey":"fake-key-K"}' > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if [[ $RC -eq 0 && "$(curl_calls)" == 1 && "$(argv_line)" == *" https://one-shot-ship-api.onrender.com$LAWS_PATH|" ]] && sent_key fake-key-K; then pass "$name"
    else fail "$name" "1 call to the default API with fake-key-K" "rc=$RC calls=$(curl_calls) argv=$(argv_line)"; fi
    teardown
}

# T25: the 24 h "fresh" stamp belongs to the API that wrote the block. A new apiUrl (local dev API
# -> production) refreshes the block from the new API on the next session start.
test_api_url_change_refreshes() {
    local same
    for same in n y; do
        local name="T25: block refreshed from API A, then apiUrl $([[ $same == y ]] && echo "unchanged → no request inside the 24 h" || echo "changed to B → the next run fetches from B")"
        ((TESTS_RUN++)); setup
        printf '{"apiKey":"fake-key-K","apiUrl":"http://127.0.0.1:9"}' > "$T/home/.oss/config.json"
        block_file "$T/proj/CLAUDE.md"; stale; run_sync
        [[ $same == y ]] || printf '{"apiKey":"fake-key-K","apiUrl":"http://localhost:9"}' > "$T/home/.oss/config.json"
        run_sync
        local last; last=$(tail -n 1 "$T/shim/argv" 2>/dev/null)
        if [[ $same == n && $RC -eq 0 && "$(curl_calls)" == 2 && "$last" == *" http://localhost:9$LAWS_PATH" ]] \
            || [[ $same == y && $RC -eq 0 && "$(curl_calls)" == 1 ]]; then pass "$name"
        else fail "$name" "$([[ $same == y ]] && echo "1 call in all" || echo "2 calls, the last to localhost:9")" "rc=$RC calls=$(curl_calls) argv=$(argv_line)"; fi
        teardown
    done
}


# =============================================================================================
# R7 (R-273 D12) The base laws are verified before they are written
# @behavior The sync asks for /shared/iron-laws?split=1 ({base, team}), pipes the exact base bytes to
#           `~/.oss/bin/oss-decrypt --verify-body shared/iron-laws`, and writes base + team only on exit 0.
#           Anything else leaves CLAUDE.md byte-identical, warns on stderr, and backs off 1 h like a failed fetch.
# @business-rule A tampered IRON LAWS body never lands in a committed CLAUDE.md; team users get exactly the block
#           they got before the split (no one-time rewrite).
# =============================================================================================
verify_calls() { cat "$VB/verify.calls" 2>/dev/null | tr '\n' ' '; }
lc_fresh() { [[ -n "$(find "$T/home/.oss/.iron-laws-last-check" -newer "$T/shim/body" 2>/dev/null)" ]] && echo y || echo n; }

test_split_verified_writes() {
    local name="R7: a verified base is written; one ?split=1 request; oss-decrypt --verify-body shared/iron-laws called once"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    local a; a=$(argv_line)
    if [[ $RC -eq 0 && "$(curl_calls)" == 1 && "$a" == *"$LAWS_PATH|" && "$(verify_calls)" == "shared/iron-laws " ]] \
        && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "1 ?split=1 call, 1 verify call, refreshed" "rc=$RC calls=$(curl_calls) argv=${a//$FAKE_KEY/<KEY>} verify=$(verify_calls) err=$ERR"; fi
    teardown
}

test_split_bytes_exact() {
    local name="R7: the bytes piped to oss-decrypt are exactly .base (its final newline neither lost nor doubled), not team"; ((TESTS_RUN++)); setup
    cp "$SPLIT_FIXTURE/base" "$T/shim/body"; cp "$SPLIT_FIXTURE/team" "$T/shim/team"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if [[ "$(tail -c 1 "$SPLIT_FIXTURE/base" | od -An -c | tr -d ' ')" == '\n' ]] && cmp -s "$VB/verify.stdin" "$SPLIT_FIXTURE/base"; then pass "$name"
    else fail "$name" "verify.stdin == fixture base (ends in \\n)" "rc=$RC stdin_bytes=$(wc -c < "$VB/verify.stdin" 2>/dev/null) base_bytes=$(wc -c < "$SPLIT_FIXTURE/base") err=$ERR"; fi
    teardown
}

test_split_team_matches_legacy() {
    local name="R7 (A6): base + team written by --install is byte-identical to what the legacy body base+team gave"; ((TESTS_RUN++)); setup
    cp "$SPLIT_FIXTURE/base" "$T/shim/body"; cp "$SPLIT_FIXTURE/team" "$T/shim/team"
    run_sync --install
    if [[ $RC -eq 0 ]] && cmp -s "$T/proj/CLAUDE.md" "$SPLIT_FIXTURE/legacy-install-claude-md"; then pass "$name"
    else fail "$name" "CLAUDE.md == fixtures/iron-laws-split/legacy-install-claude-md" "rc=$RC err=$ERR diff=$(diff "$SPLIT_FIXTURE/legacy-install-claude-md" "$T/proj/CLAUDE.md" 2>&1 | head -8)"; fi
    teardown
}

# check_unverified <label> [install]: the reply/stub are set up; refresh (or --install) must write nothing.
check_unverified() {
    local label="$1" mode="${2:-refresh}"
    local name="R7: $label ($mode) → CLAUDE.md byte-identical, warning, nothing on stdout, 1 h backoff, no fresh stamp"; ((TESTS_RUN++))
    local before want=0
    if [[ $mode == install ]]; then printf '# Mine\n' > "$T/proj/CLAUDE.md"; want=4; else block_file "$T/proj/CLAUDE.md"; stale; fi
    before=$(sum "$T/proj/CLAUDE.md")
    if [[ $mode == install ]]; then run_sync --install; else run_sync; fi
    local backoff=n bf="$T/home/.oss/.iron-laws-backoff"; [[ -f "$bf" && -n "$(find "$bf" -newer "$T/shim/body" 2>/dev/null)" ]] && backoff=y
    if [[ $RC -eq $want && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -n "$ERR" && -z "$OUT" && $backoff == y && "$(lc_fresh)" == n ]]; then pass "$name"
    else fail "$name" "rc $want, unchanged, stderr, no stdout, backoff, stamp not fresh" \
        "rc=$RC changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) out=${OUT:0:80} backoff=$backoff fresh=$(lc_fresh) err=$ERR"; fi
}

test_split_tampered_base() {
    local m
    for m in refresh install; do
        setup
        printf 'the signed laws\n' > "$T/signed"; served_hash "$VB" shared/iron-laws "$T/signed"; : > "$T/shim/pin"
        check_unverified "a base that is not the signed one" $m
        ((TESTS_RUN++))
        if [[ "$ERR" == *verif* ]]; then pass "R7: the tamper warning ($m) says the laws did not pass verification"
        else fail "R7: the tamper warning ($m) names verification" "a warning naming verification" "err=$ERR"; fi
        teardown
    done
}

test_split_verify_exit_codes() {
    local c
    for c in 1 4 124 3; do
        setup; printf '%s' "$c" > "$VB/verify.exit"
        check_unverified "oss-decrypt exits $c"
        teardown
    done
    setup; rm -f "$T/home/.oss/bin/oss-decrypt"; check_unverified "no oss-decrypt (exit 127)"; teardown
}

test_split_old_decrypt() {
    setup; ln -sf "$VB/old/oss-decrypt" "$T/home/.oss/bin/oss-decrypt"
    check_unverified "oss-decrypt older than 1.2.5 (no --verify-body: help on stdout, exit 1)"
    teardown
}

# Verification is part of the fetch, before the write lock: a lock held by another sync cannot turn a failed
# verification into a silent "lock busy" exit with no backoff, and the lock is never taken for unverified laws.
test_split_verify_before_lock() {
    local name="R7: verification runs before the lock: with the lock held, a tampered base still backs off at once, lock untouched"; ((TESTS_RUN++)); setup
    printf 'the signed laws\n' > "$T/signed"; served_hash "$VB" shared/iron-laws "$T/signed"; : > "$T/shim/pin"
    mkdir "$T/home/.oss/.iron-laws-sync.lock"; local lock_id; lock_id=$(ls -ldi "$T/home/.oss/.iron-laws-sync.lock" | awk '{print $1}')
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    run_sync
    local bf="$T/home/.oss/.iron-laws-backoff" same_lock=n
    [[ "$(ls -ldi "$T/home/.oss/.iron-laws-sync.lock" 2>/dev/null | awk '{print $1}')" == "$lock_id" ]] && same_lock=y
    if [[ $RC -eq 0 && -f "$bf" && "$ERR" == *verif* && "$ERR" != *"another sync holds"* && $same_lock == y \
          && "$(sum "$T/proj/CLAUDE.md")" == "$before" ]]; then pass "$name"
    else fail "$name" "backoff set, verification warning, not a lock wait, the held lock untouched, unchanged" \
        "rc=$RC backoff=$([[ -f $bf ]] && echo y || echo n) same_lock=$same_lock err=$ERR"; fi
    teardown
}

# The reply must be the ?split=1 JSON; anything else is refused with no second, unsplit request.
test_split_reply_refused() {
    local label
    for label in markdown html not-object no-base number-base http-404; do
        setup
        case $label in
            markdown) valid_body > "$T/shim/raw" ;;   # what the unsplit endpoint (and an old API) answers
            html) printf '<!DOCTYPE html>\n<html><body>portal</body></html>\n' > "$T/shim/raw" ;;
            not-object) printf '["# IRON LAWS"]' > "$T/shim/raw" ;;
            no-base) printf '{"team":"x"}' > "$T/shim/raw" ;;
            number-base) printf '{"base":5}' > "$T/shim/raw" ;;
            http-404) printf '404' > "$T/shim/code" ;;
        esac
        check_unverified "a ?split=1 reply that is $label"
        local a; a=$(argv_line)
        ((TESTS_RUN++))
        if [[ "$(curl_calls)" == 1 && "$a" == *"$LAWS_PATH|" && ( $label == http-404 || ! -s "$VB/verify.calls" ) ]]; then pass "R7: $label reply: one ?split=1 request, never the unsplit endpoint"
        else fail "R7: $label reply: no fallback request" "1 call ending ?split=1" "calls=$(curl_calls) argv=${a//$FAKE_KEY/<KEY>} verify=$(verify_calls)"; fi
        teardown
    done
}

echo "Running oss-iron-laws-sync.sh safety tests..."
echo "======================================="
test_refresh_never_creates
test_refresh_never_appends
test_install_creates
test_install_appends_once
test_symlinks_refused
test_not_regular_file_refused
test_home_refused
test_parent_symlink_to_home_refused
test_start_without_end_untouched
test_prose_marker_substring_untouched
test_prose_plus_block_only_block_changes
test_body_with_end_marker_no_growth
test_two_blocks_untouched
test_rejected_bodies
test_markdown_with_angle_placeholders_accepted
test_valid_write_marks_fresh
test_curl_size_and_time_caps
test_key_off_argv
test_dash_lines_kept
test_mode_kept
test_concurrent_installs_one_block
test_lock_held_blocks_write
test_stale_lock_cleared
test_json_config_parsed
test_legacy_block_canonicalised
test_crlf_block_refreshed_in_place
test_trailing_space_marker_counts
test_crlf_install_appends_crlf
test_key_without_node
test_key_without_jq
test_no_reader_fails_closed
test_install_refusal_exit_3
test_install_no_laws_exit_4
test_api_url_from_config
test_oss_config_dir_key_and_url
test_refused_api_url_no_request
test_no_api_url_default_host
test_api_url_change_refreshes
test_split_verified_writes
test_split_bytes_exact
test_split_team_matches_legacy
test_split_tampered_base
test_split_verify_exit_codes
test_split_old_decrypt
test_split_reply_refused
test_split_verify_before_lock
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
