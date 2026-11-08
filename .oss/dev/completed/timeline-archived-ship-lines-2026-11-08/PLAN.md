# Plan: timeline-archived-ship-lines

## Task 1: file post-archive lines of every kind in the archived folder
- RED: `hooks/__tests__/timeline-archived.test.sh`.
  - These cases go to `completed/<f>-<date>/timeline.ndjson` and are queued in the outbox: a ship `complete` command line, a gate line (`oss-value.sh timeline gate`) and an agent line (PostToolUse hook).
  - These stay as they were: no archived folder means unfiled, a linked folder means unfiled, a hard-linked timeline file means unfiled, and an existing active folder means active.
- GREEN: in `hooks/oss-timeline.sh`, `if [[ -z "$feature" && (merge|merge-unknown) ]]` becomes `if [[ -z "$feature" ]]`.

## Then
- `/oss:ship` as plugin 2.1.0. Run only the targeted hook tests; never the watcher's full suite.
