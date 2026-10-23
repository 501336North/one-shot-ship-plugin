#!/bin/bash
# oss-notify.sh --workflow <cmd> complete is bounded, quiet and keeps its debug log.
#
# @behavior Finishing a command never hangs on a stalled helper, prints only what the model needs
#           (the CHAIN block), and chain-trigger's own errors land in ~/.oss/logs/chain-trigger.log.
# @business-rule F8: each workflow-state update on complete is bounded (2s, like every other bounded
#           state call in the file). F7: the state CLI's
#           status lines ("Step completed: ...") are not printed into the model's context on complete.
#           F6: run_with_timeout keeps stderr, so a caller's 2>> redirect receives it; callers that
#           must stay quiet redirect stderr themselves.
#
# Time cost: about 15s (case 4 waits for the real 6 x 2s bounds; case 6 settles 1s).
#
# Usage: ./hooks/__tests__/oss-notify-complete-bounds.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-notify-complete-bounds tests..."

# Sandbox: temp HOME and a fake plugin root. The fake `node` acts as each CLI, per $STATE.
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
esac
exit 0
EOF
    chmod +x "$T/plugin/hooks/oss-log.sh" "$T/bin/node"
    : > "$T/plugin/watcher/dist/cli/update-workflow-state.js"
    : > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
}
run_notify() {
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$PATH" \
        "$SH" "$ROOT/hooks/oss-notify.sh" "$@" </dev/null >"$T/out" 2>"$T/err")
}

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

# 6. R2-1: on a host with neither timeout nor gtimeout (stock macOS), the fallback timer must not hold
#    the hook's stdout open, print a job notice, or leave its sleep behind. A pipe reader returns at once.
sandbox
mkdir -p "$T/sys"
for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n=${f##*/}
        [[ "$n" == timeout || "$n" == gtimeout || -e "$T/sys/$n" ]] && continue
        ln -s "$f" "$T/sys/$n" 2>/dev/null
    done
done
printf '#!/bin/bash\necho $$ >> "%s/sleep.pids"\nexec %s "$@"\n' "$T" "$(command -v sleep)" > "$T/bin/sleep"
chmod +x "$T/bin/sleep"
"$T/bin/sleep" 0; rm -f "$T/sleep.pids"  # warm the wrapper so its pid is recorded promptly
if PATH="$T/bin:$T/sys" command -v timeout >/dev/null || PATH="$T/bin:$T/sys" command -v gtimeout >/dev/null; then
    fail "fallback timer setup hides timeout and gtimeout" "a timeout tool is still on the PATH"
else
    start=$(date +%s)
    (cd "$T" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="" PATH="$T/bin:$T/sys" \
        "$SH" "$ROOT/hooks/oss-notify.sh" --workflow audit complete '{}' </dev/null 2>"$T/err" | cat >"$T/out")
    took=$(( $(date +%s) - start ))
    /bin/sleep 1  # a new script's first exec can lag on macOS; every timer sleeps 2s or more, so an orphan is still alive
    left=""
    while read -r p; do kill -0 "$p" 2>/dev/null && left="$left $p"; done < <(cat "$T/sleep.pids" 2>/dev/null)
    if [[ $took -lt 5 ]] && ! grep -q "Terminated" "$T/err" && [[ -z "$left" ]]; then
        pass "the fallback timer releases stdout at once, prints no job notice, leaves no sleep (took ${took}s)"
    else fail "the fallback timer releases stdout at once, prints no job notice, leaves no sleep" \
        "took=${took}s leftover-sleeps=[${left}] err=$(tr '\n' '|' < "$T/err")"; fi
    for p in $left; do kill "$p" 2>/dev/null; done
fi
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
