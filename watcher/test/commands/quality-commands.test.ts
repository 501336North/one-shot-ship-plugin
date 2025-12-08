/**
 * Quality Commands Logging Tests
 *
 * @behavior Quality commands (/oss:review, /oss:audit, /oss:tech-debt) log properly
 * @acceptance-criteria AC-QUAL-001: /oss:review logs REVIEW_STARTED/REVIEW_COMPLETE with findings
 * @acceptance-criteria AC-QUAL-002: /oss:audit logs SECURITY_FINDINGS with vulnerability summary
 * @acceptance-criteria AC-QUAL-003: /oss:tech-debt logs DEBT_IDENTIFIED with items count
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Quality Commands Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-cmd-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('/oss:review command logging', () => {
    it('should log REVIEW_STARTED/REVIEW_COMPLETE with findings count', async () => {
      // GIVEN: review command runs
      await logger.log({
        cmd: 'review',
        event: 'START',
        data: {
          target: 'src/auth/**/*.ts',
          perspectives: ['correctness', 'security', 'performance', 'maintainability'],
        },
      });
      await logger.log({
        cmd: 'review',
        event: 'MILESTONE',
        data: {
          type: 'REVIEW_STARTED',
          files_to_review: 12,
        },
      });
      await logger.log({
        cmd: 'review',
        event: 'MILESTONE',
        data: {
          step: 'correctness_complete',
          findings: 2,
        },
      });
      await logger.log({
        cmd: 'review',
        event: 'MILESTONE',
        data: {
          step: 'security_complete',
          findings: 1,
        },
      });
      await logger.log({
        cmd: 'review',
        event: 'MILESTONE',
        data: {
          type: 'REVIEW_COMPLETE',
          total_findings: 5,
          by_severity: { critical: 0, high: 1, medium: 2, low: 2 },
        },
      });
      await logger.log({
        cmd: 'review',
        event: 'COMPLETE',
        data: {
          summary: 'Code review complete: 5 findings',
          findings_count: 5,
          outputs: ['review-report.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Review milestones logged
      const reviewComplete = entries.find(
        (e) => e.event === 'MILESTONE' && e.data.type === 'REVIEW_COMPLETE'
      );
      expect(reviewComplete).toBeDefined();
      expect(reviewComplete?.data.total_findings).toBe(5);
      expect(entries[entries.length - 1].data.findings_count).toBe(5);
    });
  });

  describe('/oss:audit command logging', () => {
    it('should log SECURITY_FINDINGS with vulnerability summary', async () => {
      // GIVEN: security audit runs
      await logger.log({
        cmd: 'audit',
        event: 'START',
        data: {
          scope: 'full',
          include_dependencies: true,
        },
      });
      await logger.log({
        cmd: 'audit',
        event: 'MILESTONE',
        data: {
          step: 'dependency_scan_complete',
          vulnerabilities: 3,
        },
      });
      await logger.log({
        cmd: 'audit',
        event: 'MILESTONE',
        data: {
          type: 'SECURITY_FINDINGS',
          vulnerabilities: {
            critical: 0,
            high: 1,
            medium: 2,
            low: 5,
          },
          packages_scanned: 234,
          packages_vulnerable: 3,
        },
      });
      await logger.log({
        cmd: 'audit',
        event: 'COMPLETE',
        data: {
          summary: 'Security audit complete: 1 high, 2 medium, 5 low vulnerabilities',
          total_vulnerabilities: 8,
          remediation_required: true,
          outputs: ['security-report.md', 'VULNERABILITIES.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Security findings logged
      const securityFindings = entries.find(
        (e) => e.event === 'MILESTONE' && e.data.type === 'SECURITY_FINDINGS'
      );
      expect(securityFindings).toBeDefined();
      expect(securityFindings?.data.vulnerabilities.high).toBe(1);
      expect(securityFindings?.data.packages_vulnerable).toBe(3);
    });

    it('should log clean audit when no vulnerabilities', async () => {
      // GIVEN: clean audit
      await logger.log({
        cmd: 'audit',
        event: 'START',
        data: { scope: 'full' },
      });
      await logger.log({
        cmd: 'audit',
        event: 'MILESTONE',
        data: {
          type: 'SECURITY_FINDINGS',
          vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0 },
          packages_scanned: 234,
          packages_vulnerable: 0,
        },
      });
      await logger.log({
        cmd: 'audit',
        event: 'COMPLETE',
        data: {
          summary: 'No vulnerabilities found',
          total_vulnerabilities: 0,
          remediation_required: false,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Clean status logged
      expect(entries[2].data.total_vulnerabilities).toBe(0);
      expect(entries[2].data.remediation_required).toBe(false);
    });
  });

  describe('/oss:tech-debt command logging', () => {
    it('should log DEBT_IDENTIFIED with items count', async () => {
      // GIVEN: tech-debt command runs
      await logger.log({
        cmd: 'tech-debt',
        event: 'START',
        data: {
          scope: 'src/**/*.ts',
          categories: ['code-smells', 'outdated-deps', 'missing-tests'],
        },
      });
      await logger.log({
        cmd: 'tech-debt',
        event: 'MILESTONE',
        data: {
          type: 'DEBT_IDENTIFIED',
          items_found: 15,
          by_category: {
            'code-smells': 8,
            'outdated-deps': 4,
            'missing-tests': 3,
          },
          estimated_effort_hours: 24,
        },
      });
      await logger.log({
        cmd: 'tech-debt',
        event: 'COMPLETE',
        data: {
          summary: 'Tech debt analysis: 15 items identified',
          total_items: 15,
          priority_items: 5,
          outputs: ['TECH_DEBT.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Debt items logged
      const debtMilestone = entries.find(
        (e) => e.event === 'MILESTONE' && e.data.type === 'DEBT_IDENTIFIED'
      );
      expect(debtMilestone).toBeDefined();
      expect(debtMilestone?.data.items_found).toBe(15);
      expect(debtMilestone?.data.by_category['code-smells']).toBe(8);
    });

    it('should log prioritized items', async () => {
      // GIVEN: tech-debt with priorities
      await logger.log({
        cmd: 'tech-debt',
        event: 'START',
        data: {},
      });
      await logger.log({
        cmd: 'tech-debt',
        event: 'COMPLETE',
        data: {
          summary: 'Tech debt prioritized',
          total_items: 10,
          priority_items: 3,
          top_priorities: [
            { item: 'Upgrade lodash (security)', effort: 2 },
            { item: 'Add auth tests', effort: 8 },
            { item: 'Refactor user service', effort: 4 },
          ],
          outputs: ['TECH_DEBT.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Priority items logged
      expect(entries[1].data.top_priorities).toHaveLength(3);
      expect(entries[1].data.priority_items).toBe(3);
    });
  });
});
