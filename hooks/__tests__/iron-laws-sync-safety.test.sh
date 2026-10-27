#!/bin/bash
# Safety tests for oss-iron-laws-sync.sh (ship gate round 1, R1-R6).
#
# The sync runs at EVERY Claude Code session start in customer projects, so a defect here
# rewrites customer files. Each test drives the real script in a temp HOME + temp project
# with a stub decrypt CLI at $HOME/.oss/bin/oss-decrypt and a curl tripwire on PATH (no network), and
# asserts on files and the stubs' recorded argv.
#
# @behavior Session start may only refresh an existing, well-formed IRON LAWS block in the
#           project's own CLAUDE.md; --install (from /oss:login) may create or append one block.
# @business-rule The sync never damages, duplicates, or redirects writes from a user's file,
#           never stores a bad API response, never blocks session start, and never puts the
#           API key on a command line. The laws come only from oss-decrypt, which verifies them
#           against the signed manifest (FR15): a CLI refusal writes nothing, and curl is never used.
#
# Usage: ./hooks/__tests__/iron-laws-sync-safety.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The hook runs from a throwaway copy of hooks/ whose ensure-decrypt-cli.sh is a stub (SR6: the hook runs it before
# every sync): it records each call in $HOME/.ensure-calls, fails when $HOME/.ensure-fail exists, keeps an installed CLI; a missing CLI "fails to install"
# after asking GitHub (the curl tripwire records that). The real installer has its own suites.
HOOK_TREE=$(mktemp -d); trap 'rm -rf "$HOOK_TREE"' EXIT
cp "$SCRIPT_DIR/../oss-iron-laws-sync.sh" "$SCRIPT_DIR/../oss-api-curl.sh" "$HOOK_TREE/"
cat > "$HOOK_TREE/ensure-decrypt-cli.sh" << 'ENSUREEOF'
#!/bin/bash
echo ensure >> "$HOME/.ensure-calls"
[[ -f "$HOME/.ensure-fail" ]] && exit 1   # e.g. the pinned CLI failed verification
[[ -x "$HOME/.oss/bin/oss-decrypt" ]] && exit 0
curl -fsSL "https://github.com/501336North/one-shot-ship-plugin/releases/download/stub/oss-decrypt" -o /dev/null
exit 1
ENSUREEOF
chmod +x "$HOOK_TREE/ensure-decrypt-cli.sh"
HOOK_SCRIPT="$HOOK_TREE/oss-iron-laws-sync.sh"

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
# T/home   HOME with .oss/config.json and .oss/bin/oss-decrypt (the stub CLI)
# T/proj   CLAUDE_PROJECT_DIR
# T/bin    curl tripwire: records any call to T/shim/curl-argv and fails
# T/shim   CLI control: body, refuse (a message: the CLI prints it on stderr and exits 1), sleep;
#          records argv (one line per call)
setup() {
    T=$(mktemp -d)
    T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/bin" "$T/proj" "$T/bin" "$T/shim"
    printf '{"apiKey": "%s"}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    cat > "$T/home/.oss/bin/oss-decrypt" << SHIM
#!/bin/bash
S="$T/shim"
printf '%s\n' "\$*" >> "\$S/argv"
[[ -f "\$S/sleep" ]] && sleep "\$(cat "\$S/sleep")"
# A refusing stub still prints the body: only the exit status may decide that nothing is written.
[[ -f "\$S/body" ]] && cat "\$S/body"
if [[ -f "\$S/refuse" ]]; then echo "[verify] Prompt hash: FAILED — prompt blocked" >&2; echo "Error: \$(cat "\$S/refuse")" >&2; exit 1; fi
printf '\n'   # console.log ends the output with a newline
exit 0
SHIM
    chmod +x "$T/home/.oss/bin/oss-decrypt"
    printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "%s/curl-argv"\nexit 7\n' "$T/shim" > "$T/bin/curl"
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
cli_calls() { [[ -f "$T/shim/argv" ]] && wc -l < "$T/shim/argv" | tr -d ' ' || echo 0; }
curl_calls() { [[ -f "$T/shim/curl-argv" ]] && wc -l < "$T/shim/curl-argv" | tr -d ' ' || echo 0; }
count_line() { grep -cxF -- "$1" "$2" 2>/dev/null || true; }
sum() { cksum < "$1"; }

# =============================================================================================
# R1 Session-start safety model
# =============================================================================================
test_refresh_never_creates() {
    local name="R1: session start (no flag) never creates CLAUDE.md"; ((TESTS_RUN++)); setup
    run_sync
    if [[ ! -e "$T/proj/CLAUDE.md" && "$(cli_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "no CLAUDE.md, no CLI call" "exists=$([[ -e $T/proj/CLAUDE.md ]] && echo y || echo n) cli_calls=$(cli_calls)"; fi
    teardown
}

test_refresh_never_appends() {
    local name="R1: session start leaves a CLAUDE.md without markers byte-identical"; ((TESTS_RUN++)); setup
    printf '# Mine\n\nNo laws here.\n' > "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md")
    run_sync
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" && "$(cli_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "unchanged, no CLI call" "changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) cli_calls=$(cli_calls)"; fi
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
        if [[ "$after" == "$before" && -L "$T/proj/CLAUDE.md" && "$(cli_calls)" == "0" ]]; then pass "$name"
        else fail "$name" "target unchanged, link intact, no CLI call" "target_changed=$([[ $after == "$before" ]] && echo n || echo y) link=$([[ -L $T/proj/CLAUDE.md ]] && echo y || echo n) cli=$(cli_calls)"; fi
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
    if [[ -d "$T/proj/CLAUDE.md" && -z "$(ls -A "$T/proj/CLAUDE.md")" && "$(cli_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "exit 0, dir untouched, no CLI call" "rc=$RC cli=$(cli_calls)"; fi
    teardown
}

test_home_refused() {
    local name="R1: CLAUDE_PROJECT_DIR = \$HOME is refused (no ~/CLAUDE.md written)"; ((TESTS_RUN++)); setup
    PROJ="$T/home" run_sync --install
    if [[ ! -e "$T/home/CLAUDE.md" && "$(cli_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "no ~/CLAUDE.md, no CLI call" "exists=$([[ -e $T/home/CLAUDE.md ]] && echo y || echo n) cli=$(cli_calls)"; fi
    teardown
}

test_parent_symlink_to_home_refused() {
    local name="R1: project dir that is a symlink resolving to \$HOME is refused"; ((TESTS_RUN++)); setup
    ln -s "$T/home" "$T/linkproj"
    block_file "$T/home/CLAUDE.md"; local before; before=$(sum "$T/home/CLAUDE.md"); stale
    PROJ="$T/linkproj" run_sync
    PROJ="$T/linkproj" run_sync --install
    if [[ "$(sum "$T/home/CLAUDE.md")" == "$before" && "$(cli_calls)" == "0" ]]; then pass "$name"
    else fail "$name" "~/CLAUDE.md unchanged, no CLI call" "changed=$([[ "$(sum "$T/home/CLAUDE.md")" == "$before" ]] && echo n || echo y) cli=$(cli_calls)"; fi
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
    [[ "$code" == 200 ]] || printf 'Request failed' > "$T/shim/refuse"
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    run_sync
    local first_out="$OUT" lc_fresh=n
    [[ -n "$(find "$T/home/.oss/.iron-laws-last-check" -newer "$T/shim/body" 2>/dev/null)" ]] && lc_fresh=y
    run_sync   # within the backoff window: must not call the CLI again
    local calls; calls=$(cli_calls)
    if [[ "$(sum "$T/proj/CLAUDE.md")" == "$before" && -z "$first_out" && "$lc_fresh" == n && "$calls" == "1" ]]; then pass "$name"
    else fail "$name" "unchanged, no stdout, stamp not fresh, 1 CLI call over 2 runs" \
        "changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) stdout_bytes=${#first_out} fresh_stamp=$lc_fresh cli_calls=$calls"; fi
    teardown
}
test_rejected_bodies() {
    setup; : > "$T/shim/body"; check_rejected_body "empty 200" 200
    setup; printf '<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head><body>%s IRON LAW</body></html>\n' "$(head -c 800 /dev/zero | tr '\0' x)" > "$T/shim/body"; check_rejected_body "HTML page served as 200" 200
    setup; printf '<html><body><h1>502 Bad Gateway</h1></body></html>\n' > "$T/shim/body"; check_rejected_body "HTML 502 page" 502
    setup; check_rejected_body "CLI refusal (hash does not match the signed manifest)" refused
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

test_cli_time_cap() {
    local name="R4: a CLI that hangs is stopped (time cap) → block unchanged, 1h backoff, exit 0"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    printf '60' > "$T/shim/sleep"
    local t0; t0=$(date +%s); run_sync; local took=$(( $(date +%s) - t0 ))
    if [[ $RC -eq 0 && $took -lt 25 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -e "$T/home/.oss/.iron-laws-backoff" ]]; then pass "$name"
    else fail "$name" "returns well before the CLI would, unchanged, backoff set" "rc=$RC took=${took}s backoff=$([[ -e $T/home/.oss/.iron-laws-backoff ]] && echo y || echo n)"; fi
    teardown
}

# =============================================================================================
# R5 apiKey never in argv
# =============================================================================================
test_key_off_argv() {
    local name="R5: the laws come from 'oss-decrypt --type shared --name iron-laws' alone: no key in argv, no curl"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    local a in_out=n; a=$(cat "$T/shim/argv" 2>/dev/null)
    [[ "$OUT$ERR" == *"$FAKE_KEY"* ]] && in_out=y
    if [[ "$a" == "--type shared --name iron-laws" && "$(curl_calls)" == "0" && "$in_out" == n ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "CLI argv exactly '--type shared --name iron-laws', no curl, key not printed, refreshed" "argv=${a//$FAKE_KEY/<KEY>} curl=$(curl_calls) printed=$in_out"; fi
    teardown
}

# =============================================================================================
# V  Verified laws only (ship round 1, FR15): a CLI refusal writes nothing and never falls back
# =============================================================================================
test_cli_refusal_writes_nothing() {
    local mode
    for mode in refresh install; do
        local name="V: the CLI refuses (signature or hash mismatch) ($mode) → nothing written, no curl fallback"; ((TESTS_RUN++)); setup
        if [[ $mode == refresh ]]; then block_file "$T/proj/CLAUDE.md"; else printf '# Mine\n' > "$T/proj/CLAUDE.md"; fi
        local before; before=$(sum "$T/proj/CLAUDE.md"); stale
        printf '[SECURITY] Prompt integrity check FAILED. Content may have been tampered with.' > "$T/shim/refuse"
        if [[ $mode == refresh ]]; then run_sync; else run_sync --install; fi
        local want=0; [[ $mode == install ]] && want=4
        if [[ $RC -eq $want && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -z "$OUT" && "$(cli_calls)" == "1" && "$(curl_calls)" == "0" \
            && -e "$T/home/.oss/.iron-laws-backoff" ]]; then pass "$name"
        else fail "$name" "rc $want, unchanged, no stdout, 1 CLI call, 0 curl calls, backoff" "rc=$RC changed=$([[ "$(sum "$T/proj/CLAUDE.md")" == "$before" ]] && echo n || echo y) cli=$(cli_calls) curl=$(curl_calls) out=$OUT"; fi
        teardown
    done
}

test_cli_missing_installs_first() {
    local name="V: oss-decrypt missing → ensure-decrypt-cli.sh runs first; when it fails, exit 4, nothing written, no curl for the laws"; ((TESTS_RUN++)); setup
    rm -f "$T/home/.oss/bin/oss-decrypt"
    printf '# Mine\n' > "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md")
    run_sync --install
    local laws_curl=n; grep -q 'iron-laws' "$T/shim/curl-argv" 2>/dev/null && laws_curl=y
    local installer_ran=n; grep -q 'github.com' "$T/shim/curl-argv" 2>/dev/null && installer_ran=y
    if [[ $RC -eq 4 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -z "$OUT" && "$installer_ran" == y && "$laws_curl" == n ]]; then pass "$name"
    else fail "$name" "installer tried (github), exit 4, unchanged, no laws curl" "rc=$RC installer=$installer_ran laws_curl=$laws_curl err=$ERR"; fi
    teardown
}

# SR6: the pinned decrypt CLI is ensured before EVERY fetch, not only when it is missing, so an outdated or
# wrong-channel CLI is upgraded (ensure-decrypt-cli.sh exits at once when the pin is met). If it fails, the
# installed CLI is not trusted to fetch the laws: nothing is written.
test_cli_ensured_every_sync() {
    local name="SR6: an installed CLI is still ensured (once) before the laws are fetched"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    local n=0; [[ -f "$T/home/.ensure-calls" ]] && n=$(wc -l < "$T/home/.ensure-calls" | tr -d ' ')
    if [[ "$n" == 1 ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "ensure-decrypt-cli.sh ran once, block refreshed" "ensure calls=$n rc=$RC err=$ERR"; fi
    teardown
}
test_cli_ensure_failure_writes_nothing() {
    local name="SR6: ensure-decrypt-cli.sh fails with a CLI installed → the CLI is not run, nothing written, exit 4"; ((TESTS_RUN++)); setup
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); touch "$T/home/.ensure-fail"
    run_sync --install
    if [[ $RC -eq 4 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && "$(cli_calls)" == 0 ]]; then pass "$name"
    else fail "$name" "rc 4, unchanged, no CLI call" "rc=$RC cli=$(cli_calls) err=$ERR"; fi
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
    local name="R6: any config.json shape (spaces, newlines, escapes) → refreshed; the hook hands no key to anything"; ((TESTS_RUN++)); setup
    printf '{\n  "apiKey"   :   "abc\\/def\\u0041-%s"\n}\n' "$FAKE_KEY" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale; run_sync
    if grep -q "FRESH FROM API" "$T/proj/CLAUDE.md" && ! grep -qF "$FAKE_KEY" "$T/shim/argv" && [[ "$OUT$ERR" != *"$FAKE_KEY"* ]]; then pass "$name"
    else fail "$name" "refreshed, key in no argv and no output" "rc=$RC err=${ERR//$FAKE_KEY/<KEY>}"; fi
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
# S3 Node-free (ship gate round 2). Since FR15 the hook reads no API key at all: the decrypt CLI holds
# the credentials. Without node or python3 it still refreshes, and the key is never printed or in argv.
# =============================================================================================
# hide_tools <names...>: sets HIDDEN_PATH to the system dirs minus those tools (plus T/bin's curl tripwire).
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
# A python3 on HIDDEN_PATH that records its argv, so the test can prove the key is not in it.
python3_recorder() {
    local real; real=$(command -v python3)
    mkdir -p "$T/py"
    printf '#!/bin/bash\nprintf "%%s\\n" "$*" >> "%s/python3-argv"\nexec "%s" "$@"\n' "$T/shim" "$real" > "$T/py/python3"
    chmod +x "$T/py/python3"
    HIDDEN_PATH="$HIDDEN_PATH:$T/py"
}
# The JSON text "fake\"quo\\te-KEY": an escaped quote and backslash.
ESC_JSON="fake\\\"quo\\\\te-$FAKE_KEY"
run_hidden() { # like run_sync, with PATH=HIDDEN_PATH
    RC=0
    (cd "$T" && HOME="$T/home" CLAUDE_PROJECT_DIR="$T/proj" PATH="$HIDDEN_PATH" \
        /usr/bin/perl -e 'alarm 30; exec @ARGV' bash "$HOOK_SCRIPT" "$@" </dev/null >"$T/out" 2>"$T/err") || RC=$?
    OUT=$(cat "$T/out"); ERR=$(cat "$T/err")
}

test_key_without_node() {
    local name="S3: node absent → refreshed through the CLI; the key is in no argv and no output"; ((TESTS_RUN++)); setup
    printf '{\n  "apiKey": "%s"\n}\n' "$ESC_JSON" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale
    hide_tools node python python3; python3_recorder
    run_hidden
    local key_in_argv=n printed=n
    grep -qF "$FAKE_KEY" "$T/shim/python3-argv" "$T/shim/argv" 2>/dev/null && key_in_argv=y
    [[ "$OUT$ERR" == *"$FAKE_KEY"* ]] && printed=y
    if [[ $key_in_argv == n && $printed == n ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "refreshed, key not in argv/output" "key_in_argv=$key_in_argv printed=$printed err=${ERR//$FAKE_KEY/<KEY>}"; fi
    teardown
}

test_key_without_node_or_python() {
    local name="S3: node and python3 absent → refreshed through the CLI, key not printed"; ((TESTS_RUN++)); setup
    printf '{\n  "apiKey"  :  "%s",\n  "userId": "u1"\n}\n' "$ESC_JSON" > "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; stale
    hide_tools node python python3
    run_hidden
    if [[ "$OUT$ERR" != *"$FAKE_KEY"* && "$(curl_calls)" == "0" ]] && grep -q "FRESH FROM API" "$T/proj/CLAUDE.md"; then pass "$name"
    else fail "$name" "refreshed, key not printed, no curl" "rc=$RC err=${ERR//$FAKE_KEY/<KEY>} curl=$(curl_calls)"; fi
    teardown
}

test_fallback_fails_closed() {
    local name="S3: not logged in (no config.json), node and python3 absent → no CLI call, file unchanged"; ((TESTS_RUN++)); setup
    rm -f "$T/home/.oss/config.json"
    block_file "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md"); stale
    hide_tools node python python3
    run_hidden
    if [[ "$(cli_calls)" == "0" && "$(curl_calls)" == "0" && "$(sum "$T/proj/CLAUDE.md")" == "$before" ]]; then pass "$name"
    else fail "$name" "no CLI call, no curl, unchanged" "cli=$(cli_calls) curl=$(curl_calls) err=$ERR"; fi
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
    for label in cli-error cli-refused no-config; do
        local name="S2: --install gets no valid laws ($label) → exit 4, nothing written"; ((TESTS_RUN++)); setup
        printf '# Mine\n' > "$T/proj/CLAUDE.md"; local before; before=$(sum "$T/proj/CLAUDE.md")
        case $label in
            cli-error) printf 'Request failed' > "$T/shim/refuse" ;;
            cli-refused) printf '[SECURITY] shared/iron-laws is not in the signed prompt manifest. Prompt delivery blocked.' > "$T/shim/refuse" ;;
            no-config) rm -f "$T/home/.oss/config.json" ;;
        esac
        run_sync --install
        if [[ $RC -eq 4 && "$(sum "$T/proj/CLAUDE.md")" == "$before" && -n "$ERR" && -z "$OUT" ]]; then pass "$name"
        else fail "$name" "exit 4, unchanged, reason on stderr, no stdout" "rc=$RC err=$ERR"; fi
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
test_cli_time_cap
test_key_off_argv
test_cli_refusal_writes_nothing
test_cli_missing_installs_first
test_cli_ensured_every_sync
test_cli_ensure_failure_writes_nothing
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
test_key_without_node_or_python
test_fallback_fails_closed
test_install_refusal_exit_3
test_install_no_laws_exit_4
echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
