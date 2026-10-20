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
    local r; H="$w/home"; A="$H/projA"; B="$H/projB"; C="$H/projC"; D="$H/projD"; LT="$w/linktarget"
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

# --- T2: every oss-log.sh resolution site (log base, phase/agent state, health state/check) ----
# log_case <label> <want-in-log> <cmd...>: from A/sub/deep -> A; from C (no .oss) and D (linked .oss) -> ~/.oss.
# B's logs are never written (B's state is T3: update-workflow-state's own fallback).
log_case() {
    local label="$1" want="$2"; shift 2
    world; run "$A/sub/deep" "$@"
    has_log "$A" "$want" && [[ ! -e "$B/.oss/logs" && ! -e "$H/.oss/logs/current-session" ]] \
        && pass "T2: $label from A/sub/deep (current-project = B) logs to A, never B" \
        || fail "T2: $label from A/sub/deep (current-project = B) logs to A, never B" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
    world; run "$C/sub" "$@"
    has_log "$H" "$want" && [[ ! -e "$B/.oss/logs" && ! -e "$C/.oss" ]] \
        && pass "T2: $label from a repo with no .oss logs to ~/.oss, never B" \
        || fail "T2: $label from a repo with no .oss logs to ~/.oss, never B" "rc=$RC home:$(ls -A "$H/.oss") B:$(ls -A "$B/.oss") out=$OUT"
    world; run "$D" "$@"
    has_log "$H" "$want" && [[ ! -e "$B/.oss/logs" ]] && lt_empty \
        && pass "T2: $label from a repo with a linked .oss logs to ~/.oss, never the link target or B" \
        || fail "T2: $label from a repo with a linked .oss logs to ~/.oss, never the link target or B" "rc=$RC home:$(ls -A "$H/.oss") LT:$(ls -A "$LT") out=$OUT"
}
for ev in start complete failed; do
    ctx='{}'; [[ "$ev" == failed ]] && ctx='{"reason":"r"}'
    log_case "notify $ev" "[$ev]" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build "$ev" "$ctx"
done
log_case "oss-log write" "hello-routing" "$SH" "$ROOT/hooks/oss-log.sh" write build hello-routing
log_case "oss-log test" "PASS" "$SH" "$ROOT/hooks/oss-log.sh" test build PASS "1/1"
log_case "oss-log phase" "RED start" "$SH" "$ROOT/hooks/oss-log.sh" phase build RED start
log_case "oss-log agent" "oss:debugger" "$SH" "$ROOT/hooks/oss-log.sh" agent build oss:debugger "starting: x"
# phase/agent also move the status line: A's state, never B's
world; run "$A/sub/deep" "$SH" "$ROOT/hooks/oss-log.sh" phase build RED start
grep -qF '"tddPhase": "red"' "$A/.oss/workflow-state.json" 2>/dev/null && [[ ! -e "$B/.oss/workflow-state.json" ]] \
    && pass "T2: oss-log phase RED start from A sets A's TDD phase, never B's" \
    || fail "T2: oss-log phase RED start from A sets A's TDD phase, never B's" "A:$(cat "$A/.oss/workflow-state.json" 2>&1 | head -5) B:$(ls -A "$B/.oss")"
world; run "$A/sub/deep" "$SH" "$ROOT/hooks/oss-log.sh" agent build oss:debugger "starting: x"
for _ in 1 2 3 4 5 6 7 8 9 10; do grep -qF 'oss:debugger' "$A/.oss/workflow-state.json" 2>/dev/null && break; sleep 0.3; done   # the state update runs in the background
grep -qF 'oss:debugger' "$A/.oss/workflow-state.json" 2>/dev/null && [[ ! -e "$B/.oss/workflow-state.json" ]] \
    && pass "T2: oss-log agent start from A sets A's active agent, never B's" \
    || fail "T2: oss-log agent start from A sets A's active agent, never B's" "A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss")"
world; run "$A/sub/deep" "$SH" "$ROOT/hooks/oss-log.sh" workflow set-feature feat-x
[[ -f "$A/.oss/health-workflow-state.json" && ! -e "$B/.oss/health-workflow-state.json" ]] \
    && pass "T2: oss-log workflow set-feature from A writes A's health state, never B's" \
    || fail "T2: oss-log workflow set-feature from A writes A's health state, never B's" "A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
world; mkdir -p "$T/hc$N/watcher/dist/cli"; printf 'console.log("hc cwd " + process.cwd())\n' > "$T/hc$N/watcher/dist/cli/health-check.js"
echo "$T/hc$N" > "$H/.oss/plugin-root"
run "$A/sub/deep" "$SH" "$ROOT/hooks/oss-log.sh" health-check
grep -qF "hc cwd $A" "$A/.oss/logs/current-session/health-check.log" 2>/dev/null && [[ ! -e "$B/.oss/logs" ]] \
    && pass "T2: oss-log health-check from A checks A and logs to A, never B" \
    || fail "T2: oss-log health-check from A checks A and logs to A, never B" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"

# --- T3: the TS CLIs (no --project-dir): oss-error and update-workflow-state -------------------
ERR_ARGS=(--code OSS-API-001 --severity HIGH --message routing-msg --source cmd:build)
world; run "$A/sub/deep" node "$ROOT/watcher/dist/cli/oss-error.js" "${ERR_ARGS[@]}"
grep -qF routing-msg "$A/.oss/workflow.log" 2>/dev/null && untouched \
    && pass "T3: oss-error from A/sub/deep (current-project = B) appends to A's workflow.log, never B's" \
    || fail "T3: oss-error from A/sub/deep (current-project = B) appends to A's workflow.log, never B's" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
for r in C D; do
    world; [[ $r == C ]] && cwd="$C/sub" || cwd="$D"
    run "$cwd" node "$ROOT/watcher/dist/cli/oss-error.js" "${ERR_ARGS[@]}"
    grep -qF routing-msg "$H/.oss/workflow.log" 2>/dev/null && untouched && lt_empty \
        && pass "T3: oss-error from repo $r (no real .oss) appends to ~/.oss/workflow.log, never B or a link target" \
        || fail "T3: oss-error from repo $r (no real .oss) appends to ~/.oss/workflow.log, never B or a link target" "rc=$RC home:$(ls -A "$H/.oss") B:$(ls -A "$B/.oss") LT:$(ls -A "$LT") out=$OUT"
done
world; run "$A/sub/deep" node "$ROOT/watcher/dist/cli/update-workflow-state.js" setSupervisor intervening
grep -qF intervening "$A/.oss/workflow-state.json" 2>/dev/null && untouched \
    && pass "T3: update-workflow-state from A/sub/deep writes A's state, never B's" \
    || fail "T3: update-workflow-state from A/sub/deep writes A's state, never B's" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
for r in C D; do
    world; [[ $r == C ]] && cwd="$C/sub" || cwd="$D"
    run "$cwd" node "$ROOT/watcher/dist/cli/update-workflow-state.js" setSupervisor intervening
    grep -qF intervening "$H/.oss/workflow-state.json" 2>/dev/null && untouched && lt_empty \
        && pass "T3: update-workflow-state from repo $r (no real .oss) writes ~/.oss state, never B or a link target" \
        || fail "T3: update-workflow-state from repo $r (no real .oss) writes ~/.oss state, never B or a link target" "rc=$RC home:$(ls -A "$H/.oss") B:$(ls -A "$B/.oss") LT:$(ls -A "$LT") out=$OUT"
done
# end to end: every hook event from C or D leaves B wholly untouched (log AND state)
for cwd in C D; do
    world; [[ $cwd == C ]] && d="$C/sub" || d="$D"
    run "$d" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build failed '{"reason":"r"}'
    run "$d" "$SH" "$ROOT/hooks/oss-log.sh" phase build RED start
    run "$d" "$SH" "$ROOT/hooks/oss-log.sh" agent build oss:debugger "starting: x"; sleep 1
    untouched && lt_empty && pass "T3: notify failed + phase + agent from repo $cwd leave B (and any link target) untouched" \
        || fail "T3: notify failed + phase + agent from repo $cwd leave B (and any link target) untouched" "B:$(ls -A "$B/.oss") LT:$(ls -A "$LT")"
done

# --- T4: TMPDIR unset (common on Linux): a project's log stays project-local --------------------
world; OUT=$(cd "$A/sub/deep" && env -u CLAUDE_PROJECT_DIR -u TMPDIR HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" "$SH" "$ROOT/hooks/oss-log.sh" write build tmpdir-unset 2>&1 </dev/null); RC=$?
has_log "$A" tmpdir-unset && [[ ! -e "$H/.oss/logs" ]] && [[ "$OUT" != *unbound* ]] \
    && pass "T4: with TMPDIR unset, oss-log write from A logs to A (no unbound-variable fallback to ~/.oss)" \
    || fail "T4: with TMPDIR unset, oss-log write from A logs to A (no unbound-variable fallback to ~/.oss)" "rc=$RC A:$(ls -A "$A/.oss") home:$(ls -A "$H/.oss") out=$OUT"
world; OUT=$(cd "$C" && env -u TMPDIR HOME="$H" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$A" "$SH" "$ROOT/hooks/oss-log.sh" write build tmpdir-unset-env 2>&1 </dev/null); RC=$?
has_log "$A" tmpdir-unset-env && [[ "$OUT" != *unbound* ]] \
    && pass "T4: with TMPDIR unset, CLAUDE_PROJECT_DIR=A still logs to A" \
    || fail "T4: with TMPDIR unset, CLAUDE_PROJECT_DIR=A still logs to A" "rc=$RC A:$(ls -A "$A/.oss") out=$OUT"

# --- T5: oss-value.sh failed routes by the same walk; there is ONE copy of the walk ------------
vfailed() { # <cwd>: write reason.txt into the cwd's value folder, then send it
    local vd; vd=$(cd "$1" && env -u CLAUDE_PROJECT_DIR HOME="$H" "$SH" "$ROOT/hooks/oss-value.sh" dir 2>/dev/null </dev/null)
    [[ -n "$vd" ]] && echo routing-reason > "$vd/reason.txt"
    run "$1" "$SH" "$ROOT/hooks/oss-value.sh" failed build
}
world; vfailed "$A/sub/deep"
has_log "$A" routing-reason && untouched \
    && pass "T5: oss-value failed from A/sub/deep (current-project = B) lands in A, never B" \
    || fail "T5: oss-value failed from A/sub/deep (current-project = B) lands in A, never B" "rc=$RC A:$(ls -A "$A/.oss") B:$(ls -A "$B/.oss") out=$OUT"
world; vfailed "$D"
has_log "$H" routing-reason && untouched && lt_empty \
    && pass "T5: oss-value failed from a repo with a linked .oss lands in ~/.oss, never the link target or B" \
    || fail "T5: oss-value failed from a repo with a linked .oss lands in ~/.oss, never the link target or B" "rc=$RC home:$(ls -A "$H/.oss") LT:$(ls -A "$LT") out=$OUT"
copies=$(cd "$ROOT/hooks" && grep -lF '"$d/.oss"' ./*.sh | tr '\n' ' ')
[[ "$copies" == "./oss-safe-path.sh " ]] && grep -qF 'oss_project_walk' "$ROOT/hooks/oss-value.sh" \
    && pass "T5: the .oss walk exists once (hooks/oss-safe-path.sh); oss-value.sh uses it" \
    || fail "T5: the .oss walk exists once (hooks/oss-safe-path.sh); oss-value.sh uses it" "walk found in: $copies"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
