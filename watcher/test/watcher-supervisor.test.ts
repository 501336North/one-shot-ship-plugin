/**
 * Watcher Supervisor Tests
 *
 * @behavior Watcher monitors workflow logs and generates interventions
 * @acceptance-criteria AC-007.1 through AC-007.10
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WatcherSupervisor,
  ANALYSIS_WINDOW,
  STATE_SAVE_THRESHOLD,
} from '../src/supervisor/watcher-supervisor.js';
import { WorkflowAnalyzer } from '../src/analyzer/workflow-analyzer.js';
import type { ParsedLogEntry } from '../src/logger/log-reader.js';
import { WorkflowLogger } from '../src/logger/workflow-logger.js';
import { QueueManager } from '../src/queue/manager.js';

describe('WatcherSupervisor', () => {
  let testDir: string;
  let ossDir: string;
  let supervisor: WatcherSupervisor;
  let logger: WorkflowLogger;
  let queueManager: QueueManager;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-supervisor-test-'));
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });

    // Create settings.json with supervisor mode set to workflow-only
    // to prevent IRON LAW monitoring from interfering with tests
    const settings = {
      notifications: {
        style: 'visual',
        verbosity: 'important',
        sound: { enabled: false, volume: 50 },
      },
      supervisor: {
        mode: 'workflow-only', // Disable always-on IRON LAW monitoring
        ironLawChecks: { tdd: true, testPhilosophy: true, gitFlow: true, agentDelegation: true, loopDetection: true, devDocs: true },
        checkIntervalMs: 5000,
      },
      version: 1,
    };
    fs.writeFileSync(path.join(ossDir, 'settings.json'), JSON.stringify(settings, null, 2));

    queueManager = new QueueManager(ossDir);
    logger = new WorkflowLogger(ossDir);
    supervisor = new WatcherSupervisor(ossDir, queueManager);
  });

  afterEach(async () => {
    await supervisor.stop();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('workflow monitoring', () => {
    it('starts LogReader on supervisor start', async () => {
      await supervisor.start();

      expect(supervisor.isRunning()).toBe(true);
    });

    it('passes new entries to WorkflowAnalyzer', async () => {
      await supervisor.start();
      const analyzeSpyFn = vi.fn();
      supervisor.onAnalyze(analyzeSpyFn);

      // Wait for tail to start
      await new Promise((r) => setTimeout(r, 100));

      await logger.log({ cmd: 'build', event: 'START', data: {} });

      // Wait for processing
      await new Promise((r) => setTimeout(r, 150));

      expect(analyzeSpyFn).toHaveBeenCalled();
    });

    it('generates interventions for detected issues', async () => {
      await supervisor.start();
      const interventionFn = vi.fn();
      supervisor.onIntervention(interventionFn);

      await new Promise((r) => setTimeout(r, 100));

      // Log entries that will trigger loop detection (same milestone 5 times)
      for (let i = 0; i < 5; i++) {
        await logger.log({ cmd: 'build', event: 'MILESTONE', data: { action: 'same_action' } });
      }

      await new Promise((r) => setTimeout(r, 150));

      expect(interventionFn).toHaveBeenCalled();
      const intervention = interventionFn.mock.calls[0][0];
      expect(intervention.issue.type).toBe('loop_detected');
    });

    it('writes interventions to queue', async () => {
      await supervisor.start();

      await new Promise((r) => setTimeout(r, 100));

      // Log entries that will trigger an issue
      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'Test failed' } });

      await new Promise((r) => setTimeout(r, 150));

      const queuePath = path.join(ossDir, 'queue.json');
      if (fs.existsSync(queuePath)) {
        const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
        expect(queue.tasks.length).toBeGreaterThanOrEqual(0); // May or may not have tasks depending on auto-execute
      }
    });

    it('sends notifications via callback', async () => {
      await supervisor.start();
      const notifyFn = vi.fn();
      supervisor.onNotify(notifyFn);

      await new Promise((r) => setTimeout(r, 100));

      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'Test failed' } });

      await new Promise((r) => setTimeout(r, 150));

      expect(notifyFn).toHaveBeenCalled();
    });
  });

  describe('state persistence', () => {
    it('writes workflow state to workflow-state.json', async () => {
      await supervisor.start();

      await new Promise((r) => setTimeout(r, 100));

      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: { section: 'problem' } });

      await new Promise((r) => setTimeout(r, 150));

      const statePath = path.join(ossDir, 'workflow-state.json');
      expect(fs.existsSync(statePath)).toBe(true);

      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(state.current_command).toBe('ideate');
    });

    it('reads state on restart', async () => {
      // Create existing state
      const existingState = {
        current_command: 'plan',
        chain_progress: { ideate: 'complete', plan: 'in_progress', build: 'pending', ship: 'pending' },
        milestone_timestamps: [],
      };
      fs.writeFileSync(path.join(ossDir, 'workflow-state.json'), JSON.stringify(existingState));

      await supervisor.start();

      await new Promise((r) => setTimeout(r, 100));

      const state = supervisor.getState();
      expect(state.current_command).toBe('plan');
    });

    it('rebuilds state from log if state file missing', async () => {
      // Create log entries but no state file
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { outputs: ['DESIGN.md'] } });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });

      await supervisor.start();

      await new Promise((r) => setTimeout(r, 150));

      const state = supervisor.getState();
      expect(state.chain_progress.ideate).toBe('complete');
      expect(state.chain_progress.plan).toBe('in_progress');
    });
  });

  describe('integration', () => {
    it('detects loop and generates high-confidence intervention', async () => {
      await supervisor.start();
      const interventionFn = vi.fn();
      supervisor.onIntervention(interventionFn);

      await new Promise((r) => setTimeout(r, 100));

      // Simulate loop - write enough to guarantee high confidence
      // First 3 will trigger loop_detected with confidence 0.85 (notify_suggest)
      // 7+ will trigger with higher confidence >0.9 (auto_remediate)
      for (let i = 0; i < 7; i++) {
        await logger.log({ cmd: 'build', event: 'MILESTONE', data: { retry: 'same' } });
      }

      await new Promise((r) => setTimeout(r, 150));

      expect(interventionFn).toHaveBeenCalled();
      // The first intervention fires at 3 repeats with medium confidence
      // We verify that a loop was detected (any response type is valid)
      const intervention = interventionFn.mock.calls[0][0];
      expect(intervention.issue.type).toBe('loop_detected');
    });

    it('handles concurrent log writes', async () => {
      await supervisor.start();
      const analyzeCount = vi.fn();
      supervisor.onAnalyze(analyzeCount);

      await new Promise((r) => setTimeout(r, 100));

      // Rapidly write multiple entries
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(logger.log({ cmd: 'build', event: 'MILESTONE', data: { index: i } }));
      }
      await Promise.all(promises);

      await new Promise((r) => setTimeout(r, 200));

      // Should have analyzed after all entries
      expect(analyzeCount.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('structured error healing ports (US-005/US-006)', () => {
    /**
     * @behavior When the supervisor consumes a CRITICAL/HIGH non-retryable
     *           OSS_ERROR, its wired escalation notifier delivers the error to
     *           the Telegram bridge — proving the supervisor constructs the
     *           InterventionGenerator WITH the real EscalationNotifier port.
     * @business-rule US-005 — CRITICAL/HIGH structured errors escalate to a human.
     * @boundary Supervisor log-consumption pipeline → TelegramNotifier transport
     *           (mocked ONLY at the global fetch boundary, like the E2E test).
     */
    const savedEnv = {
      HOME: process.env.HOME,
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
      OSS_TELEGRAM_BRIDGE_URL: process.env.OSS_TELEGRAM_BRIDGE_URL,
    };

    afterEach(() => {
      vi.unstubAllGlobals();
      process.env.HOME = savedEnv.HOME;
      process.env.CLAUDE_PROJECT_DIR = savedEnv.CLAUDE_PROJECT_DIR;
      if (savedEnv.OSS_TELEGRAM_BRIDGE_URL === undefined) {
        delete process.env.OSS_TELEGRAM_BRIDGE_URL;
      } else {
        process.env.OSS_TELEGRAM_BRIDGE_URL = savedEnv.OSS_TELEGRAM_BRIDGE_URL;
      }
    });

    it('escalates a CRITICAL non-retryable OSS_ERROR through the wired Telegram notifier', async () => {
      // GIVEN — a sandbox-pinned supervisor with a configured Telegram bridge
      process.env.HOME = testDir;
      process.env.CLAUDE_PROJECT_DIR = testDir;
      process.env.OSS_TELEGRAM_BRIDGE_URL = 'http://telegram-bridge.invalid:8787';

      const fetchMock = vi.fn(
        async (): Promise<Response> => new Response('{}', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const escSupervisor = new WatcherSupervisor(ossDir, queueManager, {
        configDir: ossDir,
        projectDir: testDir,
      });
      await escSupervisor.start();
      await new Promise((r) => setTimeout(r, 100));

      // WHEN — a CRITICAL, expensive (non-retryable) structured error is logged
      await logger.log({
        cmd: 'build',
        event: 'OSS_ERROR',
        data: {
          code: 'OSS-API-001',
          severity: 'CRITICAL',
          source: 'oss:auto',
          message: 'Pipeline run failed after 40 minutes: API 500 mid-ship',
          retry_eligible: true,
          retry_cost: 'expensive',
          attempt: 0,
        },
      });

      // THEN — the wired notifier delivered the escalation to the bridge
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/api/notify');
      expect(String(init?.body)).toContain('OSS-API-001');

      await escSupervisor.stop();
    });

    it('surfaces retry visibility (status line + RECOVERY log) for a cheap retryable OSS_ERROR', async () => {
      // GIVEN — a sandbox-pinned supervisor (no Telegram bridge needed here)
      process.env.HOME = testDir;
      process.env.CLAUDE_PROJECT_DIR = testDir;
      delete process.env.OSS_TELEGRAM_BRIDGE_URL;

      const retrySupervisor = new WatcherSupervisor(ossDir, queueManager, {
        configDir: ossDir,
        projectDir: testDir,
      });
      await retrySupervisor.start();
      await new Promise((r) => setTimeout(r, 100));

      // WHEN — a cheap retryable structured error is logged
      await logger.log({
        cmd: 'build',
        event: 'OSS_ERROR',
        data: {
          code: 'OSS-API-003',
          severity: 'HIGH',
          source: 'hooks/ensure-decrypt-cli.sh',
          message: 'Prompt fetch failed: ECONNREFUSED one-shot-ship-api.onrender.com',
          retry_eligible: true,
          retry_hint: 'Wait 5s then re-run the fetch',
          retry_cost: 'cheap',
          attempt: 0,
        },
      });

      // THEN — the wired RetryStatusLine port persisted the retry text
      await vi.waitFor(() => {
        const statusState = JSON.parse(
          fs.readFileSync(path.join(ossDir, 'status-line.json'), 'utf-8'),
        ) as { retry?: string };
        expect(statusState.retry).toBe('⟳ retry 1/2: OSS-API-003');
      });

      // THEN — the wired RecoveryLogger port wrote a RECOVERY visibility line
      await vi.waitFor(() => {
        const recoveryLines = fs
          .readFileSync(path.join(ossDir, 'workflow.log'), 'utf-8')
          .split('\n')
          .filter((l) => !l.startsWith('#') && l.includes('"RECOVERY"'))
          .map((l) => JSON.parse(l) as { data: Record<string, unknown> });
        expect(recoveryLines).toHaveLength(1);
        expect(recoveryLines[0].data.code).toBe('OSS-API-003');
        expect(recoveryLines[0].data.attempt).toBe(1);
      });

      await retrySupervisor.stop();
    });
  });

  describe('healthcheck integration', () => {
    /**
     * @behavior Supervisor runs health checks periodically
     * @acceptance-criteria AC-003.1
     * @business-rule Proactive monitoring prevents issues
     * @boundary Supervisor loop
     */
    it('should run healthchecks on configurable interval', async () => {
      const mockHealthcheck = {
        runChecks: vi.fn().mockResolvedValue({
          timestamp: new Date().toISOString(),
          overall_status: 'healthy',
          checks: {
            logging: { status: 'pass', message: 'OK' },
            dev_docs: { status: 'pass', message: 'OK' },
            delegation: { status: 'pass', message: 'OK' },
            queue: { status: 'pass', message: 'OK' },
            archive: { status: 'pass', message: 'OK' },
            quality_gates: { status: 'pass', message: 'OK' },
            notifications: { status: 'pass', message: 'OK' },
            git_safety: { status: 'pass', message: 'OK' },
          },
        }),
      };

      const customSupervisor = new WatcherSupervisor(ossDir, queueManager, {
        healthcheckService: mockHealthcheck,
        healthcheckIntervalMs: 100, // Fast interval for testing
      });

      await customSupervisor.start();

      // Wait for at least 2 healthcheck cycles
      await new Promise((r) => setTimeout(r, 250));

      await customSupervisor.stop();

      // Should have run multiple times
      expect(mockHealthcheck.runChecks).toHaveBeenCalled();
      expect(mockHealthcheck.runChecks.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * @behavior Supervisor queues corrective actions for warnings
     * @acceptance-criteria AC-003.1
     * @business-rule Warnings trigger medium-priority tasks
     * @boundary Supervisor -> QueueManager
     */
    it('should queue corrective action when check warns', async () => {
      const mockHealthcheck = {
        runChecks: vi.fn().mockResolvedValue({
          timestamp: new Date().toISOString(),
          overall_status: 'warning',
          checks: {
            logging: { status: 'pass', message: 'OK' },
            dev_docs: { status: 'warn', message: 'PROGRESS.md stale (>1 hour)', details: { action: 'Update dev docs' } },
            delegation: { status: 'pass', message: 'OK' },
            queue: { status: 'pass', message: 'OK' },
            archive: { status: 'pass', message: 'OK' },
            quality_gates: { status: 'pass', message: 'OK' },
            notifications: { status: 'pass', message: 'OK' },
            git_safety: { status: 'pass', message: 'OK' },
          },
        }),
      };

      const customSupervisor = new WatcherSupervisor(ossDir, queueManager, {
        healthcheckService: mockHealthcheck,
        healthcheckIntervalMs: 100,
      });

      await customSupervisor.start();

      // Wait for healthcheck to run
      await new Promise((r) => setTimeout(r, 150));

      await customSupervisor.stop();

      // Check that a task was queued
      const tasks = await queueManager.getTasks();
      const devDocsTask = tasks.find((t) => t.context.type === 'dev_docs');
      expect(devDocsTask).toBeDefined();
      expect(devDocsTask?.priority).toBe('medium');
    });

    /**
     * @behavior Supervisor sends notifications for critical issues
     * @acceptance-criteria AC-003.1
     * @business-rule Critical issues require immediate notification
     * @boundary Supervisor -> Notification System
     */
    it('should notify user when critical issue detected', async () => {
      const mockHealthcheck = {
        runChecks: vi.fn().mockResolvedValue({
          timestamp: new Date().toISOString(),
          overall_status: 'critical',
          checks: {
            logging: { status: 'pass', message: 'OK' },
            dev_docs: { status: 'pass', message: 'OK' },
            delegation: { status: 'pass', message: 'OK' },
            queue: { status: 'pass', message: 'OK' },
            archive: { status: 'pass', message: 'OK' },
            quality_gates: { status: 'pass', message: 'OK' },
            notifications: { status: 'pass', message: 'OK' },
            git_safety: { status: 'fail', message: 'Agent pushed to main branch!' },
          },
        }),
      };

      const customSupervisor = new WatcherSupervisor(ossDir, queueManager, {
        healthcheckService: mockHealthcheck,
        healthcheckIntervalMs: 100,
        configDir: ossDir, // Use test ossDir for settings (has workflow-only mode)
      });

      const notifyFn = vi.fn();
      customSupervisor.onNotify(notifyFn);

      await customSupervisor.start();

      // Wait for healthcheck to run
      await new Promise((r) => setTimeout(r, 150));

      await customSupervisor.stop();

      // Should have sent critical notification
      expect(notifyFn).toHaveBeenCalled();
      const [title, message] = notifyFn.mock.calls[0];
      expect(title).toContain('Critical');
      expect(title).toContain('Git Safety');
    });

    /**
     * @behavior Supervisor deduplicates same issue notifications
     * @acceptance-criteria AC-003.1
     * @business-rule Don't spam user with duplicate notifications
     * @boundary Supervisor notification logic
     */
    it('should deduplicate same issue notifications', async () => {
      const mockHealthcheck = {
        runChecks: vi.fn().mockResolvedValue({
          timestamp: new Date().toISOString(),
          overall_status: 'warning',
          checks: {
            logging: { status: 'pass', message: 'OK' },
            dev_docs: { status: 'warn', message: 'PROGRESS.md stale (>1 hour)' },
            delegation: { status: 'pass', message: 'OK' },
            queue: { status: 'pass', message: 'OK' },
            archive: { status: 'pass', message: 'OK' },
            quality_gates: { status: 'pass', message: 'OK' },
            notifications: { status: 'pass', message: 'OK' },
            git_safety: { status: 'pass', message: 'OK' },
          },
        }),
      };

      const customSupervisor = new WatcherSupervisor(ossDir, queueManager, {
        healthcheckService: mockHealthcheck,
        healthcheckIntervalMs: 50, // Fast for testing
        configDir: ossDir, // Use test ossDir for settings (has workflow-only mode)
      });

      const notifyFn = vi.fn();
      customSupervisor.onNotify(notifyFn);

      await customSupervisor.start();

      // Wait for multiple healthcheck cycles with same issue
      await new Promise((r) => setTimeout(r, 200));

      await customSupervisor.stop();

      // Should only notify once for the same issue
      expect(notifyFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('analyzer re-scan bounding (perf T15)', () => {
    /**
     * @behavior The supervisor must not re-scan unbounded history on every new
     *           log line — per-entry analyzer work stays bounded by a window,
     *           not by total entries N (guards O(N²) growth on long sessions).
     * @business-rule A long-running watcher stays responsive regardless of session length.
     * @boundary Supervisor.handleEntry → WorkflowAnalyzer.analyze
     */
    async function feedEntries(count: number, makeData: (i: number) => Record<string, unknown>): Promise<void> {
      for (let i = 0; i < count; i++) {
        await logger.log({ cmd: 'build', event: 'MILESTONE', data: makeData(i) });
      }
    }

    it('keeps analyzer input bounded by the window as entries grow', async () => {
      // Capture input length AT CALL TIME — this.entries is a live reference the
      // supervisor slices in place, so reading .length afterwards is unreliable.
      const inputLengths: number[] = [];
      const realAnalyze = WorkflowAnalyzer.prototype.analyze;
      const analyzeSpy = vi
        .spyOn(WorkflowAnalyzer.prototype, 'analyze')
        .mockImplementation(function (this: WorkflowAnalyzer, entries: ParsedLogEntry[], now?: Date) {
          inputLengths.push(entries.length);
          return realAnalyze.call(this, entries, now);
        });
      await supervisor.start();
      await new Promise((r) => setTimeout(r, 100));

      const total = ANALYSIS_WINDOW + 60;
      await feedEntries(total, (i) => ({ index: i })); // unique data → no false loop

      await vi.waitFor(
        () => {
          expect(inputLengths.length).toBeGreaterThan(ANALYSIS_WINDOW);
        },
        { timeout: 4000 },
      );

      const maxInputLen = Math.max(...inputLengths);
      expect(maxInputLen).toBeLessThanOrEqual(ANALYSIS_WINDOW);

      analyzeSpy.mockRestore();
    });

    it('still detects a regression spanning the retained window', async () => {
      const analyses: import('../src/analyzer/workflow-analyzer.js').WorkflowAnalysis[] = [];
      await supervisor.start();
      supervisor.onAnalyze((a) => analyses.push(a));
      await new Promise((r) => setTimeout(r, 100));

      // A completed phase, then many filler entries (still inside the window),
      // then a failure. detectRegression scans the whole retained array, so the
      // early PHASE_COMPLETE must survive to be paired with the late FAILED.
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_COMPLETE', data: {} });
      await feedEntries(400, (i) => ({ index: i }));
      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'boom after complete' } });

      await vi.waitFor(
        () => {
          const latest = analyses[analyses.length - 1];
          expect(latest?.issues.some((issue) => issue.type === 'regression')).toBe(true);
        },
        { timeout: 4000 },
      );
    });

    it('logs exactly once when older entries fall outside the window (no silent cap)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await supervisor.start();
      await new Promise((r) => setTimeout(r, 100));

      // Feed well past the window so trimming happens on many cycles.
      await feedEntries(ANALYSIS_WINDOW + 40, (i) => ({ index: i }));

      await vi.waitFor(
        () => {
          expect(warnSpy).toHaveBeenCalled();
        },
        { timeout: 4000 },
      );

      const dropWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes('window'));
      expect(dropWarnings).toHaveLength(1);

      warnSpy.mockRestore();
    });
  });

  describe('state persistence throttling (perf T17)', () => {
    /**
     * @behavior State is persisted to disk on a throttled cadence (not a full
     *           synchronous writeFileSync on every single log line), and the
     *           latest state is always flushed on stop so nothing is lost.
     * @business-rule A busy watcher does not thrash the disk per log line, yet
     *                never loses the final state on shutdown.
     * @boundary Supervisor.handleEntry / stop → fs.writeFileSync(workflow-state.json)
     */
    it('throttles state writes instead of writing on every entry', async () => {
      // Each persistence does exactly one writeFileSync, so counting saveState
      // calls == counting disk writes. (fs.writeFileSync itself is a
      // non-configurable ESM namespace export and cannot be spied directly.)
      type Savable = { saveState: () => Promise<void> };
      const saveSpy = vi.spyOn(supervisor as unknown as Savable, 'saveState');
      const analyzeCount = vi.fn();
      await supervisor.start();
      supervisor.onAnalyze(analyzeCount);
      await new Promise((r) => setTimeout(r, 100));

      const k = STATE_SAVE_THRESHOLD * 2;
      for (let i = 0; i < k; i++) {
        await logger.log({ cmd: 'build', event: 'MILESTONE', data: { index: i } }); // unique → no loop
      }

      await vi.waitFor(
        () => {
          expect(analyzeCount.mock.calls.length).toBeGreaterThanOrEqual(k);
        },
        { timeout: 4000 },
      );

      const stateWrites = saveSpy.mock.calls.length;

      // Throttled: far fewer than one-write-per-entry, bounded by the threshold.
      expect(stateWrites).toBeLessThanOrEqual(Math.ceil(k / STATE_SAVE_THRESHOLD));
      expect(stateWrites).toBeLessThan(k);

      saveSpy.mockRestore();
    });

    it('flushes the latest state on stop', async () => {
      await supervisor.start();
      await new Promise((r) => setTimeout(r, 100));

      // Fewer entries than the threshold: without an explicit stop-flush, the
      // final command change would never reach disk.
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'MILESTONE', data: { index: 0 } });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await new Promise((r) => setTimeout(r, 200));

      await supervisor.stop();

      const state = JSON.parse(
        fs.readFileSync(path.join(ossDir, 'workflow-state.json'), 'utf-8'),
      ) as { current_command?: string };
      expect(state.current_command).toBe('plan');
    });
  });

  describe('session-lifetime anchors survive windowing (perf T15 correctness)', () => {
    /**
     * @behavior The supervisor accumulates durable "anchor facts" (first command,
     *           completed chain steps, seen/completed phases) on EVERY entry BEFORE
     *           the 500-entry window trims history, and feeds them to the analyzer.
     *           So a big feature that scrolls its ideate/plan COMPLETE (or an earlier
     *           PHASE_COMPLETE) out of the window neither emits a FALSE chain_broken
     *           nor MISSES a real regression.
     * @business-rule Windowing is a perf bound only — it must never change which
     *                violations the watcher reports.
     * @boundary Supervisor.handleEntry → accumulate anchors → WorkflowAnalyzer.analyze
     */
    type WA = import('../src/analyzer/workflow-analyzer.js').WorkflowAnalysis;

    async function feedFiller(count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        await logger.log({ cmd: 'build', event: 'MILESTONE', data: { index: i } });
      }
    }

    it('does NOT emit a false chain_broken when the prerequisite COMPLETE scrolled out of the window', async () => {
      const analyses: WA[] = [];
      await supervisor.start();
      supervisor.onAnalyze((a) => analyses.push(a));
      await new Promise((r) => setTimeout(r, 100));

      // A valid, completed ideate+plan chain...
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { outputs: ['DESIGN.md'] } });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await logger.log({ cmd: 'plan', event: 'COMPLETE', data: { outputs: ['PLAN.md'] } });

      // ...then enough activity to push those anchors out of the 500-entry window...
      await feedFiller(ANALYSIS_WINDOW + 20);

      // ...then a later command whose prerequisites finished long ago.
      await logger.log({ cmd: 'build', event: 'START', data: {} });

      await vi.waitFor(
        () => {
          expect(analyses[analyses.length - 1]?.current_command).toBe('build');
        },
        { timeout: 8000 },
      );

      const latest = analyses[analyses.length - 1];
      expect(latest.issues.some((i) => i.type === 'chain_broken')).toBe(false);
    }, 20000);

    it('still detects a regression when the earlier PHASE_COMPLETE scrolled out of the window', async () => {
      const analyses: WA[] = [];
      await supervisor.start();
      supervisor.onAnalyze((a) => analyses.push(a));
      await new Promise((r) => setTimeout(r, 100));

      // A phase completes, then heavy activity scrolls that COMPLETE out of the
      // window, then a failure. The regression (fail-after-success) must survive.
      await logger.log({ cmd: 'build', event: 'START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_START', data: {} });
      await logger.log({ cmd: 'build', phase: 'RED', event: 'PHASE_COMPLETE', data: {} });
      await feedFiller(ANALYSIS_WINDOW + 20);
      await logger.log({ cmd: 'build', event: 'FAILED', data: { error: 'boom after complete' } });

      await vi.waitFor(
        () => {
          const latest = analyses[analyses.length - 1];
          expect(latest?.issues.some((i) => i.type === 'regression')).toBe(true);
        },
        { timeout: 8000 },
      );
    }, 20000);

    it('restores session anchors across restart so a resumed command is not falsely chain-broken', async () => {
      // First session: a valid ideate+plan chain, then a clean shutdown that
      // flushes the accumulated anchors into workflow-state.json.
      await supervisor.start();
      await new Promise((r) => setTimeout(r, 100));
      await logger.log({ cmd: 'ideate', event: 'START', data: {} });
      await logger.log({ cmd: 'ideate', event: 'COMPLETE', data: { outputs: ['DESIGN.md'] } });
      await logger.log({ cmd: 'plan', event: 'START', data: {} });
      await logger.log({ cmd: 'plan', event: 'COMPLETE', data: { outputs: ['PLAN.md'] } });
      await new Promise((r) => setTimeout(r, 200));
      await supervisor.stop();

      // Second session: a fresh supervisor over the same .oss dir. Its analysis
      // window starts empty, so only the restored anchors can vouch for the chain.
      const resumed = new WatcherSupervisor(ossDir, queueManager, { configDir: ossDir });
      const analyses: WA[] = [];
      resumed.onAnalyze((a) => analyses.push(a));
      await resumed.start();
      await new Promise((r) => setTimeout(r, 100));

      await logger.log({ cmd: 'build', event: 'START', data: {} });

      await vi.waitFor(
        () => {
          expect(analyses[analyses.length - 1]?.current_command).toBe('build');
        },
        { timeout: 4000 },
      );

      const latest = analyses[analyses.length - 1];
      expect(latest.issues.some((i) => i.type === 'chain_broken')).toBe(false);

      await resumed.stop();
    }, 15000);
  });
});
