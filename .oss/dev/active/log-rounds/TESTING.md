# Testing: Command logs keep every round

## Strategy
Vitest exec tests in watcher/test/hooks against the real hooks/oss-log.sh and hooks/oss-log-analyzer.sh, temp project via CLAUDE_PROJECT_DIR and temp HOME; never write the real ~/.oss/current-project (the existing oss-log-project-local test does: see NOTES).

## Results
- none yet

## Last Updated: 2026-10-28 14:30 CST by orchestrator
