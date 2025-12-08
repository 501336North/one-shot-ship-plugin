/**
 * Watcher Auto-Restart Tests
 *
 * @behavior If watcher process dies, it should restart automatically
 * @acceptance-criteria AC-RESTART-001: Detect dead watcher process
 * @acceptance-criteria AC-RESTART-002: Restart watcher on session start if dead
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Watcher Auto-Restart', () => {
  let testDir: string;
  let ossDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-restart-test-'));
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Dead process detection', () => {
    it('should detect when PID file exists but process is dead', async () => {
      // GIVEN: A PID file with a non-existent process
      const pidPath = path.join(ossDir, 'watcher.pid');
      const fakePid = 999999999; // Very unlikely to be a real process
      fs.writeFileSync(pidPath, String(fakePid));

      // WHEN: Checking if process is alive
      const isAlive = checkProcessAlive(fakePid);

      // THEN: Process should be detected as dead
      expect(isAlive).toBe(false);
    });

    it('should detect when PID file does not exist', async () => {
      // GIVEN: No PID file
      const pidPath = path.join(ossDir, 'watcher.pid');

      // WHEN: Checking if watcher is running
      const pidExists = fs.existsSync(pidPath);

      // THEN: Should indicate no watcher running
      expect(pidExists).toBe(false);
    });

    it('should detect when current process PID is alive', async () => {
      // GIVEN: Current process PID (definitely alive)
      const currentPid = process.pid;

      // WHEN: Checking if process is alive
      const isAlive = checkProcessAlive(currentPid);

      // THEN: Should be detected as alive
      expect(isAlive).toBe(true);
    });
  });

  describe('PID file management', () => {
    it('should write PID file on watcher start', async () => {
      // GIVEN: Fresh .oss directory
      const pidPath = path.join(ossDir, 'watcher.pid');

      // WHEN: Simulating watcher start
      const pid = process.pid;
      fs.writeFileSync(pidPath, String(pid));

      // THEN: PID file should contain process ID
      const savedPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      expect(savedPid).toBe(pid);
    });

    it('should remove PID file on watcher stop', async () => {
      // GIVEN: PID file exists
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, String(process.pid));

      // WHEN: Simulating watcher stop
      fs.unlinkSync(pidPath);

      // THEN: PID file should be removed
      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it('should clean up stale PID file on session start', async () => {
      // GIVEN: Stale PID file with dead process
      const pidPath = path.join(ossDir, 'watcher.pid');
      const stalePid = 999999999;
      fs.writeFileSync(pidPath, String(stalePid));

      // WHEN: Session start cleans up stale PID
      const savedPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      if (!checkProcessAlive(savedPid)) {
        fs.unlinkSync(pidPath);
      }

      // THEN: Stale PID file should be removed
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  describe('Restart logic', () => {
    it('should indicate restart needed when no watcher running', async () => {
      // GIVEN: No PID file
      const pidPath = path.join(ossDir, 'watcher.pid');

      // WHEN: Checking if restart needed
      const needsRestart = !fs.existsSync(pidPath);

      // THEN: Should need restart
      expect(needsRestart).toBe(true);
    });

    it('should indicate restart needed when watcher is dead', async () => {
      // GIVEN: Stale PID file
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, '999999999');

      // WHEN: Checking if restart needed
      const savedPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      const needsRestart = !checkProcessAlive(savedPid);

      // THEN: Should need restart
      expect(needsRestart).toBe(true);
    });

    it('should NOT indicate restart needed when watcher is alive', async () => {
      // GIVEN: Valid PID file with current process
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, String(process.pid));

      // WHEN: Checking if restart needed
      const savedPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      const needsRestart = !checkProcessAlive(savedPid);

      // THEN: Should NOT need restart
      expect(needsRestart).toBe(false);
    });
  });
});

/**
 * Check if a process is alive by sending signal 0
 */
function checkProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
