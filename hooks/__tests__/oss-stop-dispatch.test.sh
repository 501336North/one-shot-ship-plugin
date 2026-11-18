#!/bin/bash
# hooks/oss-stop-dispatch.sh: the Stop hook entry (R-257 T11, ADR-1; not wired in hooks.json until T18).
#
# @behavior When Claude tries to end a turn:
#           - outside a started phase, the "Done" notification runs and node is never started (bash fast path);
#           - while a started phase has no result, the stop is blocked with JSON naming the phase;
#           - however the dispatcher dies (SIGKILL, the 5 s bound, the stop_hook_active loop guard), the phase is
#             left marked so `oss-phase-result.sh check` refuses it: a fail-open never looks like a pass.
# @business-rule R-257 US-004 / ADR-1 amendments F2, F3, S3, P5: pending marker before any check; the shell writes
#           the unverified markers and the systemMessage when its bound fires; the ledger marker alone is enough
#           for check to refuse (deleting the repo marker does not help).
#
# Hermetic: temp HOME, temp git repo, PATH shims for node (when recorded) and terminal-notifier.
# Usage: ./hooks/__tests__/oss-stop-dispatch.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
unset CLAUDE_CODE_SESSION_ID OSS_STOP_DISPATCH_TEST_BOUND
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-stop-dispatch.sh"
REAL_NODE="$(command -v node)"
# T26: the dispatcher runs on the node recorded in ~/.oss/node-path (the real one, resolved: outside temp folders),
# never PATH's. Tests that need a dispatcher that misbehaves use a sandbox plugin (CLAUDE_PLUGIN_ROOT) whose
# stop-dispatch.cjs does it, since a PATH node shim is no longer started.
RECORDED_NODE="$(node -p 'require("fs").realpathSync(process.execPath)')"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-stop-dispatch tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

FEATURE=stop-feat
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/bin" "$T/repo"
    chmod 700 "$T/home/.oss"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    # The notification: terminal-notifier only records that it ran.
    printf '#!/bin/bash\necho notified >> "%s"\n' "$T/notified" > "$T/bin/terminal-notifier"
    chmod +x "$T/bin/terminal-notifier"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$FEATURE/build" && mkdir -p ".oss/dev/active/$FEATURE" \
        && echo '{}' > .oss/workflow-state.json )
}
cleanup() { rm -rf "$T"; }
ledger_dir() { # -> the ledger key dir (NOTES "Ledger (D14, T3b)")
    local top gd key
    top=$(cd "$T/repo" && git rev-parse --show-toplevel); gd=$(cd "$top" && git rev-parse --absolute-git-dir)
    key=$(printf '%s\n%s\n' "$top" "$gd" | git hash-object --stdin | cut -c1-16)
    echo "$T/home/.oss/ledger/$key"
}
start_phase() { # <phase>: the row oss-notify start writes
    local d; d=$(ledger_dir)
    mkdir -m 700 -p "$d/run"; chmod 700 "$T/home/.oss/ledger" "$d"
    (umask 077; printf '{"startedAt":"%s","session":"s1","headSha":"x"}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >> "$d/run/$1")
}
# stop <stop_hook_active> [extra env...]: runs the hook as Claude Code does (JSON on stdin, cwd = repo)
stop() {
    local active="$1"; shift
    (cd "$T/repo" && printf '{"session_id":"s1","stop_hook_active":%s,"cwd":"%s"}' "$active" "$T/repo" \
        | env HOME="$T/home" PATH="$T/bin:$PATH" "$@" "$SH" "$HOOK" 2>"$T/stderr")
}
check_plan() { (cd "$T/repo" && HOME="$T/home" "$SH" "$ROOT/hooks/oss-phase-result.sh" check plan </dev/null >/dev/null 2>&1); }
node_shim_recorder() {
    printf '#!/bin/bash\necho called >> "%s"\nexec "%s" "$@"\n' "$T/node.calls" "$REAL_NODE" > "$T/bin/node"
    chmod +x "$T/bin/node"
}
# sandbox_plugin <js>: a plugin root at $T/plugin with the real hooks/oss-node.sh and a stop-dispatch.cjs holding <js>.
sandbox_plugin() {
    mkdir -p "$T/plugin/hooks" "$T/plugin/watcher/dist/cli"
    cp "$ROOT/hooks/oss-node.sh" "$T/plugin/hooks/oss-node.sh"
    printf '%s\n' "$1" > "$T/plugin/watcher/dist/cli/stop-dispatch.cjs"
}
# A dispatcher that only records that it ran (T26: PATH's node shim no longer shows whether the dispatcher started).
CLI_RECORDER='require("fs").appendFileSync(process.env.HOME + "/../cli.calls", "ran\n")'

# 1. No phase started: node is never called and the notification still runs.
sandbox; node_shim_recorder; sandbox_plugin "$CLI_RECORDER"
out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/node.calls" && ! -e "$T/cli.calls" && -s "$T/notified" ]]; then
    pass "no phase started: fast path, no node, notification runs"
else fail "no phase started: fast path, no node, notification runs" "rc=$rc out=$out node=$(cat "$T/node.calls" 2>/dev/null) notified=$(cat "$T/notified" 2>/dev/null)"; fi
cleanup

# 1b. Not an OSS repo at all: same, no node.
sandbox; node_shim_recorder; sandbox_plugin "$CLI_RECORDER"; rm -rf "$T/repo/.oss"
out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/node.calls" && ! -e "$T/cli.calls" && -s "$T/notified" ]]; then
    pass "no .oss: fast path, no node, notification runs"
else fail "no .oss: fast path, no node, notification runs" "rc=$rc out=$out"; fi
cleanup

# 2. A started phase with no result: block JSON naming the phase; no notification.
sandbox; start_phase plan
out=$(stop false); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan")) and (.reason | test("oss-phase-result.sh assemble plan"))' >/dev/null 2>&1 \
    && [[ ! -e "$T/notified" ]]; then
    pass "started phase with no result: block JSON names the phase and assemble, no notification"
else fail "started phase with no result: block JSON names the phase and assemble, no notification" "rc=$rc out=$out err=$(cat "$T/stderr")"; fi
cleanup

# 3. SIGKILL the dispatcher mid-check: the pending marker is left behind and check refuses.
#    The sandbox plugin's stop-dispatch.cjs starts the real dispatcher, SIGKILLs it once its pending marker exists and
#    exits 137 (T26: what the PATH node shim did before; the recorded node now runs it).
sandbox; start_phase plan
sandbox_plugin "$(cat <<EOF
const cp = require("child_process"), fs = require("fs");
const c = cp.spawn(process.execPath, ["$ROOT/watcher/dist/cli/stop-dispatch.cjs", ...process.argv.slice(2)], { stdio: "ignore" });
let n = 0;
const t = setInterval(() => {
  let found = false;
  try { found = fs.readdirSync("$(ledger_dir)/pending/$FEATURE").length > 0; } catch (e) { found = false; }
  if (found || ++n > 200) { clearInterval(t); c.kill("SIGKILL"); process.exit(137); }
}, 50);
EOF
)"
stop false CLAUDE_PLUGIN_ROOT="$T/plugin" >/dev/null
if [[ -f "$(ledger_dir)/pending/$FEATURE/plan" ]] && ! check_plan; then
    pass "SIGKILL mid-check: pending marker left behind, check refuses"
else fail "SIGKILL mid-check: pending marker left behind, check refuses" "pending=$(ls "$(ledger_dir)/pending/$FEATURE" 2>&1)"; fi
cleanup

# 4. A second stop with stop_hook_active: allowed with a systemMessage, and check refuses.
sandbox; start_phase plan
stop false >/dev/null
out=$(stop true); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '(.decision // "") != "block" and (.systemMessage | test("plan"))' >/dev/null 2>&1 \
    && ! check_plan; then
    pass "stop_hook_active: allowed with a systemMessage, check still refuses"
else fail "stop_hook_active: allowed with a systemMessage, check still refuses" "rc=$rc out=$out err=$(cat "$T/stderr")"; fi

# 5. Delete the repo marker: the ledger marker alone keeps check refusing.
rm -f "$T/repo/.oss/dev/active/$FEATURE/results/plan.unverified.json"
if [[ -f "$(ledger_dir)/unverified/$FEATURE/plan" ]] && ! check_plan; then
    pass "repo marker deleted: the ledger unverified marker keeps check refusing"
else fail "repo marker deleted: the ledger unverified marker keeps check refusing" "ledger=$(ls "$(ledger_dir)/unverified/$FEATURE" 2>&1)"; fi
cleanup

# 6. The shell bound fires: the shell writes both unverified markers and prints the systemMessage.
sandbox; start_phase plan
# T26: the hang is the sandbox plugin's dispatcher (the recorded node runs it), not a PATH node shim.
sandbox_plugin 'setInterval(() => {}, 1000)'
t0=$(date +%s)
out=$(stop false OSS_STOP_DISPATCH_TEST_BOUND=1 CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
el=$(( $(date +%s) - t0 ))
if [[ $rc -eq 0 && $el -lt 10 ]] && printf '%s' "$out" | jq -e '(.decision // "") != "block" and (.systemMessage | test("plan")) and (.systemMessage | test("stop-dispatch"))' >/dev/null 2>&1 \
    && [[ -f "$(ledger_dir)/unverified/$FEATURE/plan" && -f "$T/repo/.oss/dev/active/$FEATURE/results/plan.unverified.json" ]] \
    && ! check_plan; then
    pass "shell bound fires: both unverified markers written, systemMessage printed"
else fail "shell bound fires: both unverified markers written, systemMessage printed" "rc=$rc el=$el out=$out err=$(cat "$T/stderr")"; fi
cleanup

# 7. T26 (security C1): a fake node first on PATH that forges an allow is never started; the real dispatcher on the
#    recorded node blocks the stop of a started phase with no result.
sandbox; start_phase plan
printf '#!/bin/sh\necho x >> "%s"\necho %s\nexit 0\n' "$T/fake.calls" "'{\"verification\":\"verified\"}'" > "$T/bin/node"
chmod +x "$T/bin/node"
out=$(stop false); rc=$?
if [[ $rc -eq 0 && ! -e "$T/fake.calls" ]] && printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan"))' >/dev/null 2>&1; then
    pass "a fake node first on PATH is never started; the recorded node runs the dispatcher (block)"
else fail "a fake node first on PATH is never started; the recorded node runs the dispatcher (block)" "rc=$rc out=$out fake=$(cat "$T/fake.calls" 2>/dev/null) err=$(cat "$T/stderr")"; fi
cleanup

# 8. T26: no usable node recorded: the dispatcher cannot run, so the phase is marked unverified (node_missing), never
#    a silent pass, and PATH's temp node is not run.
sandbox; start_phase plan; node_shim_recorder
: > "$T/home/.oss/node-path"
out=$(cd "$T/repo" && printf '{"session_id":"s1","stop_hook_active":false,"cwd":"%s"}' "$T/repo" \
    | env HOME="$T/home" PATH="$T/bin:/usr/bin:/bin:/usr/sbin:/sbin:${REAL_NODE%/*}" "$SH" "$HOOK" 2>"$T/stderr"); rc=$?
if [[ $rc -eq 0 && ! -e "$T/node.calls" && -f "$(ledger_dir)/unverified/$FEATURE/plan" ]] \
    && printf '%s' "$out" | jq -e '.systemMessage | test("node_missing")' >/dev/null 2>&1; then
    pass "no usable node recorded: phase marked unverified (node_missing), PATH's temp node not run"
else fail "no usable node recorded: phase marked unverified (node_missing), PATH's temp node not run" "rc=$rc out=$out node=$(cat "$T/node.calls" 2>/dev/null) err=$(cat "$T/stderr")"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
