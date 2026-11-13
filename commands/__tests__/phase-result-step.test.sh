#!/bin/bash
# The ideate, plan, build and ship wrappers assemble the phase result before `complete` (R-257 Task 12).
#
# Usage: ./commands/__tests__/phase-result-step.test.sh
#
# @behavior When a user runs /oss:ideate, /oss:plan, /oss:build or /oss:ship, the model writes the phase's
#           value files with the Write tool and runs the fixed assemble call before marking the phase complete,
#           so the next phase's gate finds a code-assembled result instead of prose.
# @business-rule The assemble step comes before the `--workflow <phase> complete` line.
# @business-rule Value files reach the hook through the `oss-value.sh dir` folder via the Write tool, never
#           through a command line, and each wrapper names the files its assembler reads.
# @business-rule Results are never written by hand: a failed assemble is fixed at the evidence and re-run.
#
# Matching is by keyword (FOLLOWUPS 212), literal (grep -F / awk index).
set -uo pipefail
unset OSS_CONFIG_DIR OSS_MANIFEST_URL OSS_ALLOW_HTTP_LOOPBACK

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMDS="$HERE/.."
RUN=0; FAILED=0
pass() { echo "✓ PASS: $1"; RUN=$((RUN + 1)); }
fail() { echo "✗ FAIL: $1 — $2"; RUN=$((RUN + 1)); FAILED=$((FAILED + 1)); }
export LC_ALL=C

value_files() {
    case "$1" in
        ideate) echo "open-questions.json" ;;
        plan) echo "tasks.json" ;;
        build) echo "notes.txt" ;;
        ship) echo "summary.txt overrides.json" ;;
    esac
}

# First line number holding the literal text $2 in file $1 (0 if none).
line_of() { awk -v s="$2" 'index($0, s) { print NR; found = 1; exit } END { if (!found) print 0 }' "$1"; }

for phase in ideate plan build ship; do
    f="$CMDS/$phase.md"
    asm=$(line_of "$f" "oss-phase-result.sh assemble $phase")
    done_line=$(line_of "$f" "--workflow $phase complete '{}'")
    if [ "$asm" -gt 0 ] && [ "$done_line" -gt 0 ] && [ "$asm" -lt "$done_line" ]; then
        pass "$phase: assemble runs before complete"
    else
        fail "$phase: assemble runs before complete" "assemble line $asm, complete line $done_line"
    fi

    # The step text: from its heading to the assemble line.
    head_line=$(awk 'tolower($0) ~ /^#+ .*assemble the phase result/ { print NR; exit }' "$f")
    step=""
    [ -n "$head_line" ] && [ "$asm" -gt 0 ] && step=$(awk -v s="$head_line" -v e="$((asm + 12))" 'NR >= s && NR <= e' "$f")
    if [ -n "$step" ]; then pass "$phase: has an 'Assemble the phase result' step"; else fail "$phase: has an 'Assemble the phase result' step" "no heading before the assemble line"; fi

    lc=$(printf '%s' "$step" | tr '[:upper:]' '[:lower:]')
    case "$lc" in *"write tool"*) pass "$phase: step names the Write tool" ;; *) fail "$phase: step names the Write tool" "missing" ;; esac
    case "$step" in *"oss-value.sh dir"*) pass "$phase: step names oss-value.sh dir" ;; *) fail "$phase: step names oss-value.sh dir" "missing" ;; esac
    for v in $(value_files "$phase"); do
        case "$step" in *"$v"*) pass "$phase: step names $v" ;; *) fail "$phase: step names $v" "missing" ;; esac
    done
    case "$lc" in *never*"by hand"*|*"by hand"*never*) pass "$phase: step says never write results by hand" ;; *) fail "$phase: step says never write results by hand" "missing" ;; esac
    case "$step" in *"results/"*) pass "$phase: step names results/" ;; *) fail "$phase: step names results/" "missing" ;; esac

    # No value file ever reaches a command: not inside $(cat ...), not as an argument on a fenced line.
    bad=$(awk '
        /^[ \t]*```/ { fence = !fence; next }
        fence && /(open-questions|tasks|overrides)\.json|notes\.txt|summary\.txt/ { print NR ": " $0 }
        /\$\(cat[^)]*(open-questions|tasks|overrides)\.json/ || /\$\(cat[^)]*(notes|summary)\.txt/ { print NR ": " $0 }' "$f")
    if [ -z "$bad" ]; then pass "$phase: no value file in a command"; else fail "$phase: no value file in a command" "$bad"; fi
done

# Review agents run only from R-266's Bash allowlist, so the tool gate would refuse oss-phase-result.sh: only the main
# agent and builders assemble a phase result. No review agent prompt may tell it to run.
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
for a in code-reviewer security-auditor penetration-tester performance-auditor; do
    if grep -q 'oss-phase-result' "$ROOT_DIR/agents/$a.md" 2>/dev/null; then fail "review agent $a never runs oss-phase-result.sh" "mentioned"
    else pass "review agent $a never runs oss-phase-result.sh"; fi
done

echo
echo "$RUN run, $((RUN - FAILED)) passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
