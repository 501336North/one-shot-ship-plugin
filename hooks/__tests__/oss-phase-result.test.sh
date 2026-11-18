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
    mkdir -p "$T/home/.oss" "$T/hooks" "$T/plugin/watcher/dist/cli" "$T/plugin/hooks" "$T/bin"
    cp "$SCRIPT" "$T/hooks/oss-phase-result.sh"
    cp "$ROOT/hooks/oss-node.sh" "$T/plugin/hooks/oss-node.sh"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    printf 'require("fs").appendFileSync(%s, process.argv.slice(2).join(" ") + "\\n"); console.log(JSON.stringify({verification: "verified"}))\n' \
        "\"$T/cli.calls\"" > "$T/plugin/watcher/dist/cli/phase-result.cjs"
    printf '#!/bin/sh\necho x >> "%s"\nexec "%s" "$@"\n' "$T/node.calls" "$REAL_NODE" > "$T/bin/node"
    chmod +x "$T/bin/node"
}
entry() { (cd "$T" && HOME="$T/home" PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" "$@" </dev/null); }
node_starts() { [[ -f "$T/node.calls" ]] && wc -l <"$T/node.calls" | tr -d ' ' || echo 0; }

# 1. --plugin-dir layout: no cache, CLAUDE_PLUGIN_ROOT=~/.oss, ~/.oss/plugin-root names the plugin -> CLI runs.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
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
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
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
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
printf 'console.error("phase-result: stale_result: startedAt"); process.exit(1)\n' > "$T/plugin/watcher/dist/cli/phase-result.cjs"
out=$(entry check ship --repo "$T" --all 2>"$T/err"); rc=$?
if [[ $rc -eq 1 ]] && grep -q stale_result "$T/err"; then
    pass "the CLI's exit code and stderr are forwarded"
else fail "the CLI's exit code and stderr are forwarded" "rc=$rc err=$(cat "$T/err")"; fi
rm -rf "$T"

# 7. T26 (security C1): a fake node first on PATH that forges a verdict is never started; the recorded node runs the CLI.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
printf '#!/bin/sh\necho x >> "%s"\necho %s\nexit 0\n' "$T/fake.calls" "'{\"verification\":\"verified\"}'" > "$T/bin/node"
chmod +x "$T/bin/node"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 0 && ! -e "$T/fake.calls" && "$(cat "$T/cli.calls" 2>/dev/null)" == "check plan" ]]; then
    pass "a fake node first on PATH is never started; the CLI runs on the node in ~/.oss/node-path"
else fail "a fake node first on PATH is never started; the CLI runs on the node in ~/.oss/node-path" "rc=$rc out=$out fake=$(cat "$T/fake.calls" 2>/dev/null) calls=$(cat "$T/cli.calls" 2>/dev/null) err=$(cat "$T/err")"; fi
rm -rf "$T"

# 8. T26: a plugin root with no hooks/oss-node.sh: exit 127 with node_missing, the CLI never runs.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
rm -f "$T/plugin/hooks/oss-node.sh"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err"; then
    pass "a plugin root without hooks/oss-node.sh exits 127 with node_missing"
else fail "a plugin root without hooks/oss-node.sh exits 127 with node_missing" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 8b. T26: a linked hooks/oss-node.sh is refused the same way.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
mv "$T/plugin/hooks/oss-node.sh" "$T/real-oss-node.sh"; ln -s "$T/real-oss-node.sh" "$T/plugin/hooks/oss-node.sh"
out=$(entry check plan 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err"; then
    pass "a symlinked hooks/oss-node.sh is refused: 127 with node_missing"
else fail "a symlinked hooks/oss-node.sh is refused: 127 with node_missing" "rc=$rc out=$out err=$(cat "$T/err")"; fi
rm -rf "$T"

# 9. T26: an empty ~/.oss/node-path and no usable node (PATH's only node is in a temp folder): 127, node_missing.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
: > "$T/home/.oss/node-path"
out=$(cd "$T" && HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" && "$(node_starts)" == 0 ]] && grep -q 'node_missing: no usable node recorded in ~/.oss/node-path' "$T/err"; then
    pass "no usable node recorded: exit 127 with node_missing, PATH's temp node is not run"
else fail "no usable node recorded: exit 127 with node_missing, PATH's temp node is not run" "rc=$rc out=$out err=$(cat "$T/err") node_starts=$(node_starts)"; fi
rm -rf "$T"

# 10. T26: a recorded node that is gone while PATH has another one: 127, and the line says the recorded node changed.
sandbox
printf '%s\n' "$T/plugin" > "$T/home/.oss/plugin-root"
printf '%s\n' "/nonexistent/old/node" > "$T/home/.oss/node-path"
out=$(cd "$T" && HOME="$T/home" PATH="${RECORDED_NODE%/*}:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$T/home/.oss" "$SH" "$T/hooks/oss-phase-result.sh" check plan </dev/null 2>"$T/err"); rc=$?
if [[ $rc -eq 127 && ! -e "$T/cli.calls" ]] && grep -q 'node_missing' "$T/err" && grep -q 'changed' "$T/err"; then
    pass "a recorded node that changed: exit 127, node_missing says it changed"
else fail "a recorded node that changed: exit 127, node_missing says it changed" "rc=$rc out=$out err=$(cat "$T/err")"; fi
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
