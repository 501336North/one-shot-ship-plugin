# Notes

- `watcher/test/hooks/oss-log-project-local.test.ts` blanks the real `~/.oss/current-project` in beforeEach. Other sessions on this machine resolve their project through hooks that may read that shared pointer, so running this suite can redirect a parallel session. Possibly related to the 2026-10-28 misrouted integration log (AgenticDevWorkflow FOLLOWUPS). Do not copy that pattern.
- Trim grep: `{ head -n "$dropped" | grep 'OSS Command:' || true; }` also masks a failing `head`. Accepted: the next line runs `tail -1000` on the same file, and that failure still stops the `set -e` script. A grep-only tolerance (`|| [[ $? -eq 1 ]]`) would need its own RED test that makes head fail; not worth it here.
- The installed ~/.oss/hooks/oss-log.sh still truncates until this ships, so this session's build.log banner count stays 1 for round 2.
- Load-sensitive / real-~/.oss tests and the dead analyzer pipeline: see FOLLOWUPS.md (2026-10-28).
