#!/bin/bash
# R-257 phase-results: acceptance tests at the system boundaries (outside-in, slice A).
#
# @behavior A phase passes only with a result the plugin's own assembler wrote for this run:
#           - `oss-notify --workflow <phase> complete` with no result refuses: non-zero exit, no chain
#             fired, and the reason names the phase and the command that builds the result (US-001).
#           - assemble -> complete passes and fires the chain (US-001 AC-001.3, US-002).
#           - a schema-valid result written by hand (not by the assembler) is refused (D14).
#           - `start` refuses a phase whose previous result is missing once the feature has results,
#             and a pre-R-257 feature with no results/ dir starts with a notice (D16, D17).
#           - ship on an empty diff fails with empty_diff (US-003 AC-003.4).
#           - the Stop dispatcher blocks while a started phase has no valid result (US-004).
# @business-rule "A missing or malformed result fails the phase" (R-257 card); a result counts only when
#           bound to this run in the owner-only ledger (D14); the start gate's migration rule is D17.
#
# Hermetic: temp HOME, temp git repo, a sandbox plugin root whose chain-trigger is a recorder (no network).
# Usage: ./hooks/__tests__/phase-results.acceptance.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running phase-results acceptance tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

# D38 (round 4): no run may reach a real notifier (terminal-notifier, osascript, say, afplay). The Stop dispatcher
# starts its notification in the background; with the caller's PATH and no settings it fell through to
# /opt/homebrew/bin/terminal-notifier once cleanup had deleted $T. So, as in oss-stop-dispatch.test.sh:
# - the hook's PATH is the system folders plus a folder holding only a node link, never the caller's PATH;
# - each sandbox's settings.json says style "none";
# - the hook run holds fd 9 open on a pipe (held_by), and cleanup deletes $T only once every process that inherited
#   it, a background notifier included, has exited.
SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
T=""
RUNDIR=$(cd "$(mktemp -d)" && pwd -P)
mkdir "$RUNDIR/node-only"; ln -s "$(node -p 'require("fs").realpathSync(process.execPath)')" "$RUNDIR/node-only/node"
trap 'cleanup; rm -rf "$RUNDIR"' EXIT

FEATURE=accept-feature
# ⚠ changes existing test: D34 — a ship base must be an ancestor of origin's default branch, so the sandbox repo has
#   refs/remotes/origin/main at main's tip.
# Sandbox: temp HOME with .oss, a git repo with one active feature, and a plugin root that links the real
# hooks, schemas and watcher CLIs except chain-trigger, which only records that it was called.
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/plugin/watcher/dist/cli" "$T/repo"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    # D25: CLAUDE_PLUGIN_ROOT counts only as the plugin ~/.oss/plugin-root names (mode 600, as session-start writes
    # it), and oss-node.sh comes only from ~/.oss/hooks.
    printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    # OSS_TEST_PHASE_RESULT_CLI: a phase-result bundle built from src outside dist (fix rounds build dist once, at the end).
    [[ -n "${OSS_TEST_PHASE_RESULT_CLI:-}" ]] && ln -sf "$OSS_TEST_PHASE_RESULT_CLI" "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log("---CHAIN_COMMANDS---")\n' \
        "\"$T/chain.calls\"" > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git update-ref refs/remotes/origin/main main \
        && git checkout -q -b "feat/$FEATURE/build" && mkdir -p ".oss/dev/active/$FEATURE" \
        && printf '# Design\n\nStatus: COMMITTED\n' > ".oss/dev/active/$FEATURE/DESIGN.md" )
}
envrun() { # <cmd...> run from the repo with the sandbox env
    (cd "$T/repo" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$T/repo" \
        CLAUDE_CODE_SESSION_ID="accept-session-1" "$@" </dev/null)
}
notify() { envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow "$@"; }
phase_result() { envrun "$SH" "$ROOT/hooks/oss-phase-result.sh" "$@"; }
value_dir() { envrun "$SH" "$ROOT/hooks/oss-value.sh" dir 2>/dev/null; }
chain_fired() { [[ -s "$T/chain.calls" ]]; }
# held_by <marker>: the reader end of a hook run's fd 9. It deletes <marker> once every process holding the write end
# (the hook and all it started, the background notifier included) has exited.
held_by() { exec >/dev/null 2>&1; /bin/cat; /bin/rm -f "$1"; }
# cleanup: waits up to 30 s for every hook run's processes to exit, then deletes $T. One still running fails the case
# and keeps $T, so it never runs on with its settings gone.
cleanup() {
    [[ -n "$T" && -d "$T" ]] || return 0
    local held=""
    for _ in $(seq 300); do held=$(cd "$T" && ls -d held.* 2>/dev/null); [[ -z "$held" ]] && break; sleep 0.1; done
    if [[ -n "$held" ]]; then fail "every process a hook run started has exited" "still held after 30 s: $held (kept $T)"; return; fi
    rm -rf "$T"
}

# 1. complete with no result: refused, no chain, reason names the phase and the assemble command.
sandbox
notify plan start '{}' >/dev/null 2>&1
out=$(notify plan complete '{}' 2>&1); rc=$?
if [[ $rc -ne 0 ]] && ! chain_fired && [[ "$out" == *plan* && "$out" == *"oss-phase-result.sh assemble plan"* ]]; then
    pass "complete with no phase result is refused: no chain, reason names phase and command"
else fail "complete with no phase result is refused: no chain, reason names phase and command" "rc=$rc chain=$(cat "$T/chain.calls" 2>/dev/null) out=$out"; fi
cleanup

# 2. assemble -> complete: the result is written, complete passes and the chain fires.
sandbox
notify plan start '{}' >/dev/null 2>&1
vd=$(value_dir)
printf '[{"id":"T1","title":"first task","testIds":["validate.test.ts:accepts"]}]\n' > "$vd/tasks.json"
a_out=$(phase_result assemble plan 2>&1); a_rc=$?
out=$(notify plan complete '{}' 2>&1); rc=$?
if [[ $a_rc -eq 0 && -f "$T/repo/.oss/dev/active/$FEATURE/results/plan.json" && $rc -eq 0 ]] && chain_fired; then
    pass "assemble then complete passes and fires the chain"
else fail "assemble then complete passes and fires the chain" "assemble rc=$a_rc ($a_out) complete rc=$rc ($out) chain=$(cat "$T/chain.calls" 2>/dev/null)"; fi
cleanup

# 3. a schema-valid result written by hand (never assembled) is refused: unbound_result.
sandbox
notify plan start '{}' >/dev/null 2>&1
mkdir -p "$T/repo/.oss/dev/active/$FEATURE/results"
cat > "$T/repo/.oss/dev/active/$FEATURE/results/plan.json" <<EOF
{"v":1,"phase":"plan","feature":"$FEATURE","startedAt":"2026-11-13T00:00:00Z","assembledAt":"2026-11-13T00:00:01Z",
 "verification":"verified","sources":{"tasks":"model"},"claims":[],"chain":[],
 "tasks":[{"id":"T1","title":"forged","testIds":["x.test.ts:y"]}]}
EOF
out=$(notify plan complete '{}' 2>&1); rc=$?
if [[ $rc -ne 0 ]] && ! chain_fired && [[ "$out" == *unbound_result* ]]; then
    pass "a hand-written schema-valid result is refused (unbound_result), no chain"
else fail "a hand-written schema-valid result is refused (unbound_result), no chain" "rc=$rc out=$out"; fi
cleanup

# 4. start gate: a pre-R-257 feature (no results/ dir) starts with a notice (D17) ...
sandbox
out=$(notify build start '{}' 2>&1); rc=$?
if [[ $rc -eq 0 && "$out" == *"start gate skipped"* && "$out" == *"/oss:plan"* ]]; then
    pass "pre-R-257 feature with no results/ starts with the D17 notice"
else fail "pre-R-257 feature with no results/ starts with the D17 notice" "rc=$rc out=$out"; fi
cleanup

# 5. ... and once the feature has results, a phase whose previous result is missing is refused.
sandbox
notify plan start '{}' >/dev/null 2>&1
vd=$(value_dir)
printf '[{"id":"T1","title":"first task","testIds":["validate.test.ts:accepts"]}]\n' > "$vd/tasks.json"
phase_result assemble plan >/dev/null 2>&1
out=$(notify ship start '{}' 2>&1); rc=$?
if [[ $rc -ne 0 && "$out" == *"/oss:build"* ]]; then
    pass "start ship without a build result is refused and names /oss:build"
else fail "start ship without a build result is refused and names /oss:build" "rc=$rc out=$out"; fi
cleanup

# 6. ship on an empty diff fails with empty_diff and writes no result.
sandbox
notify ship start '{}' >/dev/null 2>&1
out=$(phase_result assemble ship 2>&1); rc=$?
if [[ $rc -ne 0 && "$out" == *empty_diff* && ! -e "$T/repo/.oss/dev/active/$FEATURE/results/ship.json" ]]; then
    pass "ship assemble on an empty diff fails with empty_diff and writes nothing"
else fail "ship assemble on an empty diff fails with empty_diff and writes nothing" "rc=$rc out=$out"; fi
cleanup

# 7. Stop dispatcher: a started phase with no valid result blocks, naming the phase.
sandbox
notify plan start '{}' >/dev/null 2>&1
out=$(cd "$T/repo" && h=$(/usr/bin/mktemp "$T/held.XXXXXX") \
    && printf '{"session_id":"accept-session-1","stop_hook_active":false,"cwd":"%s"}' "$T/repo" \
    | env HOME="$T/home" PATH="$SAFE_PATH:$RUNDIR/node-only" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$T/repo" \
        "$SH" "$ROOT/hooks/oss-stop-dispatch.sh" 2>/dev/null 9> >(held_by "$h"))
if printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan"))' >/dev/null 2>&1; then
    pass "Stop dispatcher blocks while a started phase has no valid result"
else fail "Stop dispatcher blocks while a started phase has no valid result" "out=$out"; fi
cleanup

# 8. R-257 T27 (AC-003.5): ship as the served prompt runs it. Round-1 gate lines are written through
#    `oss-value.sh timeline gate` with the six value files, under ship.md's gate.txt names (code-review, performance,
#    security). Assemble with the default required gates (no override) succeeds, ready to merge.
# shellcheck source=lib/phase-result-fixture.sh
source "$ROOT/hooks/__tests__/lib/phase-result-fixture.sh"   # prf_build: a valid build result, so ship can start
sandbox
PRF_REPO="$T/repo" prf_build
notify ship start '{}' >/dev/null 2>&1
(cd "$T/repo" && echo change > change.txt && git add change.txt && git commit -q -m change)
gate_err=""
for g in code-review performance security; do
    vd=$(value_dir)
    printf '1\n' > "$vd/round.txt"; printf '%s\n' "$g" > "$vd/gate.txt"; printf 'pass\n' > "$vd/verdict.txt"
    printf 'critical=0\n' > "$vd/findings.txt"; printf 'critical=0\n' > "$vd/fixed.txt"; printf 'full\n' > "$vd/mode.txt"
    envrun "$SH" "$ROOT/hooks/oss-value.sh" timeline gate >/dev/null 2>&1 || gate_err="$gate_err $g"
done
out=$(phase_result assemble ship 2>&1); rc=$?
ship_json="$T/repo/.oss/dev/active/$FEATURE/results/ship.json"
if [[ -z "$gate_err" && $rc -eq 0 ]] \
    && jq -e '.verdict == "ready_to_merge" and ([.gates[].gate] | sort) == ["code-review","performance","security"]' "$ship_json" >/dev/null 2>&1; then
    pass "ship assemble with ship.md's gate.txt names and the default required gates is ready_to_merge"
else fail "ship assemble with ship.md's gate.txt names and the default required gates is ready_to_merge" "gate_err=$gate_err rc=$rc out=$out"; fi
cleanup

# 9. D40: ship start records the SHAs of refs/remotes/origin/* in the owner-only ledger (run/ship.origin, 600, bound to
#    the run by startedAt). A base whose origin ref was written after the start (here with no reflog) is refused.
sandbox
PRF_REPO="$T/repo" prf_build
# ⚠ changes existing test: D46 — the snapshot maps each origin ref name to its SHA ({startedAt, refs}), and
#   refs/remotes/origin/HEAD (a symref) is skipped.
# ⚠ changes existing test: D50 — every remote's refs are recorded (here also upstream/main); each */HEAD is skipped.
# Security M3 (round 7, D51): every symref is dropped, not only */HEAD: refs/remotes/origin/release, a symref to the
#   local branch refs/heads/release, would record a local tip under a remote name.
(cd "$T/repo" && git update-ref refs/remotes/origin/feat/pre/build main \
    && git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main \
    && git update-ref refs/remotes/upstream/main main \
    && git symbolic-ref refs/remotes/upstream/HEAD refs/remotes/upstream/main \
    && git branch release main && git symbolic-ref refs/remotes/origin/release refs/heads/release)
notify ship start '{}' >/dev/null 2>&1
snap=$(ls "$T"/home/.oss/ledger/*/run/ship.origin 2>/dev/null | head -1)
m=$(cd "$T/repo" && git rev-parse main)
want=$(jq -cn --arg m "$m" '{"refs/remotes/origin/feat/pre/build": $m, "refs/remotes/origin/main": $m, "refs/remotes/upstream/main": $m}')
started=$(jq -r '.currentCommandStartedAt // empty' "$T/repo/.oss/workflow-state.json" 2>/dev/null)
mode=$(stat -c '%a' "$snap" 2>/dev/null || stat -f '%Lp' "$snap" 2>/dev/null)
if [[ -n "$snap" && "$mode" == 600 && "$(jq -cS .refs "$snap" 2>/dev/null)" == "$want" && "$(jq -r .startedAt "$snap" 2>/dev/null)" == "$started" ]]; then
    pass "ship start records every remote's ref names and SHAs in the ledger (run/ship.origin, 600, this run's startedAt, no symref)"
else fail "ship start records every remote's ref names and SHAs in the ledger (run/ship.origin, 600, this run's startedAt, no symref)" "snap=$snap mode=$mode want=$want got=$(cat "$snap" 2>/dev/null) started=$started"; fi
(cd "$T/repo" && echo one > one.txt && git add one.txt && git commit -q -m one && echo two > two.txt && git add two.txt \
    && git commit -q -m two && git -c core.logAllRefUpdates=false update-ref refs/remotes/origin/wip HEAD~1 \
    && git -c core.logAllRefUpdates=false branch wip HEAD~1)
printf 'wip\n' > "$(value_dir)/base.txt"
out=$(phase_result assemble ship 2>&1); rc=$?
if [[ $rc -ne 0 && "$out" == *unsafe_base* ]]; then
    pass "a base whose origin ref was written after ship start is refused (unsafe_base)"
else fail "a base whose origin ref was written after ship start is refused (unsafe_base)" "rc=$rc out=$out"; fi
cleanup

# 10. D40: over 1,000 origin refs at ship start, no snapshot is recorded and assemble ship fails closed.
sandbox
PRF_REPO="$T/repo" prf_build
(cd "$T/repo" && for i in $(seq 1001); do echo "create refs/remotes/origin/r$i main"; done | git update-ref --stdin)
notify ship start '{}' >/dev/null 2>&1
(cd "$T/repo" && echo change > change.txt && git add change.txt && git commit -q -m change)
out=$(phase_result assemble ship 2>&1); rc=$?
if [[ $rc -ne 0 && "$out" == *no_base_snapshot* ]]; then
    pass "over 1,000 origin refs at ship start: assemble ship refuses no_base_snapshot"
else fail "over 1,000 origin refs at ship start: assemble ship refuses no_base_snapshot" "rc=$rc out=$out"; fi
cleanup

# 11. D46 (pen M2a, r4-pen/a6b-pushed.sh): the feature branch is pushed (origin/feat/<f>/build at HEAD) before ship
#     start, and `wip` at HEAD~1 is named as base. Its tip is inside origin/feat/<f>/build, but origin has no `wip`, so
#     assemble ship refuses it. (A forged refs/remotes/origin/wip written BEFORE ship start is R-266's tool gate's job.)
sandbox
PRF_REPO="$T/repo" prf_build
(cd "$T/repo" && echo one > one.txt && git add one.txt && git commit -q -m one && echo two > two.txt && git add two.txt \
    && git commit -q -m two && git update-ref "refs/remotes/origin/feat/$FEATURE/build" HEAD \
    && git branch wip HEAD~1 && git config oss.shipBase wip)
notify ship start '{}' >/dev/null 2>&1
out=$(phase_result assemble ship 2>&1); rc=$?
if [[ $rc -ne 0 && "$out" == *unsafe_base* ]]; then
    pass "a base inside the pushed feature branch, with no origin ref of its own name, is refused (unsafe_base)"
else fail "a base inside the pushed feature branch, with no origin ref of its own name, is refused (unsafe_base)" "rc=$rc out=$out"; fi
cleanup

# 12. Perf L1 (round 7, D51): the snapshot is linear in the refs it lists. 1,000 refs with long (~420-byte) names, the
#     cap, add well under 2 s to ship start (the quadratic string build took about 9 s here under /bin/bash 3.2), and
#     all 1,000 are recorded. Timed against the same ship start with only origin/main, so node start-up cancels out.
now_ms() { /usr/bin/perl -MTime::HiRes=time -e 'printf "%d", time * 1000'; }
sandbox
PRF_REPO="$T/repo" prf_build
t0=$(now_ms); notify ship start '{}' >/dev/null 2>&1; base_ms=$(( $(now_ms) - t0 ))
pad=$(printf '%0200d' 0 | tr 0 x)
(cd "$T/repo" && for i in $(seq 999); do echo "create refs/remotes/origin/$pad/$pad/r$i main"; done | git update-ref --stdin)
t0=$(now_ms); notify ship start '{}' >/dev/null 2>&1; long_ms=$(( $(now_ms) - t0 ))
snap=$(ls "$T"/home/.oss/ledger/*/run/ship.origin 2>/dev/null | head -1)
count=$(jq '.refs | length' "$snap" 2>/dev/null)
if [[ "$count" == 1000 && $((long_ms - base_ms)) -lt 2000 ]]; then
    pass "a 1,000-ref snapshot (the cap) is recorded in well under 2 s"
else fail "a 1,000-ref snapshot (the cap) is recorded in well under 2 s" "count=$count base=${base_ms}ms with_refs=${long_ms}ms"; fi
cleanup

# 13. D78 (user pick 2026-11-23, "Pre-merge check row"): the whole /oss:ship --merge path, end to end. Step 8 assembles
#     a ready ship result and records it (`check ship --record-ready`, a ledger row for the checked head); the served
#     merge step archives and commits the dev docs (only .oss/ paths move the head), oss-merge-test.sh refuses unless
#     that row covers the head it merges, the PR is squashed onto main, and `merged` then `complete` pass on main with
#     the feature archived, printing the chain. GitHub is a bare origin plus gh and npm stubs (no real clone of npm).
# merge_sandbox: sandbox + a bare origin behind a github.com URL (gh and npm stubs in $T/bin), built, shipped (ready).
merge_sandbox() {
    sandbox
    mkdir -p "$T/bin"; git init -q --bare "$T/origin.git"
    printf '#!/bin/sh\nif test "$1" = api; then git --git-dir "%s" rev-parse refs/heads/main; fi\nexit 0\n' "$T/origin.git" > "$T/bin/gh"
    printf '#!/bin/sh\nexit 0\n' > "$T/bin/npm"; chmod +x "$T/bin/gh" "$T/bin/npm"
    (cd "$T/repo" && git remote add origin https://github.com/o/r.git && git config url."$T/origin.git".insteadOf https://github.com/o/r.git \
        && git push -q origin main && git fetch -q origin)
    PRF_REPO="$T/repo" prf_build
    PRF_REPO="$T/repo" prf_ship
}
# merge_test: the served item 4 call, from the repo, with the stubs on PATH (system folders only otherwise).
merge_test() { (cd "$T/repo" && env HOME="$T/home" PATH="$T/bin:$SAFE_PATH" /bin/bash "$ROOT/hooks/oss-merge-test.sh" --v2 2>&1 </dev/null); }
# archive_commit: the served items 2-3 (the feature folder moved to completed/, a build report, one commit) and a push.
archive_commit() {
    (cd "$T/repo" && mkdir -p .oss/dev/completed .oss/reports/builds && mv ".oss/dev/active/$FEATURE" ".oss/dev/completed/$FEATURE-2026-11-23" \
        && echo report > ".oss/reports/builds/2026-11-23T00-00-$FEATURE.md" && git add -A .oss && git commit -q -m 'docs: archive' \
        && git push -q origin "HEAD:refs/heads/feat/$FEATURE/build")
}
# squash_to_main: GitHub's squash merge of the branch onto main, then served item 6 (fetch main, switch to it).
squash_to_main() {
    (cd "$T/repo" && b=$(git branch --show-current) && git checkout -q main && git merge -q --squash "$b" && git commit -q -m squash \
        && git push -q origin main && git fetch -q origin)
}

merge_sandbox
rec_out=$(phase_result check ship --record-ready 2>&1); rec_rc=$?
archive_commit
mt_out=$(merge_test); mt_rc=$?
squash_to_main
m_out=$(notify ship merged '{}' 2>&1); m_rc=$?
out=$(notify ship complete '{}' 2>&1); rc=$?
if [[ $rec_rc -eq 0 && "$rec_out" == *READY_RECORDED* && $mt_rc -eq 0 && "$mt_out" == *READY_TO_MERGE* && $m_rc -eq 0 && $rc -eq 0 \
    && "$out" == *---CHAIN_COMMANDS---* ]] && chain_fired; then
    pass "D78: record ready, archive commit, merge gate, squash onto main, merged, complete: complete passes and prints the chain"
else fail "D78: record ready, archive commit, merge gate, squash onto main, merged, complete: complete passes and prints the chain" "record rc=$rec_rc ($rec_out) merge-test rc=$mt_rc ($mt_out) merged rc=$m_rc complete rc=$rc ($out)"; fi
cleanup

# 13b. D78: a blocked ship result records no row, and the merge gate refuses the head.
merge_sandbox
for g in code-review performance security; do   # round 2: security fails
    vd=$(value_dir); printf '2\n' > "$vd/round.txt"; printf '%s\n' "$g" > "$vd/gate.txt"; : > "$vd/fixed.txt"; printf 'full\n' > "$vd/mode.txt"
    if [[ $g == security ]]; then printf 'fail\n' > "$vd/verdict.txt"; printf 'high=1\n' > "$vd/findings.txt"; else printf 'pass\n' > "$vd/verdict.txt"; : > "$vd/findings.txt"; fi
    envrun "$SH" "$ROOT/hooks/oss-value.sh" timeline gate >/dev/null 2>&1
done
a_out=$(phase_result assemble ship 2>&1)
rec_out=$(phase_result check ship --record-ready 2>&1); rec_rc=$?
rows=$(cat "$T"/home/.oss/ledger/*/merge/ready 2>/dev/null)
archive_commit
mt_out=$(merge_test); mt_rc=$?
if [[ "$a_out" == *'"verdict":"blocked"'* && $rec_rc -ne 0 && -z "$rows" && $mt_rc -ne 0 && "$mt_out" == *STOP:* && "$mt_out" != *READY_TO_MERGE* ]]; then
    pass "D78: a blocked ship result writes no ready row and the merge gate refuses"
else fail "D78: a blocked ship result writes no ready row and the merge gate refuses" "assemble=$a_out record rc=$rec_rc ($rec_out) rows=$rows merge-test rc=$mt_rc ($mt_out)"; fi
cleanup

# 13c. D78: a code change committed after the checked head is refused by the merge gate (only .oss/ paths may follow).
merge_sandbox
phase_result check ship --record-ready >/dev/null 2>&1
archive_commit
(cd "$T/repo" && echo sneaky > change.txt && git commit -q -am 'after the check')
mt_out=$(merge_test); mt_rc=$?
if [[ $mt_rc -ne 0 && "$mt_out" == *STOP:* && "$mt_out" != *READY_TO_MERGE* ]]; then
    pass "D78: a code change after the checked head is refused by the merge gate"
else fail "D78: a code change after the checked head is refused by the merge gate" "merge-test rc=$mt_rc ($mt_out)"; fi
cleanup

# 13d. D78: a row from an earlier ship (that run ended, a new ship started since) is refused by the merge gate and by
#     complete. (A start while ship is still the current command keeps its startedAt: the same run.)
merge_sandbox
phase_result check ship --record-ready >/dev/null 2>&1
notify ship merged '{}' >/dev/null 2>&1
notify ship start '{}' >/dev/null 2>&1
archive_commit
mt_out=$(merge_test); mt_rc=$?
squash_to_main
notify ship merged '{}' >/dev/null 2>&1
out=$(notify ship complete '{}' 2>&1); rc=$?
if [[ $mt_rc -ne 0 && "$mt_out" == *STOP:* && $rc -ne 0 ]] && ! chain_fired; then
    pass "D78: a ready row from an earlier ship is refused by the merge gate and by complete"
else fail "D78: a ready row from an earlier ship is refused by the merge gate and by complete" "merge-test rc=$mt_rc ($mt_out) complete rc=$rc ($out)"; fi
cleanup

# 13e. D78: on main with the feature archived but no ready row, complete still refuses.
merge_sandbox
archive_commit
squash_to_main
notify ship merged '{}' >/dev/null 2>&1
out=$(notify ship complete '{}' 2>&1); rc=$?
if [[ $rc -ne 0 ]] && ! chain_fired; then
    pass "D78: complete after merged refuses when no ready row was recorded"
else fail "D78: complete after merged refuses when no ready row was recorded" "complete rc=$rc ($out)"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
