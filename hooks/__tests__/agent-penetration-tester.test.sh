#!/bin/bash
# The penetration-tester agent wrapper (radical-observability G2, B10; API ADR-018).
#
# @behavior A ship run can call oss:penetration-tester, an authorized penetration tester that attacks the change
#           under review in a sandbox, separate from the security audit. Its wrapper fetches the
#           penetration-tester prompt and otherwise behaves exactly like security-auditor's wrapper: the same
#           model, the same model routing, the same steps.
# @business-rule The wrapper is security-auditor.md with only its own identity changed: the frontmatter name and
#           description, the route marker, AGENT_ID, the heading and the decrypt name. Any other difference is drift
#           between two wrappers that must stay alike, and fails here.
# @business-rule Claude Code finds a plugin's agents in agents/*.md (plugin.json lists none); the prompt the wrapper
#           fetches must be one the API serves (commands/__tests__/served-prompt-names.txt).
# Usage: /bin/bash hooks/__tests__/agent-penetration-tester.test.sh
set -uo pipefail
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PEN="$ROOT/agents/penetration-tester.md"
SEC="$ROOT/agents/security-auditor.md"
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
echo "Running agent-penetration-tester tests..."
T=$(mktemp -d /tmp/oss-agent-pen.XXXXXX); trap 'rm -rf "$T"' EXIT

# --- its own identity ---------------------------------------------------------------------------------------------
name='should name itself penetration-tester in the name, route marker, AGENT_ID, heading and decrypt call'
bad=""
[[ -f "$PEN" ]] || bad="$bad no agents/penetration-tester.md"
if [[ -f "$PEN" ]]; then
    [[ "$(sed -n '2p' "$PEN")" == 'name: penetration-tester' ]] || bad="$bad name"
    grep -qxF '<!-- OSS-ROUTE-AGENT: oss:penetration-tester -->' "$PEN" || bad="$bad route-marker"
    grep -qxF '# penetration-tester Agent' "$PEN" || bad="$bad heading"
    # shellcheck disable=SC2088 # the ~ is the wrapper's own text, matched literally
    grep -qxF '~/.oss/bin/oss-decrypt --type agents --name penetration-tester' "$PEN" || bad="$bad decrypt"
    # every AGENT_ID (Step 0 and Step 2.5) is its own
    ids=$(grep -E '^[[:space:]]*AGENT_ID=' "$PEN" | sed 's/^[[:space:]]*//' | sort -u)
    [[ "$ids" == 'AGENT_ID="oss:penetration-tester"' && $(grep -cE '^[[:space:]]*AGENT_ID=' "$PEN") -eq $(grep -cE '^[[:space:]]*AGENT_ID=' "$SEC") ]] \
        || bad="$bad agent-id=[$ids]"
    desc=$(sed -n '3p' "$PEN")
    [[ "$desc" == 'description: '*'authorized penetration tester'*'sandbox'*'security audit'* ]] || bad="$bad description=[$desc]"
    grep -q 'security-auditor' "$PEN" && bad="$bad mentions-security-auditor"
fi
[[ -z "$bad" ]] && pass "$name" || fail "$name" "$bad"

# --- no drift from security-auditor's wrapper ---------------------------------------------------------------------
# same <file> <agent>: the wrapper with its own identity lines replaced by one fixed text, so two wrappers that differ
# only there come out byte-identical
same() {
    sed -e "s/^name: $2\$/name: {{id}}/" -e 's/^description: .*/description: {{id}}/' \
        -e "s/^<!-- OSS-ROUTE-AGENT: oss:$2 -->\$/<!-- OSS-ROUTE-AGENT: {{id}} -->/" \
        -e "s/^\\([[:space:]]*\\)AGENT_ID=\"oss:$2\"\$/\\1AGENT_ID={{id}}/" \
        -e "s/^# $2 Agent\$/# {{id}} Agent/" \
        -e "s|^~/.oss/bin/oss-decrypt --type agents --name $2\$|~/.oss/bin/oss-decrypt --type agents --name {{id}}|" "$1"
}
name='should be byte-identical to security-auditor.md apart from its name, description, route marker, AGENT_ID, heading and decrypt name'
if [[ -f "$PEN" ]] && same "$SEC" security-auditor > "$T/sec" && same "$PEN" penetration-tester > "$T/pen" && cmp -s "$T/sec" "$T/pen"; then
    pass "$name"
else
    fail "$name" "$( [[ -f "$PEN" ]] && diff "$T/sec" "$T/pen" | head -20 | tr '\n' '|' || echo 'no agents/penetration-tester.md')"
fi
# control: the normalising is not vacuous, security-auditor's own identity lines are what it replaced
[[ $(same "$SEC" security-auditor | grep -c '{{id}}') -eq $(grep -cE '^name: |^description: |OSS-ROUTE-AGENT|AGENT_ID=|^# security-auditor Agent$|--name security-auditor$' "$SEC") ]] \
    && pass "control: the comparison replaces exactly security-auditor's identity lines" \
    || fail "control: the comparison replaces exactly security-auditor's identity lines" "replaced=$(same "$SEC" security-auditor | grep -c '{{id}}')"

# --- registration ---------------------------------------------------------------------------------------------------
name='should be found by Claude Code from agents/, and fetch a prompt the API serves'
bad=""
# plugin.json lists no agents: Claude Code discovers agents/*.md. Should it ever list them, this one must be there.
if jq -e 'has("agents")' "$ROOT/.claude-plugin/plugin.json" >/dev/null 2>&1; then
    jq -e '.agents | tostring | test("penetration-tester")' "$ROOT/.claude-plugin/plugin.json" >/dev/null 2>&1 || bad="$bad plugin.json-agents"
fi
grep -qxF 'agents penetration-tester' "$ROOT/commands/__tests__/served-prompt-names.txt" || bad="$bad not-served"
[[ -f "$PEN" ]] || bad="$bad no-file"
[[ -z "$bad" ]] && pass "$name" || fail "$name" "$bad"

echo "$RUN run, $FAILED failed"
[[ $FAILED -eq 0 ]]
