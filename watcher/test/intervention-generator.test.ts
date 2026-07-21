/**
 * InterventionGenerator Tests
 *
 * @behavior Watcher generates appropriate interventions based on issue confidence
 * @acceptance-criteria AC-006.1 through AC-006.12
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  InterventionGenerator,
  Intervention,
  ResponseType,
} from '../src/intervention/generator.js';
import { WorkflowIssue, IssueType } from '../src/analyzer/workflow-analyzer.js';

// Helper to create issues
function issue(
  type: IssueType,
  confidence: number,
  message: string = 'Test issue',
  context: Record<string, unknown> = {}
): WorkflowIssue {
  return { type, confidence, message, context };
}

describe('InterventionGenerator', () => {
  let generator: InterventionGenerator;

  beforeEach(() => {
    generator = new InterventionGenerator();
  });

  describe('generate()', () => {
    it('creates auto-remediate response for high confidence', () => {
      const loopIssue = issue('loop_detected', 0.95, 'Loop detected: same action 5 times');

      const intervention = generator.generate(loopIssue);

      expect(intervention.response_type).toBe('auto_remediate');
    });

    it('creates notify-suggest response for medium confidence', () => {
      const silenceIssue = issue('silence', 0.8, 'No activity for 3 minutes');

      const intervention = generator.generate(silenceIssue);

      expect(intervention.response_type).toBe('notify_suggest');
    });

    it('creates notify-only response for low confidence', () => {
      const velocityIssue = issue('declining_velocity', 0.5, 'Velocity declining');

      const intervention = generator.generate(velocityIssue);

      expect(intervention.response_type).toBe('notify_only');
    });

    it('includes queue task with correct priority for auto-remediate', () => {
      const failureIssue = issue('explicit_failure', 0.95, 'Build failed');

      const intervention = generator.generate(failureIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.priority).toBe('high');
      expect(intervention.queue_task!.auto_execute).toBe(true);
    });

    it('includes queue task with prompt for suggested action', () => {
      const stuckIssue = issue('phase_stuck', 0.8, 'RED phase stuck for 5 minutes');

      const intervention = generator.generate(stuckIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.prompt).toBeDefined();
      expect(intervention.queue_task!.auto_execute).toBe(false);
    });

    it('includes notification for all response types', () => {
      const issueTypes: Array<[IssueType, number]> = [
        ['loop_detected', 0.95],
        ['silence', 0.8],
        ['declining_velocity', 0.5],
      ];

      for (const [type, conf] of issueTypes) {
        const testIssue = issue(type, conf);
        const intervention = generator.generate(testIssue);

        expect(intervention.notification).toBeDefined();
        expect(intervention.notification.title).toBeDefined();
        expect(intervention.notification.message).toBeDefined();
      }
    });

    it('selects appropriate agent for issue type', () => {
      const tddIssue = issue('tdd_violation', 0.95, 'GREEN before RED');
      const securityIssue = issue('agent_failed', 0.9, 'Security auditor failed', {
        agent_type: 'security-auditor',
      });

      const tddIntervention = generator.generate(tddIssue);
      const securityIntervention = generator.generate(securityIssue);

      expect(tddIntervention.queue_task?.agent_type).toBe('test-engineer');
      // Security issue should spawn a related agent or general debugger
      expect(securityIntervention.queue_task?.agent_type).toBeDefined();
    });
  });

  describe('createPrompt()', () => {
    it('generates clear prompt describing the issue', () => {
      const loopIssue = issue('loop_detected', 0.95, 'Same action repeated 5 times', {
        repeat_count: 5,
      });

      const prompt = generator.createPrompt(loopIssue);

      expect(prompt).toContain('loop');
      expect(prompt).toContain('5');
    });

    it('includes evidence from log entries', () => {
      const stuckIssue = issue('phase_stuck', 0.85, 'Phase stuck', {
        phase: 'RED',
        elapsed_ms: 300000,
      });

      const prompt = generator.createPrompt(stuckIssue);

      expect(prompt).toContain('RED');
      expect(prompt).toMatch(/5|minutes/i);
    });

    it('includes suggested action', () => {
      const regressionIssue = issue('regression', 0.9, 'Tests broke during REFACTOR', {
        completed_phase: 'GREEN',
      });

      const prompt = generator.createPrompt(regressionIssue);

      expect(prompt).toMatch(/fix|revert|investigate/i);
    });

    it('formats for Claude readability', () => {
      const failureIssue = issue('explicit_failure', 0.95, 'Build failed: type error', {
        error: 'TS2345: Argument of type X is not assignable to Y',
      });

      const prompt = generator.createPrompt(failureIssue);

      // Should have clear structure
      expect(prompt).toContain('##');
      expect(prompt.length).toBeGreaterThan(50);
    });
  });

  describe('createNotification()', () => {
    it('creates title with issue type', () => {
      const loopIssue = issue('loop_detected', 0.95);

      const notification = generator.createNotification(loopIssue);

      expect(notification.title).toMatch(/loop/i);
    });

    it('creates message with actionable info', () => {
      const stuckIssue = issue('phase_stuck', 0.8, 'RED phase stuck for 5 minutes');

      const notification = generator.createNotification(stuckIssue);

      expect(notification.message).toContain('RED');
      expect(notification.message.length).toBeGreaterThan(10);
    });

    it('uses appropriate sound for severity', () => {
      const criticalIssue = issue('explicit_failure', 0.95);
      const warningIssue = issue('silence', 0.8);
      const infoIssue = issue('declining_velocity', 0.5);

      const criticalNotif = generator.createNotification(criticalIssue);
      const warningNotif = generator.createNotification(warningIssue);
      const infoNotif = generator.createNotification(infoIssue);

      // Critical should use alert sound
      expect(criticalNotif.sound).toBe('Basso');
      // Warning should use gentler sound
      expect(warningNotif.sound).toBe('Purr');
      // Info can be silent or quiet
      expect(['Pop', 'default', undefined]).toContain(infoNotif.sound);
    });
  });

  describe('IRON LAW violation handling', () => {
    /**
     * @behavior Watcher creates notification for IRON LAW violations
     * @acceptance-criteria AC-006.13
     * @boundary Notification
     */
    it('should create notification for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #1 violated: Code written before test',
        { law_number: 1, violation_type: 'code_before_test' }
      );

      const notification = generator.createNotification(ironLawIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('IRON LAW #1');
      expect(notification.message).toContain('Code written before test');
    });

    /**
     * @behavior Watcher creates notification for repeated IRON LAW violations
     * @acceptance-criteria AC-006.14
     * @boundary Notification
     */
    it('should create notification for iron_law_repeated', () => {
      const repeatedIssue = issue(
        'iron_law_repeated',
        0.98,
        'IRON LAW #1 violated 3 times in this session',
        { law_number: 1, repeat_count: 3 }
      );

      const notification = generator.createNotification(repeatedIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('3 times');
      expect(notification.message).toContain('repeated');
    });

    /**
     * @behavior Watcher maps IRON LAW violations to debugger agent
     * @acceptance-criteria AC-006.15
     * @boundary Agent Selection
     */
    it('should suggest debugger agent for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #2 violated: Tests not passing',
        { law_number: 2 }
      );

      const intervention = generator.generate(ironLawIssue);

      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.agent_type).toBe('debugger');
    });

    /**
     * @behavior Watcher provides corrective action for IRON LAW violations
     * @acceptance-criteria AC-006.16
     * @boundary Suggested Action
     */
    it('should provide corrective action for iron_law_violation', () => {
      const ironLawIssue = issue(
        'iron_law_violation',
        0.95,
        'IRON LAW #1 violated: Code written before test',
        { law_number: 1 }
      );

      const prompt = generator.createPrompt(ironLawIssue);

      expect(prompt).toMatch(/IRON LAW/i);
      expect(prompt).toContain('Suggested Action');
      expect(prompt).toMatch(/delete.*code|remove.*implementation|start.*with.*test/i);
    });

    /**
     * @behavior Watcher handles ignored IRON LAW violations
     * @acceptance-criteria AC-006.17
     * @boundary Notification
     */
    it('should create notification for iron_law_ignored', () => {
      const ignoredIssue = issue(
        'iron_law_ignored',
        0.99,
        'IRON LAW violation not addressed after 5 minutes',
        { law_number: 1, elapsed_ms: 300000 }
      );

      const notification = generator.createNotification(ignoredIssue);

      expect(notification.title).toMatch(/IRON LAW/i);
      expect(notification.message).toContain('not addressed');
      expect(notification.sound).toBe('Basso'); // Critical alert
    });
  });

  describe('structured OSS_ERROR retry mapping (US-004, AC-004.1/AC-004.2/AC-003.2)', () => {
    const RETRY_HINT = 'Wait 5s then re-run: node watcher/dist/cli/get-copy.js --cmd build';

    function wireContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        code: 'OSS-API-001',
        severity: 'HIGH',
        source: 'hooks/ensure-decrypt-cli.sh',
        message: 'Prompt fetch failed: ECONNREFUSED',
        retry_eligible: true,
        retry_hint: RETRY_HINT,
        retry_cost: 'cheap',
        attempt: 0,
        ...overrides,
      };
    }

    /**
     * @behavior A cheap retryable structured error becomes an auto-executing queue task
     *           whose prompt carries the emitter's retry_hint so the fix is mechanical
     * @acceptance-criteria AC-004.1
     * @business-rule cheap + eligible + attempt < 2 → auto_remediate with retry_hint
     * @boundary Queue task generation
     */
    it('should enqueue an auto_remediate task carrying retry_hint for cheap retryable errors', () => {
      const errorIssue = issue(
        'oss_error_auto_remediable',
        0.95,
        'Structured error OSS-API-001: Prompt fetch failed',
        wireContext()
      );

      const intervention = generator.generate(errorIssue);

      expect(intervention.response_type).toBe('auto_remediate');
      expect(intervention.queue_task).toBeDefined();
      expect(intervention.queue_task!.auto_execute).toBe(true);
      expect(intervention.queue_task!.prompt).toContain(RETRY_HINT);
      expect(intervention.queue_task!.prompt).toContain('OSS-API-001');
      expect(intervention.queue_task!.prompt).toContain('hooks/ensure-decrypt-cli.sh');
    });

    /**
     * @behavior An expensive structured error is surfaced to a human, never auto-retried
     *           (a retry would burn a full pipeline run)
     * @acceptance-criteria AC-004.2
     * @business-rule retry_cost=expensive → NEVER auto_remediate
     * @boundary Queue task generation
     */
    it('should never enqueue auto-remediation for retry_cost=expensive', () => {
      const expensiveIssue = issue(
        'oss_error_escalation',
        0.95,
        'Structured error OSS-API-001 requires escalation',
        wireContext({ retry_cost: 'expensive' })
      );

      const intervention = generator.generate(expensiveIssue);

      expect(intervention.response_type).not.toBe('auto_remediate');
      expect(intervention.queue_task?.auto_execute).not.toBe(true);
    });

    /**
     * @behavior When the retry cap is reached the watcher stops retrying and escalates,
     *           even if the classification says auto-remediable
     * @acceptance-criteria AC-003.2
     * @business-rule attempt >= MAX_RETRIES (2) → escalate, no retry task
     * @boundary Queue task generation
     */
    it('should escalate instead of retrying when attempt >= 2', () => {
      const cappedIssue = issue(
        'oss_error_auto_remediable',
        0.95,
        'Structured error OSS-API-001: Prompt fetch failed',
        wireContext({ attempt: 2 })
      );

      const intervention = generator.generate(cappedIssue);

      expect(intervention.response_type).not.toBe('auto_remediate');
      expect(intervention.queue_task?.auto_execute).not.toBe(true);
    });

    /**
     * @behavior An error arriving already beyond the cap is escalated immediately
     * @acceptance-criteria AC-003.2 (edge case)
     * @business-rule attempt beyond cap on arrival → immediate escalation
     * @boundary Queue task generation
     */
    it('should escalate immediately when attempt already exceeds cap on arrival', () => {
      const beyondCapIssue = issue(
        'oss_error_auto_remediable',
        0.95,
        'Structured error OSS-API-001: Prompt fetch failed',
        wireContext({ attempt: 5 })
      );

      const intervention = generator.generate(beyondCapIssue);

      expect(intervention.response_type).not.toBe('auto_remediate');
      expect(intervention.queue_task?.auto_execute).not.toBe(true);
      expect(intervention.notification.message).toContain('OSS-API-001');
    });
  });

  describe('severity-based escalation + retry visibility (US-005/US-006)', () => {
    let mockNotifier: { sendErrorEscalation: ReturnType<typeof vi.fn> };
    let mockStatusLine: { setRetryStatus: ReturnType<typeof vi.fn> };
    let mockRecoveryLogger: { logRecovery: ReturnType<typeof vi.fn> };
    let wiredGenerator: InterventionGenerator;

    beforeEach(() => {
      mockNotifier = { sendErrorEscalation: vi.fn().mockResolvedValue(undefined) };
      mockStatusLine = { setRetryStatus: vi.fn().mockResolvedValue(undefined) };
      mockRecoveryLogger = { logRecovery: vi.fn() };
      wiredGenerator = new InterventionGenerator({
        notifier: mockNotifier,
        statusLine: mockStatusLine,
        recoveryLogger: mockRecoveryLogger,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function escalationIssue(
      severity: string,
      overrides: Record<string, unknown> = {}
    ): WorkflowIssue {
      return issue(
        'oss_error_escalation',
        0.95,
        'Structured error OSS-AUTH-001 requires escalation: Invalid or expired API key',
        {
          code: 'OSS-AUTH-001',
          severity,
          source: 'hooks/ensure-decrypt-cli.sh',
          message: 'Invalid or expired API key',
          retry_eligible: false,
          retry_cost: 'cheap',
          attempt: 0,
          ...overrides,
        }
      );
    }

    /**
     * @behavior CRITICAL and HIGH escalations wake the user up via Telegram with
     *           recovery[] steps so they can act without digging through logs
     * @acceptance-criteria AC-005.1
     * @business-rule US-005: severity routes the escalation channel
     * @boundary telegram-notifier (mocked at its interface)
     */
    it('should send a Telegram notification for CRITICAL and HIGH escalations', () => {
      for (const severity of ['CRITICAL', 'HIGH'] as const) {
        mockNotifier.sendErrorEscalation.mockClear();

        wiredGenerator.generate(escalationIssue(severity));

        expect(mockNotifier.sendErrorEscalation).toHaveBeenCalledTimes(1);
        const payload = mockNotifier.sendErrorEscalation.mock.calls[0][0] as {
          code: string;
          severity: string;
          recovery: string[];
        };
        expect(payload.code).toBe('OSS-AUTH-001');
        expect(payload.severity).toBe(severity);
        expect(Array.isArray(payload.recovery)).toBe(true);
        expect(payload.recovery.length).toBeGreaterThan(0);
      }
    });

    /**
     * @behavior MEDIUM/LOW escalations stay in-session/log only — no Telegram noise
     * @acceptance-criteria AC-005.2
     * @business-rule US-005: only CRITICAL/HIGH interrupt the user
     * @boundary telegram-notifier (mocked at its interface)
     */
    it('should NOT notify Telegram for MEDIUM/LOW escalations', () => {
      for (const severity of ['MEDIUM', 'LOW'] as const) {
        wiredGenerator.generate(escalationIssue(severity));
      }

      expect(mockNotifier.sendErrorEscalation).not.toHaveBeenCalled();
    });

    /**
     * @behavior Every retry task issuance is visible: a RECOVERY workflow-log line
     *           and a "⟳ retry N/2: <code>" status line update
     * @acceptance-criteria AC-006.1
     * @business-rule US-006: silent retries are forbidden
     * @boundary workflow-logger + status-line (mocked at their interfaces)
     */
    it('should log a RECOVERY line and update status line on every retry attempt', () => {
      const retryableIssue = issue(
        'oss_error_auto_remediable',
        0.95,
        'Structured error OSS-API-001: Prompt fetch failed',
        {
          code: 'OSS-API-001',
          severity: 'HIGH',
          source: 'hooks/ensure-decrypt-cli.sh',
          message: 'Prompt fetch failed: ECONNREFUSED',
          retry_eligible: true,
          retry_hint: 'Wait 5s then re-run the fetch',
          retry_cost: 'cheap',
          attempt: 0,
        }
      );

      const intervention = wiredGenerator.generate(retryableIssue);

      expect(intervention.response_type).toBe('auto_remediate');
      expect(mockRecoveryLogger.logRecovery).toHaveBeenCalledTimes(1);
      expect(mockRecoveryLogger.logRecovery).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'OSS-API-001', attempt: 1, max_retries: 2 })
      );
      expect(mockStatusLine.setRetryStatus).toHaveBeenCalledWith('⟳ retry 1/2: OSS-API-001');
    });

    /**
     * @behavior Expensive errors escalate immediately in unattended mode — the
     *           watcher never waits for a confirmation that cannot come
     * @acceptance-criteria AC-005.3
     * @business-rule Unattended expensive error → immediate escalation, no auto-retry
     * @boundary telegram-notifier (mocked at its interface)
     */
    it('should escalate expensive errors immediately in unattended mode without prompting', () => {
      const expensiveIssue = escalationIssue('HIGH', {
        code: 'OSS-API-001',
        retry_eligible: true,
        retry_cost: 'expensive',
      });

      const intervention = wiredGenerator.generate(expensiveIssue);

      expect(mockNotifier.sendErrorEscalation).toHaveBeenCalledTimes(1);
      expect(intervention.response_type).not.toBe('auto_remediate');
      expect(intervention.queue_task?.auto_execute).not.toBe(true);
    });

    /**
     * @behavior A failing Telegram bridge never crashes the healing pipeline —
     *           the failure is swallowed and logged
     * @acceptance-criteria AC-005.1 (edge case: notify errors are logged, swallowed)
     * @business-rule Notification failures must not mask the original error
     * @boundary telegram-notifier (mocked at its interface)
     */
    it('should swallow and log a Telegram failure, never throw', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockNotifier.sendErrorEscalation.mockRejectedValue(new Error('bridge down'));

      expect(() => wiredGenerator.generate(escalationIssue('CRITICAL'))).not.toThrow();

      // Flush the fire-and-forget rejection handler
      await new Promise((resolve) => setImmediate(resolve));
      expect(consoleSpy).toHaveBeenCalled();
    });

    /**
     * @behavior Without wired collaborators the generator still produces the
     *           intervention (escalation side effects are optional ports)
     * @acceptance-criteria AC-004.2
     * @boundary Generator construction
     */
    it('should generate escalations without collaborators wired', () => {
      const bareGenerator = new InterventionGenerator();

      const intervention = bareGenerator.generate(escalationIssue('CRITICAL'));

      expect(intervention.response_type).not.toBe('auto_remediate');
      expect(intervention.notification.message).toContain('OSS-AUTH-001');
    });
  });
});
