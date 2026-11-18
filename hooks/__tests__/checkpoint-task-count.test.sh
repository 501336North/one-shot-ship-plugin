#!/bin/bash
# R-257 T15: checkpoint.sh counts completed tasks from the plan phase result, never from PROGRESS.md prose.
#
# @behavior A checkpoint's tasks_completed is the number of tasks in a valid, bound results/plan.json
#           (one bounded `oss-phase-result.sh check plan`). With no result, a hand-written (unbound) result
#           or a CLI that hangs, it is 0. PROGRESS.md `- [x]` lines are ignored.
# @business-rule AC-006.2: progress comes from phase results the plugin assembled, not from prose a model wrote.
#
# Hermetic: temp HOME, temp git repo on feat/<f>/build, a sandbox plugin root that links the real hooks and CLI.
# Usage: ./hooks/__tests__/checkpoint-task-count.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE OSS_DEV_ROOT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running checkpoint task-count tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

FEATURE=count-feature
# T26: the plan check runs on the node recorded in ~/.oss/node-path (the real one, resolved: outside temp folders).
RECORDED_NODE=$(node -p 'require("fs").realpathSync(process.execPath)')
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli" "$T/repo" "$T/bin"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    echo 'console.log("---CHAIN_COMMANDS---")' > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$FEATURE/build" && mkdir -p ".oss/dev/active/$FEATURE" \
        && printf '# Design\n\nStatus: COMMITTED\n' > ".oss/dev/active/$FEATURE/DESIGN.md" )
}
envrun() {
    (cd "$T/repo" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$T/repo" \
        CLAUDE_CODE_SESSION_ID="count-session-1" "$@" </dev/null)
}
cleanup() { rm -rf "$T"; }
# assemble_plan <n>: start plan, write n tasks to the value folder, assemble the bound result.
assemble_plan() {
    local i tasks=""
    envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow plan start '{}' >/dev/null 2>&1
    for ((i = 1; i <= $1; i++)); do
        tasks="${tasks:+$tasks,}{\"id\":\"T$i\",\"title\":\"task $i\",\"testIds\":[\"t.test.ts:case$i\"]}"
    done
    printf '[%s]\n' "$tasks" > "$(envrun "$SH" "$ROOT/hooks/oss-value.sh" dir 2>/dev/null)/tasks.json"
    envrun "$SH" "$ROOT/hooks/oss-phase-result.sh" assemble plan >/dev/null 2>&1
}
hand_plan() {
    mkdir -p "$T/repo/.oss/dev/active/$FEATURE/results"
    cat > "$T/repo/.oss/dev/active/$FEATURE/results/plan.json" <<EOF
{"v":1,"phase":"plan","feature":"$FEATURE","startedAt":"2026-11-13T00:00:00Z","assembledAt":"2026-11-13T00:00:01Z",
 "verification":"verified","sources":{"tasks":"model"},"claims":[],"chain":[],
 "tasks":[{"id":"T1","title":"a","testIds":["x.test.ts:a"]},{"id":"T2","title":"b","testIds":["x.test.ts:b"]}]}
EOF
}
# count: create a checkpoint and print its tasks_completed.
count() {
    local f
    envrun env OSS_DEV_ROOT="$T/repo" "$SH" "$ROOT/hooks/checkpoint.sh" create "$FEATURE" cp >/dev/null 2>&1
    f=$(ls "$T/repo/.oss/dev/active/$FEATURE/checkpoints/"*.json 2>/dev/null | head -1)
    [[ -n "$f" ]] && jq -r '.tasks_completed' "$f" 2>/dev/null || echo "no-checkpoint"
}

# 1. a valid, bound plan result with 3 tasks gives 3.
sandbox
assemble_plan 3
if [[ -f "$T/repo/.oss/dev/active/$FEATURE/results/plan.json" ]]; then
    n=$(count); [[ "$n" == 3 ]] && pass "a bound plan result with 3 tasks counts 3" \
        || fail "a bound plan result with 3 tasks counts 3" "got $n"
else fail "a bound plan result with 3 tasks counts 3" "setup: assemble wrote no plan.json"; fi
cleanup

# 2. no result gives 0.
sandbox
n=$(count); [[ "$n" == 0 ]] && pass "no plan result counts 0" || fail "no plan result counts 0" "got $n"
cleanup

# 3. five `- [x]` PROGRESS.md lines and no result give 0.
sandbox
printf '# Progress\n- [x] a\n- [x] b\n- [x] c\n- [x] d\n- [x] e\n' > "$T/repo/.oss/dev/active/$FEATURE/PROGRESS.md"
n=$(count); [[ "$n" == 0 ]] && pass "PROGRESS.md [x] lines are ignored (0)" || fail "PROGRESS.md [x] lines are ignored (0)" "got $n"
cleanup

# 4. a hand-written plan.json (not bound in the ledger) gives 0.
sandbox
envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow plan start '{}' >/dev/null 2>&1
hand_plan
n=$(count); [[ "$n" == 0 ]] && pass "a hand-written plan result counts 0" || fail "a hand-written plan result counts 0" "got $n"
cleanup

# 5. a CLI that hangs is bounded and gives 0.
sandbox
hand_plan
rm -f "$T/plugin/watcher/dist/cli/phase-result.cjs"
echo 'setInterval(() => {}, 1000)' > "$T/plugin/watcher/dist/cli/phase-result.cjs"
start=$SECONDS
n=$(count); took=$((SECONDS - start))
if [[ "$n" == 0 && $took -lt 20 ]]; then pass "a hanging CLI is bounded and counts 0 (${took}s)"
else fail "a hanging CLI is bounded and counts 0" "got $n in ${took}s"; fi
cleanup

# 6. the check covers the branch's feature only: another feature's hand-written plan.json counts 0
#    even while the branch's feature has a bound result.
sandbox
assemble_plan 3
OTHER=other-feature
mkdir -p "$T/repo/.oss/dev/active/$OTHER/results"
sed "s/$FEATURE/$OTHER/" "$T/repo/.oss/dev/active/$FEATURE/results/plan.json" \
    > "$T/repo/.oss/dev/active/$OTHER/results/plan.json"
envrun env OSS_DEV_ROOT="$T/repo" "$SH" "$ROOT/hooks/checkpoint.sh" create "$OTHER" cp >/dev/null 2>&1
f=$(ls "$T/repo/.oss/dev/active/$OTHER/checkpoints/"*.json 2>/dev/null | head -1)
n=$([[ -n "$f" ]] && jq -r '.tasks_completed' "$f" 2>/dev/null || echo "no-checkpoint")
[[ "$n" == 0 ]] && pass "another feature's unchecked plan result counts 0" \
    || fail "another feature's unchecked plan result counts 0" "got $n"
cleanup

# 7. T26 (security C1): a fake node first on PATH that forges a verified check never starts; an unbound plan.json
#    is still checked by the real CLI on the recorded node and counts 0.
sandbox
hand_plan
printf '#!/bin/sh\necho x >> "%s"\necho %s\nexit 0\n' "$T/fake.calls" "'{\"verification\":\"verified\"}'" > "$T/bin/node"
chmod +x "$T/bin/node"
envrun env PATH="$T/bin:$PATH" OSS_DEV_ROOT="$T/repo" "$SH" "$ROOT/hooks/checkpoint.sh" create "$FEATURE" cp >/dev/null 2>&1
f=$(ls "$T/repo/.oss/dev/active/$FEATURE/checkpoints/"*.json 2>/dev/null | head -1)
n=$([[ -n "$f" ]] && jq -r '.tasks_completed' "$f" 2>/dev/null || echo "no-checkpoint")
if [[ "$n" == 0 && ! -e "$T/fake.calls" ]]; then pass "a fake node first on PATH never runs the plan check (recorded node used, counts 0)"
else fail "a fake node first on PATH never runs the plan check (recorded node used, counts 0)" "got $n fake=$(cat "$T/fake.calls" 2>/dev/null)"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
