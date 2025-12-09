/**
 * @behavior WatcherSupervisor detects IRON LAW violations from log entries
 * @acceptance-criteria Task 5.1: Log-parsing IronLawMonitor integration
 * @boundary WatcherSupervisor
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WatcherSupervisor } from '../src/supervisor/watcher-supervisor.js';
import { QueueManager } from '../src/queue/manager.js';
import { WorkflowAnalysis } from '../src/analyzer/workflow-analyzer.js';
import { ParsedLogEntry } from '../src/logger/log-reader.js';

describe('WatcherSupervisor - IRON LAW Monitoring', () => {
  let testDir: string;
  let ossDir: string;
  let queueManager: QueueManager;
  let supervisor: WatcherSupervisor;

  beforeEach(() => {
    // Create unique test directory
    testDir = path.join(
      os.tmpdir(),
      `oss-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });

    // Initialize queue manager and supervisor
    queueManager = new QueueManager(ossDir);
    supervisor = new WatcherSupervisor(ossDir, queueManager);
  });

  afterEach(async () => {
    // Stop supervisor and cleanup
    await supervisor.stop();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * @behavior When log contains IRON_LAW_CHECK with violations, WorkflowAnalysis contains iron_law_violation issue
   * @test-case Single IRON LAW violation detected from log entry
   */
  it('should detect IRON LAW violations from log entries', async () => {
    // GIVEN - Setup onAnalyze callback to capture analysis
    let capturedAnalysis: WorkflowAnalysis | null = null;
    let capturedEntries: ParsedLogEntry[] | null = null;

    supervisor.onAnalyze((analysis, entries) => {
      capturedAnalysis = analysis;
      capturedEntries = entries;
    });

    // WHEN - Start supervisor first (starts tailing)
    await supervisor.start();

    // Then write entry (will be picked up by tailer)
    const workflowLog = path.join(ossDir, 'workflow.log');
    const logEntry = JSON.stringify({
      ts: new Date().toISOString(),
      cmd: '/oss:build',
      phase: 'red',
      event: 'IRON_LAW_CHECK',
      data: {
        violations: [
          {
            law: 1,
            message: 'No production code without a failing test first',
          },
        ],
      },
    });
    fs.appendFileSync(workflowLog, logEntry + '\n');

    // Wait for tailer to pick up (polls every 50ms)
    await new Promise((resolve) => setTimeout(resolve, 150));

    // THEN - Analysis should contain iron_law_violation issue
    expect(capturedAnalysis).not.toBeNull();
    expect(capturedAnalysis?.issues).toBeDefined();

    const ironLawIssues = capturedAnalysis?.issues.filter(
      (issue) => issue.type === 'iron_law_violation'
    );

    expect(ironLawIssues?.length).toBeGreaterThan(0);
    expect(ironLawIssues?.[0].message).toContain('IRON LAW #1');
    expect(ironLawIssues?.[0].context?.law).toBe(1);
  });

  /**
   * @behavior When multiple IRON_LAW_CHECK entries for same law, escalates to iron_law_repeated
   * @test-case Second violation of same law triggers escalation
   */
  it('should escalate to iron_law_repeated on multiple violations', async () => {
    // GIVEN - Setup onAnalyze callback to capture analysis
    let capturedAnalysis: WorkflowAnalysis | null = null;

    supervisor.onAnalyze((analysis) => {
      capturedAnalysis = analysis;
    });

    // WHEN - Start supervisor first (starts tailing)
    await supervisor.start();

    // Then write TWO entries sequentially
    const workflowLog = path.join(ossDir, 'workflow.log');
    const timestamp1 = new Date(Date.now() - 60000).toISOString(); // 1 min ago
    const timestamp2 = new Date().toISOString(); // now

    const logEntry1 = JSON.stringify({
      ts: timestamp1,
      cmd: '/oss:build',
      phase: 'red',
      event: 'IRON_LAW_CHECK',
      data: {
        violations: [
          {
            law: 1,
            message: 'No production code without a failing test first',
          },
        ],
      },
    });

    const logEntry2 = JSON.stringify({
      ts: timestamp2,
      cmd: '/oss:build',
      phase: 'green',
      event: 'IRON_LAW_CHECK',
      data: {
        violations: [
          {
            law: 1,
            message: 'No production code without a failing test first',
          },
        ],
      },
    });

    fs.appendFileSync(workflowLog, logEntry1 + '\n');
    await new Promise((resolve) => setTimeout(resolve, 100)); // Let first entry be processed
    fs.appendFileSync(workflowLog, logEntry2 + '\n');

    // Wait for tailer to pick up both entries
    await new Promise((resolve) => setTimeout(resolve, 150));

    // THEN - Analysis should contain iron_law_repeated issue
    expect(capturedAnalysis).not.toBeNull();
    expect(capturedAnalysis?.issues).toBeDefined();

    const repeatedIssues = capturedAnalysis?.issues.filter(
      (issue) => issue.type === 'iron_law_repeated'
    );

    expect(repeatedIssues?.length).toBeGreaterThan(0);
    expect(repeatedIssues?.[0].message).toContain('IRON LAW #1 violated 2 times');
    expect(repeatedIssues?.[0].context?.law).toBe(1);
    expect(repeatedIssues?.[0].context?.count).toBe(2);
  });
});
