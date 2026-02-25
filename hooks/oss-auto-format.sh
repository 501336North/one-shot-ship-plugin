#!/bin/bash
#
# oss-auto-format.sh
# PostToolUse hook: auto-formats code after Write/Edit operations.
#
# Environment:
#   OSS_AUTO_FORMAT=false  - disables auto-formatting
#
# Behavior:
#   - Detects project formatter via oss-detect-formatter.sh
#   - Runs the formatter (swallows errors)
#   - Always exits 0 (formatting must never block edits)

set -euo pipefail

# Check if auto-formatting is disabled
if [[ "${OSS_AUTO_FORMAT:-}" == "false" ]]; then
    exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DETECT_SCRIPT="$SCRIPT_DIR/oss-detect-formatter.sh"

# Detect the formatter
formatter=""
if [[ -f "$DETECT_SCRIPT" ]]; then
    formatter=$("$DETECT_SCRIPT" 2>/dev/null) || true
fi

# If no formatter detected, nothing to do
if [[ -z "$formatter" ]]; then
    exit 0
fi

# Run the formatter (swallow errors - formatting must never block edits)
echo "Auto-formatting with: $formatter" >&2
case "$formatter" in
    prettier)
        npx prettier --write . 2>/dev/null || true
        ;;
    biome)
        npx biome format --write . 2>/dev/null || true
        ;;
    gofmt)
        gofmt -w . 2>/dev/null || true
        ;;
    black)
        black . 2>/dev/null || true
        ;;
    rustfmt)
        cargo fmt 2>/dev/null || true
        ;;
    *)
        # package.json format script or unknown - try npm run format
        npm run format 2>/dev/null || true
        ;;
esac

exit 0
