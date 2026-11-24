#!/bin/bash
# Valid phase results for hook tests (R-257): each helper starts the phase through oss-notify.sh, writes the evidence
# the assembler reads, and runs `oss-phase-result.sh assemble`, so the result is bound to that run in the ledger.
# Sourced. The caller sets ROOT (the plugin checkout), SH (the bash under test) and PRF_REPO (the repo, a git repo on a
# feat/<feature>/<phase> branch with that feature's folder), and defines envrun <cmd...>, which runs a command from
# PRF_REPO with the sandbox env (HOME, CLAUDE_PLUGIN_ROOT, ...). The plugin root must hold the real watcher CLIs.
prf_notify() { envrun "$SH" "$ROOT/hooks/oss-notify.sh" --workflow "$@"; }
prf_value_dir() { envrun "$SH" "$ROOT/hooks/oss-value.sh" dir 2>/dev/null; }
prf_assemble() { envrun "$SH" "$ROOT/hooks/oss-phase-result.sh" assemble "$1" >/dev/null 2>&1; }

# plan: one task with one test id, from the value file tasks.json
prf_plan() {
    local vd
    prf_notify plan start '{}' >/dev/null 2>&1
    vd=$(prf_value_dir) && [[ -n "$vd" ]] || return 1
    printf '[{"id":"T1","title":"first task","testIds":["validate.test.ts:accepts"]}]\n' > "$vd/tasks.json"
    prf_assemble plan
}

# build: a red then a green test run in the tool gate's event log, at this build's start time
prf_build() {
    local s
    prf_notify build start '{}' >/dev/null 2>&1
    s=$(jq -r '.currentCommandStartedAt // empty' "$PRF_REPO/.oss/workflow-state.json" 2>/dev/null) && [[ -n "$s" ]] || return 1
    mkdir -p "$PRF_REPO/.oss/tool-gates"
    printf '{"ts":"%s","tool":"Bash","kind":"test-run","program":"npx","result":"%s"}\n' "$s" red "$s" green \
        > "$PRF_REPO/.oss/tool-gates/events.ndjson"
    prf_assemble build
}

# ship: one commit against main, and a passing round-1 line for each default gate, written through oss-value.sh
# ⚠ changes existing test: REQUIREMENTS AC-003.5 — gates are the timeline gate lines, whose names are ship.md's gate.txt values
prf_ship() {
    local vd g
    # ⚠ changes existing test: D34 — a ship base must be an ancestor of origin's default branch, so origin/main is set
    #   at main's tip when the repo has none.
    # ⚠ changes existing test: D40 — the base must be in the origin snapshot ship start records, so origin/main is set
    #   before the start.
    (cd "$PRF_REPO" && { git rev-parse -q --verify refs/remotes/origin/main >/dev/null \
        || git update-ref refs/remotes/origin/main main; }) || return 1
    prf_notify ship start '{}' >/dev/null 2>&1
    (cd "$PRF_REPO" && echo change > change.txt && git add change.txt && git commit -q -m change) || return 1
    for g in code-review performance security; do
        vd=$(prf_value_dir) && [[ -n "$vd" ]] || return 1
        printf '1\n' > "$vd/round.txt"; printf '%s\n' "$g" > "$vd/gate.txt"; printf 'pass\n' > "$vd/verdict.txt"
        : > "$vd/findings.txt"; : > "$vd/fixed.txt"; printf 'full\n' > "$vd/mode.txt"
        envrun "$SH" "$ROOT/hooks/oss-value.sh" timeline gate >/dev/null 2>&1 || return 1
    done
    prf_assemble ship
}
