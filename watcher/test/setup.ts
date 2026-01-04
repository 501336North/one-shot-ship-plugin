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

// Set env vars to skip background processes in all tests
process.env.OSS_SKIP_WATCHER = '1';
process.env.OSS_SKIP_HEALTH_CHECK = '1';

// Ensure the directory exists
fs.mkdirSync(ossDir, { recursive: true });

// Kill any watcher processes at the start of test run
beforeAll(() => {
  try {
    // Kill any node processes running watcher/dist/index.js
    execSync('pkill -f "watcher/dist/index.js" 2>/dev/null || true', { stdio: 'ignore' });
    // Also kill any stale session-start.sh or health-check processes
    execSync('pkill -f "oss-session-start" 2>/dev/null || true', { stdio: 'ignore' });
    execSync('pkill -f "health-check.js" 2>/dev/null || true', { stdio: 'ignore' });
    // Small delay to let processes terminate
    execSync('sleep 0.2', { stdio: 'ignore' });
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

// Before each test, clear current-project to avoid cross-test pollution
// Each test that needs current-project should set it explicitly
beforeEach(() => {
  // Clear current-project file to ensure clean state
  // Tests that need it will set it in their own beforeEach
  try {
    if (fs.existsSync(currentProjectFile)) {
      fs.unlinkSync(currentProjectFile);
    }
  } catch {
    // Ignore - file might be locked or already deleted
  }
});

// Kill any watchers that may have been spawned during tests
afterAll(() => {
  try {
    execSync('pkill -f "watcher/dist/index.js" 2>/dev/null || true', { stdio: 'ignore' });
  } catch {
    // Ignore
  }
});
