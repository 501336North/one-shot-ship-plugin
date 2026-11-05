#!/bin/bash
# The Local-Model Offload step (Step 2.5) of the 13 routable agents, run as written (T78e, code-review L5).
#
# @behavior When a customer maps an agent to a local model, Claude makes a private folder, writes the prompt into it
#           with the Write tool on the first try, and the offloader gets that prompt with nothing left on disk.
# @business-rule Step 1 makes only the owner-only (700) folder and prints a prompt path that does not exist yet:
#           Claude Code's Write refuses to overwrite a file it has not Read, so a pre-made empty file costs a failed
#           Write (or a native run). Step 2 deletes the file and its folder before node runs; the prompt reaches the
#           offloader on stdin. All 13 agents carry the same step apart from their own id, and none may drop it.
# @boundary The two bash blocks of each agent's Step 2.5, run unchanged in bash and zsh, with TMPDIR in a sandbox and
#           a stub node and agent-offload.js. Never the real ~/.oss.
#
# Usage: ./commands/__tests__/agent-offload-step.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT/hooks/__tests__/lib/run-capped.sh"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
T=$(mktemp -d); T=$(cd "$T" && pwd -P)
# Step 1's mktemp -t may use the per-user temp folder whatever TMPDIR says (macOS): every folder it prints is
# recorded in $T/made and removed here, however the test ends.
gone() { local d; [[ -f "$T/made" ]] && while IFS= read -r d; do case "$d" in */oss-offload.*) rm -f -- "$d/prompt.md"; rmdir -- "$d" 2>/dev/null ;; esac; done < "$T/made"; rm -rf "$T"; }
trap gone EXIT
trap 'gone; exit 1' HUP INT TERM

AGENTS="backend-architect code-reviewer code-simplifier debugger figma-design-agent frontend-developer nextjs-developer
python-pro react-specialist refactoring-specialist security-auditor test-engineer typescript-pro"

# step <agent>: the Step 2.5 section, up to the next ## heading
step() { awk '/^## Step 2\.5/ { f = 1; print; next } f && /^## / { exit } f' "$ROOT/agents/$1.md"; }
# block <agent> <n>: the body of the n-th ```bash block of that section, less its indent
block() {
    step "$1" | awk -v n="$2" '
        /^[[:space:]]*```bash/ { k++; if (k == n) { on = 1; match($0, /^[[:space:]]*/); ind = RLENGTH }; next }
        on && /^[[:space:]]*```/ { exit }
        on { print substr($0, ind + 1) }'
}

# --- every routable agent has the step, and all are the same apart from the id ---------------------------------
have=$(cd "$ROOT/agents" && grep -l '^## Step 2\.5' *.md | sed 's/\.md$//' | sort | tr '\n' ' ')
want=$(printf '%s\n' $AGENTS | sort | tr '\n' ' ')
[[ "$have" == "$want" ]] && pass "exactly the 13 routable agents carry Step 2.5" \
    || fail "exactly the 13 routable agents carry Step 2.5" "missing: $(comm -13 <(printf '%s\n' $have) <(printf '%s\n' $want) | tr '\n' ' ') extra: $(comm -23 <(printf '%s\n' $have) <(printf '%s\n' $want) | tr '\n' ' ')"
ref=''; diffs=''
for a in $AGENTS; do
    s=$(step "$a" | sed "s/oss:$a/oss:<agent>/g")
    [[ -n "$s" ]] || { diffs="$diffs $a(no step)"; continue; }
    [[ -z "$ref" ]] && { ref=$s; continue; }
    [[ "$s" == "$ref" ]] || diffs="$diffs $a"
done
[[ -z "$diffs" ]] && pass "Step 2.5 is the same in all 13 agents apart from the agent id" || fail "Step 2.5 is the same in all 13 agents" "differs:$diffs"

# --- an old Claude Code: the customer is told why the agent ran on Claude (T76b) ---------------------------------
# @behavior When the offloader says the installed Claude Code is too old (reason cli_too_old), the agent shows its one
#           notice line to the user once, then runs natively, so a customer who mapped a model is never switched to
#           Claude silently.
TOO_OLD='- **`offloaded: false` with `reason: "cli_too_old"`** → show the user the result'"'"'s `notice` line once, word for word, then run natively: proceed to Step 3.'
[[ "$(printf '%s' "$ref" | tr -s '[:space:]' ' ')" == *"$TOO_OLD"* ]] && pass "Step 2.5 shows the cli_too_old notice once, then runs natively (13 agents)" \
    || fail "Step 2.5 shows the cli_too_old notice once, then runs natively" "missing: $TOO_OLD"

# --- run the two blocks as written (TMPDIR points into the sandbox where mktemp honours it) ---------------------------------------------------------------------------
mkdir -p "$T/bin" "$T/plugin/watcher/dist/cli"; : > "$T/plugin/watcher/dist/cli/agent-offload.js"
# stub node: records whether the prompt file and its folder still existed, and what came in on stdin
cat > "$T/bin/node" << SH
#!/bin/sh
{ [ -e "\$STUB_PF" ] && echo file-there; [ -d "\${STUB_PF%/prompt.md}" ] && echo dir-there; echo "args \$*"; } > "$T/node.seen"
cat > "$T/node.stdin"
echo '{"offloaded":true,"output":"stub"}'
SH
chmod +x "$T/bin/node"
for sh in /bin/bash /bin/zsh; do
    [[ -x "$sh" ]] || { pass "$sh rows skipped (no $sh)"; continue; }
    bad=''
    for a in $AGENTS; do
        rm -rf "$T/tmp" "$T/node.seen" "$T/node.stdin"; mkdir -p "$T/tmp"
        b1=$(block "$a" 1); b2=$(block "$a" 2)
        PF=$(cd "$T" && run_capped 30 env TMPDIR="$T/tmp" "$sh" -c "$b1" 2>&1 </dev/null) || { bad="$bad [$a: step 1 failed: $PF]"; continue; }
        d=${PF%/prompt.md}; printf '%s\n' "$d" >> "$T/made"
        [[ "$PF" == /*/oss-offload.*/prompt.md && "$PF" != *$'\n'* ]] || { bad="$bad [$a: step 1 printed $PF]"; continue; }
        [[ ! -e "$PF" ]] || bad="$bad [$a: step 1 made the prompt file, so a first Write is refused]"
        m=$(stat -c %a "$d" 2>/dev/null || stat -f %Lp "$d")
        [[ -d "$d" && "$m" == 700 ]] || bad="$bad [$a: the folder is mode $m]"
        # the model's Write: create the printed path with the prompt
        printf 'EXPERT-PROMPT-78\n\n---\n\nTASK-78\n' > "$PF"
        b2=${b2//<path printed in step 1>/$PF}
        out=$(cd "$T" && run_capped 30 env PATH="$T/bin:$PATH" CLAUDE_PLUGIN_ROOT="$T/plugin" STUB_PF="$PF" "$sh" -c "$b2" 2>&1 </dev/null)
        [[ "$out" == *'"offloaded":true'* ]] || bad="$bad [$a: no offloader result: $out]"
        [[ -f "$T/node.seen" && "$(grep -c -- '-there' "$T/node.seen")" == 0 ]] || bad="$bad [$a: node ran while the prompt was on disk: $(cat "$T/node.seen" 2>/dev/null | tr '\n' ' ')]"
        grep -q -- "--agent oss:$a " "$T/node.seen" 2>/dev/null || bad="$bad [$a: wrong agent id: $(cat "$T/node.seen" 2>/dev/null)]"
        [[ "$(cat "$T/node.stdin" 2>/dev/null)" == *EXPERT-PROMPT-78*TASK-78* ]] || bad="$bad [$a: the prompt did not reach node on stdin]"
        [[ ! -e "$PF" && ! -e "$d" ]] || bad="$bad [$a: the prompt or its folder is left behind]"
    done
    [[ -z "$bad" ]] && pass "$sh: step 1 makes only the 700 folder (the prompt path is new for Write); step 2 deletes both before node runs and feeds the prompt on stdin (13 agents)" \
        || fail "$sh: Step 2.5 runs as written" "$bad"
done

echo ""
echo "Results: $((RUN - FAILED))/$RUN passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
