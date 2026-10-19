#!/bin/bash
# oss-notify.sh --workflow <cmd> complete is bounded, quiet and keeps its debug log.
#
# @behavior Finishing a command never hangs on a stalled helper, prints only what the model needs
#           (the CHAIN block), and chain-trigger's own errors land in ~/.oss/logs/chain-trigger.log.
# @business-rule F4: the Telegram send is bounded (15s). F8: each workflow-state update on complete
#           is bounded (2s, like every other bounded state call in the file). F7: the state CLI's
#           status lines ("Step completed: ...") are not printed into the model's context on complete.
#           F6: run_with_timeout keeps stderr, so a caller's 2>> redirect receives it; callers that
#           must stay quiet redirect stderr themselves.
#
# Time cost: about 27s (cases 1 and 4 wait for the real 15s and 6 x 2s bounds).
#
# Usage: ./hooks/__tests__/oss-notify-complete-bounds.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notify-complete-bounds tests..."

# Sandbox: temp HOME and a fake plugin root. The fake `node` acts as each CLI, per $STATE / $TELEGRAM.
sandbox() {
    T=$(mktemp -d)
    mkdir -p "$T/home/.oss" "$T/plugin/hooks" "$T/plugin/watcher/dist/cli" "$T/bin"
    printf '#!/bin/sh\nexit 0\n' > "$T/plugin/hooks/oss-log.sh"
    cat > "$T/bin/node" <<EOF
#!/bin/bash
echo "\$*" >> "$T/node.calls"
case "\$1" in
  *update-workflow-state.js)
    [[ "\${STATE:-}" == hang ]] && exec sleep 20
    echo "STATE-STDOUT \$*"; echo "STATE-STDERR \$*" >&2 ;;
  *chain-trigger.cjs)
    echo "---CHAIN_COMMANDS---"; echo "CHAIN: /oss:review (always)"; echo "---END_CHAIN_COMMANDS---"
    echo "No API key configured. Run /oss:login" >&2; exit 1 ;;
  *telegram-notify.js)
    [[ "\${TELEGRAM:-}" == hang ]] && exec sleep 30 ;;
esac
exit 0
EOF
    chmod +x "$T/plugin/hooks/oss-log.sh" "$T/bin/node"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    : > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    : > "$T/plugin/watcher/dist/cli/telegram-notify.js"
}
run_notify() {
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$PATH" \
        "$SH" "$ROOT/hooks/oss-notify.sh" "$@" </dev/null >"$T/out" 2>"$T/err")
}

# 1. F4: a Telegram send that stalls for 30s is cut off at the 15s bound.
sandbox
echo '{"notifications":{"telegram":{"enabled":true}}}' > "$T/home/.oss/settings.json"
start=$(date +%s); TELEGRAM=hang run_notify --workflow audit complete; took=$(( $(date +%s) - start ))
if [[ $took -lt 24 ]] && grep -q "telegram-notify.js --message" "$T/node.calls"; then
    pass "a stalled Telegram send returns within its 15s bound (took ${took}s)"
else fail "a stalled Telegram send returns within its 15s bound" "took=${took}s calls=$(tr '\n' '|' < "$T/node.calls")"; fi
rm -rf "$T"

# 2. F6: chain-trigger's stderr lands in chain-trigger.log.
sandbox
run_notify --workflow build complete
if grep -q "No API key configured" "$T/home/.oss/logs/chain-trigger.log" 2>/dev/null; then
    pass "chain-trigger stderr lands in ~/.oss/logs/chain-trigger.log"
else fail "chain-trigger stderr lands in ~/.oss/logs/chain-trigger.log" "log=$(cat "$T/home/.oss/logs/chain-trigger.log" 2>/dev/null)"; fi

# 3. F7: on complete the model sees the CHAIN block and no workflow-state status lines.
if grep -q "^CHAIN: /oss:review (always)$" "$T/out" && ! grep -q "STATE-" "$T/out" "$T/err"; then
    pass "complete prints the CHAIN block and no workflow-state status lines"
else fail "complete prints the CHAIN block and no workflow-state status lines" "out=$(tr '\n' '|' < "$T/out") err=$(tr '\n' '|' < "$T/err")"; fi
rm -rf "$T"

# 4. F8: a hanging state CLI cannot hold complete open (ship makes 6 updates x 2s bound; one unbounded update alone adds 20s).
sandbox
start=$(date +%s); STATE=hang run_notify --workflow ship complete; took=$(( $(date +%s) - start ))
if [[ $took -lt 20 ]] && [[ $(grep -c "update-workflow-state.js" "$T/node.calls") -eq 6 ]]; then
    pass "a hanging workflow-state CLI is bounded on complete (took ${took}s)"
else fail "a hanging workflow-state CLI is bounded on complete" "took=${took}s calls=$(tr '\n' '|' < "$T/node.calls")"; fi
rm -rf "$T"

# 5. F6 control: the other bounded state calls (session events) still keep the CLI's stderr out.
sandbox
run_notify --session context_saved
if grep -q "setSupervisor idle" "$T/node.calls" && ! grep -q "STATE-STDERR" "$T/err"; then
    pass "session state updates keep the state CLI's stderr out of the hook's output"
else fail "session state updates keep the state CLI's stderr out of the hook's output" "err=$(tr '\n' '|' < "$T/err")"; fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
