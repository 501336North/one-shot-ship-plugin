#!/bin/bash
# The Stop command registered in hooks.json, run end to end (R-257 T18, DESIGN D9).
#
# @behavior When Claude ends a turn in a folder that is not an OSS project, the registered Stop command lets the
#           stop through (exit 0, nothing on stdout, so no block), shows the "Done" notification once, and never
#           starts node (the dispatcher's bash fast path).
# @business-rule R-257 AC-004.2: no phase started -> the stop is allowed and the existing notification runs; the
#           Stop hook must cost a bash script, not a node start, on every turn of every project.
#
# Hermetic: temp HOME (no settings, no node-path), PATH shims for node and terminal-notifier that only record.
# Usage: ./hooks/__tests__/stop-hook-wired.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
unset CLAUDE_CODE_SESSION_ID OSS_STOP_DISPATCH_TEST_BOUND
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
# shellcheck source=lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running stop-hook-wired tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

T=$(mktemp -d); T=$(cd "$T" && pwd -P)
# D38 (round 4): no run may reach a real notifier (terminal-notifier, osascript, say, afplay). The dispatcher starts the
# notification in the background; with the caller's PATH it fell through to /opt/homebrew/bin/terminal-notifier once
# $T (and its stub) was gone. So the hook's PATH is $T/bin and the system folders only, the run holds fd 9 open on a
# pipe (held_by), and the EXIT trap deletes $T only once every process that inherited it has exited. The style stays
# visual (no settings.json): this case asserts the stub notifier ran once.
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
held_by() { exec >/dev/null 2>&1; /bin/cat; /bin/rm -f "$1"; }
# Round 5 (code review L2): cleanup runs before the summary, so a lingering process fails the run; the EXIT trap only
# covers an early exit (T already gone or kept: nothing to do).
cleanup() {
    [[ -n "$T" && -d "$T" ]] || return 0
    local held=""
    for _ in $(seq 300); do held=$(cd "$T" && ls -d held.* 2>/dev/null); [[ -z "$held" ]] && break; sleep 0.1; done
    if [[ -n "$held" ]]; then fail "every process the hook run started has exited" "still held after 30 s: $held (kept $T)"; T=""; return 1; fi
    rm -rf "$T"
}
trap cleanup EXIT
mkdir -p "$T/home" "$T/bin" "$T/not-oss"
printf '#!/bin/bash\necho called >> "%s"\n' "$T/node.calls" > "$T/bin/node"
printf '#!/bin/bash\necho notified >> "%s"\n' "$T/notified" > "$T/bin/terminal-notifier"
chmod +x "$T/bin/node" "$T/bin/terminal-notifier"
# macOS scans a freshly written executable on its first run (1.5-4 s measured on 2026-11-18), longer than
# run_capped's 2 s leftover-process grace: the background notifier's first terminal-notifier call then outlives the
# hook and the test failed about 7 runs in 10. Run each shim once now, then drop what that run recorded.
"$T/bin/node" >/dev/null 2>&1; "$T/bin/terminal-notifier" >/dev/null 2>&1
rm -f "$T/node.calls" "$T/notified"

# 1. hooks.json has one Stop entry with one command.
name='(1) hooks.json registers exactly one Stop command'
count=$(jq '[.hooks.Stop[]?.hooks[]?] | length' "$ROOT/hooks.json" 2>/dev/null)
if [[ "$count" == 1 ]]; then pass "$name"; else fail "$name" "found $count Stop commands"; fi

# 2. That command, with ${CLAUDE_PLUGIN_ROOT} expanded as Claude Code does, run from a non-OSS folder.
name='(2) the registered Stop command, outside an OSS project, allows the stop, notifies once and starts no node'
cmd=$(jq -r '.hooks.Stop[0].hooks[0].command // ""' "$ROOT/hooks.json" 2>/dev/null)
cmd=${cmd//'${CLAUDE_PLUGIN_ROOT}'/$ROOT}
printf '{"session_id":"s1","stop_hook_active":false,"cwd":"%s"}' "$T/not-oss" > "$T/stdin.json"
out=$(cd "$T/not-oss" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") \
    && run_capped 30 env HOME="$T/home" PATH="$T/bin:$SAFE_PATH" CLAUDE_PLUGIN_ROOT="$ROOT" \
    "$SH" -c "$cmd" < "$T/stdin.json" 2>"$T/stderr" 9> >(held_by "$h"))
rc=$?
notified=0; [[ -f "$T/notified" ]] && notified=$(wc -l < "$T/notified" | tr -d ' ')
if [[ "$cmd" == */hooks/oss-stop-dispatch.sh && $rc -eq 0 && -z "$out" && "$notified" == 1 && ! -e "$T/node.calls" ]]; then
    pass "$name"
else
    fail "$name" "cmd='$cmd' rc=$rc stdout='$out' notified='${notified:-0}' node=$([[ -e "$T/node.calls" ]] && echo started || echo no) stderr=$(head -c 300 "$T/stderr")"
fi

cleanup
echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
