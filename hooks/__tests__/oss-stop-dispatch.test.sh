#!/bin/bash
# hooks/oss-stop-dispatch.sh: the Stop hook entry (R-257 T11, ADR-1; wired in hooks.json by T18).
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
# shellcheck source=hooks/__tests__/lib/warm-stub.sh
source "$ROOT/hooks/__tests__/lib/warm-stub.sh"
echo "Running oss-stop-dispatch tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

# D38 (round 4): no run may reach a real notifier (terminal-notifier, osascript, say, afplay). Builder B's runs did:
# the notification runs in the background, cleanup deleted $T while it still ran, and with $T/bin and the scratch HOME
# gone it fell through to the caller's PATH (/opt/homebrew/bin/terminal-notifier) with the default style, visual.
# - The hook's PATH is the sandbox's bin and the system folders, never the caller's PATH or a homebrew folder.
# - Each sandbox's settings.json says style "none"; a case that checks the notification turns it on (notify_on).
# - Every hook run holds fd 9 open on a pipe (held_by), and cleanup deletes $T only once every process that
#   inherited it, the background notifier included, has exited.
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
T=""
RUNDIR=$(cd "$(mktemp -d)" && pwd -P)
mkdir "$RUNDIR/node-only"; ln -s "$REAL_NODE" "$RUNDIR/node-only/node"
# The notifier stubs, written and warmed once per run (lib/warm-stub.sh). Each sandbox links to them: macOS scans a new
# executable on its first run (1-2 s idle, past 5 s under load), and a fresh stub per sandbox made that first run the
# background notifier's, past wait_file's 5 s (D38: the four "no marker, no node" fails and "slow notifier"). A link
# to a warmed file is not scanned again. The trace goes to the sandbox through the hook's HOME ($T/home).
warm_stub "$RUNDIR/terminal-notifier" 'echo notified >> "$HOME/../notified"' || { echo "setup: stub warm-up failed"; exit 1; }
warm_stub "$RUNDIR/terminal-notifier-slow" 'echo notified >> "$HOME/../notified"; exec sleep 3' \
    || { echo "setup: stub warm-up failed"; exit 1; }
trap 'cleanup; rm -rf "$RUNDIR"' EXIT

FEATURE=stop-feat
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/bin" "$T/repo"
    chmod 700 "$T/home/.oss"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    # D25 (round 1): the CLI is found through the protected ~/.oss/plugin-root (600) and node through
    # ~/.oss/hooks/oss-node.sh, never through an untrusted CLAUDE_PLUGIN_ROOT or the plugin's own copy.
    plugin_root "$ROOT"
    mkdir -p "$T/home/.oss/hooks"; cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    # The notification: terminal-notifier only records that it ran (a link to the warmed stub), and is off unless the
    # case turns it on.
    ln -s "$RUNDIR/terminal-notifier" "$T/bin/terminal-notifier"
    notify_style none
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$FEATURE/build" && mkdir -p ".oss/dev/active/$FEATURE" \
        && echo '{}' > .oss/workflow-state.json )
}
notify_style() { printf '{"notifications":{"style":"%s"}}\n' "$1" > "$T/home/.oss/settings.json"; }
notify_on() { notify_style visual; }
# held_by <marker>: the reader end of a hook run's fd 9. It deletes <marker> once every process holding the write end
# (the hook and all it started, the background notifier included) has exited.
held_by() { exec >/dev/null 2>&1; /bin/cat; /bin/rm -f "$1"; }
# cleanup: waits up to 30 s for every hook run's processes to exit, then deletes $T. One still running fails the case
# and keeps $T, so it never runs on with its stub and settings gone.
cleanup() {
    [[ -n "$T" && -d "$T" ]] || return 0
    local held=""
    for _ in $(seq 300); do held=$(cd "$T" && ls -d held.* 2>/dev/null); [[ -z "$held" ]] && break; sleep 0.1; done
    if [[ -n "$held" ]]; then fail "every process a hook run started has exited" "still held after 30 s: $held (kept $T)"; return; fi
    rm -rf "$T"
}
plugin_root() { (umask 077; printf '%s\n' "$1" > "$T/home/.oss/plugin-root"); chmod 600 "$T/home/.oss/plugin-root"; }
ledger_dir() { # -> the ledger key dir (NOTES "Ledger (D14, T3b)")
    local top gd key
    top=$(cd "$T/repo" && git rev-parse --show-toplevel); gd=$(cd "$top" && git rev-parse --absolute-git-dir)
    key=$(printf '%s\n%s\n' "$top" "$gd" | git hash-object --stdin | cut -c1-16)
    echo "$T/home/.oss/ledger/$key"
}
# ⚠ changes existing test: R-257 ship round 1 finding 1 — the run row records its feature; only this session's run
# for this checkout's feature blocks.
start_phase() { # <phase> [session] [feature]: the row oss-notify start writes
    local d; d=$(ledger_dir)
    mkdir -m 700 -p "$d/run"; chmod 700 "$T/home/.oss/ledger" "$d"
    (umask 077; printf '{"startedAt":"%s","session":"%s","headSha":"x","feature":"%s"}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "${2:-s1}" "${3-$FEATURE}" >> "$d/run/$1")
}
# bind_result <phase>: a results file and the ledger results row bound to the phase's last run (what assemble leaves)
bind_result() {
    local d f at sha; d=$(ledger_dir); f="$T/repo/.oss/dev/active/$FEATURE/results/$1.json"
    mkdir -p "${f%/*}"; printf '{"phase":"%s"}\n' "$1" > "$f"
    at=$(tail -n 1 "$d/run/$1" | sed -n 's/.*"startedAt":"\([^"]*\)".*/\1/p')
    sha=$(shasum -a 256 "$f" | cut -c1-64)
    mkdir -m 700 -p "$d/results/$FEATURE"; chmod 700 "$d/results"
    (umask 077; printf '{"sha256":"%s","feature":"%s","phase":"%s","startedAt":"%s","headSha":"x","session":"s1"}\n' \
        "$sha" "$FEATURE" "$1" "$at" >> "$d/results/$FEATURE/$1")
}
# wait_file <file>: the notification runs in the background (finding 7); wait up to 5 s for its trace
wait_file() { local i; for i in $(seq 50); do [[ -s "$1" ]] && return 0; sleep 0.1; done; return 1; }
now_ms() { /usr/bin/perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'; }
# stop <stop_hook_active> [extra env...]: runs the hook as Claude Code does (JSON on stdin, cwd = repo)
stop() {
    local active="$1"; shift
    (cd "$T/repo" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") \
        && printf '{"session_id":"s1","stop_hook_active":%s,"cwd":"%s"}' "$active" "$T/repo" \
        | env HOME="$T/home" PATH="$T/bin:$SAFE_PATH" "$@" "$SH" "$HOOK" 2>"$T/stderr" 9> >(held_by "$h"))
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
    plugin_root "$T/plugin"
}
# A dispatcher that only records that it ran (T26: PATH's node shim no longer shows whether the dispatcher started).
CLI_RECORDER='require("fs").appendFileSync(process.env.HOME + "/../cli.calls", "ran\n")'

# 1. No phase started: node is never called and the notification still runs.
sandbox; notify_on; node_shim_recorder; sandbox_plugin "$CLI_RECORDER"
out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/node.calls" && ! -e "$T/cli.calls" ]] && wait_file "$T/notified"; then
    pass "no phase started: fast path, no node, notification runs"
else fail "no phase started: fast path, no node, notification runs" "rc=$rc out=$out node=$(cat "$T/node.calls" 2>/dev/null) notified=$(cat "$T/notified" 2>/dev/null)"; fi
cleanup

# 1b. Not an OSS repo at all: same, no node.
sandbox; notify_on; node_shim_recorder; sandbox_plugin "$CLI_RECORDER"; rm -rf "$T/repo/.oss"
out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/node.calls" && ! -e "$T/cli.calls" ]] && wait_file "$T/notified"; then
    pass "no .oss: fast path, no node, notification runs"
else fail "no .oss: fast path, no node, notification runs" "rc=$rc out=$out"; fi
cleanup

# 2. A started phase with no result: block JSON naming the phase; no notification.
sandbox; notify_on; start_phase plan
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
out=$(cd "$T/repo" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") \
    && printf '{"session_id":"s1","stop_hook_active":false,"cwd":"%s"}' "$T/repo" \
    | env HOME="$T/home" PATH="$T/bin:$SAFE_PATH:$RUNDIR/node-only" "$SH" "$HOOK" 2>"$T/stderr" 9> >(held_by "$h")); rc=$?
if [[ $rc -eq 0 && ! -e "$T/node.calls" && -f "$(ledger_dir)/unverified/$FEATURE/plan" ]] \
    && printf '%s' "$out" | jq -e '.systemMessage | test("node_missing")' >/dev/null 2>&1; then
    pass "no usable node recorded: phase marked unverified (node_missing), PATH's temp node not run"
else fail "no usable node recorded: phase marked unverified (node_missing), PATH's temp node not run" "rc=$rc out=$out node=$(cat "$T/node.calls" 2>/dev/null) err=$(cat "$T/stderr")"; fi
cleanup

# --- R-257 ship fix round 1 ------------------------------------------------------------------------------------
# no_node_allow <name> [extra env...]: the stop is allowed with nothing on stdout, the dispatcher never starts, no
# ledger marker is written, and the notification runs.
no_node_allow() {
    local name="$1"; shift
    notify_on; sandbox_plugin "$CLI_RECORDER"
    out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin" "$@"); rc=$?
    if [[ $rc -eq 0 && -z "$out" && ! -e "$T/cli.calls" && ! -e "$(ledger_dir)/pending" && ! -e "$(ledger_dir)/unverified" ]] \
        && wait_file "$T/notified"; then pass "$name"
    else fail "$name" "rc=$rc out=$out cli=$(cat "$T/cli.calls" 2>/dev/null) err=$(cat "$T/stderr")"; fi
}
# node_runs <name> [extra env...]: the fast path does not allow on its own; the dispatcher starts.
node_runs() {
    local name="$1"; shift
    sandbox_plugin "$CLI_RECORDER"
    stop false CLAUDE_PLUGIN_ROOT="$T/plugin" "$@" >/dev/null
    if [[ -s "$T/cli.calls" ]]; then pass "$name"; else fail "$name" "the dispatcher never ran; err=$(cat "$T/stderr")"; fi
}

# 9. Finding 1, repro 1: a ship run of a feature since archived, back on main: allowed, no marker, no node.
# ⚠ changes existing test: round 3 finding 2 (pen N2). The ship is a clean one (bound result): an archived run with
# no result now goes to the dispatcher, which marks it unverified and says so once (test 24).
sandbox; start_phase ship; bind_result ship
( cd "$T/repo" && git checkout -q main && rm -rf ".oss/dev/active/$FEATURE" )
no_node_allow "archived feature's ship run, back on main: allowed, no marker, no node"
cleanup

# 10. Finding 1, repro 2: a new feature branch with no run of its own is not blocked by the last feature's run.
# ⚠ changes existing test: round 3 finding 2 (pen N2). The last feature's ship is finished (bound result); an
# unfinished one is still checked on the new branch (test 23).
sandbox; start_phase ship; bind_result ship
( cd "$T/repo" && git checkout -q -b feat/next/ideate && mkdir -p .oss/dev/active/next )
no_node_allow "another feature's run on a new branch: allowed, no marker, no node"
cleanup

# 11. Finding 2: another session's run never blocks this session.
sandbox; start_phase plan other-session
no_node_allow "another session's run: allowed, no marker, no node"
cleanup

# 12. Finding 3: cd into a nested repo (git init in a subfolder): the project's own run still blocks.
sandbox; start_phase plan
( cd "$T/repo" && mkdir sub && cd sub && git init -q -b main )
out=$(cd "$T/repo/sub" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") \
    && printf '{"session_id":"s1","stop_hook_active":false,"cwd":"%s"}' "$T/repo/sub" \
    | env HOME="$T/home" PATH="$T/bin:$SAFE_PATH" CLAUDE_PROJECT_DIR="$T/repo" "$SH" "$HOOK" 2>"$T/stderr" 9> >(held_by "$h")); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan"))' >/dev/null 2>&1; then
    pass "nested repo cwd: the project dir's unfinished run still blocks"
else fail "nested repo cwd: the project dir's unfinished run still blocks" "rc=$rc out=$out err=$(cat "$T/stderr")"; fi
cleanup

# 13. Finding 4: the fast path allows a bound result only when nothing marks it and its bytes match the ledger hash.
sandbox; start_phase plan; bind_result plan
no_node_allow "bound result, hash matches, no marker: fast path allows with no node"
cleanup
sandbox; start_phase plan; bind_result plan
echo '{"phase":"plan","edited":true}' > "$T/repo/.oss/dev/active/$FEATURE/results/plan.json"
node_runs "bound result edited by hand (hash differs): the dispatcher runs"
cleanup
for kind in unverified pending; do
    sandbox; start_phase plan; bind_result plan
    mkdir -m 700 -p "$(ledger_dir)/$kind/$FEATURE"; chmod 700 "$(ledger_dir)/$kind"
    (umask 077; echo '{"check":"x"}' > "$(ledger_dir)/$kind/$FEATURE/plan")
    node_runs "bound result with a ledger $kind marker: the dispatcher runs"
    cleanup
done
sandbox; start_phase plan; bind_result plan
echo '{}' > "$T/repo/.oss/dev/active/$FEATURE/results/plan.unverified.json"
node_runs "bound result with the repo unverified marker: the dispatcher runs"
cleanup

# 14. Finding 5: outside an OSS project the hook runs neither jq nor git (the .oss check comes first).
sandbox; rm -rf "$T/repo/.oss"
for tool in jq git; do printf '#!/bin/bash\necho %s >> "%s"\nexit 1\n' "$tool" "$T/tools.calls" > "$T/bin/$tool"; chmod +x "$T/bin/$tool"; done
out=$(stop false); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/tools.calls" ]]; then pass "no .oss: no jq, no git"
else fail "no .oss: no jq, no git" "rc=$rc calls=$(tr '\n' ' ' < "$T/tools.calls" 2>/dev/null)"; fi
cleanup

# 15. Finding 6: a git that never answers does not hold the stop (the shell's git runs under the bounded runner).
#     A FIFO for HEAD makes git itself block on reading it.
sandbox; start_phase plan
rm -f "$T/repo/.git/HEAD"; mkfifo "$T/repo/.git/HEAD"
t0=$(now_ms); stop false >/dev/null; el=$(( $(now_ms) - t0 ))
if [[ $el -lt 6000 ]]; then pass "hung git: the stop returns within the bound (${el} ms)"
else fail "hung git: the stop returns within the bound" "took ${el} ms"; fi
cleanup

# 16. Finding 7: a slow notification never holds the stop (it runs in the background).
sandbox; notify_on
ln -sf "$RUNDIR/terminal-notifier-slow" "$T/bin/terminal-notifier"
t0=$(now_ms); out=$(stop false); rc=$?; el=$(( $(now_ms) - t0 ))
if [[ $rc -eq 0 && -z "$out" && $el -lt 2000 ]] && wait_file "$T/notified"; then pass "slow notifier: the stop returns at once (${el} ms), the notification still runs"
else fail "slow notifier: the stop returns at once, the notification still runs" "rc=$rc el=${el} ms"; fi
cleanup

# 17-20. D30: a run with an empty feature (an ideate started on main before its folder existed) binds its own session.
sandbox; start_phase ideate s1 ""
out=$(stop false); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("assemble ideate"))' >/dev/null 2>&1; then
    pass "D30: same session's empty-feature run, feature resolves, no result: block"
else fail "D30: same session's empty-feature run, feature resolves, no result: block" "rc=$rc out=$out err=$(cat "$T/stderr")"; fi
cleanup

sandbox; start_phase ideate s1 ""; bind_result ideate
no_node_allow "D30: same session's empty-feature run with a bound result: fast path allows, no node"
cleanup

sandbox; notify_on; start_phase ideate s1 ""
( cd "$T/repo" && git checkout -q main && rm -rf ".oss/dev/active/$FEATURE" && mkdir -p .oss/dev/active/a .oss/dev/active/b )
out=$(stop false); rc=$?
# ⚠ changes existing test: round 3 INFO. The no-feature marker is unfiled/<phase>, outside unverified/<feature>/
# (needs the rebuilt dist/cli/stop-dispatch.cjs).
if [[ $rc -eq 0 && -f "$(ledger_dir)/unfiled/ideate" ]] \
    && printf '%s' "$out" | jq -e '(.decision // "") != "block" and (.systemMessage | test("no_feature")) and (.systemMessage | test("ideate")) and (tostring | test("current") | not)' >/dev/null 2>&1 \
    && wait_file "$T/notified"; then
    pass "D30: empty-feature run and no feature resolves: allowed, unverified marker, systemMessage"
else fail "D30: empty-feature run and no feature resolves: allowed, unverified marker, systemMessage" "rc=$rc out=$out err=$(cat "$T/stderr")"; fi
cleanup

sandbox; start_phase ideate other-session ""
no_node_allow "D30: another session's empty-feature run: allowed, no marker, no node"
cleanup

# --- R-257 ship fix round 3 ------------------------------------------------------------------------------------
run_at() { tail -n 1 "$(ledger_dir)/run/$1" | sed -n 's/.*"startedAt":"\([^"]*\)".*/\1/p'; }

# 21. Finding 1 (pen #8): plan started, then ideate started and assembled: the fast path does not let plan through.
sandbox; start_phase plan; sleep 0.01; start_phase ideate; bind_result ideate
node_runs "a finished later phase does not hide an unfinished earlier one: the dispatcher runs"
cleanup

# 22. Finding 1 (code-review LOW): another session's newer run of plan does not hide this session's run.
sandbox; start_phase plan; start_phase plan other-session
node_runs "another session's newer run does not hide this session's run: the dispatcher runs"
cleanup

# 23. Finding 2 (pen N2): build started on feat/<f>/build, then a new branch: the fast path keeps the run's feature.
sandbox; start_phase build
( cd "$T/repo" && git checkout -q -b feat/zzz/build )
node_runs "a new branch after build started: the dispatcher runs for the run's feature"
cleanup
sandbox; start_phase build
( cd "$T/repo" && mkdir -p .oss/dev/active/other && git checkout -q --detach )
node_runs "a detached HEAD with two active folders: the dispatcher runs"
cleanup

# 24. Finding 2: the folder moved to completed/ with no result: the dispatcher runs once; once its marker holds this
#     session's run, the fast path allows with no node (said once).
sandbox; start_phase build
( cd "$T/repo" && mkdir -p .oss/dev/completed && mv ".oss/dev/active/$FEATURE" .oss/dev/completed/ )
node_runs "folder moved away with no result: the dispatcher runs"
cleanup
sandbox; start_phase build
( cd "$T/repo" && mkdir -p .oss/dev/completed && mv ".oss/dev/active/$FEATURE" .oss/dev/completed/ )
mkdir -m 700 -p "$(ledger_dir)/unverified/$FEATURE"; chmod 700 "$(ledger_dir)/unverified"
(umask 077; printf '{"check":"stop-dispatch","errorClass":"feature_gone","session":"s1","startedAt":"%s"}\n' "$(run_at build)" > "$(ledger_dir)/unverified/$FEATURE/build")
notify_on; sandbox_plugin "$CLI_RECORDER"
out=$(stop false CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 && -z "$out" && ! -e "$T/cli.calls" ]] && wait_file "$T/notified"; then pass "folder moved away, already said for this run: no node, nothing said"
else fail "folder moved away, already said for this run: no node, nothing said" "rc=$rc out=$out cli=$(cat "$T/cli.calls" 2>/dev/null)"; fi
cleanup

# 25. INFO: the D30 notice is said once per run: with its unfiled marker holding this session's run, no node.
sandbox; start_phase ideate s1 ""
( cd "$T/repo" && git checkout -q main && rm -rf ".oss/dev/active/$FEATURE" && mkdir -p .oss/dev/active/a .oss/dev/active/b )
mkdir -m 700 -p "$(ledger_dir)/unfiled"
(umask 077; printf '{"check":"stop-dispatch","errorClass":"no_feature","session":"s1","startedAt":"%s"}\n' "$(run_at ideate)" > "$(ledger_dir)/unfiled/ideate")
no_node_allow "D30 notice already said for this run: no node, nothing said"
cleanup

# 26. INFO: the shell's own fail-open for a run with no feature writes no marker, so it never says "marked unverified".
sandbox; start_phase ideate s1 ""
( cd "$T/repo" && git checkout -q main && rm -rf ".oss/dev/active/$FEATURE" && mkdir -p .oss/dev/active/a .oss/dev/active/b )
sandbox_plugin 'setInterval(() => {}, 1000)'
out=$(stop false OSS_STOP_DISPATCH_TEST_BOUND=1 CLAUDE_PLUGIN_ROOT="$T/plugin"); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '(.systemMessage | test("ideate")) and (.systemMessage | test("marked unverified") | not)' >/dev/null 2>&1; then
    pass "no-feature fail-open: the message does not claim a marker"
else fail "no-feature fail-open: the message does not claim a marker" "rc=$rc out=$out"; fi
cleanup

# 27. Security L2 / pen N3: fake, empty tools first on PATH never turn a block into an allow. Every external tool the
#     hook and its bounded runner start comes from a fixed path, and node runs with a fixed PATH.
sandbox; start_phase plan
for tool in cat tail cut grep git mktemp rm dirname sort find date mkdir head tr sed; do
    printf '#!/bin/sh\necho %s >> "%s"\nexit 0\n' "$tool" "$T/fake.calls" > "$T/bin/$tool"; chmod +x "$T/bin/$tool"
done
out=$(stop false); rc=$?
if [[ $rc -eq 0 ]] && printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan"))' >/dev/null 2>&1; then
    pass "fake empty tools first on PATH: the stop is still blocked (fake calls: $(tr '\n' ' ' < "$T/fake.calls" 2>/dev/null))"
else fail "fake empty tools first on PATH: the stop is still blocked" "rc=$rc out=$out fake=$(tr '\n' ' ' < "$T/fake.calls" 2>/dev/null) err=$(cat "$T/stderr")"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
