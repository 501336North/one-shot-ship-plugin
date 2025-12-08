/**
 * Deployment Commands Logging Tests
 *
 * @behavior Deployment commands (/oss:stage, /oss:deploy, /oss:release) log properly
 * @acceptance-criteria AC-DEPLOY-001: /oss:stage logs with environment and status
 * @acceptance-criteria AC-DEPLOY-002: /oss:deploy logs with deployment target
 * @acceptance-criteria AC-DEPLOY-003: /oss:release logs with version number
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowLogger } from '../../src/logger/workflow-logger.js';
import { LogReader } from '../../src/logger/log-reader.js';

describe('Deployment Commands Logging', () => {
  let testDir: string;
  let logger: WorkflowLogger;
  let reader: LogReader;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-cmd-test-'));
    logger = new WorkflowLogger(testDir);
    reader = new LogReader(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('/oss:stage command logging', () => {
    it('should log START/COMPLETE for /oss:stage with environment', async () => {
      // GIVEN: stage command runs
      await logger.log({
        cmd: 'stage',
        event: 'START',
        data: {
          environment: 'staging',
          branch: 'feat/user-auth',
        },
      });
      await logger.log({
        cmd: 'stage',
        event: 'COMPLETE',
        data: {
          summary: 'Deployed to staging',
          environment: 'staging',
          url: 'https://staging.example.com',
          commit: 'abc1234',
          status: 'healthy',
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Deployment info logged
      expect(entries[1].event).toBe('COMPLETE');
      expect(entries[1].data.environment).toBe('staging');
      expect(entries[1].data.status).toBe('healthy');
    });

    it('should log FAILED with staging failure details', async () => {
      // GIVEN: staging fails
      await logger.log({
        cmd: 'stage',
        event: 'START',
        data: { environment: 'staging' },
      });
      await logger.log({
        cmd: 'stage',
        event: 'FAILED',
        data: {
          error: 'Health check failed after deployment',
          environment: 'staging',
          rollback_triggered: true,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Failure with rollback info logged
      expect(entries[1].event).toBe('FAILED');
      expect(entries[1].data.rollback_triggered).toBe(true);
    });
  });

  describe('/oss:deploy command logging', () => {
    it('should log START/COMPLETE for /oss:deploy with target', async () => {
      // GIVEN: deploy command runs
      await logger.log({
        cmd: 'deploy',
        event: 'START',
        data: {
          target: 'production',
          strategy: 'canary',
          canary_percentage: 10,
        },
      });
      await logger.log({
        cmd: 'deploy',
        event: 'MILESTONE',
        data: {
          step: 'canary_deployed',
          healthy_pods: 1,
          total_pods: 10,
        },
      });
      await logger.log({
        cmd: 'deploy',
        event: 'COMPLETE',
        data: {
          summary: 'Production deploy complete',
          target: 'production',
          version: 'v1.5.0',
          duration_s: 120,
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Deployment target and milestones logged
      expect(entries[0].data.target).toBe('production');
      expect(entries[1].data.step).toBe('canary_deployed');
      expect(entries[2].data.version).toBe('v1.5.0');
    });
  });

  describe('/oss:release command logging', () => {
    it('should log START/COMPLETE for /oss:release with version', async () => {
      // GIVEN: release command runs
      await logger.log({
        cmd: 'release',
        event: 'START',
        data: {
          type: 'minor',
          current_version: 'v1.4.0',
        },
      });
      await logger.log({
        cmd: 'release',
        event: 'MILESTONE',
        data: {
          step: 'changelog_generated',
          changes: 15,
        },
      });
      await logger.log({
        cmd: 'release',
        event: 'MILESTONE',
        data: {
          step: 'tag_created',
          tag: 'v1.5.0',
        },
      });
      await logger.log({
        cmd: 'release',
        event: 'COMPLETE',
        data: {
          summary: 'Release v1.5.0 published',
          new_version: 'v1.5.0',
          changelog_url: 'https://github.com/org/repo/releases/tag/v1.5.0',
          outputs: ['CHANGELOG.md'],
        },
      });

      // WHEN: LogReader reads entries
      const entries = await reader.readAll();

      // THEN: Version info logged
      expect(entries[3].data.new_version).toBe('v1.5.0');
      expect(entries.filter((e) => e.event === 'MILESTONE')).toHaveLength(2);
    });
  });
});
