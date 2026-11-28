#!/bin/bash
# complete-gaps: acceptance tests at the system boundaries (Task 1, outside-in).
#
# @behavior (a) US-001: after the ship archive commit, a fix round through /oss:build on the same branch starts,
#           assembles and completes, with the result written in the completed folder; zero, two or another feature's
#           completed folders refuse with the D85 hint and no chain; the ship re-run after the fix still merges and
#           completes (D2, D84-D88).
# @behavior (b) D11: there is no legacy pass. A run in flight across the plugin upgrade (its workflow state started long
#           ago, no run row, no results) is refused at complete as today: no notice, no unverified marker, no chain, and
#           no legacy-snapshot, phase-results-since or other legacy file is ever written under the ledger.
# @business-rule "complete always needs a valid result; a phase in flight across the upgrade is re-run once" (D11:
#           every proof of a pre-upgrade run the hooks could keep can be written by the model).
#
# Hermetic: temp HOME (the test's own and each sandbox's), temp git repo, a bare origin behind a github.com URL with gh
# and npm stubs, a sandbox plugin root whose chain-trigger is a recorder, and terminal-notifier/osascript/say/afplay
# tripwires first on every hook's PATH. Setup copied from phase-results.acceptance.test.sh (cases 13-13n).
# Usage: ./hooks/__tests__/complete-gaps.acceptance.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running complete-gaps acceptance tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
T=""
RUNDIR=$(cd "$(mktemp -d)" && pwd -P)
# The test's own HOME is a fresh temp folder too: nothing here may reach the real ~/.oss.
mkdir "$RUNDIR/outer-home"; export HOME="$RUNDIR/outer-home"
mkdir "$RUNDIR/node-only"; ln -s "$(node -p 'require("fs").realpathSync(process.execPath)')" "$RUNDIR/node-only/node"
trap 'cleanup; rm -rf "$RUNDIR"' EXIT

FEATURE=accept-feature
# shellcheck source=lib/phase-result-fixture.sh
source "$ROOT/hooks/__tests__/lib/phase-result-fixture.sh"
# shellcheck source=lib/archive-ship-fixture.sh
source "$ROOT/hooks/__tests__/lib/archive-ship-fixture.sh"

sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/plugin/watcher/dist/cli" "$T/repo" "$T/bin"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    [[ -n "${OSS_TEST_PHASE_RESULT_CLI:-}" ]] && ln -sf "$OSS_TEST_PHASE_RESULT_CLI" "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log("---CHAIN_COMMANDS---")\n' \
        "\"$T/chain.calls\"" > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    # Tripwires: a real notifier must never run; each stub only records that it was called.
    for n in terminal-notifier osascript say afplay; do
        printf '#!/bin/sh\necho "%s $*" >> "%s/tripwire"\nexit 0\n' "$n" "$T" > "$T/bin/$n"; chmod +x "$T/bin/$n"
    done
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git update-ref refs/remotes/origin/main main \
        && git checkout -q -b "feat/$FEATURE/build" && mkdir -p ".oss/dev/active/$FEATURE" \
        && printf '# Design\n\nStatus: COMMITTED\n' > ".oss/dev/active/$FEATURE/DESIGN.md" )
}
# envrun: every hook runs with the sandbox HOME and a PATH of the stubs, node and the system folders only.
envrun() {
    (cd "$T/repo" && HOME="$T/home" PATH="$T/bin:$RUNDIR/node-only:$SAFE_PATH" CLAUDE_PLUGIN_ROOT="$T/plugin" \
        CLAUDE_PROJECT_DIR="$T/repo" CLAUDE_CODE_SESSION_ID="accept-session-1" "$@" </dev/null)
}
notify() { envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow "$@"; }
phase_result() { envrun "$SH" "$ROOT/hooks/oss-phase-result.sh" "$@"; }
chain_fired() { [[ -s "$T/chain.calls" ]]; }
no_tripwire() { [[ ! -e "$T/tripwire" ]]; }
cleanup() {
    [[ -n "$T" && -d "$T" ]] || return 0
    if [[ -e "$T/tripwire" ]]; then fail "no real notifier is ever called" "$(cat "$T/tripwire")"; fi
    rm -rf "$T"; T=""
}

# ---- (a) merge path helpers, as in phase-results.acceptance.test.sh 13 (plus a plan result, so build's own start gate,
#      pen N1, finds a valid plan in the completed folder).
merge_sandbox() {
    sandbox
    git init -q --bare "$T/origin.git"
    printf '#!/bin/sh\ncase "$(cat "%s/gh-mode" 2>/dev/null)" in auth) exit 4 ;; down) exit 1 ;; esac\ncase "$*" in\n*/commits/*/pulls*) cat "%s/gh-pulls.json" 2>/dev/null || echo "[]" ;;\napi*) git --git-dir "%s" rev-parse refs/heads/main ;;\nesac\nexit 0\n' \
        "$T" "$T" "$T/origin.git" > "$T/bin/gh"
    printf '#!/bin/sh\nexit 0\n' > "$T/bin/npm"; chmod +x "$T/bin/gh" "$T/bin/npm"
    (cd "$T/repo" && git remote add origin https://github.com/o/r.git && git config url."$T/origin.git".insteadOf https://github.com/o/r.git \
        && git push -q origin main && git fetch -q origin)
    PRF_REPO="$T/repo" prf_plan
    PRF_REPO="$T/repo" prf_build
    PRF_REPO="$T/repo" prf_ship
}
merge_test() { (cd "$T/repo" && env HOME="$T/home" PATH="$T/bin:$SAFE_PATH" /bin/bash "$ROOT/hooks/oss-merge-test.sh" --v2 2>&1 </dev/null); }
archive_commit() {
    (cd "$T/repo" && mkdir -p .oss/dev/completed .oss/reports/builds && mv ".oss/dev/active/$FEATURE" ".oss/dev/completed/$FEATURE-2026-11-23" \
        && echo report > ".oss/reports/builds/2026-11-23T00-00-$FEATURE.md" && git add -A .oss && git commit -q -m 'docs: archive' \
        && git push -q origin "HEAD:refs/heads/feat/$FEATURE/build")
}
squash_to_main() {
    (cd "$T/repo" && b=$(git branch --show-current) && git checkout -q main && git merge -q --squash "$b" && git commit -q -m squash \
        && git push -q origin main && git fetch -q origin)
}
step10_cleanup() {
    rm -f "$T"/home/.oss/run/*/branch.txt "$T"/home/.oss/run/*/head.txt "$T"/home/.oss/run/*/tested.txt
    (cd "$T/repo" && git fetch -q --prune)
}
gh_says() {
    local h m=null
    h=$(git --git-dir "$T/origin.git" rev-parse "refs/heads/feat/$FEATURE/build")
    [[ $1 == merged ]] && m='"2026-11-23T02:00:00Z"'
    printf '[{"number":1,"state":"%s","merged_at":%s,"head":{"sha":"%s"},"base":{"ref":"main"}}]\n' \
        "$([[ $1 == merged ]] && echo closed || echo open)" "$m" "$h" > "$T/gh-pulls.json"
}
# build_fix_round: the merge test failed after the archive, so the fix goes through /oss:build on the same branch:
# a code fix, build start, a red then green test run at this build's start, assemble build. Sets s_out/s_rc, a_out/a_rc.
build_fix_round() {
    local s
    (cd "$T/repo" && echo fix > fix.txt && git add fix.txt && git commit -q -m 'fix after the archive commit')
    s_out=$(notify build start '{}' 2>&1); s_rc=$?
    s=$(jq -r '.currentCommandStartedAt // empty' "$T/repo/.oss/workflow-state.json" 2>/dev/null)
    mkdir -p "$T/repo/.oss/tool-gates"
    printf '{"ts":"%s","tool":"Bash","kind":"test-run","program":"npx","result":"%s"}\n' "$s" red "$s" green \
        > "$T/repo/.oss/tool-gates/events.ndjson"
    a_out=$(phase_result assemble build 2>&1); a_rc=$?
    BUILD_STARTED="$s"
}
NOT_ARCHIVED_HINT="no completed folder of this branch's feature was added"
SEVERAL_HINT="this branch added several completed folders"

# a1. AC-001.1: build complete on the branch after the archive commit passes, and results/build.json (this run's) is in
#     the completed folder.
merge_sandbox
phase_result check ship --record-ready >/dev/null 2>&1
archive_commit
build_fix_round
out=$(notify build complete '{}' 2>&1); rc=$?
bj="$T/repo/.oss/dev/completed/$FEATURE-2026-11-23/results/build.json"
got=$(jq -r '.startedAt // empty' "$bj" 2>/dev/null)
if [[ $s_rc -eq 0 && $a_rc -eq 0 && -n "$BUILD_STARTED" && "$got" == "$BUILD_STARTED" && $rc -eq 0 && "$out" == *---CHAIN_COMMANDS---* \
    && ! -e "$T/repo/.oss/dev/active/$FEATURE" ]] && chain_fired; then
    pass "AC-001.1: build complete after the archive commit passes and writes this run's build.json in the completed folder"
else fail "AC-001.1: build complete after the archive commit passes and writes this run's build.json in the completed folder" "start rc=$s_rc assemble rc=$a_rc ($a_out) complete rc=$rc ($out) build.json startedAt=$got want=$BUILD_STARTED"; fi
cleanup

# a2. AC-001.2/AC-001.3: build after the archive refuses with the D85 hint and no chain when the branch added zero
#     completed folders, two of its feature, or one for another feature.
refuse_case() { # <label> <hint> ; run after the branch is set up
    build_fix_round
    out=$(notify build complete '{}' 2>&1); rc=$?
    if [[ $a_rc -ne 0 && "$a_out" == *no_feature* && "$a_out" == *"$2"* && $rc -eq 1 && "$out" == *"$2"* \
        && "$out" != *---CHAIN_COMMANDS---* ]] && ! chain_fired; then
        pass "AC-001.2/3: build after the archive with $1 refuses no_feature with the D85 hint, no chain"
    else fail "AC-001.2/3: build after the archive with $1 refuses no_feature with the D85 hint, no chain" "assemble rc=$a_rc ($a_out) complete rc=$rc ($out)"; fi
}
merge_sandbox   # zero: the active folder is gone but no completed folder was added
rm -rf "$T/repo/.oss/dev/active/$FEATURE"   # never committed, so the branch diff adds no .oss/dev/completed folder
refuse_case "zero completed folders" "$NOT_ARCHIVED_HINT"
cleanup
merge_sandbox   # two completed folders of this feature
archive_commit
(cd "$T/repo" && cp -R ".oss/dev/completed/$FEATURE-2026-11-23" ".oss/dev/completed/$FEATURE-2026-11-24" && git add -A .oss \
    && git commit -q -m 'docs: second archive')
refuse_case "two completed folders" "$SEVERAL_HINT"
cleanup
merge_sandbox   # one completed folder, named for another feature
(cd "$T/repo" && mkdir -p .oss/dev/completed && mv ".oss/dev/active/$FEATURE" ".oss/dev/completed/other-2026-11-23" \
    && git add -A .oss && git commit -q -m 'docs: archive under another name')
refuse_case "another feature's completed folder" "$NOT_ARCHIVED_HINT"
cleanup

# a3. AC-001.5: after the build fix round, the ship re-run still records ready, merges, and completes (D84-D88).
merge_sandbox
phase_result check ship --record-ready >/dev/null 2>&1
archive_commit
build_fix_round
b_out=$(notify build complete '{}' 2>&1); b_rc=$?
notify ship start '{}' >/dev/null 2>&1
# D7: the ship re-run records its gate rounds as a real ship does (as prf_ship does): a passing round-1 line for each
# default gate, through oss-value.sh timeline gate
for g in code-review performance security; do
    vd=$(PRF_REPO="$T/repo" prf_value_dir)
    printf '1\n' > "$vd/round.txt"; printf '%s\n' "$g" > "$vd/gate.txt"; printf 'pass\n' > "$vd/verdict.txt"
    : > "$vd/findings.txt"; : > "$vd/fixed.txt"; printf 'full\n' > "$vd/mode.txt"
    envrun "$SH" "$ROOT/hooks/oss-value.sh" timeline gate >/dev/null 2>&1
done
sa_out=$(phase_result assemble ship 2>&1); sa_rc=$?
sleep 1
rec_out=$(phase_result check ship --record-ready 2>&1); rec_rc=$?
(cd "$T/repo" && git add -A .oss && git commit -q -m 'docs: ship result' && git push -q origin "HEAD:refs/heads/feat/$FEATURE/build") >/dev/null 2>&1
mt_out=$(merge_test); mt_rc=$?
squash_to_main
step10_cleanup
gh_says merged
notify ship merged '{}' >/dev/null 2>&1
out=$(notify ship complete '{}' 2>&1); rc=$?
if [[ $a_rc -eq 0 && $b_rc -eq 0 && $sa_rc -eq 0 && "$sa_out" == *'"verdict":"ready_to_merge"'* && $rec_rc -eq 0 && $mt_rc -eq 0 \
    && "$mt_out" == *READY_TO_MERGE* && $rc -eq 0 && "$out" == *---CHAIN_COMMANDS---* ]]; then
    pass "AC-001.5: after the build fix round the ship re-run records ready, merges and completes"
else fail "AC-001.5: after the build fix round the ship re-run records ready, merges and completes" "build assemble rc=$a_rc ($a_out) build complete rc=$b_rc ($b_out) ship assemble rc=$sa_rc ($sa_out) record rc=$rec_rc ($rec_out) merge-test rc=$mt_rc complete rc=$rc ($out)"; fi
cleanup

# ---- (b) D11 helpers. A pre-upgrade run: its workflow state is already there, started long ago; no run row, no results.
wf_state_file() { # <currentCommand> <currentCommandStartedAt>
    mkdir -p "$T/repo/.oss"
    jq -cn --arg c "$1" --arg s "$2" '{currentCommand: $c, currentCommandStartedAt: $s}' > "$T/repo/.oss/workflow-state.json"
}
ledger() { HOME="$T/home" ledger_dir "$T/repo"; }
LEGACY_NOTICE="started before phase results"
# legacy_files: any legacy-snapshot*, phase-results-since* or *legacy* file anywhere under the sandbox ledger.
legacy_files() {
    [[ -d "$T/home/.oss/ledger" ]] || return 0
    find "$T/home/.oss/ledger" \( -name 'legacy-snapshot*' -o -name 'phase-results-since*' -o -name '*legacy*' \) -print 2>/dev/null
}
# inflight_refuses <label> <phase> <first event> ; <phase> was started before the upgrade; the first new-hooks event in the
# repo key is <first event>, then <phase> complete.
inflight_refuses() {
    sandbox; wf_state_file "$2" 2026-11-01T00:00:00Z
    notify "$2" "$3" '{}' >/dev/null 2>&1
    out=$(notify "$2" complete '{}' 2>&1); rc=$?
    L=$(ledger); lf=$(legacy_files)
    if [[ $rc -eq 1 && "$out" == *"$2 complete refused"* && "$out" != *"$LEGACY_NOTICE"* && "$out" != *---CHAIN_COMMANDS---* \
        && ! -e "$L/unverified/$FEATURE/$2" && -z "$lf" ]] && ! chain_fired; then
        pass "D11: $1: complete refuses as today, no notice, no unverified marker, no chain, no legacy files"
    else fail "D11: $1: complete refuses as today, no notice, no unverified marker, no chain, no legacy files" "complete rc=$rc ($out) unverified=$(ls "$L/unverified/$FEATURE" 2>&1) legacy files=($lf)"; fi
    cleanup
}

# b1. a ship in flight across the upgrade (first new-hooks event pr_created) is refused at complete with today's message.
inflight_refuses "a pre-upgrade ship after pr_created" ship pr_created
# b2. the same after merged (which resets the workflow state) as the key's first event.
inflight_refuses "a pre-upgrade ship after merged" ship merged
# b3. a build in flight across the upgrade is refused the same way.
inflight_refuses "a pre-upgrade build after task_complete" build task_complete

# b4. today's message: the refusal names the missing result and the assemble step, as before the legacy pass.
sandbox; wf_state_file ship 2026-11-01T00:00:00Z
notify ship pr_created '{}' >/dev/null 2>&1
out=$(notify ship complete '{}' 2>&1); rc=$?
if [[ $rc -eq 1 && "$out" == *"ship complete refused: no valid ship result"* && "$out" == *"assemble ship"* ]]; then
    pass "D11: the pre-upgrade refusal is today's message (no valid ship result; assemble ship, then complete again)"
else fail "D11: the pre-upgrade refusal is today's message (no valid ship result; assemble ship, then complete again)" "complete rc=$rc ($out)"; fi
cleanup

echo; echo "Ran $RUN, failed $FAILED"
[[ $FAILED -eq 0 ]]
