#!/bin/bash
# hooks/oss-verdict-capture.sh: the SubagentStop verdict capture (R-257 T19, D6, D14, D21).
#
# @behavior When a review agent stops, its final message's oss-verdict block is recorded in the owner-only ledger
#           (verdicts/<feature>), so ship's gate verdict is the agent's own. Whatever happens (another agent, no block,
#           garbage input, no recorded node, a crashing or hanging capture), the hook exits 0 and prints nothing:
#           a capture failure never blocks or changes a subagent's stop.
# @business-rule PLAN T19: the gate name comes from agent_type; the capture runs on the recorded node, bounded; the
#           hook always exits 0 with an empty stdout.
#
# Hermetic: temp HOME (with ~/.oss/node-path), temp git repo, sandbox plugins for a misbehaving CLI.
# Usage: ./hooks/__tests__/oss-verdict-capture.test.sh   (BASH_UNDER_TEST=/opt/homebrew/bin/bash for bash 5)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE CLAUDE_PLUGIN_ROOT CLAUDE_PROJECT_DIR
unset CLAUDE_CODE_SESSION_ID
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib/run-capped.sh
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
SH="${BASH_UNDER_TEST:-/bin/bash}"
HOOK="$ROOT/hooks/oss-verdict-capture.sh"
RECORDED_NODE="$(node -p 'require("fs").realpathSync(process.execPath)')"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running oss-verdict-capture tests under $("$SH" -c 'echo "$BASH_VERSION"')..."

FEATURE=capture-feat
BLOCK='```oss-verdict\n{\"verdict\":\"pass\",\"findings\":{\"critical\":0,\"high\":0,\"medium\":1,\"low\":0,\"info\":2}}\n```'
sandbox() {
    T=$(mktemp -d); T=$(cd "$T" && pwd -P)
    mkdir -p "$T/home/.oss" "$T/repo"
    chmod 700 "$T/home/.oss"
    printf '%s\n' "$RECORDED_NODE" > "$T/home/.oss/node-path"
    plugin_root "$ROOT"
    # D25 e: the recorded node is read only through the protected ~/.oss/hooks copy of oss-node.sh.
    mkdir -p "$T/home/.oss/hooks" && cp "$ROOT/hooks/oss-node.sh" "$T/home/.oss/hooks/oss-node.sh"
    ( cd "$T/repo" && git init -q -b main && git config user.email t@example.invalid && git config user.name t \
        && echo base > base.txt && git add base.txt && git commit -q -m base \
        && git checkout -q -b "feat/$FEATURE/ship" && mkdir -p ".oss/dev/active/$FEATURE" )
}
cleanup() { rm -rf "$T"; }
# plugin_root <dir>: names the plugin in ~/.oss/plugin-root as session-start writes it (mode 600, one absolute line).
#   D25: the hook trusts only this file or ~/.claude/plugins, never a caller's CLAUDE_PLUGIN_ROOT or its own folder.
plugin_root() { printf '%s\n' "$1" > "$T/home/.oss/plugin-root"; chmod 600 "$T/home/.oss/plugin-root"; }
rows_file() { # -> the ledger verdicts file of the feature (NOTES "Ledger (D14, T3b)")
    local top gd key
    top=$(cd "$T/repo" && git rev-parse --show-toplevel); gd=$(cd "$top" && git rev-parse --absolute-git-dir)
    key=$(printf '%s\n%s\n' "$top" "$gd" | git hash-object --stdin | cut -c1-16)
    echo "$T/home/.oss/ledger/$key/verdicts/$FEATURE"
}
# input <agent_type> <message JSON string body>: a SubagentStop hook input
input() {
    printf '{"session_id":"s1","transcript_path":"/nonexistent","cwd":"%s","hook_event_name":"SubagentStop","stop_hook_active":false,"agent_id":"a1","agent_type":"%s","last_assistant_message":"%s"}' \
        "$T/repo" "$1" "$2"
}
# capture [env...] < stdin: runs the hook as Claude Code does (cwd = repo), capped; sets RC and OUT
capture() {
    OUT=$(cd "$T/repo" && run_capped 30 env HOME="$T/home" "$@" "$SH" "$HOOK" 2>/dev/null); RC=$?
}
# sandbox_plugin <js>: a plugin root at $T/plugin with the real hooks and a verdict-capture.cjs holding <js>.
sandbox_plugin() {
    mkdir -p "$T/plugin/hooks" "$T/plugin/watcher/dist/cli"
    cp "$ROOT/hooks/oss-node.sh" "$ROOT/hooks/oss-phase-result.sh" "$T/plugin/hooks/"
    printf '%s\n' "$1" > "$T/plugin/watcher/dist/cli/verdict-capture.cjs"
    plugin_root "$T/plugin"
}

# 1. A review agent with a valid block: one row with the gate from agent_type; exit 0, nothing printed.
sandbox
capture < <(input "oss:security-auditor" "Done.\n\n$BLOCK")
f=$(rows_file)
if [[ $RC -eq 0 && -z "$OUT" && -f "$f" ]] \
    && jq -e -s 'length == 1 and .[0].gate == "security" and .[0].verdict == "pass" and .[0].findings.info == 2 and .[0].agent == "a1" and .[0].session == "s1"' "$f" >/dev/null 2>&1; then
    pass "review agent with a block: one ledger row, gate from agent_type, exit 0, no output"
else fail "review agent with a block: one ledger row, gate from agent_type, exit 0, no output" "rc=$RC out=$OUT rows=$(cat "$f" 2>/dev/null)"; fi
cleanup

# ⚠ changes existing test: finding 5 (round 1 security) — only the exact oss: review agent types record or start
#   node, so the cases below that need the CLI to run name "oss:code-reviewer" instead of the bare name.
# 2. The transcript route: no last_assistant_message, the final assistant entry of agent_transcript_path.
sandbox
printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"%s"}]}}\n' "Done.\n\n$BLOCK" > "$T/agent.jsonl"
capture < <(printf '{"session_id":"s1","cwd":"%s","hook_event_name":"SubagentStop","agent_id":"a2","agent_type":"oss:code-reviewer","agent_transcript_path":"%s"}' "$T/repo" "$T/agent.jsonl")
f=$(rows_file)
if [[ $RC -eq 0 && -z "$OUT" ]] && jq -e -s 'length == 1 and .[0].gate == "code-review"' "$f" >/dev/null 2>&1; then
    pass "transcript route: row written, exit 0, no output"
else fail "transcript route: row written, exit 0, no output" "rc=$RC out=$OUT rows=$(cat "$f" 2>/dev/null)"; fi
cleanup

# 3. Inputs that record nothing: another agent, no block, a malformed block, garbage, empty stdin.
sandbox
f=$(rows_file)
for c in other noblock malformed garbage empty; do
    case "$c" in
        other) capture < <(input "oss:typescript-pro" "Done.\n\n$BLOCK") ;;
        noblock) capture < <(input "oss:code-reviewer" "All good.") ;;
        malformed) capture < <(input "oss:code-reviewer" '```oss-verdict\n{\"verdict\":\n```') ;;
        garbage) capture < <(printf 'not json "agent_type":"code-reviewer"') ;;
        empty) capture < /dev/null ;;
    esac
    if [[ $RC -eq 0 && -z "$OUT" && ! -s "$f" ]]; then pass "$c: no row, exit 0, no output"
    else fail "$c: no row, exit 0, no output" "rc=$RC out=$OUT rows=$(cat "$f" 2>/dev/null)"; fi
done
cleanup

# 4. No usable recorded node (D21): nothing runs, exit 0, no output.
sandbox
printf '/nonexistent/node\n' > "$T/home/.oss/node-path"
capture < <(input "oss:code-reviewer" "$BLOCK")
f=$(rows_file)
if [[ $RC -eq 0 && -z "$OUT" && ! -e "$f" ]]; then pass "no recorded node: no row, exit 0, no output"
else fail "no recorded node: no row, exit 0, no output" "rc=$RC out=$OUT"; fi
cleanup

# 5. A capture CLI that prints and crashes: its stdout never reaches Claude Code; exit 0.
sandbox
sandbox_plugin 'process.stdout.write("{\"decision\":\"block\",\"reason\":\"x\"}\n"); process.exit(3)'
capture CLAUDE_PLUGIN_ROOT="$T/plugin" < <(input "oss:code-reviewer" "$BLOCK")
if [[ $RC -eq 0 && -z "$OUT" ]]; then pass "crashing CLI that prints: exit 0, no output"
else fail "crashing CLI that prints: exit 0, no output" "rc=$RC out=$OUT"; fi
cleanup

# 6. A capture CLI that hangs: the hook's own bound ends it well under Claude Code's 10 s limit; exit 0.
sandbox
sandbox_plugin 'setInterval(() => {}, 1000)'
start=$(date +%s)
capture CLAUDE_PLUGIN_ROOT="$T/plugin" < <(input "oss:code-reviewer" "$BLOCK")
took=$(( $(date +%s) - start ))
if [[ $RC -eq 0 && -z "$OUT" && $took -lt 9 ]]; then pass "hanging CLI: bounded (${took}s), exit 0, no output"
else fail "hanging CLI: bounded, exit 0, no output" "rc=$RC out=$OUT took=${took}s"; fi
cleanup

# 7. A non-review agent never starts node (fast path in bash).
sandbox
sandbox_plugin 'require("fs").writeFileSync(process.env.HOME + "/../cli.calls", "ran\n")'
capture CLAUDE_PLUGIN_ROOT="$T/plugin" < <(input "oss:typescript-pro" "$BLOCK")
if [[ $RC -eq 0 && -z "$OUT" && ! -e "$T/cli.calls" ]]; then pass "non-review agent: the CLI never starts"
else fail "non-review agent: the CLI never starts" "rc=$RC out=$OUT calls=$(cat "$T/cli.calls" 2>/dev/null)"; fi
cleanup

# 8. Finding 5: a bare reviewer name (a project agent in .claude/agents), another plugin's prefix, a nested prefix or
#    another case never starts node.
for t in "security-auditor" "evil:code-reviewer" "x:oss:code-reviewer" "OSS:code-reviewer"; do
    sandbox
    sandbox_plugin 'require("fs").writeFileSync(process.env.HOME + "/../cli.calls", "ran\n")'
    capture CLAUDE_PLUGIN_ROOT="$T/plugin" < <(input "$t" "$BLOCK")
    if [[ $RC -eq 0 && -z "$OUT" && ! -e "$T/cli.calls" ]]; then pass "agent_type $t: the CLI never starts"
    else fail "agent_type $t: the CLI never starts" "rc=$RC out=$OUT calls=$(cat "$T/cli.calls" 2>/dev/null)"; fi
    cleanup
done

# 9. The exact oss: review agent does start the CLI (the fast path lets it through).
sandbox
sandbox_plugin 'require("fs").writeFileSync(process.env.HOME + "/../cli.calls", "ran\n")'
capture CLAUDE_PLUGIN_ROOT="$T/plugin" < <(input "oss:penetration-tester" "$BLOCK")
if [[ $RC -eq 0 && -z "$OUT" && -e "$T/cli.calls" ]]; then pass "agent_type oss:penetration-tester: the CLI starts"
else fail "agent_type oss:penetration-tester: the CLI starts" "rc=$RC out=$OUT"; fi
cleanup

# 10. Round 2 security L4: at SubagentStart (`oss-verdict-capture.sh start`) a review agent's input reaches the CLI
#     as `start <input-file>`, so the CLI records the start snapshot; still exit 0, nothing printed.
sandbox
sandbox_plugin 'require("fs").writeFileSync(process.env.HOME + "/../cli.calls", process.argv.slice(2, 3).join(" ") + "\n")'
OUT=$(cd "$T/repo" && run_capped 30 env HOME="$T/home" CLAUDE_PLUGIN_ROOT="$T/plugin" "$SH" "$HOOK" start 2>/dev/null \
    < <(input "oss:code-reviewer" "")); RC=$?
if [[ $RC -eq 0 && -z "$OUT" && "$(cat "$T/cli.calls" 2>/dev/null)" == "start" ]]; then pass "start: the CLI runs in start mode"
else fail "start: the CLI runs in start mode" "rc=$RC out=$OUT calls=$(cat "$T/cli.calls" 2>/dev/null)"; fi
cleanup

# 11. R-266 style (hooks/oss-tool-gate.sh): mktemp, head and grep come from fixed paths, never PATH, and node runs with
#     PATH=/usr/bin:/bin, so a planted program early on PATH decides nothing.
sandbox
sandbox_plugin 'require("fs").writeFileSync(process.env.HOME + "/../cli.path", String(process.env.PATH) + "\n")'
mkdir -p "$T/shims"
for b in mktemp head grep; do
    printf '#!/bin/sh\necho %s >> "%s/shim.calls"\nexit 1\n' "$b" "$T" > "$T/shims/$b"; chmod 755 "$T/shims/$b"
done
capture CLAUDE_PLUGIN_ROOT="$T/plugin" PATH="$T/shims:$PATH" < <(input "oss:code-reviewer" "$BLOCK")
if [[ $RC -eq 0 && -z "$OUT" && ! -e "$T/shim.calls" && "$(cat "$T/cli.path" 2>/dev/null)" == "/usr/bin:/bin" ]]; then
    pass "fixed mktemp/head/grep, node on PATH=/usr/bin:/bin"
else fail "fixed mktemp/head/grep, node on PATH=/usr/bin:/bin" "rc=$RC shims=$(cat "$T/shim.calls" 2>/dev/null) path=$(cat "$T/cli.path" 2>/dev/null)"; fi
cleanup

echo "Results: $((RUN-FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
