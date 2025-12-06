#!/bin/bash
# OSS IRON LAW Pre-Command Check
# Triggered on: UserPromptSubmit (before each user prompt)
# Checks IRON LAW compliance and performs self-correction
#
# Enforcement Mode: Announce + Auto-Correct (no user confirmation required)

# Only run in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Initialize tracking
VIOLATIONS=""
PASSED=""
CORRECTIONS=""

# =============================================================================
# IRON LAW #4: Agent Git Flow - Check branch
# =============================================================================
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #4: On '$BRANCH' branch (should be feature branch)\n"
    CORRECTIONS="${CORRECTIONS}│  → Create feature branch before making changes\n"
    CORRECTIONS="${CORRECTIONS}│    git fetch origin main && git checkout -b feat/agent-<name> origin/main\n"
else
    PASSED="${PASSED}├─ ✅ LAW #4: On feature branch '$BRANCH'\n"
fi

# =============================================================================
# IRON LAW #1: TDD - Check for skipped/focused tests
# =============================================================================
if [[ -f "package.json" ]]; then
    # Find skipped/focused tests (exclude node_modules)
    SKIPPED_FILES=$(grep -rl "\.skip\|\.todo\|\.only" --include="*.test.ts" --include="*.test.js" --include="*.spec.ts" --include="*.spec.js" --exclude-dir=node_modules 2>/dev/null || true)

    if [[ -n "$SKIPPED_FILES" ]]; then
        VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #1: Found skipped/focused tests (.skip/.todo/.only)\n"
        # List the specific files
        while IFS= read -r file; do
            if [[ -n "$file" ]]; then
                CORRECTIONS="${CORRECTIONS}│  → Remove .skip/.todo/.only from: $file\n"
            fi
        done <<< "$SKIPPED_FILES"
    else
        PASSED="${PASSED}├─ ✅ LAW #1: No skipped tests found\n"
    fi
fi

# =============================================================================
# IRON LAW #2: Test Philosophy - Check for 'any' types in staged files
# =============================================================================
if [[ -f "tsconfig.json" ]]; then
    # Only check staged TypeScript files for 'any' types
    STAGED_TS=$(git diff --cached --name-only 2>/dev/null | grep -E "\.tsx?$" || true)
    ANY_FILES=""

    if [[ -n "$STAGED_TS" ]]; then
        while IFS= read -r file; do
            if [[ -n "$file" && -f "$file" ]]; then
                if grep -q ": any" "$file" 2>/dev/null; then
                    ANY_FILES="${ANY_FILES}${file}\n"
                fi
            fi
        done <<< "$STAGED_TS"
    fi

    if [[ -n "$ANY_FILES" ]]; then
        VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #2: Found 'any' types in staged files\n"
        echo -e "$ANY_FILES" | while IFS= read -r file; do
            if [[ -n "$file" ]]; then
                CORRECTIONS="${CORRECTIONS}│  → Replace 'any' with proper types in: $file\n"
            fi
        done
    else
        PASSED="${PASSED}├─ ✅ LAW #2: No 'any' types in staged files\n"
    fi
fi

# =============================================================================
# SETUP: Check for dev docs structure
# =============================================================================
if [[ ! -d "dev/active" ]]; then
    VIOLATIONS="${VIOLATIONS}├─ ❌ SETUP: Missing dev/active/ directory\n"
    CORRECTIONS="${CORRECTIONS}│  → Create dev docs structure: mkdir -p dev/active dev/archive\n"
fi

# =============================================================================
# IRON LAW #5: Agent Delegation Reminder (informational only)
# =============================================================================
# This is a reminder injected into the prompt, not a violation check
AGENT_REMINDER="├─ 📋 LAW #5: Remember to delegate specialized work to agents (Task tool)\n"

# =============================================================================
# Output results (only if there are violations)
# =============================================================================
if [[ -n "$VIOLATIONS" ]]; then
    echo ""
    echo "⚠️ IRON LAW PRE-CHECK"
    echo -e "$VIOLATIONS"
    if [[ -n "$CORRECTIONS" ]]; then
        echo "SELF-CORRECTION ACTIONS:"
        echo -e "$CORRECTIONS"
    fi
    echo -e "$PASSED"
    echo -e "$AGENT_REMINDER"
    echo ""
    echo "Address violations before proceeding with your task."
    echo ""
fi

exit 0
