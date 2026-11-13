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

FEATURE=accept-feature
# Sandbox: temp HOME with .oss, a git repo with one active feature, and a plugin root that links the real
# hooks, schemas and watcher CLIs except chain-trigger, which only records that it was called.
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli" "$T/repo"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log("---CHAIN_COMMANDS---")\n' \
        "\"$T/chain.calls\"" > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
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
cleanup() { rm -rf "$T"; }

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
out=$(cd "$T/repo" && printf '{"session_id":"accept-session-1","stop_hook_active":false,"cwd":"%s"}' "$T/repo" \
    | HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$T/repo" "$SH" "$ROOT/hooks/oss-stop-dispatch.sh" 2>/dev/null)
if printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("plan"))' >/dev/null 2>&1; then
    pass "Stop dispatcher blocks while a started phase has no valid result"
else fail "Stop dispatcher blocks while a started phase has no valid result" "out=$out"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
