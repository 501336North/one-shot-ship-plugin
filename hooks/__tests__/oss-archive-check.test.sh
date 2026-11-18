#!/bin/bash
# oss-archive-check.sh archives a feature only on a valid ship phase result (R-257 T13).
#
# @behavior Before /oss:plan, finished features move from .oss/dev/active to .oss/dev/completed. A feature moves only
#           when its results/ship.json is schema-valid, bound to this machine's assembler in the ledger (from any
#           session), verified, with no unverified marker, and its verdict is ready_to_merge. A feature with no ship
#           result is never moved; all of them are named once, on one "no phase result, move by hand" line.
#           PROGRESS.md prose never decides. Two archivable features are both moved (bash 5, set -e), a link at the
#           archive destination is never followed, and the phase-result CLI runs at most once per call.
# @business-rule US-006 AC-006.1, AC-004.5 (unverified is not archived), D13, D14, FOLLOWUPS 30 and 40.
#
# Hermetic: temp HOME, temp git repo, a node shim on PATH that counts node starts.
# Usage: /bin/bash hooks/__tests__/oss-archive-check.test.sh (bash 3.2)  or  BASH_UNDER_TEST=bash ... (bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PROJECT_DIR
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1" "$3"; fi; }
echo "Running oss-archive-check tests under $("$SH" -c 'echo "$BASH_VERSION"')..."
# shellcheck source=lib/archive-ship-fixture.sh
source "$ROOT/hooks/__tests__/lib/archive-ship-fixture.sh"
REAL_NODE=$(command -v node)
# T26 (D21): the phase-result CLI runs on the node recorded in ~/.oss/node-path (the real one, resolved: outside temp
# folders), never PATH's, so the PATH shim no longer sees it. The sandbox plugin's phase-result.cjs counts its own
# start in node.calls and runs the real CLI (as itself, so it finds the real plugin's files).
RECORDED_NODE="$(node -p 'require("fs").realpathSync(process.execPath)')"
# OSS_TEST_PHASE_RESULT_CLI: a bundle built from src outside dist (fix rounds build dist once, at the end).
REAL_CLI="${OSS_TEST_PHASE_RESULT_CLI:-$ROOT/watcher/dist/cli/phase-result.cjs}"
TODAY=$(date +%Y%m%d)

sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/bin" "$T/repo"
    export HOME="$T/home"
    printf '#!/bin/bash\necho x >> "%s/node.calls"\nexec "%s" "$@"\n' "$T" "$REAL_NODE" > "$T/bin/node"
    chmod +x "$T/bin/node"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    mkdir -p "$T/cplugin/hooks" "$T/cplugin/watcher/dist/cli"
    cp "$ROOT/hooks/oss-node.sh" "$T/cplugin/hooks/oss-node.sh"
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"   # D25 (e): the copy the gate sources
    printf 'require("fs").appendFileSync(%s, "x\\n"); process.argv[1] = %s; require(%s);\n' \
        "\"$T/node.calls\"" "\"$REAL_CLI\"" "\"$REAL_CLI\"" > "$T/cplugin/watcher/dist/cli/phase-result.cjs"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base )
    R="$T/repo"; A="$R/.oss/dev/active"; C="$R/.oss/dev/completed"
    mkdir -p "$A"
}
feature() { mkdir -p "$A/$1"; printf '# Progress\n\n## Current Phase: %s\n' "${2:-build}" > "$A/$1/PROGRESS.md"; }
archive() { # runs the hook from the repo; OUT and RC
    # D25 (b, c): the plugin in CLAUDE_PLUGIN_ROOT counts only as the one ~/.oss/plugin-root names (mode 600, as
    # session-start writes it), so each run first records the plugin it uses there.
    printf '%s\n' "${PLUGIN:-$T/cplugin}" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"
    OUT=$(cd "$R" && PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="${PLUGIN:-$T/cplugin}" CLAUDE_CODE_SESSION_ID="${SESSION:-s2}" \
        "$SH" "$ROOT/hooks/oss-archive-check.sh" --project-dir="$R" "$@" 2>&1 </dev/null); RC=$?
}
archived() { [[ ! -e "$A/$1" && -d "$C/$1-$TODAY" ]]; }
kept() { [[ -d "$A/$1" ]] && ! ls -d "$C/$1-"* >/dev/null 2>&1; }
node_calls() { [[ -f "$T/node.calls" ]] && wc -l < "$T/node.calls" | tr -d ' ' || echo 0; }
nores_lines() { printf '%s\n' "$OUT" | grep -c 'no phase result, move by hand' || true; }

# 1. a valid, bound, verified ready_to_merge ship result is archived
sandbox; feature done; archivable_ship "$R" done
archive
check "a valid, bound, verified ready_to_merge ship result is archived" 'archived done' "rc=$RC out=$OUT"
rm -rf "$T"

# 2. PROGRESS.md prose alone is never archived; such features are listed once, on one line (D13)
sandbox; feature merged 'ship (merged)'; feature complete 'complete ✅'
archive
check "PROGRESS.md 'Current Phase: ship (merged)' with no results/ is not archived" \
    'kept merged && kept complete' "rc=$RC out=$OUT"
line=$(printf '%s\n' "$OUT" | grep 'no phase result, move by hand')
check "features with no ship result are listed once, on one D13 line" \
    '[[ "$(nores_lines)" == 1 && "$line" == *merged* && "$line" == *complete* ]]' "out=$OUT"
rm -rf "$T"

# 3. unverified, invalid, unbound, blocked or marked results are not archived (AC-004.5, D14)
sandbox
feature unverif; archivable_ship "$R" unverif; ship_result "$R" unverif '.verification = "unverified"'; bind_ship "$R" unverif
feature invalid; ship_result "$R" invalid '.verdict = "shipped!"'; bind_ship "$R" invalid
feature unbound; ship_result "$R" unbound
feature edited; archivable_ship "$R" edited; ship_result "$R" edited '.summary = "edited after assemble"'
feature blocked; ship_result "$R" blocked '.verdict = "blocked"'; bind_ship "$R" blocked
feature marked; archivable_ship "$R" marked; printf '{}\n' > "$A/marked/results/ship.unverified.json"
feature pending; archivable_ship "$R" pending; ledger_append "$R" pending/pending/ship '{"check":"ship","at":"x"}'
archive
check "an unverified ship result is not archived" 'kept unverif' "rc=$RC out=$OUT"
check "a schema-invalid ship result is not archived" 'kept invalid' "rc=$RC out=$OUT"
check "a committed ship result with no ledger entry is not archived" 'kept unbound' "rc=$RC out=$OUT"
check "a ship result edited after assemble is not archived" 'kept edited' "rc=$RC out=$OUT"
check "a blocked ship verdict is not archived" 'kept blocked' "rc=$RC out=$OUT"
check "a repo ship.unverified.json marker keeps the feature" 'kept marked' "rc=$RC out=$OUT"
check "a ledger pending marker keeps the feature" 'kept pending' "rc=$RC out=$OUT"
check "features with a ship result are not on the D13 line" '[[ "$(nores_lines)" == 0 ]]' "out=$OUT"
rm -rf "$T"

# 4. two archivable features are both archived (FOLLOWUPS 30: the counter under set -e)
sandbox; feature one; feature two; archivable_ship "$R" one; archivable_ship "$R" two
archive
check "two archivable features are both archived" \
    'archived one && archived two && [[ $RC -eq 0 && "$OUT" == *"Archived 2 feature(s)"* ]]' "rc=$RC out=$OUT"
rm -rf "$T"

# 5. a link at the archive destination is not followed (FOLLOWUPS 40)
sandbox; feature linked; archivable_ship "$R" linked
mkdir -p "$C" "$T/outside"; ln -s "$T/outside/target" "$C/linked-$TODAY"
archive
check "a dangling link at the archive destination is not followed when choosing a name" \
    '[[ -L "$C/linked-$TODAY" && ! -e "$T/outside/target" && -d "$C/linked-$TODAY-1" && ! -L "$C/linked-$TODAY-1" && ! -e "$A/linked" ]]' \
    "rc=$RC out=$OUT $(ls -la "$C" "$T/outside" 2>&1 | tr '\n' ' ')"
rm -rf "$T"

# 6. 50 features, 2 with results: one node start at most
sandbox
for i in $(seq 1 50); do feature "f$i" 'ship (merged)'; done
archivable_ship "$R" f7; ship_result "$R" f9 '.verification = "unverified"'; bind_ship "$R" f9
archive
check "with 50 features of which 2 have results, node starts at most once" \
    '[[ "$(node_calls)" -le 1 ]] && archived f7 && kept f9 && kept f1' "calls=$(node_calls) rc=$RC out=$(printf '%s' "$OUT" | head -c 400)"
rm -rf "$T"
sandbox; feature a 'ship (merged)'; feature b
archive
check "with no ship results at all, node never starts" '[[ "$(node_calls)" == 0 ]]' "calls=$(node_calls)"
rm -rf "$T"

# 7. a result assembled in session 1 archives in session 2, after HEAD and the ship run moved on
sandbox; feature s1feat; archivable_ship "$R" s1feat
( cd "$R" && echo merged > merged.txt && git add merged.txt && git commit -q -m merge )
# ⚠ changes existing test: pen N5 (round 2) — a later run/ship row with no feature field now counts as this feature's
#   re-ship (stale), so the later run here is another feature's.
ledger_append "$R" run/ship '{"startedAt":"2026-11-14T09:00:00Z","session":"s2","headSha":"x","feature":"other"}'
SESSION=s2 archive
check "a result bound in session 1 archives in session 2 (HEAD and run start moved on)" 'archived s1feat' "rc=$RC out=$OUT"
rm -rf "$T"

# 7b. pen N5 (round 2): a later ship run started where no feature resolved (feature "" or none) may be this feature's
#     re-ship, so the old result is kept, never archived.
for row in '"feature":""' '"note":"no feature field"'; do
    sandbox; feature n5feat; archivable_ship "$R" n5feat
    ledger_append "$R" run/ship "{\"startedAt\":\"2099-01-01T00:00:00Z\",\"session\":\"s3\",\"headSha\":\"x\",$row}"
    archive
    check "a later no-feature ship run ($row) keeps the result" 'kept n5feat' "rc=$RC out=$OUT"
    rm -rf "$T"
done

# 8. a CLI error archives nothing, even if it printed "ok"
sandbox; feature e1; archivable_ship "$R" e1
mkdir -p "$T/plugin/watcher/dist/cli" "$T/plugin/hooks"
cp "$ROOT/hooks/oss-node.sh" "$T/plugin/hooks/oss-node.sh"   # so the failing CLI really runs (not node_missing)
printf 'process.stdout.write("e1 ok\\n"); process.exit(3);\n' > "$T/plugin/watcher/dist/cli/phase-result.cjs"
PLUGIN="$T/plugin" archive
check "a phase-result CLI that fails archives nothing" 'kept e1' "rc=$RC out=$OUT"
rm -rf "$T"

# 9. --dry-run moves nothing and names what it would archive
sandbox; feature d1; archivable_ship "$R" d1
archive --dry-run
check "--dry-run names the archivable feature and moves nothing" \
    '[[ -d "$A/d1" && "$OUT" == *"Would archive: d1"* ]]' "rc=$RC out=$OUT"
rm -rf "$T"

# 10. (round 3, pen MEDIUM N3) the hook finds its own folder with a fixed dirname: a fake dirname first on PATH naming
#     a folder whose oss-phase-result.sh says "ok" for everything does not archive a hand-written ship result.
sandbox; feature victim
mkdir -p "$A/victim/results" "$T/forged"
printf '{"v":1,"phase":"ship","verification":"verified","verdict":"ready_to_merge"}\n' > "$A/victim/results/ship.json"
cp "$ROOT/hooks/oss-safe-path.sh" "$T/forged/oss-safe-path.sh"
printf 'oss_phase_result_main() { echo "victim ok"; }\n' > "$T/forged/oss-phase-result.sh"
printf '#!/bin/sh\necho "%s"\n' "$T/forged" > "$T/bin/dirname"; chmod +x "$T/bin/dirname"
archive
check "a fake dirname first on PATH does not archive a hand-written ship result" 'kept victim' "rc=$RC out=$OUT"
rm -rf "$T"

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
