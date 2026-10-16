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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/../oss-iron-laws-sync.sh"

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
# T/shim   shim control: body, code, sleep; records argv (one line per call) and stdin
setup() {
    T=$(mktemp -d)
    T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/proj" "$T/bin" "$T/shim"
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
[[ -f "\$S/sleep" ]] && sleep "\$(cat "\$S/sleep")"
[[ -f "\$S/body" ]] && cat "\$S/body"
printf '\n%s\n' "\$(cat "\$S/code" 2>/dev/null || echo 200)"
exit 0
SHIM
    chmod +x "$T/bin/curl"
    valid_body > "$T/shim/body"
}
teardown() { rm -rf "$T"; }

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
    RC=0
    (cd "$T" && HOME="$T/home" CLAUDE_PROJECT_DIR="$proj" PATH="$T/bin:$PATH" \
        perl -e 'alarm 30; exec @ARGV' bash "$HOOK_SCRIPT" "$@" </dev/null >"$T/out" 2>"$T/err") || RC=$?
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
    local m; m=$(stat -f %Lp "$T/proj/CLAUDE.md" 2>/dev/null || stat -c %a "$T/proj/CLAUDE.md")
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
            perl -e 'alarm 30; exec @ARGV' bash "$HOOK_SCRIPT" --install </dev/null >/dev/null 2>&1) & pids+=($!)
    done
    wait "${pids[@]}"
    local s e; s=$(count_line "$START" "$T/proj/CLAUDE.md"); e=$(count_line "$END" "$T/proj/CLAUDE.md")
    if [[ "$s" == "1" && "$e" == "1" ]] && grep -q "Keep me." "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "1 START, 1 END, content kept" "start=$s end=$e"; fi
    teardown
}

test_lock_held_blocks_write() {
    local name="R6: a sync holding the lock blocks the write until it is released"; ((TESTS_RUN++)); setup
    mkdir "$T/home/.oss/.iron-laws-sync.lock"
    (cd "$T" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/proj" PATH="$T/bin:$PATH" \
        perl -e 'alarm 30; exec @ARGV' bash "$HOOK_SCRIPT" --install </dev/null >/dev/null 2>&1) & local pid=$!
    sleep 1
    local early=n; [[ -e "$T/proj/CLAUDE.md" ]] && early=y
    rmdir "$T/home/.oss/.iron-laws-sync.lock"
    wait "$pid"
    local later=n; [[ "$(count_line "$START" "$T/proj/CLAUDE.md")" == "1" ]] && later=y
    if [[ "$early" == n && "$later" == y && ! -e "$T/home/.oss/.iron-laws-sync.lock" ]]; then pass "$name"
    else fail "$name" "no write while locked, one block after release, lock removed" "written_while_locked=$early block_after=$later"; fi
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
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
