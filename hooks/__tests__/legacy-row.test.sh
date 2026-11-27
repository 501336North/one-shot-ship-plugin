#!/bin/bash
# complete-gaps Task 4: the ledger legacy/<phase> row at a run's first non-start event (D6, AC-002.0, AC-002.5).
#
# @behavior When a phase that started before the phase-results hooks were installed (workflow state currentCommand is
#           this phase, currentCommandStartedAt before the ledger phase-results-since marker) sends its first non-start
#           event, oss-notify appends one {startedAt, feature} row to ~/.oss/ledger/<key>/legacy/<phase>, before merged
#           resets the workflow state. A start after the marker, another current command, any results, or a linked or
#           foreign marker or ledger folder write nothing; repeated events write the row once.
# @business-rule "Only pre-upgrade starts" may later pass complete as legacy (D6): the row is the proof, recorded from
#           hook-owned state only, never from a model value.
#
# Hermetic: its own temp HOME, a temp git repo, a sandbox plugin root (real workflow-state CLI, no chain-trigger), and
# terminal-notifier/osascript/say/afplay tripwires first on PATH. "Foreign" uses the BASH_ENV `test -O` seam.
# Usage: /bin/bash hooks/__tests__/legacy-row.test.sh
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
MARKER_AT=2026-11-20T00:00:00Z
PRE=2026-11-01T00:00:00Z

T=""
# sandbox <currentCommand> <currentCommandStartedAt>: repo on feat/<F>/ship, marker, project workflow state
sandbox() {
    T=$(mktemp -d "$RUNDIR/s.XXXXXX")
    mkdir -p "$T/home/.oss" "$T/plugin/watcher/dist/cli" "$T/bin" "$T/repo"
    ln -s "$ROOT/hooks" "$T/plugin/hooks"
    ln -s "$ROOT/watcher/dist/cli/update-workflow-state.js" "$T/plugin/watcher/dist/cli/"
    printf '{"notifications":{"style":"none"}}\n' > "$T/home/.oss/settings.json"
    for n in terminal-notifier osascript say afplay; do
        printf '#!/bin/sh\necho "%s $*" >> "%s/tripwire"\nexit 0\n' "$n" "$T" > "$T/bin/$n"; chmod +x "$T/bin/$n"
    done
    (cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$FEATURE/ship" && mkdir -p ".oss/dev/active/$FEATURE" \
        && printf '# Design\n' > ".oss/dev/active/$FEATURE/DESIGN.md")
    (umask 077; mkdir "$T/home/.oss/ledger"; printf '%s\n' "$MARKER_AT" > "$T/home/.oss/ledger/phase-results-since")
    jq -cn --arg c "$1" --arg s "$2" '{currentCommand: $c, currentCommandStartedAt: $s}' > "$T/repo/.oss/workflow-state.json"
}
# notify <event> [foreign path]: one oss-notify --workflow ship <event> run; rc in RC
notify() {
    RC=0
    (cd "$T/repo" && HOME="$T/home" PATH="$T/bin:$RUNDIR/node-only:$SAFE_PATH" CLAUDE_PLUGIN_ROOT="$T/plugin" \
        CLAUDE_PROJECT_DIR="$T/repo" BASH_ENV="$RUNDIR/foreign.sh" OSS_T_FOREIGN="${2:-}" \
        "$SH" "$ROOT/hooks/oss-notify.sh" --workflow ship "$1" '{}' </dev/null >/dev/null 2>&1) || RC=$?
}
L() { local k; k=$(cd "$T/repo" && printf '%s\n%s\n' "$(git rev-parse --show-toplevel)" "$(git rev-parse --absolute-git-dir)" \
        | git hash-object --stdin | cut -c1-16); printf '%s' "$T/home/.oss/ledger/$k"; }
rows() { [[ -f "$(L)/legacy/ship" ]] && wc -l < "$(L)/legacy/ship" | tr -d ' ' || echo 0; }
check_tripwire() { [[ ! -e "$T/tripwire" ]] || fail "no real notifier is ever called" "$(cat "$T/tripwire")"; }
none() { # <label>: no legacy row was written, the hook still exited 0
    if [[ $RC -eq 0 && ! -e "$(L)/legacy/ship" ]]; then pass "$1"; else fail "$1" "rc=$RC rows=$(cat "$(L)/legacy/ship" 2>&1)"; fi
    check_tripwire
}

# 1. pr_created on a ship started before the marker writes one {startedAt, feature} row
sandbox ship "$PRE"; notify pr_created
want=$(jq -cn --arg s "$PRE" --arg f "$FEATURE" '{startedAt: $s, feature: $f}')
if [[ $RC -eq 0 && "$(cat "$(L)/legacy/ship" 2>/dev/null)" == "$want" ]]; then
    pass "should write a legacy/ship row at pr_created for a ship started before the marker"
else fail "should write a legacy/ship row at pr_created for a ship started before the marker" "rc=$RC got=$(cat "$(L)/legacy/ship" 2>&1)"; fi
check_tripwire

# 2. merged records the row before it resets the workflow state
sandbox ship "$PRE"; notify merged
cc=$(jq -r '.currentCommand // empty' "$T/repo/.oss/workflow-state.json" 2>/dev/null)
if [[ $RC -eq 0 && "$(cat "$(L)/legacy/ship" 2>/dev/null)" == "$want" && -z "$cc" ]]; then
    pass "should write the legacy row at merged, before merged resets the workflow state"
else fail "should write the legacy row at merged, before merged resets the workflow state" "rc=$RC currentCommand=$cc got=$(cat "$(L)/legacy/ship" 2>&1)"; fi
check_tripwire

# 3. a ship started after the marker is not legacy
sandbox ship 2026-11-25T00:00:00Z; notify pr_created
none "should write no legacy row for a ship started after the marker"

# 4. another current command (a skipped ship start) is not legacy
sandbox build "$PRE"; notify pr_created
none "should write no legacy row when the current command is another phase"

# 5. results in the repo or in the ledger block the row
sandbox ship "$PRE"; mkdir -p "$T/repo/.oss/dev/active/$FEATURE/results"; echo '{}' > "$T/repo/.oss/dev/active/$FEATURE/results/plan.json"
notify pr_created
none "should write no legacy row when the feature has repo results"
sandbox ship "$PRE"; (umask 077; mkdir -p "$(L)/results/$FEATURE"; echo '{}' > "$(L)/results/$FEATURE/plan")
notify pr_created
none "should write no legacy row when the feature has ledger results"

# 6. repeated events write the row once per run
sandbox ship "$PRE"; notify pr_created; notify quality_passed; notify pr_created
if [[ $RC -eq 0 && "$(rows)" == 1 ]]; then pass "should write the legacy row only once for repeated events"
else fail "should write the legacy row only once for repeated events" "rc=$RC rows=$(cat "$(L)/legacy/ship" 2>&1)"; fi
check_tripwire

# 7. fail closed: a run row with this startedAt, a foreign marker, a linked legacy folder, a missing marker
sandbox ship "$PRE"; (umask 077; mkdir -p "$(L)/run"; jq -cn --arg s "$PRE" '{startedAt: $s}' > "$(L)/run/ship")
notify pr_created
none "should write no legacy row when a run row has this startedAt"
sandbox ship "$PRE"; notify pr_created "$T/home/.oss/ledger/phase-results-since"
none "should write no legacy row when the marker is foreign-owned"
sandbox ship "$PRE"; mkdir -m 700 "$T/other"; (umask 077; mkdir -p "$(L)"); ln -s "$T/other" "$(L)/legacy"; notify pr_created
if [[ $RC -eq 0 && -z "$(ls -A "$T/other")" ]]; then pass "should write nothing through a linked legacy folder"
else fail "should write nothing through a linked legacy folder" "rc=$RC other=$(ls -A "$T/other")"; fi
check_tripwire
sandbox ship "$PRE"; rm "$T/home/.oss/ledger/phase-results-since"; ln -s "$T/elsewhere" "$T/home/.oss/ledger/phase-results-since"
printf '%s\n' "$MARKER_AT" > "$T/elsewhere"; notify pr_created
none "should write no legacy row when the marker is a link"

echo ""
echo "legacy-row: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
