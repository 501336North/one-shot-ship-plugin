#!/usr/bin/env node
/**
 * Health Check CLI
 *
 * Runs npm test and queues any failing tests to the watcher queue.
 * Called by session-start hook to catch pre-existing issues.
 *
 * Usage:
 *   node health-check.js [--quiet] [--verbose]
 *
 * Exit codes:
 *   0 - All tests passing
 *   1 - Tests failing (tasks queued)
 *   2 - Error running tests
 */
export {};
//# sourceMappingURL=health-check.d.ts.map