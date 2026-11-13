#!/bin/bash
# Ship results for archive tests (R-257 T13): a schema-valid results/ship.json written by hand, and the ledger row
# that binds its bytes, written the way the assembler writes it (NOTES "Ledger (D14, T3b)"). Sourced.
# The ledger lives under $HOME (set HOME to the sandbox home before calling bind_ship).

# ship_result <repo> <feature> [jq filter]  - writes .oss/dev/active/<feature>/results/ship.json (filter edits it)
ship_result() {
    local dir="$1/.oss/dev/active/$2/results" sha
    sha=$(printf '%040d' 0 | tr 0 a)
    mkdir -p "$dir"
    jq -cn --arg f "$2" --arg sha "$sha" '{
        v: 1, phase: "ship", feature: $f, startedAt: "2026-11-13T00:00:00Z", assembledAt: "2026-11-13T00:00:01Z",
        headSha: $sha, sources: {diff: "code", gates: "code", verdict: "code", summary: "model"},
        verification: "verified", claims: [], chain: [],
        diff: {base: $sha, baseRef: "main", files: 1, insertions: 1, deletions: 0}, gates: [], overrides: [], blockers: [],
        verdict: "ready_to_merge", summary: "shipped"
    }' | jq -c "${3:-.}" > "$dir/ship.json"
}

# ledger_dir <repo>  - prints $HOME/.oss/ledger/<key> for the repo (key: oss-value.sh's _ov_key derivation)
ledger_dir() {
    local key
    key=$(cd "$1" && printf '%s\n%s\n' "$(git rev-parse --show-toplevel)" "$(git rev-parse --absolute-git-dir)" \
        | git hash-object --stdin | cut -c1-16)
    printf '%s\n' "$HOME/.oss/ledger/$key"
}

# ledger_append <repo> <relpath> <json row>  - one row, dirs 700, file 600
ledger_append() {
    local base file
    base=$(ledger_dir "$1"); file="$base/$2"
    (umask 077 && mkdir -p "$(dirname "$file")")
    chmod 700 "$HOME/.oss/ledger" "$base"
    local d="$(dirname "$file")"
    while [[ "$d" != "$base" ]]; do chmod 700 "$d"; d="$(dirname "$d")"; done
    printf '%s\n' "$3" >> "$file"; chmod 600 "$file"
}

# bind_ship <repo> <feature>  - binds the current ship.json bytes in the ledger, as the assembler does
bind_ship() {
    local sha
    sha=$(shasum -a 256 "$1/.oss/dev/active/$2/results/ship.json" | cut -d' ' -f1)
    ledger_append "$1" "results/$2/ship" \
        "{\"sha256\":\"$sha\",\"feature\":\"$2\",\"phase\":\"ship\",\"startedAt\":\"2026-11-13T00:00:00Z\",\"headSha\":\"$(printf '%040d' 0 | tr 0 a)\",\"session\":\"s1\"}"
}

# archivable_ship <repo> <feature>  - a valid, bound, verified ready_to_merge ship result
archivable_ship() { ship_result "$1" "$2" && bind_ship "$1" "$2"; }
