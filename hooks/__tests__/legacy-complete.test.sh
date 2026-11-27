#!/bin/bash
# complete-gaps Task 5: the legacy branch in oss-notify's complete gate (D3, D6, ADR-1, AC-002.1 to AC-002.5).
#
# @behavior A phase proven pre-upgrade (a ledger legacy/<phase> row, no run/<phase> row, no repo or ledger results for
#           the feature) passes `complete` with one fixed notice line, the ledger unverified/<feature>/<phase> marker and
#           the chain. A run row, any results, no legacy row, or a linked ledger unverified folder refuse as today. With no
#           resolved feature the notice names "this project" and no marker is written.
# @business-rule "No dead end across the upgrade, and nobody mistakes the phase for a verified one" (ADR-1): the pass is
#           decided from ledger and repo state only and is always recorded as unverified.
#
# Hermetic: its own temp HOME, a temp git repo, a sandbox plugin root whose chain-trigger is a recorder, and
# terminal-notifier/osascript/say/afplay tripwires first on PATH. "Foreign" uses the BASH_ENV `test -O` seam.
# Usage: /bin/bash hooks/__tests__/legacy-complete.test.sh
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }

SAFE_PATH=/usr/bin:/bin:/usr/sbin:/sbin
RUNDIR=$(cd "$(mktemp -d)" && pwd -P)
export HOME="$RUNDIR/outer-home"; mkdir "$HOME"
mkdir "$RUNDIR/node-only"; ln -s "$(node -p 'require("fs").realpathSync(process.execPath)')" "$RUNDIR/node-only/node"
trap 'rm -rf "$RUNDIR"' EXIT
cat > "$RUNDIR/foreign.sh" <<'SH'
test() { if [[ "${1:-}" == -O && -n "${OSS_T_FOREIGN:-}" && "${2:-}" == "$OSS_T_FOREIGN" ]]; then return 1; fi; builtin test "$@"; }
SH
FEATURE=legacy-feat
PRE=2026-11-01T00:00:00Z

T=""
# sandbox [branch]: repo on feat/<F>/ship (or <branch> with no feature folder), marker, a ledger legacy/ship row
sandbox() {
    T=$(mktemp -d "$RUNDIR/s.XXXXXX")
    mkdir -p "$T/home/.oss/hooks" "$T/plugin/watcher/dist/cli" "$T/bin" "$T/repo"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    [[ -d "$ROOT/schemas" ]] && ln -s "$ROOT/schemas" "$T/plugin/schemas"
    for f in "$ROOT"/watcher/dist/cli/*; do ln -s "$f" "$T/plugin/watcher/dist/cli/"; done
    rm -f "$T/plugin/watcher/dist/cli/chain-trigger.cjs" "$T/plugin/watcher/dist/cli/chain-trigger.js"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log("---CHAIN_COMMANDS---")\n' \
        "\"$T/chain.calls\"" > "$T/plugin/watcher/dist/cli/chain-trigger.cjs"
    for n in terminal-notifier osascript say afplay; do
        printf '#!/bin/sh\necho "%s $*" >> "%s/tripwire"\nexit 0\n' "$n" "$T" > "$T/bin/$n"; chmod +x "$T/bin/$n"
    done
    (cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base && mkdir -p .oss/dev/active)
    if [[ -z "${1:-}" ]]; then
        (cd "$T/repo" && git checkout -q -b "feat/$FEATURE/ship" && mkdir -p ".oss/dev/active/$FEATURE" \
            && printf '# Design\n' > ".oss/dev/active/$FEATURE/DESIGN.md")
    fi
    (umask 077; mkdir "$T/home/.oss/ledger"; printf '2026-11-20T00:00:00Z\n' > "$T/home/.oss/ledger/phase-results-since")
    jq -cn --arg s "$PRE" '{currentCommand: "ship", currentCommandStartedAt: $s}' > "$T/repo/.oss/workflow-state.json"
    local feat="$FEATURE"; [[ -z "${1:-}" ]] || feat=""
    row legacy/ship "$(jq -cn --arg s "$PRE" --arg f "$feat" '{startedAt: $s, feature: $f}')"
}
L() { local k; k=$(cd "$T/repo" && printf '%s\n%s\n' "$(git rev-parse --show-toplevel)" "$(git rev-parse --absolute-git-dir)" \
        | git hash-object --stdin | cut -c1-16); printf '%s' "$T/home/.oss/ledger/$k"; }
row() { (umask 077; mkdir -p "$(dirname "$(L)/$1")"; printf '%s\n' "$2" >> "$(L)/$1"); }
# complete [foreign path]: one oss-notify --workflow ship complete; rc in RC, stdout+stderr in OUT
complete() {
    RC=0
    OUT=$(cd "$T/repo" && HOME="$T/home" PATH="$T/bin:$RUNDIR/node-only:$SAFE_PATH" CLAUDE_PLUGIN_ROOT="$T/plugin" \
        CLAUDE_PROJECT_DIR="$T/repo" CLAUDE_CODE_SESSION_ID="legacy-session-1" BASH_ENV="$RUNDIR/foreign.sh" \
        OSS_T_FOREIGN="${1:-}" "$SH" "$ROOT/hooks/oss-notify.sh" --workflow ship complete '{}' </dev/null 2>&1) || RC=$?
}
NOTICE="no phase results for $FEATURE: started before phase results; complete passes unverified"
check_tripwire() { [[ ! -e "$T/tripwire" ]] || fail "no real notifier is ever called" "$(cat "$T/tripwire")"; }
refused() { # <label>: today's refusal, no notice, no marker, no chain
    if [[ $RC -eq 1 && "$OUT" != *"started before phase results"* && ! -e "$(L)/unverified/$FEATURE/ship" && ! -s "$T/chain.calls" ]]; then
        pass "$1"; else fail "$1" "rc=$RC out=($OUT) unverified=$(ls -R "$(L)/unverified" 2>&1)"; fi
    check_tripwire
}

# 1. legacy row, no run row, no results: pass with exactly one notice line, the unverified marker and the chain
sandbox; complete
m=$(cat "$(L)/unverified/$FEATURE/ship" 2>/dev/null)
if [[ $RC -eq 0 && "$OUT" != *"unbound variable"* && "$(grep -cFx "$NOTICE" <<< "$OUT")" == 1 && "$(grep -c 'started before phase results' <<< "$OUT")" == 1 \
    && "$OUT" == *---CHAIN_COMMANDS---* && -s "$T/chain.calls" \
    && "$(jq -r '.check + " " + .session' <<< "$m" 2>/dev/null)" == "legacy-complete legacy-session-1" ]]; then
    pass "should pass a legacy complete with one notice line, the unverified marker and the chain"
else fail "should pass a legacy complete with one notice line, the unverified marker and the chain" "rc=$RC out=($OUT) marker=($m)"; fi
check_tripwire

# 2. a run row after the legacy row (a Sprint D start) refuses
sandbox; row run/ship "$(jq -cn --arg s "$PRE" '{startedAt: $s, session: "x", headSha: "", feature: "legacy-feat"}')"; complete
refused "should refuse when a run row follows the legacy row"

# 3. results in the repo or the ledger refuse
sandbox; mkdir -p "$T/repo/.oss/dev/active/$FEATURE/results"; echo '{}' > "$T/repo/.oss/dev/active/$FEATURE/results/plan.json"; complete
refused "should refuse when the feature has repo results"
sandbox; row "results/$FEATURE/plan" '{}'; complete
refused "should refuse when the feature has ledger results"

# 4. no legacy row refuses (a start after the marker: complete itself records no legacy row either)
sandbox; rm "$(L)/legacy/ship"
jq -cn '{currentCommand: "ship", currentCommandStartedAt: "2026-11-25T00:00:00Z"}' > "$T/repo/.oss/workflow-state.json"; complete
refused "should refuse when there is no legacy row"

# 5. a foreign legacy file refuses
sandbox; complete "$(L)/legacy/ship"
refused "should refuse when the legacy row file is foreign-owned"

# 6. no resolved feature: the notice names this project, no marker is written, the chain runs
sandbox main; complete
if [[ $RC -eq 0 && "$OUT" != *"unbound variable"* && "$(grep -cFx 'no phase results for this project: started before phase results; complete passes unverified' <<< "$OUT")" == 1 \
    && ! -e "$(L)/unverified" && -s "$T/chain.calls" ]]; then
    pass "should pass with a 'this project' notice and no marker when no feature resolves"
else fail "should pass with a 'this project' notice and no marker when no feature resolves" "rc=$RC out=($OUT) unverified=$(ls -R "$(L)/unverified" 2>&1)"; fi
check_tripwire

# 7. a linked ledger unverified folder: fail closed (today's refusal), nothing written through the link, no crash
sandbox; mkdir -m 700 "$T/other"; ln -s "$T/other" "$(L)/unverified"; complete
if [[ $RC -eq 1 && "$OUT" != *"started before phase results"* && -z "$(ls -A "$T/other")" && ! -s "$T/chain.calls" ]]; then
    pass "should refuse, writing nothing, when the ledger unverified folder is a link"
else fail "should refuse, writing nothing, when the ledger unverified folder is a link" "rc=$RC out=($OUT) other=$(ls -A "$T/other")"; fi
check_tripwire

# 8. D8: a run row for ANOTHER feature does not count: legacy complete passes (notice, marker, chain)
sandbox; row run/ship "$(jq -cn --arg s "$PRE" '{startedAt: $s, session: "x", headSha: "", feature: "other-feat"}')"; complete
if [[ $RC -eq 0 && "$(grep -cFx "$NOTICE" <<< "$OUT")" == 1 && -e "$(L)/unverified/$FEATURE/ship" && -s "$T/chain.calls" ]]; then
    pass "should pass a legacy complete when the only run row is another feature's"
else fail "should pass a legacy complete when the only run row is another feature's" "rc=$RC out=($OUT)"; fi
check_tripwire

# 9. D8: a run row for the SAME feature among other features' rows refuses
sandbox; row run/ship "$(jq -cn --arg s "$PRE" '{startedAt: $s, session: "x", headSha: "", feature: "other-feat"}')"
row run/ship "$(jq -cn --arg s "$PRE" --arg f "$FEATURE" '{startedAt: $s, session: "y", headSha: "", feature: $f}')"; complete
refused "should refuse when a run row for the same feature sits among other features' rows"

# 10. D8 fail closed: a run file with a line that is not JSON refuses
sandbox; row run/ship "$(jq -cn --arg s "$PRE" '{startedAt: $s, session: "x", headSha: "", feature: "other-feat"}')"
row run/ship 'not json {'; complete
refused "should refuse when the run file has a line that cannot be parsed"

# 11. D8 fail closed: a foreign run file refuses even when its rows are another feature's
sandbox; row run/ship "$(jq -cn --arg s "$PRE" '{startedAt: $s, session: "x", headSha: "", feature: "other-feat"}')"
complete "$(L)/run/ship"
refused "should refuse when the run row file is foreign-owned"

echo ""
echo "legacy-complete: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
