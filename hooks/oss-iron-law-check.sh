#!/bin/bash
# OSS IRON LAW Pre-Command Check
# Triggered on: UserPromptSubmit (before each user prompt)
# Checks IRON LAW compliance and performs self-correction
#
# Enforcement Mode: Announce + Auto-Correct (no user confirmation required)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_SCRIPT="$SCRIPT_DIR/oss-log.sh"

# --- Hook Logging (for supervisor visibility) ---
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-iron-law-check START
fi

# Only run in git repositories
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if [[ -x "$LOG_SCRIPT" ]]; then
        "$LOG_SCRIPT" hook oss-iron-law-check COMPLETE
    fi
    exit 0
fi

# Initialize tracking
VIOLATIONS=""
PASSED=""
CORRECTIONS=""
VIOLATION_LAWS=""  # Track which law numbers are violated (e.g., "4,1,2")

# =============================================================================
# Load Team-Specific IRON LAWS Configuration
# =============================================================================
TEAM_CONFIG=""
FETCH_SCRIPT="$SCRIPT_DIR/oss-fetch-team-iron-laws.sh"

if [[ -x "$FETCH_SCRIPT" ]]; then
    TEAM_CONFIG=$("$FETCH_SCRIPT" 2>/dev/null || echo '{}')
fi

# Helper function to extract JSON values (works without jq)
get_json_value() {
    local json="$1"
    local key="$2"
    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[^,}]*" | sed 's/.*:[[:space:]]*//' | tr -d '"' | head -1
}

# Helper function to extract nested config value
get_config_value() {
    local json="$1"
    local law="$2"
    local field="$3"
    # Extract the law section first, then the field
    local law_section=$(echo "$json" | grep -o "\"$law\"[[:space:]]*:[[:space:]]*{[^}]*}" | head -1)
    if [[ -n "$law_section" ]]; then
        get_json_value "$law_section" "$field"
    fi
}

# Helper function to extract array values (e.g., protectedBranches)
get_config_array() {
    local json="$1"
    local law="$2"
    local array_name="$3"
    # Extract the config section with nested braces
    local law_section=$(echo "$json" | grep -o "\"$law\"[[:space:]]*:[[:space:]]*{[^}]*\"config\"[[:space:]]*:[[:space:]]*{[^}]*}" | head -1)
    if [[ -n "$law_section" ]]; then
        echo "$law_section" | grep -o "\"$array_name\"[[:space:]]*:[[:space:]]*\[[^]]*\]" | sed 's/.*\[//' | sed 's/\].*//' | tr ',' '\n' | tr -d '"' | tr -d ' '
    fi
}

# Check if a law is enabled (defaults to true if not specified)
is_law_enabled() {
    local law="$1"
    local enabled=$(get_config_value "$TEAM_CONFIG" "$law" "enabled")
    [[ "$enabled" != "false" ]]
}

# =============================================================================
# IRON LAW #4: Agent Git Flow - Check branch
# =============================================================================
if is_law_enabled "law4_git_flow"; then
    BRANCH=$(git branch --show-current 2>/dev/null || echo "detached")

    # Get custom protected branches from team config (defaults: main, master)
    PROTECTED_BRANCHES=$(get_config_array "$TEAM_CONFIG" "law4_git_flow" "protectedBranches")
    if [[ -z "$PROTECTED_BRANCHES" ]]; then
        PROTECTED_BRANCHES="main
master"
    fi

    LAW4_VIOLATED=false
    while IFS= read -r protected_branch; do
        if [[ -n "$protected_branch" && "$BRANCH" == "$protected_branch" ]]; then
            LAW4_VIOLATED=true
            break
        fi
    done <<< "$PROTECTED_BRANCHES"

    if [[ "$LAW4_VIOLATED" == "true" ]]; then
        VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #4: On protected branch '$BRANCH' (should be feature branch)\n"
        CORRECTIONS="${CORRECTIONS}│  → Create feature branch before making changes\n"
        CORRECTIONS="${CORRECTIONS}│    git fetch origin main && git checkout -b feat/agent-<name> origin/main\n"
        VIOLATION_LAWS="${VIOLATION_LAWS}4,"
    else
        PASSED="${PASSED}├─ ✅ LAW #4: On feature branch '$BRANCH'\n"
    fi
else
    PASSED="${PASSED}├─ ⏭️  LAW #4: Disabled by team config\n"
fi

# =============================================================================
# IRON LAW #1: TDD - Check for skipped/focused tests
# =============================================================================
if is_law_enabled "law1_tdd"; then
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
else
    PASSED="${PASSED}├─ ⏭️  LAW #1: Disabled by team config\n"
fi

# =============================================================================
# IRON LAW #2: Test Philosophy - Check for 'any' types in staged files
# =============================================================================
if is_law_enabled "law2_behavior_tests"; then
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
else
    PASSED="${PASSED}├─ ⏭️  LAW #2: Disabled by team config\n"
fi

# =============================================================================
# IRON LAW #6: Dev Docs Structure - Check for required docs
# =============================================================================
if is_law_enabled "law6_dev_docs"; then
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

        # Check for required docs in active features (if any active features exist)
        REQUIRED_DOCS=$(get_config_array "$TEAM_CONFIG" "law6_dev_docs" "requiredDocs")
        if [[ -z "$REQUIRED_DOCS" ]]; then
            REQUIRED_DOCS="PROGRESS.md"
        fi

        # Check each active feature for required docs
        MISSING_DOCS=""
        if [[ -d "$DEV_DOCS_PATH/active" ]]; then
            for feature_dir in "$DEV_DOCS_PATH/active"/*/; do
                if [[ -d "$feature_dir" ]]; then
                    feature_name=$(basename "$feature_dir")
                    while IFS= read -r required_doc; do
                        if [[ -n "$required_doc" && ! -f "$feature_dir/$required_doc" ]]; then
                            MISSING_DOCS="${MISSING_DOCS}│  → Missing $required_doc in $feature_name\n"
                        fi
                    done <<< "$REQUIRED_DOCS"
                fi
            done
        fi

        if [[ -n "$MISSING_DOCS" ]]; then
            VIOLATIONS="${VIOLATIONS}├─ ❌ LAW #6: Missing required docs in active features\n"
            CORRECTIONS="${CORRECTIONS}$MISSING_DOCS"
            VIOLATION_LAWS="${VIOLATION_LAWS}6,"
        fi
    fi
else
    PASSED="${PASSED}├─ ⏭️  LAW #6: Disabled by team config\n"
fi

# =============================================================================
# IRON LAW #5: Agent Delegation Reminder (informational only)
# =============================================================================
# This is a reminder injected into the prompt, not a violation check
if is_law_enabled "law5_agent_delegation"; then
    AGENT_REMINDER="├─ 📋 LAW #5: Remember to delegate specialized work to agents (Task tool)\n"
else
    AGENT_REMINDER="├─ ⏭️  LAW #5: Disabled by team config\n"
fi

# =============================================================================
# Update workflow state for status line (detect /oss:* commands)
# =============================================================================
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-}"
if [[ -z "$PLUGIN_ROOT" && -f "$HOME/.oss/plugin-root" ]]; then
    PLUGIN_ROOT=$(cat "$HOME/.oss/plugin-root" 2>/dev/null)
fi

USER_INPUT="${CLAUDE_USER_INPUT:-}"
WORKFLOW_STATE_CLI="$PLUGIN_ROOT/watcher/dist/cli/update-workflow-state.js"

# Detect /oss:* commands and update currentCommand for status line
if [[ "$USER_INPUT" == /oss:* && -f "$WORKFLOW_STATE_CLI" ]]; then
    # Extract command name (e.g., "build" from "/oss:build something")
    OSS_CMD=$(echo "$USER_INPUT" | sed -E 's|^/oss:([a-z-]+).*|\1|')

    # Only update for workflow commands (not utility commands like login, queue)
    case "$OSS_CMD" in
        ideate|requirements|api-design|data-model|adr|plan|acceptance|red|mock|green|refactor|integration|contract|build|ship|review|debug|iterate)
            node "$WORKFLOW_STATE_CLI" setCurrentCommand "$OSS_CMD" 2>/dev/null || true
            node "$WORKFLOW_STATE_CLI" setSupervisor watching 2>/dev/null || true
            ;;
    esac
fi

# =============================================================================
# Persist results to log
# =============================================================================

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

# Log hook COMPLETE
if [[ -x "$LOG_SCRIPT" ]]; then
    "$LOG_SCRIPT" hook oss-iron-law-check COMPLETE
fi

exit 0
