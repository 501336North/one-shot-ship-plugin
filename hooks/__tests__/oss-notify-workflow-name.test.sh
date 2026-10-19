#!/bin/bash
# oss-notify.sh --workflow refuses a workflow name that is not a plain command name.
#
# @behavior `oss-notify.sh --workflow 'build/../ship' complete` does nothing: no log line, no state
#           change, no chain-trigger (so ship's chain never fires), rc 0 and one stderr note.
#           Ordinary names (build, ship, plan, a team's custom-cmd) behave exactly as before.
# @business-rule A workflow name reaches file paths (oss-log.sh <name>.log), URLs/JSON (analytics)
#           and chain-trigger, so it must match ^[a-z][a-z0-9-]{0,40}$ (oss_valid_workflow_name in
#           hooks/oss-safe-path.sh; twin of isValidWorkflowName in watcher/src/utils/workflow-name.ts).
#           Context values are serialised as JSON data, never pasted into JSON text.
#
# Usage: ./hooks/__tests__/oss-notify-workflow-name.test.sh
#        BASH_UNDER_TEST=/opt/local/bin/bash ./hooks/__tests__/oss-notify-workflow-name.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notify-workflow-name tests under $("$SH" -c 'echo "$BASH_VERSION"') ($SH)..."

# Sandbox: temp HOME, a fake plugin root whose oss-log.sh and node record what they were asked.
sandbox() {
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/plugin/hooks" "$T/plugin/watcher/dist/cli" "$T/bin"
    printf '#!/bin/sh\necho "$*" >> "%s/log.calls"\n' "$T" > "$T/plugin/hooks/oss-log.sh"
    cat > "$T/bin/node" <<EOF
#!/bin/bash
echo "\$*" >> "$T/node.calls"
prev=""; for a in "\$@"; do [[ "\$prev" == setProgress ]] && printf '%s' "\$a" > "$T/progress.arg"; prev="\$a"; done
exit 0
EOF
    chmod +x "$T/plugin/hooks/oss-log.sh" "$T/bin/node"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    : > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
}
run_notify() {
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$PATH" \
        "$SH" "$ROOT/hooks/oss-notify.sh" "$@" </dev/null)
}

# 1. Traversal-shaped name on complete: nothing logged, no state, no chain; rc 0 with a note.
for name in 'build/../ship' 'Build' '../x' 'build;ship' '-ship' "$(printf 'a%.0s' {1..42})"; do
    sandbox
    err=$(run_notify --workflow "$name" complete 2>&1 >/dev/null); rc=$?
    if [[ $rc -eq 0 && ! -e "$T/log.calls" && ! -e "$T/node.calls" && "$err" == *"invalid workflow name"* ]]; then
        pass "invalid workflow name '$name' is refused: no log, no state, no chain, rc 0"
    else fail "invalid workflow name '$name' is refused: no log, no state, no chain, rc 0" \
        "rc=$rc err=$err log=$(cat "$T/log.calls" 2>/dev/null | tr '\n' '|') node=$(cat "$T/node.calls" 2>/dev/null | tr '\n' '|')"; fi
    rm -rf "$T"
done

# 2. Controls: ordinary names still log, update state and fire the chain.
for name in build ship custom-cmd2; do
    sandbox
    run_notify --workflow "$name" complete >/dev/null 2>&1; rc=$?
    if [[ $rc -eq 0 ]] && grep -q "^write $name \[complete\]" "$T/log.calls" 2>/dev/null \
       && grep -q "chain-trigger.cjs --workflow $name\$" "$T/node.calls" 2>/dev/null; then
        pass "valid workflow name '$name' still logs and fires its chain"
    else fail "valid workflow name '$name' still logs and fires its chain" \
        "rc=$rc log=$(cat "$T/log.calls" 2>/dev/null | tr '\n' '|') node=$(cat "$T/node.calls" 2>/dev/null | tr '\n' '|')"; fi
    rm -rf "$T"
done

# 3. No context argument: the default is an empty JSON object, so the log line carries no "'{}'".
sandbox
run_notify --workflow build failed >/dev/null 2>&1
if [[ "$(cat "$T/log.calls" 2>/dev/null)" == "write build [failed]" ]]; then pass "default context is {} (log line is exactly '[failed]')"
else fail "default context is {} (log line is exactly '[failed]')" "log=$(cat "$T/log.calls" 2>/dev/null)"; fi
rm -rf "$T"

# 3b. Same default for --session and --issue (same defect, same fix).
sandbox
run_notify --session context_saved >/dev/null 2>&1
run_notify --issue loop_detected >/dev/null 2>&1
if [[ "$(cat "$T/log.calls" 2>/dev/null)" == "$(printf 'write session [context_saved] {}\nwrite issue [loop_detected] {}')" ]]; then
    pass "--session/--issue default context is {} (no literal quotes)"
else fail "--session/--issue default context is {} (no literal quotes)" "log=$(cat "$T/log.calls" 2>/dev/null | tr '\n' '|')"; fi
rm -rf "$T"

# 4. task_complete: a task name with quotes reaches setProgress as data in valid JSON.
sandbox
run_notify --workflow build task_complete '{"current":3,"total":9,"taskName":"Fix \"quoted\", \"x\": 1"}' >/dev/null 2>&1
arg=$(cat "$T/progress.arg" 2>/dev/null)
if command -v jq >/dev/null 2>&1 \
   && [[ "$(printf '%s' "$arg" | jq -r '.currentTask' 2>/dev/null)" == 'Fix "quoted", "x": 1' ]] \
   && [[ "$(printf '%s' "$arg" | jq -r '.progress' 2>/dev/null)" == '3/9' ]] \
   && [[ "$(printf '%s' "$arg" | jq -r 'keys | join(",")' 2>/dev/null)" == 'currentTask,progress' ]]; then
    pass "task_complete builds setProgress JSON from data (quotes in a task name stay data)"
else fail "task_complete builds setProgress JSON from data (quotes in a task name stay data)" "arg=$arg"; fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
