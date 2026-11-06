#!/bin/bash
# Tests for check-updates.sh (session-start update checker)
#
# @behavior Plugin/prompt updates are detected and user is notified via status bar
# @business-rule Notifications are informational only — no scary CTAs
#
# Usage: ./check-updates.test.sh

set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
# T53: the state tests below set these themselves; a developer's exported copy must not change what they run.
unset OSS_MOCK_MANIFEST OSS_SKIP_MANIFEST OSS_PLUGIN_JSON

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# HOOKS_UNDER_TEST=/path/to/hooks-copy runs these tests against a copy (mutants).
CHECK_UPDATES_SCRIPT="${HOOKS_UNDER_TEST:-$SCRIPT_DIR/..}/check-updates.sh"
# shellcheck source=lib/run-capped.sh
source "$SCRIPT_DIR/lib/run-capped.sh"

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    ((TESTS_FAILED++))
}

# =============================================================================
# Test helpers
# =============================================================================

setup_test_env() {
    local test_dir
    test_dir=$(mktemp -d)

    # Create mock config dir
    mkdir -p "$test_dir/config"
    mkdir -p "$test_dir/plugin"

    # Create mock plugin.json
    cat > "$test_dir/plugin/plugin.json" << 'EOF'
{
  "name": "oss-dev-workflow",
  "version": "2.0.45"
}
EOF

    # Create mock update-state.json with old version
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.44",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    # Create mock settings.json
    cat > "$test_dir/config/settings.json" << 'EOF'
{
  "notifications": {
    "updates": true
  }
}
EOF

    echo "$test_dir"
}

cleanup_test_env() {
    rm -rf "${1:?}"
}

# =============================================================================
# TEST 1: Should detect plugin version change and output notification
#
# @behavior User sees version change notification on session start
# @acceptance-criteria Output contains version string with new version number
# =============================================================================
test_detect_plugin_version_change() {
    local test_name="Should detect plugin version change and output notification"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found: $CHECK_UPDATES_SCRIPT"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if echo "$result" | grep -q "2.0.45"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains '2.0.45'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 2: Should not notify when plugin version unchanged
#
# @behavior Silent when nothing has changed
# @acceptance-criteria No notification output when version matches cached
# =============================================================================
test_no_notify_when_unchanged() {
    local test_name="Should not notify when plugin version unchanged"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Set cached version to match current
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 3: Should detect manifest hash changes and count updated prompts
#
# @behavior User sees prompt update count on session start
# @acceptance-criteria Output contains count of changed prompts
# =============================================================================
test_detect_manifest_changes() {
    local test_name="Should detect manifest hash changes and count updated prompts"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Set cached version to match (no plugin change)
    # But give it old manifest hashes
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "oldhash1",
    "workflows/plan": "oldhash2",
    "commands/adr": "samehash"
  },
  "promptSignatures": {}
}
EOF

    # Create a mock manifest response with changed hashes
    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 2,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "newhash1", "size": 100},
    "workflows/plan": {"hash": "newhash2", "size": 200},
    "commands/adr": {"hash": "samehash", "size": 50}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should mention 2 prompts changed
    if echo "$result" | grep -q "2 prompts"; then
        pass "$test_name"
    else
        fail "$test_name" "output mentions '2 prompts'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 4: Should combine notification when both plugin + prompts changed
#
# @behavior Single combined notification when both change simultaneously
# @acceptance-criteria Output contains both version AND prompt count
# =============================================================================
test_combined_notification() {
    local test_name="Should combine notification when both plugin + prompts changed"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Old plugin version + old hashes
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.44",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 1,
  "manifestHashes": {
    "workflows/build": "oldhash1"
  },
  "promptSignatures": {}
}
EOF

    cat > "$test_dir/manifest.json" << 'EOF'
{
  "version": 2,
  "generatedAt": "2026-02-25T05:00:00Z",
  "algorithm": "sha256",
  "signing": "ed25519",
  "prompts": {
    "workflows/build": {"hash": "newhash1", "size": 100}
  },
  "signature": "mocksig"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MOCK_MANIFEST="$test_dir/manifest.json" \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should contain BOTH version and prompt count in one message
    if echo "$result" | grep -q "2.0.45" && echo "$result" | grep -q "prompt"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains version AND prompt info" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 5: Should respect notifications.updates=false setting
#
# @behavior User can disable update notifications via settings
# @acceptance-criteria No output when notifications.updates is false
# =============================================================================
test_respect_settings_disabled() {
    local test_name="Should respect notifications.updates=false setting"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Disable notifications
    cat > "$test_dir/config/settings.json" << 'EOF'
{
  "notifications": {
    "updates": false
  }
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if [[ -z "$result" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "no output (disabled)" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 6: Should complete quickly even if manifest fetch fails
#
# @behavior Network failure doesn't block session start
# @acceptance-criteria Script exits 0 within timeout, no notification
# =============================================================================
test_handles_manifest_failure() {
    local test_name="Should complete quickly even if manifest fetch fails"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Same version (no plugin change), no mock manifest (will fail)
    cat > "$test_dir/config/update-state.json" << 'EOF'
{
  "lastPluginVersion": "2.0.45",
  "lastCheckedAt": "2026-02-25T00:00:00Z",
  "manifestVersion": 0,
  "manifestHashes": {},
  "promptSignatures": {}
}
EOF

    local start_time exit_code=0
    start_time=$(date +%s)
    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_MANIFEST_URL="http://localhost:99999/nonexistent" \
             "$CHECK_UPDATES_SCRIPT" 2>&1) || exit_code=$?
    local end_time
    end_time=$(date +%s)

    local elapsed=$((end_time - start_time))

    if [[ $exit_code -eq 0 && $elapsed -lt 5 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "exit 0, < 5s" "exit=$exit_code, elapsed=${elapsed}s, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 7: Should initialize state file on first run without notification
#
# @behavior First run caches state silently, no "update" notification
# @acceptance-criteria State file created, no notification output
# =============================================================================
test_first_run_silent() {
    local test_name="Should initialize state file on first run without notification"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Remove state file (first run)
    rm -f "${test_dir:?}/config/update-state.json"

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    # Should create state file but not notify
    if [[ -f "$test_dir/config/update-state.json" && -z "$result" ]]; then
        pass "$test_name"
    else
        local file_exists="false"
        [[ -f "$test_dir/config/update-state.json" ]] && file_exists="true"
        fail "$test_name" "state file created, no output" "file_exists=$file_exists, output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# TEST 8: Should read releaseNote from plugin.json
#
# @behavior Plugin version notification includes release note text
# @acceptance-criteria Notification contains releaseNote from plugin.json
# =============================================================================
test_release_note() {
    local test_name="Should read releaseNote from plugin.json"
    ((TESTS_RUN++))

    if [[ ! -f "$CHECK_UPDATES_SCRIPT" ]]; then
        fail "$test_name" "script exists" "script not found"
        return
    fi

    local test_dir
    test_dir=$(setup_test_env)

    # Add releaseNote to plugin.json
    cat > "$test_dir/plugin/plugin.json" << 'EOF'
{
  "name": "oss-dev-workflow",
  "version": "2.0.45",
  "releaseNote": "faster TDD cycles"
}
EOF

    local result
    result=$(OSS_CONFIG_DIR="$test_dir/config" \
             OSS_PLUGIN_JSON="$test_dir/plugin/plugin.json" \
             OSS_SKIP_MANIFEST=1 \
             "$CHECK_UPDATES_SCRIPT" 2>&1)

    if echo "$result" | grep -q "faster TDD cycles"; then
        pass "$test_name"
    else
        fail "$test_name" "output contains 'faster TDD cycles'" "output: '$result'"
    fi

    cleanup_test_env "$test_dir"
}

# =============================================================================
# T53: the state file is only ever read and written as a regular file
#
# @behavior A FIFO or a symlink at ~/.oss/update-state.json never hangs the update check, never leads it to
#           write a file elsewhere, and never prints an error: the state counts as missing (cached again,
#           silently), and the next plugin update is announced as usual.
# @business-rule The update check is best-effort: it never blocks a session, never prints an error, and never
#                writes outside its own state file.
# =============================================================================

# run_state DIR [VAR=value...] - one capped run against DIR's sandbox (HOME, config and plugin.json all in DIR).
# Sets RC, OUT (stdout) and ERR (stderr). No network: every run skips the manifest or uses a local mock.
run_state() {
    local d="$1"; shift
    run_capped 10 env HOME="$d/home" OSS_CONFIG_DIR="$d/config" OSS_PLUGIN_JSON="$d/plugin/plugin.json" "$@" \
        "$CHECK_UPDATES_SCRIPT" > "$d/out" 2> "$d/err"
    RC=$?
    OUT=$(cat "$d/out"); ERR=$(cat "$d/err")
}

set_version() { printf '{"name":"oss-dev-workflow","version":"%s"}\n' "$2" > "$1/plugin/plugin.json"; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }
# $1 DIR, $2 version: the state is now a regular file (not a link) caching that version.
state_is() {
    local f="$1/config/update-state.json"
    [[ -f "$f" && ! -L "$f" && $(jq -r '.lastPluginVersion' "$f" 2>/dev/null) == "$2" ]]
}

test_state_fifo() {
    local test_name="A FIFO at the state path: no hang, no error, state cached, next update announced (T53)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home"
    rm -f "${d:?}/config/update-state.json"; mkfifo "$d/config/update-state.json"

    run_state "$d" OSS_SKIP_MANIFEST=1
    local r1="rc=$RC out='$OUT' err='$ERR'"
    if [[ $RC == 0 && -z "$OUT" && -z "$ERR" ]] && state_is "$d" 2.0.45; then
        set_version "$d" 2.0.46
        run_state "$d" OSS_SKIP_MANIFEST=1
        if [[ $RC == 0 && "$OUT" == *"v2.0.46"* && -z "$ERR" ]] && state_is "$d" 2.0.46; then
            pass "$test_name"
        else
            fail "$test_name" "second run announces v2.0.46" "rc=$RC out='$OUT' err='$ERR'"
        fi
    else
        fail "$test_name" "rc=0, silent, regular state file caching 2.0.45 (124/125 = hung)" "$r1"
    fi
    cleanup_test_env "$d"
}

test_state_symlink() {
    local test_name="A symlink at the state path: its target is never read or written (T53)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home" "$d/outside"
    # The target looks like old state: a run that read through the link would announce v2.0.45.
    mv "$d/config/update-state.json" "$d/outside/target.json"
    cp "$d/outside/target.json" "$d/outside/before.json"
    ln -s "$d/outside/target.json" "$d/config/update-state.json"

    run_state "$d" OSS_SKIP_MANIFEST=1
    local r1="rc=$RC out='$OUT' err='$ERR'"
    if ! cmp -s "$d/outside/target.json" "$d/outside/before.json"; then
        fail "$test_name" "symlink target unchanged" "target now: $(cat "$d/outside/target.json")"
    elif [[ $RC == 0 && -z "$OUT" && -z "$ERR" ]] && state_is "$d" 2.0.45; then
        set_version "$d" 2.0.46
        run_state "$d" OSS_SKIP_MANIFEST=1
        if [[ $RC == 0 && "$OUT" == *"v2.0.46"* && -z "$ERR" ]] && cmp -s "$d/outside/target.json" "$d/outside/before.json"; then
            pass "$test_name"
        else
            fail "$test_name" "second run announces v2.0.46, target unchanged" "rc=$RC out='$OUT' err='$ERR'"
        fi
    else
        fail "$test_name" "rc=0, silent (state counts as missing), link replaced by a regular file" "$r1"
    fi
    cleanup_test_env "$d"
}

test_state_round_trip() {
    local test_name="Normal runs write a private regular state file and read it back next time (T53)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home"
    rm -f "${d:?}/config/update-state.json"
    printf '{"prompts":{"a":{"hash":"h1"},"b":{"hash":"h2"}}}\n' > "$d/m1.json"
    printf '{"prompts":{"a":{"hash":"h1"},"b":{"hash":"h3"}}}\n' > "$d/m2.json"

    local got=""
    run_state "$d" OSS_MOCK_MANIFEST="$d/m1.json"            # first run: cache silently
    got="1:rc=$RC out='$OUT' mode=$(file_mode "$d/config/update-state.json")"
    [[ $RC == 0 && -z "$OUT" ]] && state_is "$d" 2.0.45 && [[ $(file_mode "$d/config/update-state.json") == 600 ]] || {
        fail "$test_name" "first run silent, 0600 regular state at 2.0.45" "$got"; cleanup_test_env "$d"; return; }
    run_state "$d" OSS_MOCK_MANIFEST="$d/m1.json"            # same version, same hashes: nothing to say
    got="2:rc=$RC out='$OUT' hashes=$(jq -c .manifestHashes "$d/config/update-state.json" 2>/dev/null)"
    [[ $RC == 0 && -z "$OUT" ]] && [[ $(jq -r .manifestHashes.b "$d/config/update-state.json") == h2 ]] || {
        fail "$test_name" "second run silent, hashes cached" "$got"; cleanup_test_env "$d"; return; }
    set_version "$d" 2.0.46
    run_state "$d" OSS_MOCK_MANIFEST="$d/m2.json"            # new version and one changed prompt
    got="3:rc=$RC out='$OUT' err='$ERR'"
    [[ $RC == 0 && "$OUT" == *"v2.0.46"*"1 prompts improved"* && -z "$ERR" ]] && state_is "$d" 2.0.46 || {
        fail "$test_name" "third run announces v2.0.46 + 1 prompt" "$got"; cleanup_test_env "$d"; return; }
    run_state "$d" OSS_MOCK_MANIFEST="$d/m2.json"            # read back: already announced
    if [[ $RC == 0 && -z "$OUT" && -z "$ERR" && $(file_mode "$d/config/update-state.json") == 600 ]]; then
        pass "$test_name"
    else
        fail "$test_name" "fourth run silent (state read back)" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

# =============================================================================
# T53b: settings.json is only read as a regular file
#
# @behavior A symlinked ~/.oss/settings.json (stow, chezmoi) is followed: update notices turned off there stay
#           off. A FIFO there counts as no settings: no hang, no error, the default (update notices on).
# @business-rule Users who manage settings with a dotfile manager keep their choice (user, 2026-11-02); a FIFO
#                never blocks session start.
# =============================================================================

test_settings_symlink() {
    local test_name="A symlinked settings.json is followed: its updates=false keeps the check silent (T53b)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home" "$d/outside"
    printf '%s\n' '{"notifications":{"updates":false}}' > "$d/outside/settings.json"
    rm -f "${d:?}/config/settings.json"; ln -s "$d/outside/settings.json" "$d/config/settings.json"
    run_state "$d" OSS_SKIP_MANIFEST=1
    if [[ $RC == 0 && -z "$OUT" && -z "$ERR" ]] && state_is "$d" 2.0.44; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0, silent (notices off through the link), state left at 2.0.44, no stderr" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

test_settings_fifo() {
    local test_name="A FIFO at settings.json: no hang, no error, default on, v2.0.45 announced (T53b)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home"
    rm -f "${d:?}/config/settings.json"; mkfifo "$d/config/settings.json"
    run_state "$d" OSS_SKIP_MANIFEST=1
    if [[ $RC == 0 && "$OUT" == *"v2.0.45"* && -z "$ERR" ]] && state_is "$d" 2.0.45; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0 (124/125 = hung), v2.0.45 announced, no stderr" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

# =============================================================================
# T74 (pen-test L2): manifest keys are data. They reach jq only through --arg and are read whole (read -r), so a
# key that is jq code cannot hang session start and a key with a space or a `*` is still compared. This hook prints
# only a count, never a key.
#
# @behavior At session start the user is told how many prompts improved, counting every changed prompt whatever
#           its name, and a hostile manifest cannot stall the check.
# @business-rule The update check is best-effort and must never hang session start (T53).
# =============================================================================

# run_keys DIR CACHED-HASHES MANIFEST: a capped run from a folder holding GLOBBED-FILE, the plugin unchanged.
run_keys() {
    local d="$1"
    set_version "$d" 2.0.44
    printf '{"lastPluginVersion":"2.0.44","lastCheckedAt":"T","manifestHashes":%s}\n' "$2" > "$d/config/update-state.json"
    printf '%s\n' "$3" > "$d/manifest.json"
    mkdir -p "$d/home" "$d/cwd"; : > "$d/cwd/GLOBBED-FILE"
    (cd "$d/cwd" && run_state "$d" OSS_MOCK_MANIFEST="$d/manifest.json"; echo "$RC" > "$d/rc")
    RC=$(cat "$d/rc"); OUT=$(cat "$d/out"); ERR=$(cat "$d/err")
}

test_keys_never_filter_text() {
    local test_name="A manifest key that is jq code is looked up as a name: no hang, its change counted (T74)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env)
    run_keys "$d" '{"x\"]|last(range(1e12))|.[\"y":"old"}' '{"prompts":{"x\"]|last(range(1e12))|.[\"y":{"hash":"new"}}}'
    if [[ $RC == 0 && "$OUT" == *"1 prompts improved"* && -z "$ERR" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0 (124 = jq ran the key as code until the cap), '1 prompts improved'" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

test_keys_not_split_or_globbed() {
    local test_name="Changed prompts named with a space or a * are counted, never split or glob-expanded (T74)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env)
    run_keys "$d" '{"two words":"old","*":"old"}' '{"prompts":{"two words":{"hash":"new"},"*":{"hash":"new"}}}'
    if [[ $RC == 0 && "$OUT" == *"2 prompts improved"* && -z "$ERR" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0, '2 prompts improved'" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

# =============================================================================
# T79 (pen-test L2): the hash comparison is one jq pass, not two jq runs per key. Session start runs this hook under
# a 3 s bound (oss-notify.sh); a manifest near the 256 KB cap used to take minutes, so the hook was killed every time
# before it saved the new hashes.
#
# @behavior With a manifest of thousands of prompts the check still finishes inside session start's 3 s bound,
#           announces the count and remembers the new hashes; a prompt name with a line break counts once.
# @business-rule The update check never stalls session start, and a prompt is announced as improved only once (T79).
# =============================================================================

test_big_manifest_saved_in_bound() {
    local test_name="A 9,000-key manifest near the 256 KB cap is counted and saved inside session start's 3 s bound (T79)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env); mkdir -p "$d/home"; set_version "$d" 2.0.44
    jq -nc '{prompts: ([range(9000) | {key: "p/\(.)", value: {hash: "new\(.)"}}] | from_entries)}' > "$d/manifest.json"
    jq -c '{lastPluginVersion: "2.0.44", lastCheckedAt: "T", manifestHashes: (.prompts | map_values("old"))}' \
        "$d/manifest.json" > "$d/config/update-state.json"
    # The same bound oss-notify.sh gives this hook at session start.
    run_capped 3 env HOME="$d/home" OSS_CONFIG_DIR="$d/config" OSS_PLUGIN_JSON="$d/plugin/plugin.json" \
        OSS_MOCK_MANIFEST="$d/manifest.json" "$CHECK_UPDATES_SCRIPT" > "$d/out" 2> "$d/err"
    RC=$?; OUT=$(cat "$d/out"); ERR=$(cat "$d/err")
    local saved; saved=$(jq -r '"\(.manifestHashes | length) \(.manifestHashes["p/0"]) \(.manifestHashes["p/8999"]) \(.lastCheckedAt)"' \
        "$d/config/update-state.json" 2>/dev/null)
    if [[ $RC == 0 && "$OUT" == "📡 OSS update: 9000 prompts improved → /oss:changelog" && -z "$ERR" \
          && "$saved" == "9000 new0 new8999 "* && "$saved" != *" T" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0 (124 = killed at the 3 s bound), '9000 prompts improved', all 9000 new hashes saved" "rc=$RC out='$OUT' err='$(head -c 300 "$d/err")' saved='$saved'"
    fi
    cleanup_test_env "$d"
}

test_newline_key_counted_once() {
    local test_name="A changed prompt whose name has a line break is counted once (T79)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env)
    run_keys "$d" '{"line\none":"old"}' '{"prompts":{"line\none":{"hash":"new"}}}'
    if [[ $RC == 0 && "$OUT" == *"1 prompts improved"* && -z "$ERR" ]]; then
        pass "$test_name"
    else
        fail "$test_name" "rc=0, '1 prompts improved'" "rc=$RC out='$OUT' err='$ERR'"
    fi
    cleanup_test_env "$d"
}

test_count_and_saved_unchanged() {
    local test_name="A normal manifest gives the same notice and saved hashes as before the one-pass diff (T79)"
    ((TESTS_RUN++))
    local d; d=$(setup_test_env)
    # Changed: a, num (cached "5", now 6), str-null (a cached "null" text counts as a hash). Not counted: same, new
    # (not cached), was-null (cached null), no-hash (no hash in the manifest).
    run_keys "$d" '{"a":"old","same":"s","num":"5","str-null":"null","was-null":null,"no-hash":"x"}' \
        '{"prompts":{"a":{"hash":"new"},"same":{"hash":"s"},"num":{"hash":6},"str-null":{"hash":"h"},"was-null":{"hash":"w"},"new":{"hash":"n"},"no-hash":{}}}'
    local saved; saved=$(jq -c .manifestHashes "$d/config/update-state.json" 2>/dev/null)
    if [[ $RC == 0 && "$OUT" == "📡 OSS update: 3 prompts improved → /oss:changelog" && -z "$ERR" \
          && "$saved" == '{"a":"new","same":"s","num":6,"str-null":"h","was-null":"w","no-hash":null,"new":"n"}' ]]; then
        pass "$test_name"
    else
        fail "$test_name" "'3 prompts improved', the manifest's hashes merged in" "rc=$RC out='$OUT' err='$ERR' saved='$saved'"
    fi
    cleanup_test_env "$d"
}

# =============================================================================
# Run all tests
# =============================================================================
echo "Running check-updates tests..."
echo "======================================="

test_detect_plugin_version_change
test_no_notify_when_unchanged
test_detect_manifest_changes
test_combined_notification
test_respect_settings_disabled
test_handles_manifest_failure
test_first_run_silent
test_release_note
test_state_fifo
test_state_symlink
test_state_round_trip
test_settings_symlink
test_settings_fifo
test_keys_never_filter_text
test_keys_not_split_or_globbed
test_big_manifest_saved_in_bound
test_newline_key_counted_once
test_count_and_saved_unchanged

echo ""
echo "======================================="
echo "Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
exit 0
