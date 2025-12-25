/**
 * Global test setup for vitest
 *
 * Ensures clean state before tests run:
 * 1. Kills any running watcher processes to avoid interference
 * 2. Sets OSS_SKIP_WATCHER=1 to prevent new watchers from spawning
 * 3. Clears ~/.oss/current-project to avoid cross-test pollution
 */
import { beforeAll, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const ossDir = path.join(os.homedir(), '.oss');
const currentProjectFile = path.join(ossDir, 'current-project');

// Set env var to skip watcher spawning in all tests
process.env.OSS_SKIP_WATCHER = '1';

// Ensure the directory exists
fs.mkdirSync(ossDir, { recursive: true });

// Kill any watcher processes at the start of test run
beforeAll(() => {
  try {
    // Kill any node processes running watcher/dist/index.js
    execSync('pkill -f "watcher/dist/index.js" 2>/dev/null || true', { stdio: 'ignore' });
    // Small delay to let processes terminate
    execSync('sleep 0.1', { stdio: 'ignore' });
  } catch {
    // Ignore errors - no watchers running is fine
  }

  // Clear any stale watcher PID files
  const pidPattern = path.join(os.tmpdir(), '**/.oss/watcher.pid');
  try {
    execSync(`find ${os.tmpdir()} -name "watcher.pid" -delete 2>/dev/null || true`, { stdio: 'ignore' });
  } catch {
    // Ignore
  }
});

// Note: We do NOT clear current-project here globally because some tests
// specifically test that file's behavior. Tests that need clean state
// should manage it themselves in their own beforeEach/afterEach hooks.

// Kill any watchers that may have been spawned during tests
afterAll(() => {
  try {
    execSync('pkill -f "watcher/dist/index.js" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {
    // Ignore
  }
});
