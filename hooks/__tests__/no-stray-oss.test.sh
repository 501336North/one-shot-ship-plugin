#!/bin/bash
# A Claude Code hook that does not know the project creates no .oss in whatever folder it runs from.
#
# @behavior When oss-precommand.sh, oss-session-start.sh or oss-session-end.sh runs with no project
#           known (no CLAUDE_PROJECT_DIR, no ~/.oss/current-project), it leaves the cwd alone: no stray .oss appears in a repo
#           sub-folder - one that the cwd walk would later take for a project and send events to.
#           With a project known it still finds that project's queue.
# @business-rule notify-routing-unify ship round 1 (R1-4): .oss is created only in a known project;
#           Claude Code always gives this hook CLAUDE_PROJECT_DIR, so the old `./.oss` fallback only
#           ever made strays (watcher/.oss in this checkout).
# Usage: ./hooks/__tests__/no-stray-oss.test.sh
set -uo pipefail
# T29: a developer's exported OSS_CONFIG_DIR / OSS_MANIFEST_URL must not lead the hooks to their real config or API.
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running no-stray-oss tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-precmd.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
H="$T/home"; P="$T/proj"; mkdir -p "$H/.oss" "$P/.oss" "$P/sub" "$P/sub2" "$P/sub3"; (cd "$P" && git init -q) >/dev/null 2>&1
printf '{"apiKey":"test-key"}\n' > "$H/.oss/config.json"   # logged in: session-start runs past its login check

OUT=$(cd "$P/sub" && env -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_SESSION_ID HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 \
    "$SH" "$ROOT/hooks/oss-precommand.sh" "hello" 2>&1 </dev/null); RC=$?
[[ $RC -eq 0 && ! -e "$P/sub/.oss" ]] && pass "no project known: precommand creates no .oss in the cwd (a repo sub-folder)" \
    || fail "no project known: precommand creates no .oss in the cwd (a repo sub-folder)" "rc=$RC sub:$(ls -A "$P/sub") out=$OUT"

for h in oss-session-start.sh oss-session-end.sh; do
    rm -rf "$P/sub3/.oss"
    OUT=$(cd "$P/sub3" && env -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_SESSION_ID HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 \
        "$SH" "$ROOT/hooks/$h" 2>&1 </dev/null); RC=$?
    [[ ! -e "$P/sub3/.oss" ]] && pass "no project known: $h creates no .oss in the cwd (a repo sub-folder)" \
        || fail "no project known: $h creates no .oss in the cwd (a repo sub-folder)" "rc=$RC sub3:$(ls -A "$P/sub3") out=$OUT"
done

printf '{"tasks":[{"status":"pending","priority":"high","prompt":"queued-x"}]}\n' > "$P/.oss/queue.json"
OUT=$(cd "$P/sub2" && env -u CLAUDE_CODE_SESSION_ID HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 CLAUDE_PROJECT_DIR="$P" \
    "$SH" "$ROOT/hooks/oss-precommand.sh" "hello" 2>&1 </dev/null); RC=$?
[[ "$OUT" == *"1 queued task"* && ! -e "$P/sub2/.oss" ]] && pass "control: with CLAUDE_PROJECT_DIR the project's queue is still found" \
    || fail "control: with CLAUDE_PROJECT_DIR the project's queue is still found" "rc=$RC out=$OUT"

# R2-3: precommand never reads ~/.oss/current-project (it names whichever session started last);
# with no CLAUDE_PROJECT_DIR it uses the shared resolver - here the cwd walk finds P, not B.
B="$T/projB"; mkdir -p "$B/.oss"; (cd "$B" && git init -q) >/dev/null 2>&1
printf '{"tasks":[{"status":"pending","priority":"high","prompt":"b1"},{"status":"pending","priority":"high","prompt":"b2"}]}\n' > "$B/.oss/queue.json"
printf '%s\n' "$B" > "$H/.oss/current-project"
OUT=$(cd "$P/sub2" && env -u CLAUDE_PROJECT_DIR -u CLAUDE_CODE_SESSION_ID HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_HEALTH_CHECK=1 \
    "$SH" "$ROOT/hooks/oss-precommand.sh" "hello" 2>&1 </dev/null); RC=$?
[[ "$OUT" == *"1 queued task"* && "$OUT" != *"2 queued task"* ]] \
    && pass "R2-3: no CLAUDE_PROJECT_DIR: precommand shows the cwd project's queue, never current-project's" \
    || fail "R2-3: no CLAUDE_PROJECT_DIR: precommand shows the cwd project's queue, never current-project's" "rc=$RC out=$OUT"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
