#!/bin/bash
# Tests that wrappers pass user and model values to the shell through the value folder, never
# typed into a command line (plugin-value-flags, ship round 3).
#
# Usage: ./value-file-wrappers.test.sh
#
# @behavior A value the user or the model supplies (an API key, a notification style, a prompt or
#           model name, a workflow name, a prompt category/name, a specialist agent's name) reaches
#           a shell command only through a file the model writes with the Write tool and
#           `oss-value.sh` reads and checks in code; a ' or $( in it can never run.
# @business-rule Ship round 3, R3-4: build.md logs the specialist's name through agent.txt and
#           `oss-value.sh agent build start|complete`, so the status line shows the agent again.
# @business-rule Ship round 3, R3-5: login --key, login's first-run style, models set, workflows
#           <name> and trust's per-prompt decrypt read their values with `oss-value.sh read`.
# @business-rule Ship round 3, R3-1..R3-3: permission-denied fallbacks show fixed commands; no
#           stale "Replace {COMMAND_NAME}" sentence; build.md's log example shows no file/message
#           after [TEST] FAIL/PASS.
# @business-rule Ship round 3, R3-7: request-shape fences are labelled ```http.

set -uo pipefail
C="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_RUN=0; TESTS_FAILED=0
pass() { echo "✓ PASS: $1"; TESTS_RUN=$((TESTS_RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; TESTS_RUN=$((TESTS_RUN + 1)); TESTS_FAILED=$((TESTS_FAILED + 1)); }
has() { grep -qF -- "$2" "$C/$1"; }                       # <file> <literal>
check() { if "${@:2}"; then pass "$1"; else fail "$1" "not as expected"; fi; }   # <name> <cmd...>
none() { ! grep -qF -- "$2" "$C/$1"; }

V='"$HOME/.oss/hooks/oss-value.sh"'

# R3-1: fallbacks give fixed, placeholder-free commands
check "ship.md fallback shows git push -u origin HEAD" has ship.md 'git push -u origin HEAD'
check "ship.md fallback shows gh pr create --base main --fill" has ship.md 'gh pr create --base main --fill'
check "deploy.md fallback shows kubectl apply for the listed manifests" has deploy.md 'kubectl apply -f deployment.yaml -f service.yaml'
check "deploy.md fallback shows kubectl rollout status for the deployment" has deploy.md 'kubectl rollout status -f deployment.yaml'

# R3-2
check "oss-custom.md has no stale Replace {COMMAND_NAME} sentence" none oss-custom.md 'Replace `{COMMAND_NAME}`'

# R3-3
check "build.md log example shows nothing after [TEST] FAIL" none build.md '[TEST] FAIL -'
check "build.md log example shows nothing after [TEST] PASS" none build.md '[TEST] PASS -'
check "build.md does not ask to document the failure message (no log text)" none build.md 'Document the failure message'

# R3-4
check "build.md logs agent start through oss-value.sh" has build.md "$V agent build start"
check "build.md logs agent completion through oss-value.sh" has build.md "$V agent build complete"
check "build.md tells the model to Write agent.txt" has build.md 'agent.txt'
check "build.md has no direct oss-log.sh agent line" none build.md 'oss-log.sh agent build'

# R3-5
check "login.md --key reads the key from key.txt" has login.md "NEW_KEY=\$($V read key)"
check "login.md has no \$KEY_ARG" none login.md '$KEY_ARG'
check "login.md first-run style reads style.txt" has login.md "STYLE=\$($V read style)"
check "models.md set reads prompt.txt" has models.md "PROMPT_NAME=\$($V read prompt)"
check "models.md set reads model.txt" has models.md "MODEL_ID=\$($V read model)"
check "models.md set does not take \$1" none models.md 'PROMPT_NAME="$1"'
check "models.md set does not take \$2" none models.md 'MODEL_ID="$2"'
check "workflows.md reads workflow.txt" has workflows.md "WORKFLOW=\$($V read workflow)"
check "workflows.md has no {workflowName}" none workflows.md '{workflowName}'
check "trust.md reads category.txt" has trust.md "T=\$($V read category)"
check "trust.md reads name.txt" has trust.md "N=\$($V read name)"
check "trust.md decrypts with the values read" has trust.md '~/.oss/bin/oss-decrypt --type "$T" --name "$N"'
for f in login.md models.md workflows.md trust.md build.md; do
    check "$f tells the model to use the folder oss-value.sh dir prints" has "$f" "$V dir"
done

# R3-7: request shapes are ```http
cnt() { grep -c '^```http' "$C/$1" | tr -d ' '; }
check "login.md has its request shape as an http fence" test "$(cnt login.md)" -ge 1
check "status.md has its request shape as an http fence" test "$(cnt status.md)" -ge 1
check "workflows.md has both request shapes as http fences" test "$(cnt workflows.md)" -ge 2

echo ""
echo "Results: $((TESTS_RUN - TESTS_FAILED))/$TESTS_RUN passed, $TESTS_FAILED failed"
[[ $TESTS_FAILED -eq 0 ]]
