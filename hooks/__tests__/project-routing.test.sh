#!/bin/bash
# Each open project gets its own events, whichever session started last.
#
# @behavior A user has two projects open, A and B (B's session started last, so
#           ~/.oss/current-project names B). A command running inside A (any subfolder, no
#           CLAUDE_PROJECT_DIR: the Bash tool does not set it) sends its status, log and error
#           events to A's .oss - never to B's. From a repo with no .oss, or one whose .oss is a
#           committed link, the events go to the user's own ~/.oss (never the link target, never B).
# @business-rule notify-routing-unify D1: project = CLAUDE_PROJECT_DIR if set, else the nearest
#           real (not linked) .oss walking up from the cwd, bounded by the git toplevel, else none
#           (~/.oss). ~/.oss/current-project is never read for routing by a model-run script. One
#           shell resolver (oss_resolve_project in hooks/oss-safe-path.sh) and one TS function.
#
# The REAL hooks and the REAL built CLIs from this checkout are run.
# Usage: ./hooks/__tests__/project-routing.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/project-routing.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running project-routing tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

T=$(cd "$(mktemp -d /tmp/oss-routing.XXXXXX)" && pwd -P)
trap 'rm -rf "$T"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR

N=0
# world: H = sandbox HOME; A, B = real repos with a real .oss; current-project = B.
#        C = a repo with no .oss; D = a repo whose .oss is a link to $LT.
world() {
    N=$((N + 1)); local w="$T/w$N"
    H="$w/home"; A="$H/projA"; B="$H/projB"; C="$H/projC"; D="$H/projD"; LT="$w/linktarget"
    mkdir -p "$H/.oss" "$A/.oss" "$A/sub/deep" "$B/.oss" "$C/sub" "$D" "$LT"
    for r in "$A" "$B" "$C" "$D"; do (cd "$r" && git init -q) >/dev/null 2>&1; done
    ln -s "$LT" "$D/.oss"
    printf '%s\n' "$B" > "$H/.oss/current-project"
}
# run <cwd> <cmd...>: as the Bash tool runs it - no CLAUDE_PROJECT_DIR; sets OUT (stdout+stderr), RC
run() {
    local cwd="$1"; shift
    OUT=$(cd "$cwd" && env -u CLAUDE_PROJECT_DIR HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_WATCHER=1 "$@" 2>&1 </dev/null); RC=$?
}
has_log() { grep -qF -- "$2" "$1/.oss/logs/current-session/build.log" 2>/dev/null; }   # <project> <text>
untouched() { [[ -z "$(ls -A "$B/.oss")" ]]; }                                         # B gets nothing
lt_empty() { [[ -z "$(ls -A "$LT")" ]]; }

# --- T1: oss-notify.sh's own state write (--project-dir it hands update-workflow-state) --------
for ev in start complete failed; do
    ctx='{}'; [[ "$ev" == failed ]] && ctx='{"reason":"r"}'
    world; run "$A/sub/deep" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build "$ev" "$ctx"
    [[ -f "$A/.oss/workflow-state.json" && ! -e "$B/.oss/workflow-state.json" && ! -e "$H/.oss/workflow-state.json" ]] \
        && pass "T1: notify $ev from A/sub/deep (current-project = B): the status-line state is A's, never B's" \
        || fail "T1: notify $ev from A/sub/deep (current-project = B): the status-line state is A's, never B's" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
done
# control: CLAUDE_PROJECT_DIR still wins (unchanged behaviour)
world; OUT=$(cd "$C" && env HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" OSS_SKIP_WATCHER=1 CLAUDE_PROJECT_DIR="$A" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build start '{}' 2>&1 </dev/null)
[[ -f "$A/.oss/workflow-state.json" ]] && has_log "$A" "[start]" \
    && pass "T1 control: CLAUDE_PROJECT_DIR=A from repo C sends state and log to A" || fail "T1 control: CLAUDE_PROJECT_DIR=A from repo C sends state and log to A" "A:$(ls -A "$A/.oss") out=$OUT"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
