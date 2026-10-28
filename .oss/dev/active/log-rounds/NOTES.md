# Notes

- `watcher/test/hooks/oss-log-project-local.test.ts` blanks the real `~/.oss/current-project` in beforeEach. Other sessions on this machine resolve their project through hooks that may read that shared pointer, so running this suite can redirect a parallel session. Possibly related to the 2026-10-28 misrouted integration log (AgenticDevWorkflow FOLLOWUPS). Do not copy that pattern.
