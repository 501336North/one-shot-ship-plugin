#!/bin/bash
# OSS Simple Mode Check - Warns if CLAUDE_CODE_SIMPLE is enabled
# When simple mode is on, hooks/skills/CLAUDE.md are all disabled - OSS cannot function.
# Called from oss-session-start.sh (very top, before any other checks)

if [[ "${CLAUDE_CODE_SIMPLE:-}" == "true" || "${CLAUDE_CODE_SIMPLE:-}" == "1" ]]; then
    echo "OSS: CLAUDE_CODE_SIMPLE is enabled. This disables hooks, skills, and CLAUDE.md — OSS cannot function. Unset it: export CLAUDE_CODE_SIMPLE="
fi

exit 0
