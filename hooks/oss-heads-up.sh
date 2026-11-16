#!/bin/sh
# OSS heads-up hook: relays Claude Code's built-in heads-up for this session to the agent, once, so it can check it
# and tell the user. Runs the pinned copy of https://github.com/501336North/heads-up (hooks/heads-up/, see
# VENDORED.json; never edit it here, re-vendor with scripts/vendor-heads-up.sh).
# Triggered on: UserPromptSubmit, PostToolUse (every tool).
#
# Starts node only when there is a store to read: HEADS_UP_STORE, or the built-in's store file under
# ~/.claude/plugins/store. Without Claude Code's built-in heads-ups this exits at once, so it costs ~nothing.
for f in "${HEADS_UP_STORE:-}" "$HOME"/.claude/plugins/store/cc-plugin-you-should-know_builtin-*.json; do
    [ -n "$f" ] && [ -e "$f" ] && exec node "$(dirname "$0")/heads-up/heads-up.mjs"
done
exit 0
