#!/usr/bin/env bash
# @behavior OSS users get Claude Code heads-ups relayed to the agent (the pinned heads-up hook), and a maintainer can
#   never ship a copy that differs from the release it claims to be.
# @business-rule hooks/heads-up/heads-up.mjs must match the sha256 in hooks/heads-up/VENDORED.json (US-007, AC-007.1);
#   hooks.json runs it (through hooks/oss-heads-up.sh) on UserPromptSubmit and after every tool (PostToolUse,
#   matcher "*"), 5 s timeout; without a built-in heads-up store node is never started (users who have not turned on
#   Claude Code's built-in heads-ups pay ~nothing per prompt and tool call).
set -u
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
pass=0; fail=0
check() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
src="$DIR/hooks/heads-up"

# Whether the copy in <dir> matches the sha256 its VENDORED.json pins.
matches_pin() {
    node -e '
      const fs = require("fs"); const dir = process.argv[1];
      const pin = JSON.parse(fs.readFileSync(dir + "/VENDORED.json", "utf8"));
      const sha = require("crypto").createHash("sha256").update(fs.readFileSync(dir + "/heads-up.mjs")).digest("hex");
      process.exit(typeof pin.sha256 === "string" && pin.sha256 === sha ? 0 : 1);
    ' "$1" 2>/dev/null
}

check "the vendored copy matches its pinned sha256" 'matches_pin "$src"'
mkdir -p "$work/drifted"
cp "$src/heads-up.mjs" "$src/VENDORED.json" "$work/drifted/" 2>/dev/null
printf '\n// local edit\n' >> "$work/drifted/heads-up.mjs"
check "an edited copy no longer matches its pin" '! matches_pin "$work/drifted"'

# The hook registered for <event> (with <matcher>, or none): prints its command|timeout.
registered() {
    node -e '
      const [file, event, matcher] = process.argv.slice(1);
      const groups = JSON.parse(require("fs").readFileSync(file, "utf8")).hooks[event] ?? [];
      for (const g of groups) for (const h of g.hooks)
        if (h.command.endsWith("/hooks/oss-heads-up.sh") && (g.matcher ?? "") === matcher)
          console.log(h.command + "|" + h.timeout);
    ' "$DIR/hooks.json" "$1" "${2:-}"
}
expected='${CLAUDE_PLUGIN_ROOT}/hooks/oss-heads-up.sh|5'
check "UserPromptSubmit runs the hook" '[ "$(registered UserPromptSubmit)" = "$expected" ]'
check "PostToolUse runs the hook after every tool" '[ "$(registered PostToolUse "*")" = "$expected" ]'

# Run the registered command the way Claude Code does, against a temp store and state dir.
run_hook() {
    local cmd
    cmd="$(registered PostToolUse "*" | cut -d'|' -f1)"
    [ -n "$cmd" ] || return 1
    printf '{"session_id":"%s","transcript_path":"/x/%s.jsonl","hook_event_name":"PostToolUse"}' "$2" "$2" |
        PATH="$work/bin:$PATH" CLAUDE_PLUGIN_ROOT="$DIR" HOME="${3:-$work/home}" HEADS_UP_STORE="$1" \
        HEADS_UP_STATE_DIR="$work/state-$2" bash -c "$cmd" 2>/dev/null
}
mkdir -p "$work/home" "$work/bin"
# A stand-in node first on PATH that records each start, then runs the real node.
real_node="$(command -v node)"
printf '#!/bin/sh\necho started >> "%s"\nexec "%s" "$@"\n' "$work/node-starts" "$real_node" > "$work/bin/node"
chmod +x "$work/bin/node"
sid="oss-$$-a"
printf '{"sessions":[{"id":"%s","tag":"Heads up","view":{"kind":"offer","line":"Port 3000 is in use %s","shownAt":1}}]}\n' \
    "$sid" "$$" > "$work/store.json"
check "a heads-up for this session reaches the agent" 'run_hook "$work/store.json" "$sid" | grep -q "Port 3000 is in use $$"'
printf '{"sessions":"changed"}\n' > "$work/changed.json"
version="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$src/VENDORED.json" 2>/dev/null)"
check "a changed store format is reported with the pinned version" \
    '[ -n "$version" ] && run_hook "$work/changed.json" "oss-$$-b" | grep -q "heads-up plugin version $version)"'

rm -f "$work/node-starts"
out="$(run_hook "" "oss-$$-c" "$work/empty-home")"
check "without a built-in store, node is never started" '[ -z "$out" ] && [ ! -e "$work/node-starts" ]'
mkdir -p "$work/home2/.claude/plugins/store"
printf '{"sessions":[{"id":"oss-%s-d","view":{"kind":"offer","line":"Built-in on %s","shownAt":1}}]}\n' "$$" "$$" \
    > "$work/home2/.claude/plugins/store/cc-plugin-you-should-know_builtin-x.json"
check "with a built-in store under HOME, the hook runs" \
    'run_hook "" "oss-$$-d" "$work/home2" | grep -q "Built-in on $$"'

echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
