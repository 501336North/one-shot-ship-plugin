/**
 * Global vitest setup: each test file runs in a sandbox.
 * - HOME (and so os.homedir()) is a fresh temp dir, set before any test reads it.
 * - The live Claude session (CLAUDE_CODE_SESSION_ID, CLAUDE_PROJECT_DIR) is hidden.
 * - Background watchers and health checks are switched off.
 * It never kills processes or deletes files outside its own temp HOME.
 */
import { afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-test-home-'));
process.env.HOME = testHome;
fs.mkdirSync(path.join(testHome, '.oss'), { mode: 0o700 });

delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CLAUDE_PROJECT_DIR;

process.env.OSS_SKIP_WATCHER = '1';
process.env.OSS_SKIP_HEALTH_CHECK = '1';

afterAll(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});
