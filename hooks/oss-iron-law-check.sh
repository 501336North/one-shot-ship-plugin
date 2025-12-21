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
VIOLATION_LAWS=""  # Track which law numbers are violated (e.g., "4,1,2")

# =============================================================================
# IRON LAW #4: Agent Git Flow - Check branch
# =============================================================================
BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #4: On '$BRANCH' branch (should be feature branch)\n"
    CORRECTIONS="${CORRECTIONS}│  → Create feature branch before making changes\n"
    CORRECTIONS="${CORRECTIONS}│    git fetch origin main && git checkout -b feat/agent-<name> origin/main\n"
    VIOLATION_LAWS="${VIOLATION_LAWS}4,"
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
        VIOLATION_LAWS="${VIOLATION_LAWS}1,"
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
        VIOLATION_LAWS="${VIOLATION_LAWS}2,"
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
# SETUP: Check for dev docs structure (project-local or global)
# =============================================================================
# Resolve dev docs path with project-local priority
# Priority: 1) Project .oss/dev/, 2) Project dev/, 3) Global ~/.oss/dev/
PROJECT_DIR=$(pwd)
DEV_DOCS_PATH=""

if [[ -d "$PROJECT_DIR/.oss/dev/active" ]]; then
    DEV_DOCS_PATH="$PROJECT_DIR/.oss/dev"
elif [[ -d "$PROJECT_DIR/dev/active" ]]; then
    DEV_DOCS_PATH="$PROJECT_DIR/dev"
elif [[ -d "$HOME/.oss/dev/active" ]]; then
    DEV_DOCS_PATH="$HOME/.oss/dev"
fi

if [[ -z "$DEV_DOCS_PATH" ]]; then
    VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #6: Missing dev/active/ directory (checked ./.oss/dev/, ./dev/, ~/.oss/dev/)\n"
    CORRECTIONS="${CORRECTIONS}│  → Create dev docs: mkdir -p .oss/dev/active .oss/dev/completed\n"
    VIOLATION_LAWS="${VIOLATION_LAWS}6,"
else
    PASSED="${PASSED}├─ ✅ LAW #6: Dev docs found at $DEV_DOCS_PATH\n"
fi

# =============================================================================
# IRON LAW #5: Agent Delegation Reminder (informational only)
# =============================================================================
# This is a reminder injected into the prompt, not a violation check
AGENT_REMINDER="├─ 📋 LAW #5: Remember to delegate specialized work to agents (Task tool)\n"

# =============================================================================
# Persist results to log
# =============================================================================
# Determine plugin root for logging
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$PLUGIN_ROOT" && -f "$HOME/.oss/plugin-root" ]]; then
    PLUGIN_ROOT=$(cat "$HOME/.oss/plugin-root" 2>/dev/null)
fi

# Determine current command (default to "precheck" if not in a command context)
CURRENT_CMD="${OSS_CURRENT_COMMAND:-precheck}"

# Log the result if plugin root is available
if [[ -n "$PLUGIN_ROOT" && -f "$PLUGIN_ROOT/hooks/oss-log.sh" ]]; then
    # Remove trailing comma from violation laws
    VIOLATION_LAWS="${VIOLATION_LAWS%,}"

    if [[ -n "$VIOLATIONS" ]]; then
        "$PLUGIN_ROOT/hooks/oss-log.sh" ironlaw "$CURRENT_CMD" "FAILED" "$VIOLATION_LAWS"
    else
        "$PLUGIN_ROOT/hooks/oss-log.sh" ironlaw "$CURRENT_CMD" "PASSED" ""
    fi
fi

# =============================================================================
# Output results
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
else
    # Always show agent delegation reminder even when no violations
    echo ""
    echo "✅ IRON LAW PRE-CHECK PASSED"
    echo -e "$PASSED"
    echo -e "$AGENT_REMINDER"
    echo "└─ 📝 LAW #6: Keep dev docs in sync (PROGRESS.md)"
    echo ""
fi

exit 0
