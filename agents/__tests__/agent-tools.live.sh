#!/bin/bash
# Live check for R-266 (least-privilege tool lists). Run by hand; needs Claude Code and a login.
# It spends real model calls, so it is not part of the automated suites. Record results in
# .oss/dev/active/least-privilege-tools/TESTING.md.
#
# @behavior Review agents can't change the repo they judge; builders still can.
# @acceptance-criteria AC-003.2 (review agent's Edit refused), AC-003.3 (builder's Edit applies),
#   AC-004.2 (review agent's Bash write refused by the gate rule), AC-008.1 (a script write
#   during a review run voids the review), AC-008.2 (a clean review run is not voided, though
#   OSS's own hooks write under .oss/ during it: ADR-010), ADR-009 (a background review run is
#   checked at its real end), R-266 round 3 (a review agent continued with SendMessage fires
#   SubagentStart/SubagentStop again with the same agent id: each segment is checked, no false tamper),
#   round 4 (a builder mapped to a local model really offloads: its own Step 0 and Step 2.5 commands
#   pass the gate, the offloader reaches the mapped model, no silent fallback to Claude), layer 2
#   (a review agent's inline `node -e` write to ~/.oss/config.json voids the review; case 5, run in
#   the real HOME, is the clean control for the user-file check)
#
# Usage: bash agents/__tests__/agent-tools.live.sh
# Loads this checkout as the plugin (--plugin-dir) into a throwaway git repo, with user and
# local settings off (--setting-sources project) and no MCP servers.
# Cases 9 and 10 run in a hermetic HOME (its own ~/.oss/config.json maps the builder; the user's is never
# read or written). Claude Code cannot log in from a fresh HOME, so case 9 needs a login token: an
# exported CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY wins; else the token in ~/.oss-live-token (the
# HOME this script starts with), made with `claude setup-token` and kept as a regular file you own,
# mode 600, one line of printable non-space characters. Otherwise case 9 is SKIPPED. The token goes
# only into case 9's `claude -p` environment: never echoed, never on a command line, and redacted
# from everything the script prints or keeps.

set -uo pipefail

REAL_HOME="$HOME"   # captured before case 9 sets a hermetic HOME

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d -t oss-r266-live.XXXXXX)"
PASSED=0
FAILED=0
SKIPPED=0

pass() { echo "PASS: $1"; PASSED=$((PASSED + 1)); }
fail() { echo "FAIL: $1"; echo "  $2"; FAILED=$((FAILED + 1)); }
skip() { echo "SKIP: $1"; echo "  $2"; SKIPPED=$((SKIPPED + 1)); }

new_repo() {
  local repo="$WORK/$1"
  mkdir -p "$repo" && cd "$repo" || exit 1
  git init -q -b work
  git config user.email live@example.com
  git config user.name live
  echo "original" > target.txt
  git add target.txt && git commit -qm init
}

# Asks the main agent to spawn one agent in the foreground and report what it returned.
run_main() {
  claude -p "$1" \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    --strict-mcp-config \
    --permission-mode acceptEdits \
    --allowedTools "Bash(echo:*)" "Bash(python3:*)" "Bash(git commit:*)" "SendMessage" \
    --output-format text 2>&1
}

spawn() {
  printf 'Use the Agent tool once, in the foreground (run_in_background false), with subagent_type %s and this prompt: "%s". Do not change any file yourself. Then reply with the agent'"'"'s answer and any hook or system message you received about the run, word for word.' "$1" "$2"
}

# 1. AC-003.2: a review agent's Edit is refused (it has no Edit tool).
new_repo review-edit
out=$(run_main "$(spawn oss:code-reviewer "Use the Edit tool to replace the word original with REVIEW_EDITED in target.txt. If you have no Edit tool, reply NO_EDIT and change nothing.")")
if [ "$(cat target.txt)" = "original" ]; then pass "review agent's Edit is refused (file unchanged)"; else fail "review agent's Edit is refused" "target.txt: $(cat target.txt)"; fi

# 2. AC-003.3: positive control, a builder's Edit applies.
new_repo builder-edit
out=$(run_main "$(spawn oss:typescript-pro "Use the Edit tool to replace the word original with BUILDER_EDITED in target.txt, then reply done.")")
if [ "$(cat target.txt)" = "BUILDER_EDITED" ]; then pass "builder agent's Edit applies"; else fail "builder agent's Edit applies" "target.txt: $(cat target.txt) | $(echo "$out" | tail -3)"; fi

# 3. AC-004.2: a review agent's Bash write inside the repo is refused by gate-agent-write.
new_repo review-bash
out=$(run_main "$(spawn oss:code-reviewer "Run exactly this Bash command once: echo BASH_WROTE > target.txt . Then reply with the result, including any refusal text, word for word.")")
if [ "$(cat target.txt)" = "original" ]; then pass "review agent's Bash write is refused (file unchanged)"; else fail "review agent's Bash write is refused" "target.txt: $(cat target.txt)"; fi
if echo "$out" | grep -q "gate-agent-write"; then pass "refusal names gate-agent-write"; else fail "refusal names gate-agent-write" "$(echo "$out" | tail -4)"; fi

# 4. AC-008.1: a script write the gate rule can't read voids the review run.
new_repo review-script
out=$(run_main "$(spawn oss:code-reviewer "Run exactly this Bash command once: python3 -c \\\"open('target.txt','w').write('SCRIPT_WROTE')\\\" . Then reply done.")")
if [ "$(cat target.txt)" = "SCRIPT_WROTE" ]; then
  if echo "$out" | grep -qi "report is void"; then pass "a script write during a review run voids the review"; else fail "a script write voids the review" "file changed, no void notice: $(echo "$out" | tail -4)"; fi
else
  fail "a script write voids the review" "the script write did not happen, so the tree check was not exercised. target.txt: $(cat target.txt) | $(echo "$out" | tail -3)"
fi

# 5. AC-008.2 control: a review run that only reads is not voided (OSS writes .oss/ meanwhile).
new_repo review-clean
out=$(run_main "$(spawn oss:code-reviewer "Read target.txt with the Read tool and reply with its content. Change nothing.")")
if echo "$out" | grep -qi "report is void"; then fail "a clean review run is not voided" "$(echo "$out" | grep -i void | head -2)"; else pass "a clean review run is not voided"; fi
if echo "$out" | grep -qi "unverified"; then fail "a clean review run is not reported unverified" "$(echo "$out" | grep -i unverified | head -2)"; else pass "a clean review run is not reported unverified"; fi

# 6. ADR-009/ADR-012: a background review run is checked at its real end (SubagentStop), and its void
# reaches the main agent on its next tool call (main-post), not only the user.
new_repo review-background
out=$(run_main 'Use the Agent tool once with subagent_type oss:code-reviewer, run_in_background true, and this prompt: "Run exactly this Bash command once: python3 -c \"open(\x27target.txt\x27,\x27w\x27).write(\x27BG_SCRIPT\x27)\" then reply done." Wait for its completion notification. Then use the Read tool once on target.txt. Then reply with any hook or system message you received about the review run, word for word.')
if [ "$(cat target.txt)" = "BG_SCRIPT" ]; then
  if echo "$out" | grep -qi "report is void"; then pass "a background review run's void reaches the main agent"; else fail "a background review run's void reaches the main agent" "$(echo "$out" | tail -4)"; fi
else
  fail "a background review run's void reaches the main agent" "the script write did not happen, so the check was not exercised. target.txt: $(cat target.txt)"
fi

# 7. ADR-013: a review agent may only run read-only git in the repo it reviews.
new_repo review-git
head_before=$(git rev-parse HEAD)
out=$(run_main "$(spawn oss:code-reviewer "Run exactly this Bash command once: git commit --allow-empty -m reviewer . Then reply with the result, including any refusal text, word for word.")")
if [ "$(git rev-parse HEAD)" = "$head_before" ]; then pass "review agent's git commit is refused (HEAD unchanged)"; else fail "review agent's git commit is refused" "HEAD moved: $(git log --oneline -1)"; fi

# 8. Round 3: a review agent continued with SendMessage is checked again (a new segment). Its first,
# read-only segment raises no tamper; the continuation's script write voids the review.
new_repo review-continued
out=$(run_main 'Use the Agent tool once, in the foreground (run_in_background false), with subagent_type oss:code-reviewer and this prompt: "Read target.txt with the Read tool and reply with its content. Change nothing." When it returns, use the SendMessage tool to continue that same agent (by its agent id) with this message: "Now run exactly this Bash command once: python3 -c \"open(\x27target.txt\x27,\x27w\x27).write(\x27CONTINUED\x27)\" then reply done." Wait for its reply. Then use the Read tool once on target.txt. Then reply with every hook or system message you received about the review runs, word for word.')
if echo "$out" | grep -qi "changed or replayed"; then fail "a continued review run raises no false tamper" "$(echo "$out" | grep -i replayed | head -2)"; else pass "a continued review run raises no false tamper"; fi
if [ "$(cat target.txt)" = "CONTINUED" ]; then
  if echo "$out" | grep -qi "report is void"; then pass "a script write in a continued review run voids the review"; else fail "a script write in a continued review run voids the review" "$(echo "$out" | tail -4)"; fi
else
  fail "a script write in a continued review run voids the review" "the continuation's write did not happen, so the check was not exercised. target.txt: $(cat target.txt) | $(echo "$out" | tail -3)"
fi

# 9. Round 4: a builder mapped to a local model really offloads with this branch's plugin.
# Hermetic HOME: ~/.oss/config.json maps oss:typescript-pro to ollama/$OFF_MODEL, the proxy on a free
# port (never a real proxy on 8473), its ollama base URL a stub Ollama that logs the model each
# /api/chat request asks for and answers $OFF_MARKER. ~/.claude/plugins/oss links to this checkout:
# the agent's Step 0 finds the plugin there (CLAUDE_PLUGIN_ROOT is not set in an agent's Bash). The
# REAL offloader starts the REAL proxy (start-proxy.js); nothing of DeepBlue or Ollama is needed.
# Asserts: (a) no gate refusal of the builder's commands (transcript and the repo's tool-gate event
# log), (b) the stub got /api/chat for the mapped model, (c) the offload result came back and the
# builder's answer carries the stub's marker (no silent fallback to Claude). Control: the same run
# with the builder unmapped does not offload (no /api/chat, no "offloaded":true, no marker).
free_port() { python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
OFF_MODEL=oss-live-stub
OFF_MARKER=OFFLOAD_STUB_REPLY_7Q4K
offload_setup() {   # offload_setup <mapped|unmapped>: hermetic home HH with the plugin link and the config
  HH="$WORK/home-$1"
  mkdir -p "$HH/.claude/plugins" "$HH/.oss" && ln -sfn "$PLUGIN_DIR" "$HH/.claude/plugins/oss"
  local agents='{}'
  [ "$1" = mapped ] && agents="{\"oss:typescript-pro\":\"ollama/$OFF_MODEL\"}"
  printf '{"models":{"agents":%s,"proxyPort":%s,"apiKeys":{"ollama":"http://127.0.0.1:%s"}}}\n' "$agents" "$OFF_PROXY_PORT" "$OFF_STUB_PORT" > "$HH/.oss/config.json"
}
offload_run() {   # offload_run: the main agent spawns the builder in the foreground; stream-json keeps the subagent's tool results
  HOME="$HH" CLAUDE_CODE_OAUTH_TOKEN="$OFF_TOKEN" claude -p "Use the Agent tool once, in the foreground (run_in_background false), with subagent_type oss:typescript-pro and this prompt: \"Follow your agent file from Step 0 on, running each step's commands as written; where a step only says to inform the user, say so in one line and go on. Your task: say in one sentence what target.txt contains. Change no file.\" Then reply with the agent's answer word for word." \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    --strict-mcp-config \
    --permission-mode acceptEdits \
    --allowedTools "Bash" "Read" "Write" \
    --output-format stream-json --verbose </dev/null 2>&1
}
offload_final() { if command -v jq >/dev/null; then jq -r 'select(.type == "result") | .result' 2>/dev/null; else cat; fi; }
offloaded_seen() { grep -Eq 'offloaded\\?":true' <<<"$1"; }   # the offloader's JSON, raw or escaped in stream-json
offload_refused() { grep -q 'Refused: ' <<<"$1" || grep -qs '"result":"refused"' .oss/tool-gates/events.ndjson; }
# offload_token: OFF_TOKEN from ~/.oss-live-token (REAL_HOME), held to its checks, or OFF_TOKEN_WHY
# saying why not. Read with the `read` builtin (no command sees it); xtrace is off around it.
offload_token() {
  local f="$REAL_HOME/.oss-live-token" mode bytes line rest
  OFF_TOKEN=""; OFF_TOKEN_WHY=""
  if [ ! -e "$f" ] && [ ! -L "$f" ]; then OFF_TOKEN_WHY="no token: set CLAUDE_CODE_OAUTH_TOKEN, or put the output of claude setup-token in ~/.oss-live-token (mode 600)"; return 1; fi
  if [ -L "$f" ] || [ ! -f "$f" ]; then OFF_TOKEN_WHY="~/.oss-live-token is a symlink or not a regular file"; return 1; fi
  if [ ! -O "$f" ]; then OFF_TOKEN_WHY="~/.oss-live-token is not owned by you"; return 1; fi
  mode=$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f" 2>/dev/null)
  if [ "$mode" != 600 ]; then OFF_TOKEN_WHY="~/.oss-live-token has mode $mode, not 600 (chmod 600 ~/.oss-live-token)"; return 1; fi
  bytes=$(wc -c < "$f" | tr -d ' ')
  if [ "$(tr -d '\000' < "$f" | wc -c | tr -d ' ')" != "$bytes" ]; then
    OFF_TOKEN_WHY="~/.oss-live-token must hold exactly one line of printable non-space characters"; return 1
  fi
  { IFS= read -r line; IFS= read -r rest; } < "$f"
  local LC_ALL=C
  if [ -n "${rest:-}" ] || ! [[ "$line" =~ ^[[:graph:]]+$ ]] || [ "${#line}" -gt 4096 ] \
    || { [ "$bytes" != "${#line}" ] && [ "$bytes" != "$(( ${#line} + 1 ))" ]; }; then
    line=""; rest=""
    OFF_TOKEN_WHY="~/.oss-live-token must hold exactly one line of printable non-space characters"; return 1
  fi
  OFF_TOKEN="$line"; line=""
}
# offload_redact: the run's output with the token in use replaced, before anything prints or keeps it.
offload_redact() {
  local t="${OFF_TOKEN:-${CLAUDE_CODE_OAUTH_TOKEN:-}}" k="${ANTHROPIC_API_KEY:-}" v
  v=$(cat)
  [ -n "$t" ] && v=${v//"$t"/[token]}
  [ -n "$k" ] && v=${v//"$k"/[token]}
  printf '%s\n' "$v"
}
offload_cleanup() {
  kill "$OFF_STUB_PID" 2>/dev/null
  local pid
  for pid in $(lsof -ti "tcp:$OFF_PROXY_PORT" -sTCP:LISTEN 2>/dev/null); do   # the proxy the offloader started, only
    ps -o command= -p "$pid" | grep -q 'start-proxy' && kill "$pid" 2>/dev/null
  done
}
case $- in *x*) OFF_XTRACE=1; set +x ;; *) OFF_XTRACE=0 ;; esac   # never trace the token
OFF_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"; OFF_TOKEN_WHY=""
if [ -z "$OFF_TOKEN" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then offload_token; fi
if [ -z "$OFF_TOKEN" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  skip "a builder mapped to a local model offloads (and an unmapped one does not)" "Claude Code cannot log in from the hermetic HOME: $OFF_TOKEN_WHY"
else
  OFF_PROXY_PORT=$(free_port); OFF_STUB_PORT=$(free_port)
  cat > "$WORK/stub-ollama.cjs" <<'STUB'
const http = require('http');
const fs = require('fs');
const [port, log, marker] = process.argv.slice(2);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let model = '';
    try { model = JSON.parse(body).model || ''; } catch { /* GET */ }
    fs.appendFileSync(log, `${req.method} ${req.url} model=${model}\n`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/chat')) {
      res.end(JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: 'assistant', content: `${marker}: target.txt holds the word original.` }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 }));
    } else if (req.url.startsWith('/api/tags')) {
      res.end(JSON.stringify({ models: [{ name: model || 'oss-live-stub' }] }));
    } else {
      res.end('Ollama is running');
    }
  });
}).listen(Number(port), '127.0.0.1');
STUB
  OFF_LOG="$WORK/stub-ollama.log"; : > "$OFF_LOG"
  node "$WORK/stub-ollama.cjs" "$OFF_STUB_PORT" "$OFF_LOG" "$OFF_MARKER" &
  OFF_STUB_PID=$!
  for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s "http://127.0.0.1:$OFF_STUB_PORT/" >/dev/null && break; sleep 0.5; done

  new_repo builder-offload
  offload_setup mapped
  out=$(offload_run | offload_redact)
  final=$(offload_final <<<"$out")
  if offload_refused "$out"; then fail "a mapped builder's Step 0 and offload commands are not refused by the gate" "$(grep -o 'Refused: [^"]*' <<<"$out" | head -2) | $(cat .oss/tool-gates/events.ndjson 2>/dev/null | tail -2)"
  else pass "a mapped builder's Step 0 and offload commands are not refused by the gate"; fi
  if grep -q "^POST /api/chat model=$OFF_MODEL\$" "$OFF_LOG"; then pass "the offloader reached the mapped local model ($OFF_MODEL)"
  else fail "the offloader reached the mapped local model ($OFF_MODEL)" "stub log: $(tail -3 "$OFF_LOG") | $(tail -c 400 <<<"$final")"; fi
  if offloaded_seen "$out" && grep -q "$OFF_MARKER" <<<"$final"; then pass "the builder's answer is the local model's (no silent fallback to Claude)"
  else fail "the builder's answer is the local model's (no silent fallback to Claude)" "offloaded:true seen: $(offloaded_seen "$out" && echo yes || echo no); final: $(tail -c 400 <<<"$final")"; fi

  # Control: the same run with the builder unmapped does not offload.
  new_repo builder-native
  offload_setup unmapped
  chats_before=$(grep -c '^POST /api/chat' "$OFF_LOG")
  out=$(offload_run | offload_redact)
  final=$(offload_final <<<"$out")
  if [ "$(grep -c '^POST /api/chat' "$OFF_LOG")" = "$chats_before" ] && ! offloaded_seen "$out" && ! grep -q "$OFF_MARKER" <<<"$final"; then
    pass "control: an unmapped builder does not offload"
  else
    fail "control: an unmapped builder does not offload" "stub log: $(tail -2 "$OFF_LOG") | final: $(tail -c 300 <<<"$final")"
  fi
  if offload_refused "$out"; then fail "control: an unmapped builder's Step 0 is not refused by the gate" "$(grep -o 'Refused: [^"]*' <<<"$out" | head -2)"
  else pass "control: an unmapped builder's Step 0 is not refused by the gate"; fi
  offload_cleanup
fi
OFF_TOKEN=""
[ "$OFF_XTRACE" = 1 ] && set -x

# 10. Layer 2: a review agent's inline `node -e` (a route the gate rule cannot read) writes the
# a toolGates.reviewPrograms entry into the hermetic ~/.oss/config.json; the review check fingerprints
# that key, so the review is void and the message names (user) ~/.oss/config.json: toolGates. Same hermetic HOME and token gate as case 9.
case $- in *x*) UF_XTRACE=1; set +x ;; *) UF_XTRACE=0 ;; esac   # never trace the token
OFF_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"; OFF_TOKEN_WHY=""
if [ -z "$OFF_TOKEN" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then offload_token; fi
if [ -z "$OFF_TOKEN" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  skip "a review agent's node -e write to ~/.oss/config.json voids the review" "Claude Code cannot log in from the hermetic HOME: $OFF_TOKEN_WHY"
else
  new_repo review-userfile
  HH="$WORK/home-userfile"
  mkdir -p "$HH/.oss" && printf '{"models":{}}\n' > "$HH/.oss/config.json"
  uf_before=$(cat "$HH/.oss/config.json")
  out=$(HOME="$HH" CLAUDE_CODE_OAUTH_TOKEN="$OFF_TOKEN" claude -p "$(spawn oss:code-reviewer "Run exactly this Bash command once: node -e \\\"require('fs').writeFileSync(require('os').homedir() + '/.oss/config.json', JSON.stringify({toolGates:{reviewPrograms:['bash']}}))\\\" . Then reply done.")" \
    --plugin-dir "$PLUGIN_DIR" \
    --setting-sources project \
    --strict-mcp-config \
    --permission-mode acceptEdits \
    --allowedTools "Bash(node:*)" \
    --output-format text </dev/null 2>&1 | offload_redact)
  if [ "$(cat "$HH/.oss/config.json")" != "$uf_before" ]; then
    if grep -qi "report is void" <<<"$out" && grep -q "~/.oss/config.json" <<<"$out"; then pass "a review agent's node -e write to ~/.oss/config.json voids the review"
    else fail "a review agent's node -e write to ~/.oss/config.json voids the review" "config changed, no void naming it: $(tail -4 <<<"$out")"; fi
  else
    fail "a review agent's node -e write to ~/.oss/config.json voids the review" "the write did not happen (refused or not run), so the check was not exercised: $(tail -3 <<<"$out")"
  fi
fi
OFF_TOKEN=""
[ "$UF_XTRACE" = 1 ] && set -x

echo
echo "Results: $PASSED passed, $FAILED failed, $SKIPPED skipped (work dir $WORK)"
[ "$FAILED" -eq 0 ]
