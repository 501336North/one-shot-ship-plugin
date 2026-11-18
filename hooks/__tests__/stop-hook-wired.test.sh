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
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/bin" "$T/not-oss"
printf '#!/bin/bash\necho called >> "%s"\n' "$T/node.calls" > "$T/bin/node"
printf '#!/bin/bash\necho notified >> "%s"\n' "$T/notified" > "$T/bin/terminal-notifier"
chmod +x "$T/bin/node" "$T/bin/terminal-notifier"

# 1. hooks.json has one Stop entry with one command.
name='(1) hooks.json registers exactly one Stop command'
count=$(jq '[.hooks.Stop[]?.hooks[]?] | length' "$ROOT/hooks.json" 2>/dev/null)
if [[ "$count" == 1 ]]; then pass "$name"; else fail "$name" "found $count Stop commands"; fi

# 2. That command, with ${CLAUDE_PLUGIN_ROOT} expanded as Claude Code does, run from a non-OSS folder.
name='(2) the registered Stop command, outside an OSS project, allows the stop, notifies once and starts no node'
cmd=$(jq -r '.hooks.Stop[0].hooks[0].command // ""' "$ROOT/hooks.json" 2>/dev/null)
cmd=${cmd//'${CLAUDE_PLUGIN_ROOT}'/$ROOT}
printf '{"session_id":"s1","stop_hook_active":false,"cwd":"%s"}' "$T/not-oss" > "$T/stdin.json"
out=$(cd "$T/not-oss" && run_capped 30 env HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$ROOT" \
    "$SH" -c "$cmd" < "$T/stdin.json" 2>"$T/stderr")
rc=$?
notified=0; [[ -f "$T/notified" ]] && notified=$(wc -l < "$T/notified" | tr -d ' ')
if [[ "$cmd" == */hooks/oss-stop-dispatch.sh && $rc -eq 0 && -z "$out" && "$notified" == 1 && ! -e "$T/node.calls" ]]; then
    pass "$name"
else
    fail "$name" "cmd='$cmd' rc=$rc stdout='$out' notified='${notified:-0}' node=$([[ -e "$T/node.calls" ]] && echo started || echo no) stderr=$(head -c 300 "$T/stderr")"
fi

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
