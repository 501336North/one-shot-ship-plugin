#!/bin/bash
# A cloned repo cannot make an OSS hook or CLI write outside the repo through a link it committed.
#
# @behavior A user opens a repo that commits `.oss/workflow-state.json -> ~/.zshrc` (or links
#           .oss, .oss/logs, current-session, workflow.log, .gitignore, .claude/settings.local.json,
#           .oss/dev/completed, ...). Running ordinary OSS events in that repo leaves every file and
#           directory outside the repo byte-identical; the hook prints one refusal line and exits 0.
# @business-rule ADR-1 (oss-writer-nofollow): every write under <project>/.oss goes through ONE
#           guard per runtime (hooks/oss-safe-path.sh, watcher/src/utils/safe-project-write.ts):
#           no symlinked component, each directory owned by the user, the target absent or a
#           regular file with link count 1. A normal repo still gets its state and logs (control).
#
# The REAL hooks and the REAL built CLIs from this checkout are run (watcher/dist must be built).
# Usage: ./hooks/__tests__/oss-writer-nofollow.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-writer-nofollow.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
DIST="$ROOT/watcher/dist"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-writer-nofollow tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

# --- world --------------------------------------------------------------------------------------
# $T/outside holds the victims: a text file, a JSON file, and a directory with one sentinel file.
# Every case snapshots $T/outside first and asserts the snapshot is unchanged afterwards.
world() {
    # Not under $TMPDIR: other suites' setup sweeps `find $TMPDIR -name watcher.pid -delete`,
    # which would delete the sentinel this suite uses to catch session-start's rm.
    T=$(cd "$(mktemp -d /tmp/oss-nofollow.XXXXXX)" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/outside/dir"
    printf 'VICTIM rc file\n' > "$T/outside/victim.txt"
    printf '{"keep": true}\n' > "$T/outside/victim.json"
    printf 'sentinel\n' > "$T/outside/dir/sentinel"
    printf 'pid\n' > "$T/outside/dir/watcher.pid"
    printf '{"keep": true}\n' > "$T/outside/dir/workflow-state.json"
    printf 'cfg\n' > "$T/outside/dir/config.json"
    mkdir -p "$T/outside/dir/logs"; printf 'old\n' > "$T/outside/dir/logs/old.log"
}
snapshot() {
    (cd "$T/outside" && find . -print | LC_ALL=C sort | while IFS= read -r p; do
        if [[ -L "$p" ]]; then echo "L $p"
        elif [[ -d "$p" ]]; then echo "D $p"
        else echo "F $p $(cksum < "$p")"; fi
    done)
}
# A repo whose committed tree holds the links, cloned the way a user gets it.
#   evil_repo <name> <setup-function>   -> sets P to the clone (inside $HOME)
evil_repo() {
    local src="$T/src-$1"
    mkdir -p "$src"
    # The user's global and XDG excludes (often .claude/settings.local.json) must not drop a link: add -f.
    (cd "$src" && export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 && git init -q && git config user.email t@example.invalid && git config user.name t \
        && "$2" && git add -A -f && git commit -qm evil) >/dev/null 2>&1
    P="$T/home/$1"
    git clone -q "$src" "$P" >/dev/null 2>&1
}
clean_repo() { P="$T/home/$1"; mkdir -p "$P"; (cd "$P" && git init -q) >/dev/null 2>&1; }

# Run a hook/CLI as the user would: temp HOME, this checkout as the plugin, cwd = the project.
run_in() { # run_in <project> <cmd...>
    local proj="$1"; shift
    (cd "$proj" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$proj" \
        OSS_SKIP_HEALTH_CHECK=1 "$@" </dev/null)
}
# Session start under a name other suites' setup does not `pkill -f oss-session-start`: a copy of
# this checkout's hooks as a plugin root whose watcher/ is this checkout's built watcher.
session_start() { # session_start <project>
    mkdir -p "$T/plugin"; cp -R "$ROOT/hooks" "$T/plugin/hooks"; ln -s "$ROOT/watcher" "$T/plugin/watcher"
    cp "$ROOT/hooks/oss-session-start.sh" "$T/plugin/hooks/s-start.sh"
    (cd "$1" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$1" \
        OSS_SKIP_HEALTH_CHECK=1 "$SH" "$T/plugin/hooks/s-start.sh" </dev/null)
}
logged_in() { echo '{"apiKey":"ossk_test_key","apiUrl":"https://example.invalid"}' > "$T/home/.oss/config.json"; }

# check <name> <before-snapshot> <rc> <out>: outside unchanged, rc 0
check() {
    local name="$1" before="$2" rc="$3" out="$4" after
    after=$(snapshot)
    if [[ "$before" == "$after" && "$rc" -eq 0 ]]; then pass "$name"
    else fail "$name" "rc=$rc outside-changed=$([[ "$before" == "$after" ]] && echo no || echo YES) diff=[$(diff <(echo "$before") <(echo "$after") | tr '\n' ' ')] out=[$(echo "$out" | tail -3 | tr '\n' ' ')]"; fi
}

# --- link layouts committed by the malicious repo ------------------------------------------------
l_state()    { mkdir -p .oss && ln -s "$T/outside/victim.json" .oss/workflow-state.json; }
l_wflog()    { mkdir -p .oss && ln -s "$T/outside/victim.txt" .oss/workflow.log; }
l_logs()     { mkdir -p .oss && ln -s "$T/outside/dir" .oss/logs; }
l_cursess()  { mkdir -p .oss/logs && ln -s "$T/outside/dir" .oss/logs/current-session; }
l_sesslog()  { mkdir -p .oss/logs/current-session && ln -s "$T/outside/victim.txt" .oss/logs/current-session/session.log; }
l_cmdlog()   { mkdir -p .oss/logs/current-session && ln -s "$T/outside/victim.txt" .oss/logs/current-session/build.log; }
l_ossdir()   { ln -s "$T/outside/dir" .oss; }
l_gitign()   { ln -s "$T/outside/victim.txt" .gitignore; }
l_settings() { mkdir -p .claude && ln -s "$T/outside/victim.json" .claude/settings.local.json; }
l_ctx()      { mkdir -p .oss && ln -s "$T/outside/victim.txt" .oss/session-context.md; }
l_cfg()      { mkdir -p .oss && ln -s "$T/outside/victim.txt" .oss/config.json; }
l_health()   { mkdir -p .oss && ln -s "$T/outside/victim.json" .oss/health-workflow-state.json; }
l_hclog()    { mkdir -p .oss/logs/current-session && ln -s "$T/outside/victim.txt" .oss/logs/current-session/health-check.log; }
l_queue()    { mkdir -p .oss && printf '%s\n' '{"version":"1.0","updated_at":"2026-01-01T00:00:00.000Z","tasks":[{"id":"t1","created_at":"2026-01-01T00:00:00.000Z","priority":"high","source":"log-monitor","anomaly_type":"agent_stuck","prompt":"do x","suggested_agent":"debugger","context":{},"status":"pending","attempts":0}]}' > .oss/queue.json && ln -s "$T/outside/victim.txt" .oss/queue.json.tmp; }
l_complete() {
    mkdir -p .oss/dev/active/feat && printf '# Progress\n\n## Current Phase: ship (COMPLETE)\n\n- [x] done\n' > .oss/dev/active/feat/PROGRESS.md
    ln -s "$T/outside/dir" .oss/dev/completed
}
l_none()     { echo hi > README.md; }

# =================================================================================================
# 1. oss-log.sh write — the most frequent sink (every logged event)
# =================================================================================================
for c in logs cursess sesslog cmdlog ossdir; do
    world; evil_repo "p-$c" "l_$c"; before=$(snapshot)
    out=$(run_in "$P" "$SH" "$ROOT/hooks/oss-log.sh" write build "hello" 2>&1); rc=$?
    check "oss-log.sh write: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done
# hard link (git cannot deliver one; a local attacker or tool could)
world; clean_repo p-hard; mkdir -p "$P/.oss/logs/current-session"; ln "$T/outside/victim.txt" "$P/.oss/logs/current-session/session.log"
before=$(snapshot); out=$(run_in "$P" "$SH" "$ROOT/hooks/oss-log.sh" write build "hello" 2>&1); rc=$?
check "oss-log.sh write: hard-linked session.log is not appended to" "$before" "$rc" "$out"
rm -rf "$T"

# refusal is visible: one line on stderr naming the path
world; evil_repo p-msg l_logs
err=$(run_in "$P" "$SH" "$ROOT/hooks/oss-log.sh" write build "hello" 2>&1 >/dev/null); rc=$?
if [[ $rc -eq 0 && "$err" == *"oss: refusing unsafe .oss path"* ]]; then pass "oss-log.sh: refusal prints 'oss: refusing unsafe .oss path' and exits 0"
else fail "oss-log.sh: refusal prints 'oss: refusing unsafe .oss path' and exits 0" "rc=$rc err=$err"; fi
rm -rf "$T"

# health workflow state (oss-log.sh workflow set-feature), routed via ~/.oss/current-project
world; evil_repo p-health l_health; echo "$P" > "$T/home/.oss/current-project"; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" CLAUDE_PROJECT_DIR="" "$SH" "$ROOT/hooks/oss-log.sh" workflow set-feature evil 2>&1); rc=$?
check "oss-log.sh workflow set-feature: committed health-workflow-state.json link is not written" "$before" "$rc" "$out"
rm -rf "$T"

# health-check.log (oss-log.sh health-check tees the CLI output into current-session)
world; evil_repo p-hclog l_hclog; echo "$P" > "$T/home/.oss/current-project"
mkdir -p "$T/fakeplugin/watcher/dist/cli"; printf 'console.log("hc ok")\n' > "$T/fakeplugin/watcher/dist/cli/health-check.js"
echo "$T/fakeplugin" > "$T/home/.oss/plugin-root"; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" CLAUDE_PROJECT_DIR="$P" "$SH" "$ROOT/hooks/oss-log.sh" health-check 2>&1); rc=0  # rc is the CLI's
check "oss-log.sh health-check: committed health-check.log link is not written" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 2. oss-notify.sh --workflow (log line + workflow-state via the real update-workflow-state.js)
# =================================================================================================
for c in state logs ossdir; do
    world; evil_repo "p-n$c" "l_$c"; before=$(snapshot)
    out=$(run_in "$P" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build failed '{"reason":"x"}' 2>&1); rc=$?
    check "oss-notify.sh --workflow build failed: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done
# the plugin wrapper's ordinary start event, routed via ~/.oss/current-project (single-session user)
world; evil_repo p-nstart l_state; echo "$P" > "$T/home/.oss/current-project"; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build start 2>&1 </dev/null); rc=$?
check "oss-notify.sh --workflow build start via current-project: state link is not written" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 3. update-workflow-state.js (every status-line update)
# =================================================================================================
for c in state ossdir; do
    world; evil_repo "p-u$c" "l_$c"; before=$(snapshot)
    out=$(run_in "$P" node "$DIST/cli/update-workflow-state.js" --project-dir "$P" setSupervisor intervening 2>&1); rc=$?
    check "update-workflow-state.js setSupervisor: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done
world; clean_repo p-uhard; mkdir -p "$P/.oss"; ln "$T/outside/victim.json" "$P/.oss/workflow-state.json"; before=$(snapshot)
out=$(run_in "$P" node "$DIST/cli/update-workflow-state.js" --project-dir "$P" setSupervisor intervening 2>&1); rc=$?
check "update-workflow-state.js setSupervisor: hard-linked state file is not written" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 4. oss-error.js (OSS_ERROR append to .oss/workflow.log)
# =================================================================================================
for c in wflog ossdir; do
    world; evil_repo "p-e$c" "l_$c"; before=$(snapshot)
    out=$(run_in "$P" node "$DIST/cli/oss-error.js" --code OSS-WORKFLOW-902 --severity MEDIUM --message boom --source test 2>&1); rc=$?
    check "oss-error.js: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done
world; clean_repo p-ehard; mkdir -p "$P/.oss"; ln "$T/outside/victim.txt" "$P/.oss/workflow.log"; before=$(snapshot)
out=$(run_in "$P" node "$DIST/cli/oss-error.js" --code OSS-WORKFLOW-902 --severity MEDIUM --message boom --source test 2>&1); rc=$?
check "oss-error.js: hard-linked workflow.log is not appended to" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 5. drain-queue.js (precommand drains a committed queue; persist writes queue.json.tmp)
# =================================================================================================
world; evil_repo p-queue l_queue; before=$(snapshot)
out=$(run_in "$P" node "$DIST/drain-queue.js" 2>&1); rc=$?
check "drain-queue.js: committed queue.json.tmp link is not written" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 6. Session hooks: start (.oss, .gitignore, settings.local.json, watcher.pid) and end (context)
# =================================================================================================
for c in gitign settings ossdir; do
    world; logged_in; evil_repo "p-s$c" "l_$c"; before=$(snapshot)
    out=$(session_start "$P" 2>&1); rc=$?
    check "oss-session-start.sh: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done
for c in ctx ossdir; do
    world; evil_repo "p-x$c" "l_$c"; before=$(snapshot)
    out=$(run_in "$P" "$SH" "$ROOT/hooks/oss-session-end.sh" 2>&1); rc=$?
    check "oss-session-end.sh: committed $c link does not write outside" "$before" "$rc" "$out"
    rm -rf "$T"
done

# =================================================================================================
# 7. Worktree hooks: create copies the API key into .oss/config.json; remove deletes under .oss
# =================================================================================================
for c in cfg state ossdir; do
    world; logged_in; evil_repo "p-w$c" "l_$c"; before=$(snapshot)
    out=$(cd "$P" && HOME="$T/home" CLAUDE_WORKTREE_PATH="$P" "$SH" "$ROOT/hooks/oss-worktree-create.sh" 2>&1 </dev/null); rc=$?
    check "oss-worktree-create.sh: committed $c link does not write outside" "$before" "$rc" "$out"
    if grep -rq ossk_test_key "$T/outside" 2>/dev/null; then fail "oss-worktree-create.sh ($c): API key never lands outside the worktree" "found in $T/outside"
    else pass "oss-worktree-create.sh ($c): API key never lands outside the worktree"; fi
    rm -rf "$T"
done
world; evil_repo p-wrm l_ossdir; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" CLAUDE_WORKTREE_PATH="$P" "$SH" "$ROOT/hooks/oss-worktree-remove.sh" 2>&1 </dev/null); rc=$?
check "oss-worktree-remove.sh: committed .oss link does not delete outside files" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 8. oss-archive-check.sh (runs before /oss:plan): .oss/dev/completed -> outside dir
# =================================================================================================
world; evil_repo p-arch l_complete; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" "$SH" "$ROOT/hooks/oss-archive-check.sh" --project-dir="$P" 2>&1 </dev/null); rc=$?
check "oss-archive-check.sh: committed dev/completed link does not move dev docs outside" "$before" "$rc" "$out"
rm -rf "$T"

# G1: a committed dev/active/<name> link to an outside dir must not pull that dir into the repo
l_activelink() {
    mkdir -p .oss/dev/active && ln -s "$T/outside/dir" .oss/dev/active/evil
}
world; printf '# Progress\n\n## Current Phase: ship (COMPLETE)\n' > "$T/outside/dir/PROGRESS.md"
evil_repo p-arch2 l_activelink; before=$(snapshot)
out=$(cd "$P" && HOME="$T/home" "$SH" "$ROOT/hooks/oss-archive-check.sh" --project-dir="$P" 2>&1 </dev/null); rc=$?
check "oss-archive-check.sh: committed dev/active/<name> link does not move the outside dir" "$before" "$rc" "$out"
rm -rf "$T"

# =================================================================================================
# 9. Controls: an ordinary repo still gets state, logs, gitignore, settings, context, archive
# =================================================================================================
world; logged_in; clean_repo p-ok
session_start "$P" >/dev/null 2>&1
run_in "$P" "$SH" "$ROOT/hooks/oss-log.sh" write build "hello" >/dev/null 2>&1
run_in "$P" node "$DIST/cli/update-workflow-state.js" --project-dir "$P" setSupervisor intervening >/dev/null 2>&1
run_in "$P" node "$DIST/cli/oss-error.js" --code OSS-WORKFLOW-902 --severity MEDIUM --message boom --source test >/dev/null 2>&1
supervisor=$(jq -r .supervisor "$P/.oss/workflow-state.json" 2>/dev/null)
run_in "$P" "$SH" "$ROOT/hooks/oss-session-end.sh" >/dev/null 2>&1
if grep -q 'hello' "$P/.oss/logs/current-session/build.log" 2>/dev/null \
   && grep -q 'hello' "$P/.oss/logs/current-session/session.log" 2>/dev/null; then pass "control: a normal repo still gets its logs"
else fail "control: a normal repo still gets its logs" "$(ls -R "$P/.oss" 2>&1 | head -20 | tr '\n' ' ')"; fi
if [[ "$supervisor" == intervening ]]; then pass "control: a normal repo still gets its workflow state"
else fail "control: a normal repo still gets its workflow state" "supervisor=$supervisor"; fi
if grep -q OSS_ERROR "$P/.oss/workflow.log" 2>/dev/null; then pass "control: a normal repo still gets OSS_ERROR in workflow.log"
else fail "control: a normal repo still gets OSS_ERROR in workflow.log" "$(cat "$P/.oss/workflow.log" 2>&1)"; fi
if grep -q '^\.oss/\*$' "$P/.gitignore" 2>/dev/null && grep -q 'oss-log.sh' "$P/.claude/settings.local.json" 2>/dev/null; then pass "control: a normal repo still gets .gitignore and settings.local.json"
else fail "control: a normal repo still gets .gitignore and settings.local.json" "gi=$(cat "$P/.gitignore" 2>&1)"; fi
if [[ -f "$P/.oss/session-context.md" ]]; then pass "control: a normal repo still gets session-context.md"
else fail "control: a normal repo still gets session-context.md" "missing"; fi
rm -rf "$T"

world; clean_repo p-okarch
mkdir -p "$P/.oss/dev/active/feat"; printf '# Progress\n\n## Current Phase: ship (COMPLETE)\n\n- [x] done\n' > "$P/.oss/dev/active/feat/PROGRESS.md"
(cd "$P" && HOME="$T/home" "$SH" "$ROOT/hooks/oss-archive-check.sh" --project-dir="$P" >/dev/null 2>&1 </dev/null)
if ls -d "$P/.oss/dev/completed/feat-"* >/dev/null 2>&1 && [[ ! -d "$P/.oss/dev/active/feat" ]]; then pass "control: a normal repo still archives completed features"
else fail "control: a normal repo still archives completed features" "$(ls -R "$P/.oss/dev" 2>&1 | tr '\n' ' ')"; fi
rm -rf "$T"

world; logged_in; clean_repo p-okwt
(cd "$P" && HOME="$T/home" CLAUDE_WORKTREE_PATH="$P" "$SH" "$ROOT/hooks/oss-worktree-create.sh" >/dev/null 2>&1 </dev/null)
if grep -q ossk_test_key "$P/.oss/config.json" 2>/dev/null && [[ -f "$P/.oss/workflow-state.json" ]]; then pass "control: a normal worktree still gets config.json and workflow-state.json"
else fail "control: a normal worktree still gets config.json and workflow-state.json" "$(ls -la "$P/.oss" 2>&1 | tr '\n' ' ')"; fi
(cd "$P" && HOME="$T/home" CLAUDE_WORKTREE_PATH="$P" "$SH" "$ROOT/hooks/oss-worktree-remove.sh" >/dev/null 2>&1 </dev/null)
if [[ ! -e "$P/.oss/config.json" && ! -e "$P/.oss/workflow-state.json" ]]; then pass "control: a normal worktree is still cleaned up on remove"
else fail "control: a normal worktree is still cleaned up on remove" "$(ls -la "$P/.oss" 2>&1 | tr '\n' ' ')"; fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
