/**
 * Operations Commands Logging Tests
 *
 * @behavior Ops commands (/oss:monitor, /oss:incident, /oss:rollback) log properly
 * @acceptance-criteria AC-OPS-001: /oss:monitor logs with monitoring status
 * @acceptance-criteria AC-OPS-002: /oss:incident logs INCIDENT_DECLARED with severity
 * @acceptance-criteria AC-OPS-003: /oss:rollback logs ROLLBACK_EXECUTED with target version
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Operations Commands Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-cmd-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('/oss:monitor command logging', () => {
    it('should log START/COMPLETE for /oss:monitor with status', async () => {
      // GIVEN: monitor command runs
      await logger.log({
        cmd: 'monitor',
        event: 'START',
        data: {
          target: 'production',
          metrics: ['cpu', 'memory', 'requests'],
        },
      });
      await logger.log({
        cmd: 'monitor',
        event: 'MILESTONE',
        data: {
          step: 'metrics_collected',
          cpu_avg: 45,
          memory_avg: 68,
          request_rate: 1200,
        },
      });
      await logger.log({
        cmd: 'monitor',
        event: 'COMPLETE',
        data: {
          summary: 'All systems healthy',
          status: 'healthy',
          alerts: 0,
          duration_s: 30,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Monitoring status logged
      expect(entries[2].data.status).toBe('healthy');
      expect(entries[2].data.alerts).toBe(0);
    });

    it('should log warning status when thresholds exceeded', async () => {
      // GIVEN: monitor detects issues
      await logger.log({
        cmd: 'monitor',
        event: 'START',
        data: { target: 'production' },
      });
      await logger.log({
        cmd: 'monitor',
        event: 'COMPLETE',
        data: {
          summary: 'Warning: High memory usage',
          status: 'warning',
          alerts: 2,
          warnings: [
            { metric: 'memory', value: 92, threshold: 85 },
            { metric: 'disk', value: 88, threshold: 80 },
          ],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Warning status logged
      expect(entries[1].data.status).toBe('warning');
      expect(entries[1].data.alerts).toBe(2);
    });
  });

  describe('/oss:incident command logging', () => {
    it('should log INCIDENT_DECLARED milestone with severity', async () => {
      // GIVEN: incident command declares incident
      await logger.log({
        cmd: 'incident',
        event: 'START',
        data: {
          trigger: 'Manual escalation',
        },
      });
      await logger.log({
        cmd: 'incident',
        event: 'MILESTONE',
        data: {
          type: 'INCIDENT_DECLARED',
          severity: 'P1',
          title: 'API Gateway 500 errors spike',
          affected_services: ['api', 'auth'],
          incident_id: 'INC-2024-001',
        },
      });
      await logger.log({
        cmd: 'incident',
        event: 'COMPLETE',
        data: {
          summary: 'Incident INC-2024-001 created',
          incident_id: 'INC-2024-001',
          status: 'investigating',
          outputs: ['incident-report.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Incident with severity logged
      const incidentMilestone = entries.find(
        (e) => e.event === 'MILESTONE' && e.data.type === 'INCIDENT_DECLARED'
      );
      expect(incidentMilestone).toBeDefined();
      expect(incidentMilestone?.data.severity).toBe('P1');
      expect(incidentMilestone?.data.affected_services).toContain('api');
    });
  });

  describe('/oss:rollback command logging', () => {
    it('should log ROLLBACK_EXECUTED milestone with target version', async () => {
      // GIVEN: rollback command executes
      await logger.log({
        cmd: 'rollback',
        event: 'START',
        data: {
          reason: 'API errors after deploy',
          current_version: 'v1.5.0',
          target_version: 'v1.4.9',
        },
      });
      await logger.log({
        cmd: 'rollback',
        event: 'MILESTONE',
        data: {
          type: 'ROLLBACK_EXECUTED',
          from_version: 'v1.5.0',
          to_version: 'v1.4.9',
          pods_rolled: 10,
        },
      });
      await logger.log({
        cmd: 'rollback',
        event: 'MILESTONE',
        data: {
          step: 'health_check_passed',
          healthy_pods: 10,
        },
      });
      await logger.log({
        cmd: 'rollback',
        event: 'COMPLETE',
        data: {
          summary: 'Rollback to v1.4.9 complete',
          rolled_back_to: 'v1.4.9',
          health_status: 'healthy',
          duration_s: 45,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Rollback with target version logged
      const rollbackMilestone = entries.find(
        (e) => e.event === 'MILESTONE' && e.data.type === 'ROLLBACK_EXECUTED'
      );
      expect(rollbackMilestone).toBeDefined();
      expect(rollbackMilestone?.data.to_version).toBe('v1.4.9');
      expect(entries[3].data.rolled_back_to).toBe('v1.4.9');
    });

    it('should log FAILED if rollback fails', async () => {
      // GIVEN: rollback fails
      await logger.log({
        cmd: 'rollback',
        event: 'START',
        data: { target_version: 'v1.4.9' },
      });
      await logger.log({
        cmd: 'rollback',
        event: 'FAILED',
        data: {
          error: 'Rollback failed: Previous image not found in registry',
          target_version: 'v1.4.9',
          manual_intervention_required: true,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Failure logged with manual intervention flag
      expect(entries[1].event).toBe('FAILED');
      expect(entries[1].data.manual_intervention_required).toBe(true);
    });
  });
});
