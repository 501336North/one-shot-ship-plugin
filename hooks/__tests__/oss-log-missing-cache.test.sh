#!/bin/bash
# hooks/oss-log.sh: a log line that was written exits 0 even when the plugin cache folder is missing.
#
# @behavior `oss-log.sh agent ...` and `oss-log.sh phase ... start` write their line and exit 0 on a
#           machine with no ~/.claude/plugins/cache/one-shot-ship-plugin folder (and no
#           CLAUDE_PLUGIN_ROOT, as in the Bash tool), so callers such as `oss-value.sh agent` do not
#           report a failure for a line that was logged.
# @business-rule Ship round 4, R4-3: the version-agnostic `find` of the state CLI may find nothing;
#           under set -euo pipefail its failure must not end the script.
#
# Usage: ./hooks/__tests__/oss-log-missing-cache.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-log-missing-cache.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

T=$(cd "$(mktemp -d /tmp/oss-logcache.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
N=0
# setup [cache]: fresh HOME + project with .oss; "cache" adds a plugin cache with the state CLI
setup() {
    N=$((N + 1)); H="$T/h$N"; P="$T/p$N"; mkdir -p "$H/.oss" "$P/.oss"
    if [[ "${1:-}" == cache ]]; then
        mkdir -p "$H/.claude/plugins/cache/one-shot-ship-plugin/x/watcher/dist/cli"
        printf 'process.exit(0)\n' > "$H/.claude/plugins/cache/one-shot-ship-plugin/x/watcher/dist/cli/update-workflow-state.js"
    fi
}
# lg <args...>: run the real oss-log.sh as the Bash tool would (no CLAUDE_PLUGIN_ROOT) -> RC, LOG
lg() {
    (cd "$P" && env -u CLAUDE_PLUGIN_ROOT HOME="$H" CLAUDE_PROJECT_DIR="$P" "$SH" "$ROOT/hooks/oss-log.sh" "$@" >/dev/null 2>"$T/err" </dev/null); RC=$?
    LOG=$(cat "$P/.oss/logs/current-session/build.log" 2>/dev/null)
}

for c in nocache cache; do
    setup "$c"; lg agent build code-reviewer "starting: delegated task"
    [[ "$RC" == 0 && "$LOG" == *"code-reviewer: starting: delegated task"* ]] && pass "$c: agent writes its line and exits 0" || fail "$c: agent writes its line and exits 0" "rc=$RC err=$(cat "$T/err") log=$LOG"
    setup "$c"; lg phase build RED start
    [[ "$RC" == 0 && "$LOG" == *"[PHASE] RED start"* ]] && pass "$c: phase start writes its line and exits 0" || fail "$c: phase start writes its line and exits 0" "rc=$RC err=$(cat "$T/err") log=$LOG"
done
wait

echo
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ "$FAILED" == 0 ]]
