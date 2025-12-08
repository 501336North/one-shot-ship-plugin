/**
 * E2E Log Flow Integration Tests
 *
 * @behavior Supervisor can consume logs from workflow.log and detect issues
 * @acceptance-criteria AC-LOG-001: When a command logs START/COMPLETE, supervisor receives the events
 * @acceptance-criteria AC-LOG-002: When START logged but no COMPLETE within timeout, issue detected
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer.js';
import { InterventionGenerator } from '../../src/intervention/generator.js';

describe('E2E Log Flow', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;
  let analyzer: WorkflowAnalyzer;
  let generator: InterventionGenerator;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-flow-e2e-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
    analyzer = new WorkflowAnalyzer();
    generator = new InterventionGenerator();
  });

  afterEach(() => {
    reader.stopTailing();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('AC-LOG-001: Supervisor receives logged events', () => {
    it('should detect agent logging from workflow.log', async () => {
      // GIVEN: A command logs START event
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: { feature: 'user-auth' },
      });

      // WHEN: LogReader reads the entries
      const entries = await reader.readAll();

      // THEN: WorkflowAnalyzer can process them
      const analysis = analyzer.analyze(entries);

      // Verify the supervisor received the event
      expect(entries.length).toBe(1);
      expect(entries[0].cmd).toBe('build');
      expect(entries[0].event).toBe('START');
      expect(analysis.current_command).toBe('build');
      expect(analysis.chain_progress.build).toBe('in_progress');
    });

    it('should track full command lifecycle from START to COMPLETE', async () => {
      // GIVEN: A command logs START and COMPLETE
      await logger.log({
        cmd: 'ideate',
        event: 'START',
        data: { idea: 'new feature' },
      });
      await logger.log({
        cmd: 'ideate',
        event: 'MILESTONE',
        data: { step: 'problem-definition' },
      });
      await logger.log({
        cmd: 'ideate',
        event: 'COMPLETE',
        data: { summary: 'Design approved', outputs: ['DESIGN.md'] },
      });

      // WHEN: LogReader reads the entries
      const entries = await reader.readAll();

      // THEN: WorkflowAnalyzer sees healthy completion
      const analysis = analyzer.analyze(entries);

      expect(entries.length).toBe(3);
      expect(analysis.health).toBe('healthy');
      expect(analysis.chain_progress.ideate).toBe('complete');
    });

    it('should receive events via tailing in real-time', async () => {
      const receivedEntries: any[] = [];

      // GIVEN: LogReader is tailing
      reader.startTailing((entry) => {
        receivedEntries.push(entry);
      });

      // WHEN: Logger writes entries after tailing started
      await logger.log({
        cmd: 'plan',
        event: 'START',
        data: {},
      });

      // Give time for polling (50ms interval)
      await new Promise((resolve) => setTimeout(resolve, 100));

      await logger.log({
        cmd: 'plan',
        event: 'COMPLETE',
        data: { summary: 'Plan created', outputs: ['PLAN.md'] },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // THEN: Tail callback received both entries
      expect(receivedEntries.length).toBe(2);
      expect(receivedEntries[0].event).toBe('START');
      expect(receivedEntries[1].event).toBe('COMPLETE');
    });
  });

  describe('AC-LOG-002: Detect missing COMPLETE after START', () => {
    it('should detect silence when START logged but no COMPLETE within timeout', async () => {
      // GIVEN: A command logs START but no COMPLETE (simulating stuck workflow)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

      // Manually write timestamped entry to simulate old START
      const entry = {
        ts: fiveMinutesAgo.toISOString(),
        cmd: 'build',
        event: 'START',
        data: { feature: 'stuck-feature' },
      };
      const logPath = path.join(testDir, 'workflow.log');
      fs.writeFileSync(logPath, JSON.stringify(entry) + '\n# BUILD:START\n');

      // WHEN: Analyzer processes entries with current time
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries, new Date());

      // THEN: Issue detected (silence or abrupt_stop)
      expect(analysis.health).not.toBe('healthy');
      const hasRelevantIssue = analysis.issues.some(
        (i) => i.type === 'silence' || i.type === 'abrupt_stop'
      );
      expect(hasRelevantIssue).toBe(true);
    });

    it('should generate intervention for missing COMPLETE', async () => {
      // GIVEN: Analysis detected silence issue
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const entry = {
        ts: fiveMinutesAgo.toISOString(),
        cmd: 'build',
        event: 'START',
        data: {},
      };
      const logPath = path.join(testDir, 'workflow.log');
      fs.writeFileSync(logPath, JSON.stringify(entry) + '\n# BUILD:START\n');

      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries, new Date());

      // WHEN: InterventionGenerator processes the issue
      const silenceIssue = analysis.issues.find(
        (i) => i.type === 'silence' || i.type === 'abrupt_stop'
      );
      expect(silenceIssue).toBeDefined();

      const intervention = generator.generate(silenceIssue!);

      // THEN: Intervention has appropriate response
      expect(intervention.notification.title).toBeDefined();
      expect(intervention.notification.message).toBeDefined();
      // High-confidence issues should have queue tasks
      if (silenceIssue!.confidence >= 0.7) {
        expect(intervention.queue_task).toBeDefined();
      }
    });

    it('should detect incomplete phase with proper issue type', async () => {
      // GIVEN: Phase START logged but no PHASE_COMPLETE
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const entries = [
        {
          ts: tenMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'START' as const,
          data: {},
        },
        {
          ts: tenMinutesAgo.toISOString(),
          cmd: 'build',
          event: 'PHASE_START' as const,
          phase: 'RED',
          data: {},
        },
        // No PHASE_COMPLETE
      ];
      const logPath = path.join(testDir, 'workflow.log');
      const content = entries
        .map((e) => JSON.stringify(e) + `\n# ${e.cmd.toUpperCase()}:${e.event}\n`)
        .join('');
      fs.writeFileSync(logPath, content);

      // WHEN: Analyzer processes entries
      const parsedEntries = await reader.readAll();
      const analysis = analyzer.analyze(parsedEntries, new Date());

      // THEN: Phase stuck issue detected
      expect(analysis.issues.some((i) => i.type === 'phase_stuck')).toBe(true);
    });
  });

  describe('Full supervisor flow', () => {
    it('should complete full flow: log → read → analyze → intervene', async () => {
      // GIVEN: A workflow with an issue (TDD violation - GREEN before RED)
      await logger.log({
        cmd: 'build',
        event: 'START',
        data: {},
      });
      await logger.log({
        cmd: 'build',
        phase: 'GREEN',
        event: 'PHASE_START',
        data: {},
      });

      // WHEN: Full flow executes
      const entries = await reader.readAll();
      const analysis = analyzer.analyze(entries);

      // THEN: TDD violation detected
      const tddIssue = analysis.issues.find((i) => i.type === 'tdd_violation');
      expect(tddIssue).toBeDefined();
      expect(tddIssue!.confidence).toBeGreaterThan(0.9);

      // AND: Intervention generated
      const intervention = generator.generate(tddIssue!);
      expect(intervention.response_type).toBe('auto_remediate');
      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.agent_type).toBe('test-engineer');
    });
  });
});
