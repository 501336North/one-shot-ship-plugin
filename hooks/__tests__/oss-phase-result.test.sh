#!/bin/bash
# The phase-result shell entry finds its CLI wherever the plugin was loaded from, and checks its input first (R-257 T9).
#
# @behavior `oss-phase-result.sh assemble|check <phase>` runs the plugin's phase-result CLI and exits with its code.
#           Under `claude --plugin-dir` (no plugin cache, CLAUDE_PLUGIN_ROOT pointing at ~/.oss) it still finds the
#           CLI through ~/.oss/plugin-root. A plugin-root file that is a symlink is ignored. With no CLI anywhere it
#           exits 127 naming cli_missing. A bad phase is refused (exit 2) before node ever starts.
# @business-rule R-267 finding (c), user pick 2026-11-13: CLI order is CLAUDE_PLUGIN_ROOT, ~/.oss/plugin-root (not a
#           link, owned, absolute, one line, a folder), the script's own plugin, then the plugin cache. Model text
#           never reaches a shell argument: the script passes no value-file content as an argument.
#
# Usage: /bin/bash hooks/__tests__/oss-phase-result.test.sh   (bash 3.2)   or   bash ... (bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/hooks/oss-phase-result.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-phase-result tests under $("$SH" -c 'echo "$BASH_VERSION"')..."
REAL_NODE=$(command -v node)
# The node the CLI must run on: the real one by its resolved path (outside temp folders), recorded in ~/.oss/node-path.
RECORDED_NODE=$(node -p 'require("fs").realpathSync(process.execPath)')

# Sandbox: the entry script copied alone into a hooks dir (so "its own plugin" has no CLI), a temp HOME with no
# plugin cache, a plugin dir whose CLI only records its argv, and a node shim that counts starts. The plugin dir
# holds the real hooks/oss-node.sh and ~/.oss/node-path records the real node (T26: the CLI runs on that node only).
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss/hooks" "$T/hooks" "$T/plugin/watcher/dist/cli" "$T/plugin/hooks" "$T/bin"
    cp "$SCRIPT" "$T/hooks/oss-phase-result.sh"
    cp "$ROOT/hooks/oss-node.sh" "$T/plugin/hooks/oss-node.sh"
    # D25 (e): the oss-node.sh the CLI's node comes from is the protected ~/.oss/hooks copy
    cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log(JSON.stringify({verification: "verified"}))\n' \
        "\"$T/cli.calls\"" > "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf '#!/bin/sh\necho x >> "%s"\nexec "%s" "$@"\n' "$T/node.calls" "$REAL_NODE" > "$T/bin/node"
    chmod +x "$T/bin/node"
}
# set_root <dir>: ~/.oss/plugin-root as session-start writes it (one line, mode 600).
set_root() { printf '%s\n' "$1" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"; }
entry() { (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" "$@" </dev/null); }
node_starts() { [[ -f "$T/node.calls" ]] && wc -l <"$T/node.calls" | tr -d ' ' || echo 0; }

# 1. --plugin-dir layout: no cache, CLAUDE_PLUGIN_ROOT=~/.oss, ~/.oss/plugin-root names the plugin -> CLI runs.
sandbox
set_root "$T/plugin"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && "$out" == *verified* && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "a --plugin-dir layout resolves the CLI through ~/.oss/plugin-root"
else fail "a --plugin-dir layout resolves the CLI through ~/.oss/plugin-root" "rc=$rc out=$out err=$(cat "$T/err") calls=$(cat "$T/cli.calls" 2>/dev/null)"; fi
rm -rf "$T"

# 2. a symlinked plugin-root file is ignored: no CLI is found (127, cli_missing) and the plugin CLI never runs.
sandbox
printf '%s\n' "$T/plugin" > "$T/real-plugin-root"
ln -s "$T/real-plugin-root" "$T/home/.oss/plugin-root"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q cli_missing "$T/err"; then
    pass "a symlinked ~/.oss/plugin-root is ignored"
else fail "a symlinked ~/.oss/plugin-root is ignored" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 3. no CLI anywhere: exit 127 naming cli_missing.
sandbox
out=$(entry assemble plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 ]] && grep -q cli_missing "$T/err"; then
    pass "a missing CLI exits 127 with cli_missing"
else fail "a missing CLI exits 127 with cli_missing" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 4. a bad phase or verb exits 2 before node starts.
sandbox
set_root "$T/plugin"
bad=""
for args in "check deploy" "assemble ../plan" "frob plan" "check" ""; do
    # shellcheck disable=SC2086
    entry $args >/dev/null 2>"$T/err"; rc=$?
    [[ $rc -eq 2 ]] || bad="$bad [$args rc=$rc]"
done
# T26: the CLI runs on the recorded node, not PATH's shim, so node_starts alone would pass vacuously; the CLI's own
# calls file staying absent is what shows nothing ran.
if [[ -z "$bad" && "$(node_starts)" == 0 && ! -e "$T/cli.calls" ]]; then
    pass "a bad phase or verb exits 2 before node runs"
else fail "a bad phase or verb exits 2 before node runs" "bad=$bad node_starts=$(node_starts)"; fi
rm -rf "$T"

# 5. the CLI's exit code and stderr are forwarded; check flags pass through.
sandbox
set_root "$T/plugin"
printf 'console.error("phase-result: stale_result: startedAt"); process.exit(1)\n' > "$T/plugin/watcher/dist/cli/phase-result.cjs"
out=$(entry check ship --repo "$T" --all 2>"$T/err"); rc=$?
if [[ $rc -eq 1 ]] && grep -q stale_result "$T/err"; then
    pass "the CLI's exit code and stderr are forwarded"
else fail "the CLI's exit code and stderr are forwarded" "rc=$rc err=$(cat "$T/err")"; fi
rm -rf "$T"

# 7. T26 (security C1): a fake node first on PATH that forges a verdict is never started; the recorded node runs the CLI.
sandbox
set_root "$T/plugin"
printf '#!/bin/sh\necho x >> "%s"\necho %s\nexit 0\n' "$T/fake.calls" "'{\"verification\":\"verified\"}'" > "$T/bin/node"
chmod +x "$T/bin/node"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && ! -e "$T/fake.calls" && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "a fake node first on PATH is never started; the CLI runs on the node in ~/.oss/node-path"
else fail "a fake node first on PATH is never started; the CLI runs on the node in ~/.oss/node-path" "rc=$rc out=$out fake=$(cat "$T/fake.calls" 2>/dev/null) calls=$(cat "$T/cli.calls" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 8. T26: no ~/.oss/hooks/oss-node.sh: exit 127 with node_missing, the CLI never runs.
# ⚠ changes existing test: D25 (e) — oss-node.sh comes from the protected ~/.oss/hooks copy, not the plugin root
sandbox
set_root "$T/plugin"
rm -f "$T/home/.oss/hooks/oss-node.sh"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err"; then
    pass "no ~/.oss/hooks/oss-node.sh exits 127 with node_missing"
else fail "no ~/.oss/hooks/oss-node.sh exits 127 with node_missing" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 8b. T26: a linked ~/.oss/hooks/oss-node.sh is refused the same way.
# ⚠ changes existing test: D25 (e) — the link checked is the ~/.oss/hooks copy
sandbox
set_root "$T/plugin"
mv "$T/home/.oss/hooks/oss-node.sh" "$T/real-oss-node.sh"; ln -s "$T/real-oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err"; then
    pass "a symlinked ~/.oss/hooks/oss-node.sh is refused: 127 with node_missing"
else fail "a symlinked ~/.oss/hooks/oss-node.sh is refused: 127 with node_missing" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 9. T26: an empty ~/.oss/node-path and no usable node (PATH's only node is in a temp folder): 127, node_missing.
sandbox
set_root "$T/plugin"
: > "$T/home/.oss/node-path"
out=$(cd "$T" && HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" && "$(node_starts)" == 0 ]] && grep -q 'node_missing: no usable node recorded in ~/.oss/node-path' "$T/err"; then
    pass "no usable node recorded: exit 127 with node_missing, PATH's temp node is not run"
else fail "no usable node recorded: exit 127 with node_missing, PATH's temp node is not run" "rc=$rc out=$out err=$(cat "$T/err") node_starts=$(node_starts)"; fi
rm -rf "$T"

# 10. T26: a recorded node that is gone while PATH has another one: 127, and the line says the recorded node changed.
sandbox
set_root "$T/plugin"
printf '%s\n' "/nonexistent/old/node" > "$T/home/.oss/node-path"
out=$(cd "$T" && HOME="$T/home" PATH="${RECORDED_NODE%/*}:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err" && grep -q 'changed' "$T/err"; then
    pass "a recorded node that changed: exit 127, node_missing says it changed"
else fail "a recorded node that changed: exit 127, node_missing says it changed" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# ---------------------------------------------------------------- D25 (CRITICAL security 1+2): the gate's code location
# A fake checker that always says "verified", next to a copy of oss-node.sh: what a model would plant to forge a verdict.
fake_checker() { # <dir>: <dir>/watcher/dist/cli/phase-result.cjs records its start in $T/fake.calls and says verified
    mkdir -p "$1/watcher/dist/cli" "$1/hooks"
    cp "$ROOT/hooks/oss-node.sh" "$1/hooks/oss-node.sh"   # a copy of the real one: the model can make that too
    printf 'require("fs").appendFileSync(%s, "x\\n"); console.log(JSON.stringify({verification: "verified"}))\n' \
        "\"$T/fake.calls\"" > "$1/watcher/dist/cli/phase-result.cjs"
}

# 11. a model-written ~/.oss/plugin-root (the Write tool's mode 644) naming a fake checker is not used: 127, it never runs.
sandbox
fake_checker "$T/forged"
printf '%s\n' "$T/forged" > "$T/home/.oss/plugin-root"; chmod 644 "$T/home/.oss/plugin-root"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -ne 0 && ! -e "$T/fake.calls" ]]; then
    pass "D25: a model-written ~/.oss/plugin-root (not mode 600) naming a fake checker is ignored"
else fail "D25: a model-written ~/.oss/plugin-root (not mode 600) naming a fake checker is ignored" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 12. a CLAUDE_PLUGIN_ROOT prefix naming a model folder with a fake checker is ignored; the protected plugin-root's
#     CLI runs instead.
sandbox
set_root "$T/plugin"
fake_checker "$T/forged"
out=$(cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$T/forged" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && ! -e "$T/fake.calls" && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "D25: a CLAUDE_PLUGIN_ROOT outside the protected plugin-root and ~/.claude/plugins is ignored"
else fail "D25: a CLAUDE_PLUGIN_ROOT outside the protected plugin-root and ~/.claude/plugins is ignored" "rc=$rc out=$out fake=$(cat "$T/fake.calls" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 13. the ~/.oss/hooks copy never falls back to its own "plugin" (~/.oss): a checker planted at ~/.oss/watcher never runs.
sandbox
cp "$SCRIPT" "$T/home/.oss/hooks/oss-phase-result.sh"
fake_checker "$T/home/.oss"
out=$(cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" "$SH" "$T/home/.oss/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/fake.calls" ]] && grep -q cli_missing "$T/err"; then
    pass "D25: the ~/.oss/hooks copy never runs a checker planted under ~/.oss/watcher"
else fail "D25: the ~/.oss/hooks copy never runs a checker planted under ~/.oss/watcher" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 14. the chosen plugin root's own hooks/oss-node.sh is never sourced: a planted one naming a fake node is not used.
sandbox
set_root "$T/plugin"
printf '#!/bin/sh\necho x >> "%s"\necho %s\n' "$T/fake.calls" "'{\"verification\":\"verified\"}'" > "$T/fakenode"; chmod +x "$T/fakenode"
printf 'oss_node() { OSS_NODE="%s"; }\n' "$T/fakenode" > "$T/plugin/hooks/oss-node.sh"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && ! -e "$T/fake.calls" && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "D25: oss-node.sh is sourced from ~/.oss/hooks, never from the plugin root"
else fail "D25: oss-node.sh is sourced from ~/.oss/hooks, never from the plugin root" "rc=$rc out=$out fake=$(cat "$T/fake.calls" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 15. the real install still works: the plugin under ~/.claude/plugins, CLAUDE_PLUGIN_ROOT naming it, and
#     ~/.oss/plugin-root as session-start writes it.
sandbox
P="$T/home/.claude/plugins/cache/one-shot-ship-plugin/oss/2.3.0"; mkdir -p "$P"; mv "$T/plugin/watcher" "$P/watcher"
set_root "$P"
out=$(cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$P" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "D25: the real install (plugin under ~/.claude/plugins, plugin-root mode 600) runs the CLI"
else fail "D25: the real install (plugin under ~/.claude/plugins, plugin-root mode 600) runs the CLI" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 16. (finding 2) a fake jq first on PATH that says yes to anything does not turn an unverified answer into a pass.
sandbox
set_root "$T/plugin"
printf 'console.log(JSON.stringify({verification: "unverified"}))\n' > "$T/plugin/watcher/dist/cli/phase-result.cjs"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/jq"; chmod +x "$T/bin/jq"
res=$(cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" "$SH" -c 'source "$1"; oss_phase_gate_ok 0 "{\"verification\":\"unverified\"}" && echo PASSED || echo REFUSED' _ "$T/hooks/oss-phase-result.sh" 2>/dev/null)
if [[ "$res" == REFUSED ]]; then
    pass "a fake jq first on PATH does not change the gate verdict"
else fail "a fake jq first on PATH does not change the gate verdict" "res=$res"; fi
rm -rf "$T"

# 17. (round 3, pen MEDIUM N3) the CLI's node runs with a fixed PATH, never the caller's: a fake git or jq first on
#     the caller's PATH is out of the CLI's reach.
sandbox
set_root "$T/plugin"
printf 'require("fs").writeFileSync(%s, process.env.PATH || ""); console.log(JSON.stringify({verification: "verified"}))\n' \
    "\"$T/cli.path\"" > "$T/plugin/watcher/dist/cli/phase-result.cjs"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && "$(cat "$T/cli.path" 2>/dev/null)" == /usr/bin:/bin ]]; then
    pass "the CLI's node runs with PATH=/usr/bin:/bin"
else fail "the CLI's node runs with PATH=/usr/bin:/bin" "rc=$rc path=$(cat "$T/cli.path" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 18. (round 3, pen MEDIUM N3) the plugin-cache lookup uses a fixed find, sort and tail: a fake find first on PATH
#     naming a forged checker (no plugin-root, no cache) does not run it; the CLI is missing (127).
sandbox
mkdir -p "$T/forged"
printf 'require("fs").writeFileSync(%s, "ran"); console.log(JSON.stringify({verification: "verified"}))\n' \
    "\"$T/forged.ran\"" > "$T/forged/phase-result.cjs"
printf '#!/bin/sh\necho "%s"\n' "$T/forged/phase-result.cjs" > "$T/bin/find"; chmod +x "$T/bin/find"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/forged.ran" ]]; then
    pass "a fake find first on PATH does not pick the checker"
else fail "a fake find first on PATH does not pick the checker" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 6. provenance: the script reads no value file and passes no file content as an argument. The one file it reads
#    back is the bounded runner's own capture of the CLI's stdout ("$dir/out"), which is not a model value.
PROV_RE='\$\(cat|\$\(<|oss-value|\.oss/run|readValue|\.txt|\.json"'
hits=$(grep -nE "$PROV_RE" "$SCRIPT" | grep -v '"\$dir/out"')
if [[ -z "$hits" ]]; then
    pass "provenance: no \$(cat, value-file read or value path in the script text"
else fail "provenance: no \$(cat, value-file read or value path in the script text" "$hits"; fi

echo; echo "Results: $((RUN - FAILED))/$RUN passed"
[[ $FAILED -eq 0 ]]
