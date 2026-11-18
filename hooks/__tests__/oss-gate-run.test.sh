#!/bin/bash
# Gate-run hook wiring: a review agent's run is checked for repo changes (R-266, US-008, ADR-009).
#
# @behavior When a review agent starts, the repo is recorded; when it ends, a change is reported to
#           the user; when the main agent gets the review's result (or, for a background run, makes
#           its next tool call), it is told the review is void. Claude Code runs hooks/oss-gate-run.sh
#           for SubagentStart, SubagentStop, the Agent PostToolUse and every PostToolUse, which runs
#           the shipped bundle watcher/dist/cli/gate-run.cjs with the event. On every tool call with
#           no pending notice the hook ends without starting node. A failure of the check itself,
#           including the hook being stopped at its time limit, never blocks the session: the run is
#           allowed and the user is told the review could not be checked. The hook runs node from the
#           absolute path in ~/.oss/node-path (written at SessionStart) and cat and mktemp from /bin and
#           /usr/bin, never through PATH: a fake node, cat or mktemp first on PATH is never run (C1).
# @business-rule A review is only worth something if the code it judged is the code that ships.
#
# Usage: ./hooks/__tests__/oss-gate-run.test.sh   (needs jq, git, node)
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK CLAUDE_PROJECT_DIR CLAUDE_CODE_SESSION_ID
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_JSON="$ROOT/hooks.json"
HOOK="$ROOT/hooks/oss-gate-run.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; ((RUN++)); }
fail() { echo "✗ FAIL: $1 — $2"; ((RUN++)); ((FAILED++)); }

command -v jq >/dev/null 2>&1 || { echo "✗ FAIL: jq is required"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- hooks.json: three synchronous entries, timeout 10 ---------------------------------------
entry() { # event matcher-or-empty arg
    jq -c --arg ev "$1" --arg m "$2" --arg cmd "\${CLAUDE_PLUGIN_ROOT}/hooks/oss-gate-run.sh $3" '
      [.hooks[$ev][]? | select((.matcher // "") == $m) | .hooks[] | select(.command == $cmd)]' "$HOOKS_JSON"
}
check_entry() { # event matcher arg label
    local found
    found="$(entry "$1" "$2" "$3")"
    if [[ "$(jq 'length' <<<"$found")" == 1 && "$(jq '.[0].timeout' <<<"$found")" == 10 &&
          "$(jq '.[0].async // false' <<<"$found")" == false ]]; then
        pass "hooks.json: $4 runs oss-gate-run.sh $3 (timeout: 10, not async)"
    else
        fail "hooks.json: $4 runs oss-gate-run.sh $3 (timeout: 10, not async)" "found: $found"
    fi
}
check_entry SubagentStart "" subagent-start "SubagentStart"
check_entry SubagentStop "" subagent-stop "SubagentStop"
check_entry PostToolUse "Agent|Task" agent-post "PostToolUse Agent|Task"
check_entry PostToolUse "" main-post "PostToolUse (every tool)"
if [[ "$(jq '[.hooks.PostToolUse[] | select(.matcher == "Agent|Task") | .hooks[] | select(.command | endswith("oss-timeline.sh")) | select(.async == true)] | length' "$HOOKS_JSON")" == 1 ]]; then
    pass "hooks.json: the async timeline hook on Agent|Task is kept"
else
    fail "hooks.json: the async timeline hook on Agent|Task is kept" "missing or changed"
fi

# --- the real hook and bundle, end to end, CLAUDE_PROJECT_DIR unset --------------------------
REPO="$TMP/repo"
mkdir -p "$REPO/src/deep"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.name "Gate Run Hook Test"
git -C "$REPO" config user.email gate-run-hook-test@example.com
git -C "$REPO" config commit.gpgsign false
printf 'export const a = 1;\n' > "$REPO/src/app.ts"
git -C "$REPO" add -A && git -C "$REPO" commit -q -m initial
TEST_HOME="$TMP/home"
mkdir -p "$TEST_HOME/.oss"
REAL_NODE="$(node -p 'require("fs").realpathSync(process.execPath)')"
printf '%s\n' "$REAL_NODE" > "$TEST_HOME/.oss/node-path"
export HOME="$TEST_HOME"   # every run below reads node from here unless it sets its own HOME
run_hook() { # event json  (run from a subfolder of the repo, as a subagent's cwd can be)
    (cd "$REPO/src/deep" && HOME="$TEST_HOME" CLAUDE_PLUGIN_ROOT="$ROOT" "$HOOK" "$1" <<<"$2")
}
SUB="$REPO/src/deep"
start_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"SubagentStart\",\"agent_id\":\"hook-a\",\"agent_type\":\"oss:code-reviewer\"}"
stop_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"SubagentStop\",\"agent_id\":\"hook-a\",\"agent_type\":\"oss:code-reviewer\"}"
post_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_response\":{\"agentId\":\"hook-a\"}}"

out="$(run_hook subagent-start "$start_json")"; rc=$?
if [[ $rc == 0 && -z "$out" ]]; then pass "subagent-start: exit 0, says nothing"
else fail "subagent-start: exit 0, says nothing" "rc=$rc out=$out"; fi

printf 'export const a = 2;\n' > "$REPO/src/app.ts"
out="$(run_hook subagent-stop "$stop_json")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("void"; "i") and contains("src/app.ts")' <<<"$out" >/dev/null 2>&1; then
    pass "subagent-stop: the repo is found from cwd without CLAUDE_PROJECT_DIR and the change is reported"
else
    fail "subagent-stop: the repo is found from cwd without CLAUDE_PROJECT_DIR and the change is reported" "rc=$rc out=$out"
fi

out="$(run_hook agent-post "$post_json")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("stop the ship"; "i"))' <<<"$out" >/dev/null 2>&1; then
    pass "agent-post: the main agent is told the review is void"
else
    fail "agent-post: the main agent is told the review is void" "rc=$rc out=$out"
fi

# a background review run: no Agent result follows, the main agent's next tool call carries the void
start_b="${start_json//hook-a/hook-b}"
stop_b="${stop_json//hook-a/hook-b}"
main_json="{\"session_id\":\"s1\",\"cwd\":\"$SUB\",\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}"
run_hook subagent-start "$start_b" >/dev/null
printf 'export const a = 3;\n' > "$REPO/src/app.ts"
run_hook subagent-stop "$stop_b" >/dev/null
out="$(run_hook main-post "$main_json")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.hookSpecificOutput.additionalContext | test("void"; "i") and contains("src/app.ts")' <<<"$out" >/dev/null 2>&1; then
    pass "main-post: a background run's void reaches the main agent's next tool call"
else
    fail "main-post: a background run's void reaches the main agent's next tool call" "rc=$rc out=$out"
fi
out="$(run_hook main-post "$main_json")"; rc=$?
if [[ $rc == 0 && -z "$out" ]]; then pass "main-post: the void is told once"
else fail "main-post: the void is told once" "rc=$rc out=$out"; fi

# --- a broken CLI never blocks: allow, tell -----------------------------------------------------
STUB_ROOT="$TMP/plugin"
mkdir -p "$STUB_ROOT/watcher/dist/cli" "$STUB_ROOT/hooks"
cp "$HOOK" "$STUB_ROOT/hooks/oss-gate-run.sh"
cp "$ROOT/hooks/oss-node.sh" "$STUB_ROOT/hooks/oss-node.sh"
printf 'process.stdout.write(process.argv[2] + "\\n");\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(cd "$REPO" && CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 && "$out" == subagent-stop ]]; then pass "the hook hands the event name to the CLI"
else fail "the hook hands the event name to the CLI" "rc=$rc out=$out"; fi

printf 'process.exit(1);\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
rm -rf "$REPO/.oss"
out="$(cd "$REPO" && CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("could not"; "i")' <<<"$out" >/dev/null 2>&1; then
    pass "a failing CLI: exit 0 and the user is told the review check could not run"
else
    fail "a failing CLI: exit 0 and the user is told the review check could not run" "rc=$rc out=$out"
fi
if [[ ! -e "$REPO/.oss" ]]; then pass "the shell writes no log line itself (node logs, the shell only tells)"
else fail "the shell writes no log line itself (node logs, the shell only tells)" "$(ls -R "$REPO/.oss")"; fi

# --- main-post costs no node start when no notice is pending -----------------------------------
# The session comes from the hook input's session_id (read in bash), CLAUDE_CODE_SESSION_ID only as a
# fallback; with neither, node never starts. node gets the same hook input on its stdin.
EMPTY_HOME="$TMP/empty-home"
mkdir -p "$EMPTY_HOME/.oss/gate-state/s1"
cp "$TEST_HOME/.oss/node-path" "$EMPTY_HOME/.oss/node-path"
printf 'const fs = require("fs"); fs.writeFileSync(process.env.MARKER, fs.readFileSync(0, "utf8") || "ran");\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
MARKER="$TMP/node-ran"
S1_JSON='{"session_id": "s1", "hook_event_name": "PostToolUse", "tool_name": "Bash"}'
out="$(HOME="$EMPTY_HOME" MARKER="$MARKER" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" main-post <<<"$S1_JSON")"; rc=$?
if [[ $rc == 0 && -z "$out" && ! -e "$MARKER" ]]; then pass "main-post with no pending notice: exit 0, silent, node not started"
else fail "main-post with no pending notice: exit 0, silent, node not started" "rc=$rc out=$out marker=$(ls "$MARKER" 2>&1)"; fi
printf '{}' > "$EMPTY_HOME/.oss/gate-state/s1/a.notice.json"
HOME="$EMPTY_HOME" MARKER="$MARKER" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" main-post <<<"$S1_JSON" >/dev/null
if [[ -e "$MARKER" && "$(cat "$MARKER")" == "$S1_JSON" ]]; then pass "main-post: this session's pending notice (session_id from the hook input) starts node, which gets the input"
else fail "main-post: this session's pending notice (session_id from the hook input) starts node, which gets the input" "marker=$(cat "$MARKER" 2>&1)"; fi

rm -f "$MARKER"
HOME="$EMPTY_HOME" MARKER="$MARKER" CLAUDE_CODE_SESSION_ID=s1 CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" main-post <<<'{"session_id":"other-session"}' >/dev/null
if [[ ! -e "$MARKER" ]]; then pass "main-post: the hook input's session wins; another session's pending notice does not start node"
else fail "main-post: the hook input's session wins; another session's pending notice does not start node" "node ran"; fi
HOME="$EMPTY_HOME" MARKER="$MARKER" CLAUDE_CODE_SESSION_ID=s1 CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" main-post <<<"{}" >/dev/null
if [[ -e "$MARKER" ]]; then pass "main-post: with no session_id in the input, CLAUDE_CODE_SESSION_ID names the session"
else fail "main-post: with no session_id in the input, CLAUDE_CODE_SESSION_ID names the session" "marker missing"; fi
rm -f "$MARKER"
HOME="$EMPTY_HOME" MARKER="$MARKER" CLAUDE_CODE_SESSION_ID='*' CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" main-post <<<'{"session_id":"*"}' >/dev/null
if [[ ! -e "$MARKER" ]]; then pass "main-post: with no plain session id anywhere, node never starts (no every-session fallback)"
else fail "main-post: with no plain session id anywhere, node never starts (no every-session fallback)" "node ran"; fi

# --- add-repo: the CLI's answer and exit code pass through, never the check-failed JSON -----------
printf 'process.stderr.write("refused: " + process.argv[2] + "\\n"); process.exit(1);\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" add-repo 2>"$TMP/add-err" </dev/null)"; rc=$?
if [[ $rc == 1 && -z "$out" && "$(cat "$TMP/add-err")" == "refused: add-repo" ]]; then pass "add-repo: a refusal exits 1 with the CLI's reason"
else fail "add-repo: a refusal exits 1 with the CLI's reason" "rc=$rc out=$out err=$(cat "$TMP/add-err")"; fi
printf 'process.stdout.write("added\\n");\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" add-repo </dev/null)"; rc=$?
if [[ $rc == 0 && "$out" == added ]]; then pass "add-repo: success exits 0 with the CLI's message"
else fail "add-repo: success exits 0 with the CLI's message" "rc=$rc out=$out"; fi

# --- node from ~/.oss/node-path, cat and mktemp at fixed paths: a fake one first on PATH never runs --
FAKE="$TMP/fake-bin"; FAKE_RAN="$TMP/fake-ran"
mkdir -p "$FAKE"
for tool in node cat mktemp rm mkdir date tr head cut git; do
    printf '#!/bin/sh\necho %s >> "%s"\nexit 0\n' "$tool" "$FAKE_RAN" > "$FAKE/$tool"
    chmod +x "$FAKE/$tool"
done
printf 'process.stdout.write(process.argv[2] + "\\n");\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
out="$(cd "$REPO" && PATH="$FAKE:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 && "$out" == subagent-stop && ! -e "$FAKE_RAN" ]]; then pass "a fake node, cat, mktemp, rm, mkdir, date, tr, head, cut or git first on PATH is never run; the real node runs the check"
else fail "a fake node, cat, mktemp, rm, mkdir, date, tr, head, cut or git first on PATH is never run; the real node runs the check" "rc=$rc out=$out ran=$(cat "$FAKE_RAN" 2>&1)"; fi
out="$(cd "$REPO" && PATH="$FAKE:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 && "$out" == subagent-stop && ! -e "$FAKE_RAN" ]]; then pass "with no node on PATH at all, the check still runs (no change for builders or the main agent)"
else fail "with no node on PATH at all, the check still runs (no change for builders or the main agent)" "rc=$rc out=$out"; fi

NO_NODE_HOME="$TMP/no-node-home"; mkdir -p "$NO_NODE_HOME/.oss"
out="$(cd "$REPO" && HOME="$NO_NODE_HOME" PATH="$FAKE:$PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 && ! -e "$FAKE_RAN" ]] && jq -e '.systemMessage | test("could not"; "i")' <<<"$out" >/dev/null 2>&1; then
    pass "no ~/.oss/node-path: the hook fails closed (the user is told the check could not run), PATH's node is not tried"
else
    fail "no ~/.oss/node-path: the hook fails closed (the user is told the check could not run), PATH's node is not tried" "rc=$rc out=$out"
fi
ln -s "$REAL_NODE" "$TMP/linked-node"
printf '%s\n' "$TMP/linked-node" > "$NO_NODE_HOME/.oss/node-path"
out="$(cd "$REPO" && HOME="$NO_NODE_HOME" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("could not"; "i")' <<<"$out" >/dev/null 2>&1; then
    pass "~/.oss/node-path naming a link in a temp folder is refused: the hook fails closed"
else
    fail "~/.oss/node-path naming a link in a temp folder is refused: the hook fails closed" "rc=$rc out=$out"
fi
PATH_NODE="$(type -P node)"
if jq -e --arg old "$TMP/linked-node" --arg new "$PATH_NODE" '.systemMessage | contains($old) and contains($new)' <<<"$out" >/dev/null 2>&1; then
    pass "a record that is no longer usable is not silently replaced by PATH's different node: the user is told both paths (HIGH-1)"
else
    fail "a record that is no longer usable is not silently replaced by PATH's different node: the user is told both paths (HIGH-1)" "out=$out"
fi
if [[ "$(head -1 "$NO_NODE_HOME/.oss/node-path")" == "$TMP/linked-node" ]]; then pass "the old record is kept as it was"
else fail "the old record is kept as it was" "$(cat "$NO_NODE_HOME/.oss/node-path")"; fi

# --- first use: no record, the first gate hook call records PATH's node (stable path) and runs it -----
case "$PATH_NODE" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) echo "  (skipped: this machine's node is in a temp folder)" ;;
    *)
        FIRST_HOME="$TMP/first-home"; mkdir -p "$FIRST_HOME"
        out="$(cd "$REPO" && HOME="$FIRST_HOME" PATH="${PATH_NODE%/*}:/usr/bin:/bin" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}")"; rc=$?
        if [[ $rc == 0 && "$out" == subagent-stop && "$(head -1 "$FIRST_HOME/.oss/node-path" 2>/dev/null)" == "$PATH_NODE" ]]; then
            pass "no record: the first gate hook call records PATH's node by its stable path and runs the check"
        else
            fail "no record: the first gate hook call records PATH's node by its stable path and runs the check" "rc=$rc out=$out file=$(cat "$FIRST_HOME/.oss/node-path" 2>&1)"
        fi ;;
esac

# --- no usable node: review agents fail closed and the main agent is told too (sec MEDIUM-3) ----------
NN_HOME="$TMP/nn-home"; mkdir -p "$NN_HOME/.oss"
printf '%s\n' "/nonexistent/old/node" > "$NN_HOME/.oss/node-path"
NN_PATH="/usr/bin:/bin"
nn_hook() { # event json
    (cd "$REPO" && HOME="$NN_HOME" PATH="$NN_PATH" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" "$1" <<<"$2")
}
mkdir -p "$STUB_ROOT/config"; cp "$ROOT/config/tool-gates.json" "$STUB_ROOT/config/tool-gates.json"
nn_notices() { ls "$NN_HOME/.oss/gate-state/nn/" 2>/dev/null | grep -c '\.notice\.json$'; }
REVIEW_START='{"session_id":"nn","cwd":"'"$REPO"'","hook_event_name":"SubagentStart","agent_id":"rv-1","agent_type":"oss:security-auditor"}'
BUILDER_START='{"session_id":"nn","cwd":"'"$REPO"'","hook_event_name":"SubagentStart","agent_id":"bd-1","agent_type":"oss:typescript-pro"}'
out="$(nn_hook subagent-start "$BUILDER_START")"; rc=$?
if [[ $rc == 0 && -z "$out" && "$(nn_notices)" == 0 ]]; then pass "no usable node, a builder agent: silent, no notice"
else fail "no usable node, a builder agent: silent, no notice" "rc=$rc out=$out notices=$(nn_notices)"; fi
out="$(nn_hook subagent-start "$REVIEW_START")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("unverified"; "i")' <<<"$out" >/dev/null 2>&1 && [[ "$(nn_notices)" == 1 ]]; then
    pass "no usable node, a review agent: the user is told the run is unverified and a notice is kept for the main agent"
else
    fail "no usable node, a review agent: the user is told the run is unverified and a notice is kept for the main agent" "rc=$rc out=$out notices=$(nn_notices)"
fi
f="$(ls "$NN_HOME/.oss/gate-state/nn/"*.notice.json 2>/dev/null | head -1)"
mode="$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f" 2>/dev/null)"
if [[ "$f" == */rv-1.*.notice.json && "$mode" == 600 ]] && jq -e '.kind == "unverified" and (.reason | type == "string")' "$f" >/dev/null 2>&1; then
    pass "the notice is the review run's own (rv-1), private (600), an unverified notice the check reads"
else
    fail "the notice is the review run's own (rv-1), private (600), an unverified notice the check reads" "file=$f mode=$mode $(cat "$f" 2>&1)"
fi
NN_MAIN='{"session_id":"nn","hook_event_name":"PostToolUse","tool_name":"Bash"}'
out="$(nn_hook main-post "$NN_MAIN")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.hookSpecificOutput.hookEventName == "PostToolUse" and (.hookSpecificOutput.additionalContext | test("unverified"; "i") and test("stop the ship"; "i"))' <<<"$out" >/dev/null 2>&1; then
    pass "no usable node, the main agent's next tool call: it is told the review run is unverified"
else
    fail "no usable node, the main agent's next tool call: it is told the review run is unverified" "rc=$rc out=$out"
fi
out="$(nn_hook main-post "$NN_MAIN")"; rc=$?
if [[ $rc == 0 && -z "$out" && "$(nn_notices)" == 0 ]]; then pass "no usable node: the main agent is told once"
else fail "no usable node: the main agent is told once" "rc=$rc out=$out notices=$(nn_notices)"; fi

# --- the CLI fails for a review agent: the main agent gets a notice too -----------------------------
printf 'process.exit(3);\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
CF_HOME="$TMP/cf-home"; mkdir -p "$CF_HOME/.oss"; cp "$TEST_HOME/.oss/node-path" "$CF_HOME/.oss/node-path"
CF_STOP='{"session_id":"cf","cwd":"'"$REPO"'","hook_event_name":"SubagentStop","agent_id":"rv-2","agent_type":"code-reviewer"}'
out="$(cd "$REPO" && HOME="$CF_HOME" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"$CF_STOP")"; rc=$?
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("could not"; "i")' <<<"$out" >/dev/null 2>&1 && ls "$CF_HOME/.oss/gate-state/cf/"rv-2.*.notice.json >/dev/null 2>&1; then
    pass "a failing CLI on a review agent's stop: the user is told and a notice is kept for the main agent"
else
    fail "a failing CLI on a review agent's stop: the user is told and a notice is kept for the main agent" "rc=$rc out=$out files=$(ls -A "$CF_HOME/.oss/gate-state/cf" 2>&1)"
fi
out="$(HOME="$NO_NODE_HOME" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" add-repo 2>"$TMP/add-err" </dev/null)"; rc=$?
if [[ $rc == 1 && -z "$out" ]] && grep -q "node-path" "$TMP/add-err"; then pass "add-repo with no usable ~/.oss/node-path: exit 1, says why"
else fail "add-repo with no usable ~/.oss/node-path: exit 1, says why" "rc=$rc out=$out err=$(cat "$TMP/add-err")"; fi

# --- the answer file: under ~/.oss/gate-state (0700), never in TMPDIR (round 9, CR HIGH-1) ---------
# A review agent can write TMPDIR; the answer file sits where it can't. The stub CLI says where its
# answer is kept (the out.* files in the gate-state folder) and what TMPDIR holds while it runs.
OF_HOME="$TMP/of-home"; mkdir -p "$OF_HOME/.oss"; cp "$TEST_HOME/.oss/node-path" "$OF_HOME/.oss/node-path"
OF_TMP="$TMP/of-tmp"; mkdir -p "$OF_TMP"
cat > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs" <<'STUB'
const fs = require('fs');
const dir = process.env.HOME + '/.oss/gate-state';
const outs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith('out.')) : [];
const modes = outs.map((n) => (fs.statSync(dir + '/' + n).mode & 0o777).toString(8));
const dirMode = fs.existsSync(dir) ? (fs.statSync(dir).mode & 0o777).toString(8) : 'none';
process.stdout.write(JSON.stringify({ outs: outs.length, modes, dirMode, tmp: fs.readdirSync(process.env.TMPDIR).length }) + '\n');
STUB
of_run() { (cd "$REPO" && HOME="$OF_HOME" TMPDIR="$OF_TMP" CLAUDE_PLUGIN_ROOT="$STUB_ROOT" "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<'{"session_id":"of","agent_id":"rv-9","agent_type":"oss:code-reviewer"}'); }
out="$(of_run)"; rc=$?
if [[ $rc == 0 ]] && jq -e '.outs == 1 and .modes == ["600"] and .dirMode == "700" and .tmp == 0' <<<"$out" >/dev/null 2>&1 &&
   [[ -z "$(ls -A "$OF_TMP")" && -z "$(ls "$OF_HOME/.oss/gate-state" | grep '^out\.')" && ! -e "$OF_HOME/.oss/run/gate-run" ]]; then
    pass "the answer file is kept under ~/.oss/gate-state (0700), never in TMPDIR nor ~/.oss/run/gate-run, and removed after"
else
    fail "the answer file is kept under ~/.oss/gate-state (0700), never in TMPDIR nor ~/.oss/run/gate-run, and removed after" "rc=$rc out=$out tmp=$(ls -A "$OF_TMP")"
fi
rm -rf "$OF_HOME/.oss/gate-state"; mkdir -p "$TMP/of-elsewhere"; ln -s "$TMP/of-elsewhere" "$OF_HOME/.oss/gate-state"
out="$(of_run)"; rc=$?
if [[ $rc == 0 ]] && jq -e '.outs == 0 and .tmp == 0' <<<"$out" >/dev/null 2>&1 && [[ -z "$(ls -A "$TMP/of-elsewhere")" && -z "$(ls -A "$OF_TMP")" ]]; then
    pass "with a symlinked ~/.oss/gate-state the answer goes through no file (not the link's target, not TMPDIR)"
else
    fail "with a symlinked ~/.oss/gate-state the answer goes through no file (not the link's target, not TMPDIR)" "rc=$rc out=$out elsewhere=$(ls -A "$TMP/of-elsewhere") tmp=$(ls -A "$OF_TMP")"
fi

# --- stopped at its time limit (TERM): exit 0 and the user is told ------------------------------
printf 'setTimeout(() => {}, 30000);\n' > "$STUB_ROOT/watcher/dist/cli/gate-run.cjs"
(cd "$REPO" && CLAUDE_PLUGIN_ROOT="$STUB_ROOT" exec "$STUB_ROOT/hooks/oss-gate-run.sh" subagent-stop <<<"{}" >"$TMP/term-out") &
HOOK_PID=$!
sleep 1
kill -TERM "$HOOK_PID"
wait "$HOOK_PID"; rc=$?
out="$(cat "$TMP/term-out")"
if [[ $rc == 0 ]] && jq -e '.systemMessage | test("unverified"; "i")' <<<"$out" >/dev/null 2>&1; then
    pass "a hook stopped by TERM: exit 0 and the user is told the review run is unverified"
else
    fail "a hook stopped by TERM: exit 0 and the user is told the review run is unverified" "rc=$rc out=$out"
fi

echo "Ran $RUN checks, $FAILED failed"
[[ $FAILED -eq 0 ]]
