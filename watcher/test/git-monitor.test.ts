import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitMonitor, CIStatus, PRCheckResult } from '../src/monitors/git-monitor';
import { QueueManager } from '../src/queue/manager';
import { Task, CreateTaskInput } from '../src/types';

// Mock dependencies
vi.mock('../src/queue/manager');

/**
 * @behavior Git/CI monitor detects CI failures and git issues
 * @acceptance-criteria AC-004.1, AC-004.2, AC-004.3, AC-004.4, AC-004.5
 */
describe('GitMonitor', () => {
  let monitor: GitMonitor;
  let mockQueueManager: {
    addTask: ReturnType<typeof vi.fn>;
    initialize: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockQueueManager = {
      addTask: vi.fn().mockResolvedValue({ id: 'task-123' } as Task),
      initialize: vi.fn().mockResolvedValue(undefined),
    };

    monitor = new GitMonitor(mockQueueManager as unknown as QueueManager);
  });

  // AC-004.1: Detects CI red status
  describe('CI status detection', () => {
    it('should detect CI failure from status check', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'CI',
        branch: 'main',
        commit: 'abc123',
        url: 'https://github.com/owner/repo/actions/runs/123',
      };

      const result = await monitor.analyzeCIStatus(ciStatus);

      expect(result.hasFailure).toBe(true);
    });

    it('should detect CI success', async () => {
      const ciStatus: CIStatus = {
        status: 'success',
        workflow: 'CI',
        branch: 'main',
        commit: 'abc123',
      };

      const result = await monitor.analyzeCIStatus(ciStatus);

      expect(result.hasFailure).toBe(false);
    });

    it('should detect CI pending/running state', async () => {
      const ciStatus: CIStatus = {
        status: 'pending',
        workflow: 'CI',
        branch: 'feat/new-feature',
        commit: 'def456',
      };

      const result = await monitor.analyzeCIStatus(ciStatus);

      expect(result.hasFailure).toBe(false);
      expect(result.isPending).toBe(true);
    });

    it('should create task for CI failure', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'Build',
        branch: 'main',
        commit: 'abc123',
        url: 'https://github.com/owner/repo/actions/runs/123',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'ci_failure',
          priority: 'high',
          source: 'git-monitor',
        })
      );
    });

    it('should include CI URL in task context', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'Tests',
        branch: 'feat/login',
        commit: 'xyz789',
        url: 'https://github.com/owner/repo/actions/runs/456',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            ci_url: 'https://github.com/owner/repo/actions/runs/456',
          }),
        })
      );
    });
  });

  // AC-004.2: Detects PR check failures
  describe('PR check detection', () => {
    it('should detect PR check failure', async () => {
      const checkResult: PRCheckResult = {
        passed: false,
        checkName: 'build',
        prNumber: 42,
        branch: 'feat/awesome',
        errorMessage: 'Build failed: TypeScript errors',
      };

      const result = await monitor.analyzePRCheck(checkResult);

      expect(result.hasFailure).toBe(true);
    });

    it('should detect PR check success', async () => {
      const checkResult: PRCheckResult = {
        passed: true,
        checkName: 'tests',
        prNumber: 42,
        branch: 'feat/awesome',
      };

      const result = await monitor.analyzePRCheck(checkResult);

      expect(result.hasFailure).toBe(false);
    });

    it('should create task for PR check failure', async () => {
      const checkResult: PRCheckResult = {
        passed: false,
        checkName: 'lint',
        prNumber: 123,
        branch: 'fix/bug',
        errorMessage: 'ESLint found 5 errors',
      };

      await monitor.reportPRCheckFailure(checkResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'pr_check_failed',
          priority: 'high',
          source: 'git-monitor',
        })
      );
    });

    it('should include PR number in task context', async () => {
      const checkResult: PRCheckResult = {
        passed: false,
        checkName: 'coverage',
        prNumber: 99,
        branch: 'feat/metrics',
        errorMessage: 'Coverage below threshold',
      };

      await monitor.reportPRCheckFailure(checkResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            pr_number: 99,
          }),
        })
      );
    });
  });

  // AC-004.3: Detects push failures
  describe('push failure detection', () => {
    it('should detect push rejection', async () => {
      const pushOutput = `
error: failed to push some refs to 'git@github.com:owner/repo.git'
hint: Updates were rejected because the remote contains work that you do
hint: not have locally.
`;
      const result = await monitor.analyzePushOutput(pushOutput);

      expect(result.hasFailure).toBe(true);
      expect(result.failureType).toBe('rejected');
    });

    it('should detect permission denied', async () => {
      const pushOutput = `
Permission denied (publickey).
fatal: Could not read from remote repository.
`;
      const result = await monitor.analyzePushOutput(pushOutput);

      expect(result.hasFailure).toBe(true);
      expect(result.failureType).toBe('permission');
    });

    it('should detect successful push', async () => {
      const pushOutput = `
Enumerating objects: 5, done.
Counting objects: 100% (5/5), done.
To github.com:owner/repo.git
   abc123..def456  main -> main
`;
      const result = await monitor.analyzePushOutput(pushOutput);

      expect(result.hasFailure).toBe(false);
    });

    it('should create task for push failure', async () => {
      await monitor.reportPushFailure(
        'failed to push some refs',
        'rejected',
        'feat/new-api'
      );

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          anomaly_type: 'push_failed',
          priority: 'high',
          source: 'git-monitor',
        })
      );
    });

    it('should include branch in task context', async () => {
      await monitor.reportPushFailure(
        'permission denied',
        'permission',
        'fix/auth'
      );

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            branch: 'fix/auth',
          }),
        })
      );
    });
  });

  // AC-004.4: Creates task with CI failure details
  describe('CI failure task details', () => {
    it('should include workflow name in prompt', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'Production Deploy',
        branch: 'main',
        commit: 'abc123',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Production Deploy'),
        })
      );
    });

    it('should suggest deployment-engineer for CI failures', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'CI',
        branch: 'main',
        commit: 'abc123',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          suggested_agent: 'deployment-engineer',
        })
      );
    });
  });

  // AC-004.5: Includes relevant commit/PR info in context
  describe('git context in tasks', () => {
    it('should include commit SHA in CI failure context', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'Tests',
        branch: 'main',
        commit: 'a1b2c3d4e5f6',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            commit: 'a1b2c3d4e5f6',
          }),
        })
      );
    });

    it('should include branch in CI failure context', async () => {
      const ciStatus: CIStatus = {
        status: 'failure',
        workflow: 'Build',
        branch: 'feat/new-feature',
        commit: 'xyz789',
      };

      await monitor.reportCIFailure(ciStatus);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            branch: 'feat/new-feature',
          }),
        })
      );
    });

    it('should include error message in PR check context', async () => {
      const checkResult: PRCheckResult = {
        passed: false,
        checkName: 'typecheck',
        prNumber: 50,
        branch: 'fix/types',
        errorMessage: 'Found 3 type errors',
      };

      await monitor.reportPRCheckFailure(checkResult);

      expect(mockQueueManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            last_error: 'Found 3 type errors',
          }),
        })
      );
    });
  });

  // Git output parsing
  describe('git output parsing', () => {
    it('should parse gh CLI status output', async () => {
      const ghOutput = `
{
  "state": "FAILURE",
  "statuses": [
    {
      "context": "CI / Build",
      "state": "FAILURE",
      "targetUrl": "https://github.com/owner/repo/actions/runs/123"
    }
  ]
}
`;
      const status = await monitor.parseGHStatus(ghOutput);

      expect(status.status).toBe('failure');
    });

    it('should handle empty status', async () => {
      const status = await monitor.parseGHStatus('');

      expect(status.status).toBe('unknown');
    });
  });
});
