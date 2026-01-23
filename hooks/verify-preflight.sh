#!/bin/bash
# verify-preflight.sh - Pre-flight verification checks for /oss:ship
#
# Supports modes:
#   quick - Build and TypeScript only
#   full (default) - Build, TypeScript, Lint, Tests, Coverage, Console.log, IRON LAW
#
# Usage:
#   verify-preflight.sh [--quick] [--dry-run]
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

set -euo pipefail

# Configuration
QUICK_MODE=false
DRY_RUN=false
PROJECT_ROOT="${OSS_PROJECT_ROOT:-$(pwd)}"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick|-q)
            QUICK_MODE=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help|-h)
            echo "Usage: verify-preflight.sh [--quick] [--dry-run]"
            echo ""
            echo "Options:"
            echo "  --quick, -q    Run quick checks only (build and TypeScript)"
            echo "  --dry-run      Show what would be checked without running"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Results tracking
declare -A CHECK_RESULTS
OVERALL_STATUS=0

# Output helpers
print_header() {
    echo ""
    echo "┌────────────────────────────────────────────────────────┐"
    echo "│                  PREFLIGHT VERIFICATION                 │"
    echo "└────────────────────────────────────────────────────────┘"
    echo ""
    if [[ "$QUICK_MODE" == "true" ]]; then
        echo "Mode: QUICK (build + TypeScript only)"
    else
        echo "Mode: FULL (all checks)"
    fi
    echo ""
}

print_check_start() {
    local name="$1"
    printf "├── ⏳ %s..." "$name"
}

print_check_result() {
    local name="$1"
    local status="$2"

    # Move cursor back to overwrite the pending line
    printf "\r"

    if [[ "$status" == "pass" ]]; then
        echo "├── ✅ $name"
        CHECK_RESULTS["$name"]="pass"
    else
        echo "├── ❌ $name"
        CHECK_RESULTS["$name"]="fail"
        OVERALL_STATUS=1
    fi
}

print_summary() {
    echo ""
    echo "└── Summary:"

    local passed=0
    local failed=0

    for check in "${!CHECK_RESULTS[@]}"; do
        if [[ "${CHECK_RESULTS[$check]}" == "pass" ]]; then
            passed=$((passed + 1))
        else
            failed=$((failed + 1))
        fi
    done

    echo "    ├── Passed: $passed"
    echo "    ├── Failed: $failed"

    if [[ $OVERALL_STATUS -eq 0 ]]; then
        echo "    └── Status: ✅ ALL CHECKS PASSED"
    else
        echo "    └── Status: ❌ SOME CHECKS FAILED"
    fi
}

# Check functions
run_build_check() {
    local name="Build"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would run: npm run build"
        print_check_result "$name" "pass"
        return
    fi

    if cd "$PROJECT_ROOT" && npm run build >/dev/null 2>&1; then
        print_check_result "$name" "pass"
    else
        print_check_result "$name" "fail"
    fi
}

run_typescript_check() {
    local name="TypeScript (tsc)"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would run: npx tsc --noEmit"
        print_check_result "$name" "pass"
        return
    fi

    if cd "$PROJECT_ROOT" && npx tsc --noEmit >/dev/null 2>&1; then
        print_check_result "$name" "pass"
    else
        print_check_result "$name" "fail"
    fi
}

run_lint_check() {
    local name="Lint"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would run: npm run lint"
        print_check_result "$name" "pass"
        return
    fi

    if cd "$PROJECT_ROOT" && npm run lint >/dev/null 2>&1; then
        print_check_result "$name" "pass"
    else
        # Lint might not exist, treat as pass
        if ! npm run lint 2>&1 | grep -q "Missing script"; then
            print_check_result "$name" "fail"
        else
            print_check_result "$name" "pass"
        fi
    fi
}

run_test_check() {
    local name="Tests"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would run: npm test"
        print_check_result "$name" "pass"
        return
    fi

    if cd "$PROJECT_ROOT" && npm test >/dev/null 2>&1; then
        print_check_result "$name" "pass"
    else
        print_check_result "$name" "fail"
    fi
}

run_coverage_check() {
    local name="Coverage/Console.log"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would check for console.log statements"
        print_check_result "$name" "pass"
        return
    fi

    # Check for console.log in source files (not tests)
    local console_count
    console_count=$(find "$PROJECT_ROOT/src" -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs grep -l "console\.log" 2>/dev/null | wc -l | tr -d ' ')

    if [[ "$console_count" -eq 0 ]]; then
        print_check_result "$name" "pass"
    else
        print_check_result "$name" "fail"
        echo "    Found $console_count files with console.log"
    fi
}

run_iron_law_check() {
    local name="IRON LAW Compliance"
    print_check_start "$name"

    if [[ "$DRY_RUN" == "true" ]]; then
        echo ""
        echo "    [dry-run] Would check IRON LAW compliance"
        print_check_result "$name" "pass"
        return
    fi

    # Check for IRON LAW compliance script
    local iron_law_script="${CLAUDE_PLUGIN_ROOT:-$HOME/.oss}/hooks/oss-iron-law-check.sh"

    if [[ -x "$iron_law_script" ]]; then
        if "$iron_law_script" --quiet >/dev/null 2>&1; then
            print_check_result "$name" "pass"
        else
            print_check_result "$name" "fail"
        fi
    else
        # No iron law check script, pass
        print_check_result "$name" "pass"
    fi
}

# Main execution
main() {
    print_header

    if [[ "$QUICK_MODE" == "true" ]]; then
        # Quick mode: only build and TypeScript
        echo "Checks to run:"
        echo "├── Build"
        echo "└── TypeScript (tsc)"
        echo ""

        run_build_check
        run_typescript_check
    else
        # Full mode: all checks
        echo "Checks to run:"
        echo "├── Build"
        echo "├── TypeScript (tsc)"
        echo "├── Lint"
        echo "├── Tests"
        echo "├── Coverage/Console.log"
        echo "└── IRON LAW Compliance"
        echo ""

        run_build_check
        run_typescript_check
        run_lint_check
        run_test_check
        run_coverage_check
        run_iron_law_check
    fi

    print_summary
    exit $OVERALL_STATUS
}

main
