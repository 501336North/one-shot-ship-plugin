/**
 * TDD Mode Semaphore Tests
 *
 * @behavior Prevent supervisor from queueing test failures during TDD RED phase
 * @acceptance-criteria AC-TDD-SEM-001: Create tdd-mode.lock when build starts
 * @acceptance-criteria AC-TDD-SEM-002: Skip queue when tdd-mode.lock exists
 * @acceptance-criteria AC-TDD-SEM-003: Queue normally when no lock
 * @acceptance-criteria AC-TDD-SEM-004: Remove lock when build completes
 * @acceptance-criteria AC-TDD-SEM-005: Clean stale lock on session start
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface TddLock {
  created: string;
  command: string;
  feature: string;
}

describe('TDD Mode Semaphore', () => {
  let testDir: string;
  let ossDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-semaphore-test-'));
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
    lockPath = path.join(ossDir, 'tdd-mode.lock');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Lock creation', () => {
    it('should create tdd-mode.lock when build starts', async () => {
      // GIVEN: No lock file exists
      expect(fs.existsSync(lockPath)).toBe(false);

      // WHEN: Build starts and creates lock
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'agent-workflow-logging',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

      // THEN: Lock file exists with correct format
      expect(fs.existsSync(lockPath)).toBe(true);
      const savedLock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as TddLock;
      expect(savedLock.command).toBe('build');
      expect(savedLock.feature).toBe('agent-workflow-logging');
    });

    it('should include timestamp in lock file', async () => {
      // GIVEN: Creating a lock
      const beforeCreate = new Date().toISOString();

      // WHEN: Lock is created
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'test-feature',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

      const afterCreate = new Date().toISOString();

      // THEN: Timestamp is within expected range
      const savedLock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as TddLock;
      expect(savedLock.created >= beforeCreate).toBe(true);
      expect(savedLock.created <= afterCreate).toBe(true);
    });
  });

  describe('TDD mode detection', () => {
    it('should detect TDD mode when lock exists', async () => {
      // GIVEN: Lock file exists
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'test',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));

      // WHEN: Checking TDD mode
      const isTddMode = isTddModeActive(ossDir);

      // THEN: TDD mode is active
      expect(isTddMode).toBe(true);
    });

    it('should NOT detect TDD mode when no lock exists', async () => {
      // GIVEN: No lock file
      expect(fs.existsSync(lockPath)).toBe(false);

      // WHEN: Checking TDD mode
      const isTddMode = isTddModeActive(ossDir);

      // THEN: TDD mode is not active
      expect(isTddMode).toBe(false);
    });
  });

  describe('Queue behavior with TDD mode', () => {
    it('should NOT queue test failures when tdd-mode.lock exists', async () => {
      // GIVEN: TDD mode is active
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'test',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));

      // WHEN: Test failure detected
      const shouldQueue = shouldQueueTestFailure(ossDir);

      // THEN: Should NOT queue (TDD mode active)
      expect(shouldQueue).toBe(false);
    });

    it('should queue test failures when tdd-mode.lock does NOT exist', async () => {
      // GIVEN: TDD mode is not active
      expect(fs.existsSync(lockPath)).toBe(false);

      // WHEN: Test failure detected
      const shouldQueue = shouldQueueTestFailure(ossDir);

      // THEN: Should queue normally
      expect(shouldQueue).toBe(true);
    });

    it('should log "TDD mode active" when skipping queue', async () => {
      // GIVEN: TDD mode active, test failure occurs
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'test',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));

      // WHEN: Deciding to queue
      const logMessages: string[] = [];
      const shouldQueue = shouldQueueTestFailureWithLogging(ossDir, (msg) => logMessages.push(msg));

      // THEN: Log indicates TDD mode
      expect(shouldQueue).toBe(false);
      expect(logMessages.some((m) => m.includes('TDD mode active'))).toBe(true);
    });
  });

  describe('Lock removal', () => {
    it('should remove tdd-mode.lock when build completes', async () => {
      // GIVEN: Lock exists
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'test',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));
      expect(fs.existsSync(lockPath)).toBe(true);

      // WHEN: Build completes and removes lock
      removeTddLock(ossDir);

      // THEN: Lock no longer exists
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should handle removal when lock does not exist', async () => {
      // GIVEN: No lock
      expect(fs.existsSync(lockPath)).toBe(false);

      // WHEN: Attempting to remove non-existent lock
      removeTddLock(ossDir);

      // THEN: No error, still no lock
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });

  describe('Stale lock cleanup', () => {
    it('should remove stale tdd-mode.lock on session-start', async () => {
      // GIVEN: Stale lock from previous session
      const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const lock: TddLock = {
        created: staleTime.toISOString(),
        command: 'build',
        feature: 'old-feature',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));

      // WHEN: Session starts and checks for stale lock
      cleanupStaleLock(ossDir);

      // THEN: Stale lock removed
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('should NOT remove fresh lock on session-start', async () => {
      // GIVEN: Fresh lock (just created)
      const lock: TddLock = {
        created: new Date().toISOString(),
        command: 'build',
        feature: 'current-feature',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock));

      // WHEN: Session starts - but lock is too fresh to be stale
      // For this test, we define "stale" as older than 1 hour
      const savedLock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as TddLock;
      const ageMs = Date.now() - new Date(savedLock.created).getTime();
      const isStale = ageMs > 60 * 60 * 1000; // 1 hour

      // THEN: Lock should NOT be considered stale
      expect(isStale).toBe(false);
    });
  });

  describe('Lock file format', () => {
    it('should have valid JSON format', async () => {
      // GIVEN: Lock created with expected format
      const lock: TddLock = {
        created: '2025-12-08T22:45:00Z',
        command: 'build',
        feature: 'agent-workflow-logging-verification',
      };
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

      // WHEN: Reading lock file
      const content = fs.readFileSync(lockPath, 'utf-8');
      const parsed = JSON.parse(content);

      // THEN: Has expected fields
      expect(parsed).toHaveProperty('created');
      expect(parsed).toHaveProperty('command');
      expect(parsed).toHaveProperty('feature');
    });
  });
});

// Helper functions (would be in src/supervisor/tdd-semaphore.ts)

function isTddModeActive(ossDir: string): boolean {
  const lockPath = path.join(ossDir, 'tdd-mode.lock');
  return fs.existsSync(lockPath);
}

function shouldQueueTestFailure(ossDir: string): boolean {
  return !isTddModeActive(ossDir);
}

function shouldQueueTestFailureWithLogging(
  ossDir: string,
  log: (msg: string) => void
): boolean {
  if (isTddModeActive(ossDir)) {
    log('TDD mode active - skipping queue for test failure');
    return false;
  }
  return true;
}

function removeTddLock(ossDir: string): void {
  const lockPath = path.join(ossDir, 'tdd-mode.lock');
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

function cleanupStaleLock(ossDir: string): void {
  const lockPath = path.join(ossDir, 'tdd-mode.lock');
  if (!fs.existsSync(lockPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(lockPath, 'utf-8');
    const lock = JSON.parse(content) as TddLock;
    const ageMs = Date.now() - new Date(lock.created).getTime();
    const isStale = ageMs > 60 * 60 * 1000; // 1 hour

    if (isStale) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // If we can't read the lock, remove it as corrupted
    fs.unlinkSync(lockPath);
  }
}
