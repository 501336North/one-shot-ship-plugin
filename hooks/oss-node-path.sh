#!/bin/bash
# oss-node-path.sh - SessionStart: records the user's node in ~/.oss/node-path, the only node the gate
# hooks run (security C1). The rules are oss-node.sh's oss_node, the same the first gate hook call uses
# when the record is missing: PATH's node by its stable path (or a version manager's real file), only
# when usable; a usable record is kept, so a node planted on PATH later is never adopted. When a record
# existed, is no longer usable and PATH has a different node, nothing is written and the user is told,
# naming both paths (security HIGH-1). Never blocks the session: exit 0.
set -u

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" 2>/dev/null && pwd)" || exit 0
source "$SCRIPT_DIR/oss-node.sh" 2>/dev/null || exit 0
oss_node && exit 0
if [ "${OSS_NODE_PROBLEM:-}" = changed ]; then
    printf '{"systemMessage":"%s"}\n' "$(oss_json_text "$(oss_node_changed_message)")"
fi
exit 0
