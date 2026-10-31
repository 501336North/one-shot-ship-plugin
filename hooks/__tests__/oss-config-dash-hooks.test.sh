#!/bin/bash
# The update checker, /oss:changelog and the worktree hook use a config dir whose path starts with "-" (T47,
# same class as T39 and T44).
#
# @behavior With a relative OSS_CONFIG_DIR such as "-cfg": session start still says what changed since the last
#           session (and stays quiet when update notices are off) and keeps -cfg/update-state.json owner-only;
#           /oss:changelog lists the changed and the new prompts; a new worktree gets a copy of -cfg/config.json.
#           No tool complains on stderr.
# @business-rule The config path is data: whatever OSS_CONFIG_DIR holds, it names a file and is never read as an
#           option by jq, mkdir, chmod or cp.
# @boundary Sandbox HOME and cwd outside any repo, a local manifest file (OSS_MOCK_MANIFEST), real jq and the
#           real coreutils. No network, never the real ~/.oss.
#           The cases run twice: with the native tools, then with GNU coreutils chmod, mkdir and cp first on PATH
#           (Linux behaviour: GNU getopt permutes, so `chmod 600 -cfg/x` reads -cfg as options, where BSD chmod
#           stops at the mode). On macOS that pass needs coreutils (gchmod, gmkdir, gcp); without them it is
#           reported SKIPPED, never counted as passed.
#
# Usage: /bin/bash hooks/__tests__/oss-config-dash-hooks.test.sh
#        HOOKS_UNDER_TEST=/path/to/hooks-copy /bin/bash hooks/__tests__/oss-config-dash-hooks.test.sh  (mutants)
set -uo pipefail
HOOKS="${HOOKS_UNDER_TEST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$(dirname "${BASH_SOURCE[0]}")/lib/run-capped.sh"   # the one time cap a test may use (T49)
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-config-dash-hooks tests..."

REAL_JQ=$(command -v jq) || { echo "✗ FAIL: jq is required"; exit 1; }
# A developer's exported overrides must not lead the hooks to the real config or the real API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CURL_HOME XDG_CONFIG_HOME OSS_SKIP_MANIFEST OSS_MOCK_MANIFEST
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_NAMESPACE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
trap 'rm -rf "$T"' EXIT
H="$T/home"; W="$T/w/cwd"; mkdir -p "$H/.oss" "$W"
D="$W/-cfg"; S="$D/update-state.json"
printf '{"name":"oss-dev-workflow","version":"2.0.45"}\n' > "$T/plugin.json"
printf '{"prompts":{"a":{"hash":"new-a"},"b":{"hash":"new-b"}}}\n' > "$T/manifest.json"
OLD_STATE='{"lastPluginVersion":"2.0.0","lastCheckedAt":"2000-01-01T00:00:00Z","manifestHashes":{"a":"old-a"}}'

GNU=""   # a dir of GNU coreutils shims, first on PATH for the second pass
# run_hook HOOK [VAR=value...]: runs HOOK from the cwd $W with OSS_CONFIG_DIR=-cfg; sets OUT, ERR, RC.
run_hook() {
    local hook=$1; shift
    OUT=$(cd "$W" && run_capped 20 env -u CLAUDE_PLUGIN_ROOT -u CLAUDE_PROJECT_DIR GIT_CEILING_DIRECTORIES="$T/w" HOME="$H" \
        PATH="${GNU:+$GNU:}$PATH" OSS_CONFIG_DIR=-cfg OSS_PLUGIN_JSON="$T/plugin.json" \
        OSS_MANIFEST_URL=http://127.0.0.1:9/never "$@" /bin/bash "$HOOKS/$hook" \
        2>"$T/err" </dev/null); RC=$?
    ERR=$(tr '\n' ' ' < "$T/err")
}
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
field() { "$REAL_JQ" -c "$1" "$2" 2>&1; }

run_cases() {   # $1: label of the pass
# --- 1. check-updates, first run, no -cfg dir yet: the state file is created, owner-only ---
rm -rf "$D"
run_hook check-updates.sh OSS_SKIP_MANIFEST=1
name="[$1] check-updates first run: creates -cfg/update-state.json (600) with the version, nothing on stderr"
if [[ $RC == 0 && -z "$OUT" && -z "$ERR" && "$(field .lastPluginVersion "$S")" == '"2.0.45"' && "$(mode_of "$S")" == 600 ]]; then
    pass "$name"; else fail "$name" "rc=$RC out='$OUT' err='$ERR' state=$(cat "$S" 2>&1) mode=$(mode_of "$S" 2>&1)"; fi

# --- 2. check-updates, a new version and a changed prompt: the notice, and the state follows ---
rm -rf "$D"; mkdir -p "$D"; printf '%s\n' "$OLD_STATE" > "$S"; chmod 644 "$S"
run_hook check-updates.sh OSS_MOCK_MANIFEST="$T/manifest.json"
name="[$1] check-updates: notices v2.0.45 + 1 changed prompt, records version, hashes and time, 600, nothing on stderr"
if [[ $RC == 0 && "$OUT" == "✨ OSS v2.0.45 + 1 prompts improved → /oss:changelog" && -z "$ERR" \
      && "$(field .lastPluginVersion "$S")" == '"2.0.45"' \
      && "$(field .manifestHashes "$S")" == '{"a":"new-a","b":"new-b"}' \
      && "$(field .lastCheckedAt "$S")" != '"2000-01-01T00:00:00Z"' && "$(mode_of "$S")" == 600 ]]; then
    pass "$name"; else fail "$name" "rc=$RC out='$OUT' err='$ERR' state=$(cat "$S" 2>&1) mode=$(mode_of "$S" 2>&1)"; fi

# --- 3. check-updates with update notices turned off in -cfg/settings.json: quiet ---
rm -rf "$D"; mkdir -p "$D"; printf '%s\n' "$OLD_STATE" > "$S"
printf '{"notifications":{"updates":false}}\n' > "$D/settings.json"
run_hook check-updates.sh OSS_MOCK_MANIFEST="$T/manifest.json"
name="[$1] check-updates: notices off in -cfg/settings.json, so no notice and the state is left alone"
if [[ $RC == 0 && -z "$OUT" && -z "$ERR" && "$(field .lastPluginVersion "$S")" == '"2.0.0"' ]]; then
    pass "$name"; else fail "$name" "rc=$RC out='$OUT' err='$ERR' state=$(cat "$S" 2>&1)"; fi

# --- 4. /oss:changelog: the version change, the changed and the new prompt, the last check time ---
rm -rf "$D"; mkdir -p "$D"; printf '%s\n' "$OLD_STATE" > "$S"
run_hook oss-changelog.sh OSS_MOCK_MANIFEST="$T/manifest.json"
name="[$1] changelog: v2.0.0 → v2.0.45, prompt a updated, b new, last checked time shown, nothing on stderr"
if [[ $RC == 0 && -z "$ERR" && "$OUT" == *"Plugin: v2.0.0 → v2.0.45"* \
      && "$OUT" == *$'Updated prompts (1):\n  • a'* && "$OUT" == *$'New prompts (1):\n  + b'* \
      && "$OUT" == *"Last checked: 2000-01-01T00:00:00Z"* ]]; then
    pass "$name"; else fail "$name" "rc=$RC err='$ERR' out=$(printf '%s' "$OUT" | tr '\n' '|')"; fi

# --- 5. worktree-create copies -cfg/config.json into the new worktree, owner-only ---
rm -rf "$D" "$T/wt"; mkdir -p "$D" "$T/wt"
printf '{"apiKey":"ossk_dash_test_key","other":1}\n' > "$D/config.json"
run_hook oss-worktree-create.sh CLAUDE_WORKTREE_PATH="$T/wt"
name="[$1] worktree-create: copies -cfg/config.json into <worktree>/.oss/config.json (600), nothing on stderr"
if [[ $RC == 0 && -z "$ERR" ]] && cmp -s "$D/config.json" "$T/wt/.oss/config.json" \
      && [[ "$(mode_of "$T/wt/.oss/config.json")" == 600 ]]; then
    pass "$name"; else fail "$name" "rc=$RC err='$ERR' copy=$(cat "$T/wt/.oss/config.json" 2>&1)"; fi
}

run_cases native
# --- The same cases with GNU coreutils first on PATH ---
if chmod --version 2>/dev/null | grep -q coreutils; then
    echo "GNU pass: the native tools are already GNU coreutils — covered by the cases above"
elif [[ $(command -v gchmod gmkdir gcp 2>/dev/null | wc -l) -eq 3 ]]; then
    GNU="$T/gnu"; mkdir -p "$GNU"
    for b in chmod mkdir cp; do ln -s "$(command -v "g$b")" "$GNU/$b"; done
    if [[ "$(PATH="$GNU:$PATH" chmod --version 2>/dev/null | head -1)" == *coreutils* ]]; then pass "[gnu] chmod on the hook's PATH is GNU coreutils (anchor)"
    else fail "[gnu] chmod on the hook's PATH is GNU coreutils (anchor)" "$(PATH="$GNU:$PATH" command -v chmod)"; fi
    run_cases gnu
else
    echo "SKIPPED: GNU pass — no GNU coreutils (install coreutils for gchmod, gmkdir, gcp); NOT counted as passed"
fi

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
