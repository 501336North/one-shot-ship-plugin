#!/bin/bash
# oss-notify.sh gates phase starts and completes on phase results (R-257 T10b, T10).
#
# @behavior Start gate (T10b): `start` of plan, build or ship (and their -team variants) needs a valid result of the
#           previous phase. A feature with no results/ folder (made before R-257) starts with a one-line notice
#           instead. A refused start exits 1, names the command that builds the missing result and changes no state.
#           `start ideate`, `quick` and other commands are never gated. Every start of ideate, plan, build or ship
#           records its run (start time, session, HEAD) in the owner-only ledger, with the same start time the
#           workflow state shows.
#           Complete gate (T10): `complete` of ideate, plan, build or ship refuses (exit 1, state failed, no CHAIN) unless
#           that phase's result is valid, verified and bound to this run, checked in the project the command is for.
# @business-rule US-001 AC-001.1 to AC-001.3; D16 (start gate), D17 (migration: no results/ means skip with a notice), D14 (run ledger row
#           run/<phase> {startedAt, session, headSha}; dirs 700, files 600).
#
# Hermetic: temp HOME, temp git repo, a sandbox plugin root linking the real watcher CLIs except chain-trigger,
# which only records that it was called (no network).
# Usage: /bin/bash hooks/__tests__/oss-notify-phase-result.test.sh   (bash 3.2)   or   BASH_UNDER_TEST=bash ... (bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1" "$3"; fi; }
echo "Running oss-notify-phase-result tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

FEATURE=gate-feature
SESSION=pr-session-1
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli" "$T/repo"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log("---CHAIN_COMMANDS---"); console.log("CHAIN: /oss:next (always)")\n' \
        "\"$T/chain.calls\"" > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    make_repo "$T/repo" "$FEATURE"
}
make_repo() { # <dir> <feature>
    ( cd "$1" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$2/build" && mkdir -p ".oss/dev/active/$2" \
        && printf '# Design\n\nStatus: COMMITTED\n' > ".oss/dev/active/$2/DESIGN.md" )
}
# shellcheck source=lib/phase-result-fixture.sh
source "$ROOT/hooks/__tests__/lib/phase-result-fixture.sh"   # prf_plan, prf_build, prf_ship: valid assembled results
REPO_RUN="" # the repo a run happens in (default $T/repo)
envrun() {
    local r="${REPO_RUN:-$T/repo}"
    (cd "$r" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="${PROJECT_RUN:-$r}" \
        CLAUDE_CODE_SESSION_ID="$SESSION" "$@" </dev/null)
}
notify() { envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow "$@"; }
results_dir() { echo "$T/repo/.oss/dev/active/$FEATURE/results"; }
state() { cat "$T/repo/.oss/workflow-state.json" 2>/dev/null; }
state_field() { jq -r ".$1 // empty" "$T/repo/.oss/workflow-state.json" 2>/dev/null; }
run_row() { cat "$T"/home/.oss/ledger/*/run/"$1" 2>/dev/null | tail -1; }
chain_fired() { [[ -s "$T/chain.calls" ]]; }
not_done() { [[ "$(jq -r ".chainState.$1 // empty" "$T/repo/.oss/workflow-state.json" 2>/dev/null)" != done ]]; }
perm() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

# ---------------------------------------------------------------- T10b: start gate (D16, D17) and the run row
# 1. a pre-R-257 feature (no results/) gets the notice and starts.
sandbox
out=$(notify build start '{}' 2>&1); rc=$?
check "a feature with no results/ starts build with the D17 notice" \
    '[[ $rc -eq 0 && "$out" == *"no phase results for $FEATURE: start gate skipped; run /oss:plan to enable it"* && "$(state_field currentCommand)" == build ]]' \
    "rc=$rc out=$out"
rm -rf "$T"

# 2. results/ideate.json but no plan result: start build is refused naming /oss:plan, state unchanged.
sandbox
notify ideate start '{}' >/dev/null 2>&1
mkdir -p "$(results_dir)"; printf '{}\n' > "$(results_dir)/ideate.json"
before=$(state)
out=$(notify build start '{}' 2>&1); rc=$?
check "start build without a plan result is refused naming /oss:plan, state unchanged" \
    '[[ $rc -eq 1 && "$out" == *"/oss:plan"* && "$(state)" == "$before" ]]' "rc=$rc out=$out"
# 3. quick is never gated.
out=$(notify quick start '{}' 2>&1); rc=$?
check "quick start is not gated" '[[ $rc -eq 0 && "$(state_field currentCommand)" == quick ]]' "rc=$rc out=$out"
# 4. build-team is gated like build.
before=$(state)
out=$(notify build-team start '{}' 2>&1); rc=$?
check "build-team start is gated like build" '[[ $rc -eq 1 && "$out" == *"/oss:plan"* && "$(state)" == "$before" ]]' "rc=$rc out=$out"
rm -rf "$T"

# 5. with a valid assembled plan result, start build proceeds (no notice).
sandbox
PRF_REPO="$T/repo" prf_plan
out=$(notify build start '{}' 2>&1); rc=$?
check "start build with a valid plan result proceeds" \
    '[[ -f "$(results_dir)/plan.json" && $rc -eq 0 && "$out" != *"start gate skipped"* && "$(state_field currentCommand)" == build ]]' "rc=$rc out=$out"
# 6. the run row's startedAt is the start time workflow-state shows.
check "the build run row's startedAt equals workflow-state's currentCommandStartedAt" \
    '[[ -n "$(state_field currentCommandStartedAt)" && "$(run_row build | jq -r .startedAt)" == "$(state_field currentCommandStartedAt)" ]]' \
    "row=$(run_row build) state=$(state_field currentCommandStartedAt)"
rm -rf "$T"

# 7. start ideate writes the run row: startedAt, session, headSha; dirs 700, file 600.
sandbox
notify ideate start '{}' >/dev/null 2>&1
row=$(run_row ideate); head=$(cd "$T/repo" && git rev-parse HEAD)
f=$(ls "$T"/home/.oss/ledger/*/run/ideate 2>/dev/null | head -1)
check "start ideate writes the ledger run row (startedAt, session, headSha; 700/600)" \
    '[[ -n "$f" && "$(printf "%s" "$row" | jq -r .session)" == "$SESSION" && "$(printf "%s" "$row" | jq -r .headSha)" == "$head" \
       && -n "$(printf "%s" "$row" | jq -r ".startedAt // empty")" && "$(perm "$f")" == 600 && "$(perm "${f%/*}")" == 700 \
       && "$(perm "$T/home/.oss/ledger")" == 700 ]]' "row=$row f=$f"
rm -rf "$T"

# 8. a linked run file is refused: one stderr line, the start still succeeds, nothing written through the link.
sandbox
notify ideate start '{}' >/dev/null 2>&1
f=$(ls "$T"/home/.oss/ledger/*/run/ideate 2>/dev/null | head -1)
rm -f "$f"; : > "$T/elsewhere"; ln -s "$T/elsewhere" "$f"
out=$(notify ideate start '{}' 2>&1); rc=$?
check "a linked ledger run file is refused without blocking the start" \
    '[[ $rc -eq 0 && ! -s "$T/elsewhere" && "$(state_field currentCommand)" == ideate ]]' "rc=$rc out=$out"
rm -rf "$T"

# 8b. a project outside any git repo starts with the notice (its git lookup must not end the hook under set -e).
sandbox
mkdir -p "$T/nogit/.oss"
out=$(cd "$T/nogit" && HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" CLAUDE_PROJECT_DIR="$T/nogit" GIT_CEILING_DIRECTORIES="$T" \
    "$SH" "$ROOT/hooks/oss-notify.sh" --workflow build start '{}' 2>&1 </dev/null); rc=$?
check "build start in a project outside git starts with the notice" \
    '[[ $rc -eq 0 && "$out" == *"start gate skipped"* && "$(jq -r .currentCommand "$T/nogit/.oss/workflow-state.json" 2>/dev/null)" == build ]]' "rc=$rc out=$out"
rm -rf "$T"

# ---------------------------------------------------------------- T10: the complete gate (US-001)
# 9. for each phase, no result: exit 1, supervisor intervening, no CHAIN, phase not completed, reason names the
#    phase and the assemble command (build also says its evidence is not ledger-checked, D15).
for ph in ideate plan build ship; do
    sandbox
    notify "$ph" start '{}' >/dev/null 2>&1
    out=$(notify "$ph" complete '{}' 2>&1); rc=$?
    extra=1; [[ $ph == build && "$out" != *"build evidence is from repo files (not ledger-checked)"* ]] && extra=0
    check "$ph complete with no result: exit 1, failed, no CHAIN, not completed, reason names the command" \
        '[[ $rc -eq 1 && $extra -eq 1 && "$out" != *"CHAIN:"* && "$out" == *"oss-phase-result.sh assemble $ph"* ]] && ! chain_fired \
         && [[ "$(state_field supervisor)" == intervening ]] && not_done "$ph"' "rc=$rc state=$(state) out=$out"
    rm -rf "$T"
done

# 10. a malformed result (bound in the ledger, but with an unknown field) is refused naming the field.
sandbox
PRF_REPO="$T/repo" prf_plan
f="$(results_dir)/plan.json"; jq -c '. + {bogus: 1}' "$f" > "$f.new" && mv "$f.new" "$f"
lf=$(ls "$T"/home/.oss/ledger/*/results/"$FEATURE"/plan 2>/dev/null | head -1)
[[ -n "$lf" ]] && tail -1 "$lf" | jq -c --arg s "$(shasum -a 256 "$f" | cut -c1-64)" '.sha256 = $s' >> "$lf"
out=$(notify plan complete '{}' 2>&1); rc=$?
check "a malformed plan result is refused naming the field" \
    '[[ -n "$lf" && $rc -eq 1 && "$out" == *bogus* && "$out" != *"CHAIN:"* ]] && ! chain_fired && not_done plan' "rc=$rc out=$out"
rm -rf "$T"

# 11. an unverified marker next to a valid result is refused.
sandbox
PRF_REPO="$T/repo" prf_plan
printf '{}\n' > "$(results_dir)/plan.unverified.json"
out=$(notify plan complete '{}' 2>&1); rc=$?
check "a plan result with an unverified marker is refused" \
    '[[ -f "$(results_dir)/plan.json" && $rc -eq 1 && "$out" == *unverified* ]] && ! chain_fired && not_done plan' "rc=$rc out=$out"
rm -rf "$T"

# 12. project A has ship started and no result; the cwd is repo B, which has a valid ship result: refused.
sandbox
B="$T/repo-b"; mkdir -p "$B"; make_repo "$B" "$FEATURE"
REPO_RUN="$B" PRF_REPO="$B" prf_ship
b_ok=0; [[ -f "$B/.oss/dev/active/$FEATURE/results/ship.json" ]] && b_ok=1
notify ship start '{}' >/dev/null 2>&1
out=$(REPO_RUN="$B" PROJECT_RUN="$T/repo" notify ship complete '{}' 2>&1); rc=$?
check "complete for project A from repo B (which has a valid result) is refused: repo_mismatch, no CHAIN" \
    '[[ $b_ok -eq 1 && $rc -eq 1 && "$out" == *repo_mismatch* && "$out" != *"CHAIN:"* ]] && ! chain_fired' "b_ok=$b_ok rc=$rc out=$out"
rm -rf "$T"

# 13. no node on PATH: refused, no CHAIN (the state CLI cannot run either).
sandbox
PRF_REPO="$T/repo" prf_plan
out=$(PATH=/usr/bin:/bin:/usr/sbin:/sbin notify plan complete '{}' 2>&1); rc=$?
check "with no node on PATH a valid result is still refused: exit 1, no CHAIN" \
    '[[ -f "$(results_dir)/plan.json" && $rc -eq 1 && "$out" != *"CHAIN:"* ]] && ! chain_fired' "rc=$rc out=$out"
rm -rf "$T"

# 14. no phase-result CLI anywhere (hooks run from a copy, the plugin root has no CLI): refused, failed, no CHAIN.
sandbox
PRF_REPO="$T/repo" prf_plan
mkdir -p "$T/copy/hooks"; cp "$ROOT"/hooks/*.sh "$T/copy/hooks/"
rm -f "$T/plugin/watcher/dist/cli/phase-result.cjs"
out=$(envrun "$SH" "$T/copy/hooks/oss-notify.sh" --workflow plan complete '{}' 2>&1); rc=$?
check "with no phase-result CLI anywhere: exit 1, failed, no CHAIN" \
    '[[ $rc -eq 1 && "$out" == *cli_missing* && "$(state_field supervisor)" == intervening ]] && ! chain_fired && not_done plan' "rc=$rc out=$out"
rm -rf "$T"

# 15. a CLI that exits 2, 124 or 127 is a refusal: exit 1, failed, no CHAIN.
for code in 2 124 127; do
    sandbox
    PRF_REPO="$T/repo" prf_plan
    rm -f "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf 'console.log(JSON.stringify({verification: "verified"})); process.exit(%s)\n' "$code" > "$T/plugin/watcher/dist/cli/phase-result.cjs"
    out=$(notify plan complete '{}' 2>&1); rc=$?
    check "a phase-result CLI exiting $code is a refusal: exit 1, failed, no CHAIN" \
        '[[ $rc -eq 1 && "$out" != *"CHAIN:"* && "$(state_field supervisor)" == intervening ]] && ! chain_fired && not_done plan' "rc=$rc out=$out"
    rm -rf "$T"
done

# 16. a valid result keeps today's behaviour: state updated, CHAIN printed.
sandbox
PRF_REPO="$T/repo" prf_plan
out=$(notify plan complete '{}' 2>&1); rc=$?
check "a valid plan result completes: state updated and the CHAIN printed" \
    '[[ $rc -eq 0 && "$out" == *"CHAIN: /oss:next"* && "$(jq -r .chainState.plan "$T/repo/.oss/workflow-state.json")" == done ]] && chain_fired' "rc=$rc out=$out"
rm -rf "$T"

# 17. a non-phase command is unaffected.
sandbox
out=$(notify requirements complete '{}' 2>&1); rc=$?
check "requirements complete is unaffected (no result needed, CHAIN printed)" '[[ $rc -eq 0 && "$out" == *"CHAIN:"* ]] && chain_fired' "rc=$rc out=$out"
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
