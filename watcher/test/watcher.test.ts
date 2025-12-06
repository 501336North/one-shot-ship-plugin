import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Watcher, WatcherState } from '../src/index';

/**
 * @behavior Watcher process starts automatically and monitors continuously
 * @acceptance-criteria AC-001.1, AC-001.2, AC-001.3, AC-001.4, AC-001.5
 */
describe('Watcher Process', () => {
  let testDir: string;
  let ossDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `oss-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // AC-001.4: PID file created at .oss/watcher.pid
  describe('PID file management', () => {
    it('should create PID file on start', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const pidPath = path.join(ossDir, 'watcher.pid');
      expect(fs.existsSync(pidPath)).toBe(true);

      await watcher.stop();
    });

    it('should write process ID to PID file', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const pidPath = path.join(ossDir, 'watcher.pid');
      const pidContent = fs.readFileSync(pidPath, 'utf-8');
      const pid = parseInt(pidContent, 10);

      expect(pid).toBeGreaterThan(0);

      await watcher.stop();
    });

    it('should remove PID file on stop', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();
      await watcher.stop();

      const pidPath = path.join(ossDir, 'watcher.pid');
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  // AC-001.2: Only one watcher instance runs (singleton)
  describe('singleton enforcement', () => {
    it('should detect if another watcher is running', async () => {
      // Create fake PID file with current process (simulating running watcher)
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, process.pid.toString());

      const watcher = new Watcher(ossDir, 'test-api-key');
      const isRunning = await watcher.isAnotherWatcherRunning();

      expect(isRunning).toBe(true);
    });

    it('should detect stale PID file', async () => {
      // Create PID file with non-existent process
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, '999999999'); // Unlikely to be a real process

      const watcher = new Watcher(ossDir, 'test-api-key');
      const isRunning = await watcher.isAnotherWatcherRunning();

      expect(isRunning).toBe(false);
    });

    it('should clean up stale PID file', async () => {
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, '999999999');

      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.cleanupStalePidFile();

      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it('should not start if another watcher running', async () => {
      // Create PID file with current process
      const pidPath = path.join(ossDir, 'watcher.pid');
      fs.writeFileSync(pidPath, process.pid.toString());

      const watcher = new Watcher(ossDir, 'test-api-key');
      const started = await watcher.start();

      expect(started).toBe(false);
    });
  });

  // AC-001.5: Watcher logs to .oss/watcher.log
  describe('logging', () => {
    it('should create log file', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const logPath = path.join(ossDir, 'watcher.log');
      expect(fs.existsSync(logPath)).toBe(true);

      await watcher.stop();
    });

    it('should write startup message to log', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const logPath = path.join(ossDir, 'watcher.log');
      const logContent = fs.readFileSync(logPath, 'utf-8');

      expect(logContent).toContain('Watcher started');

      await watcher.stop();
    });

    it('should write shutdown message to log', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();
      await watcher.stop();

      const logPath = path.join(ossDir, 'watcher.log');
      const logContent = fs.readFileSync(logPath, 'utf-8');

      expect(logContent).toContain('Watcher stopped');
    });
  });

  // Watcher state
  describe('state management', () => {
    it('should report running state after start', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      expect(watcher.getState()).toBe(WatcherState.Running);

      await watcher.stop();
    });

    it('should report stopped state after stop', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();
      await watcher.stop();

      expect(watcher.getState()).toBe(WatcherState.Stopped);
    });

    it('should report idle state initially', () => {
      const watcher = new Watcher(ossDir, 'test-api-key');

      expect(watcher.getState()).toBe(WatcherState.Idle);
    });
  });

  // Queue integration
  describe('queue integration', () => {
    it('should initialize queue manager on start', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      const queuePath = path.join(ossDir, 'queue.json');
      expect(fs.existsSync(queuePath)).toBe(true);

      await watcher.stop();
    });
  });

  // Config management
  describe('configuration', () => {
    it('should use default config when no config file exists', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      const config = await watcher.loadConfig();

      expect(config.enabled).toBe(true);
      expect(config.monitors.logs).toBe(true);
      expect(config.monitors.tests).toBe(true);
      expect(config.monitors.git).toBe(true);
    });

    it('should load custom config from file', async () => {
      const customConfig = {
        version: '1.0',
        enabled: true,
        monitors: { logs: true, tests: false, git: false },
        loop_detection_threshold: 10,
        stuck_timeout_seconds: 120,
        task_expiry_hours: 48,
        max_queue_size: 100,
        use_llm_analysis: false,
        llm_confidence_threshold: 0.9,
      };
      fs.writeFileSync(path.join(ossDir, 'config.json'), JSON.stringify(customConfig));

      const watcher = new Watcher(ossDir, 'test-api-key');
      const config = await watcher.loadConfig();

      expect(config.monitors.tests).toBe(false);
      expect(config.loop_detection_threshold).toBe(10);
    });
  });

  // Graceful shutdown
  describe('graceful shutdown', () => {
    it('should stop cleanly', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();

      // Should not throw
      await expect(watcher.stop()).resolves.not.toThrow();
    });

    it('should handle multiple stop calls', async () => {
      const watcher = new Watcher(ossDir, 'test-api-key');
      await watcher.start();
      await watcher.stop();

      // Second stop should be safe
      await expect(watcher.stop()).resolves.not.toThrow();
    });
  });
});
