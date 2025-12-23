/**
 * PR Task Executor Tests
 *
 * @behavior Executes PR remediation tasks with TDD workflow
 * @acceptance-criteria Context preserved, TDD cycle followed, quality gates pass
 * @business-rule Never lose uncommitted work, never push to main
 * @boundary PR Task Executor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRTaskExecutor } from '../../src/agents/pr-task-executor';
import { exec } from 'child_process';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

describe('PRTaskExecutor', () => {
  let executor: PRTaskExecutor;

  beforeEach(() => {
    executor = new PRTaskExecutor();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Context Preservation', () => {
    it('should save current branch to context file', async () => {
      // GIVEN - Current branch is 'main'
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('git branch --show-current')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: 'feat/my-feature\n', stderr: '' }
          );
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We save context
      await executor.saveContext();

      // THEN - Original branch should be stored
      const context = executor.getContext();
      expect(context.originalBranch).toBe('feat/my-feature');
    });

    it('should stash uncommitted changes if present', async () => {
      // GIVEN - Uncommitted changes exist
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('git branch --show-current')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: 'main\n', stderr: '' }
          );
        } else if ((cmd as string).includes('git status --porcelain')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: ' M src/foo.ts\n', stderr: '' }
          );
        } else if ((cmd as string).includes('git stash push')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: 'Saved working directory\n', stderr: '' }
          );
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We save context
      await executor.saveContext();

      // THEN - Stash was created
      const context = executor.getContext();
      expect(context.stashCreated).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git stash push'),
        expect.any(Function)
      );
    });

    it('should skip stash if working tree is clean', async () => {
      // GIVEN - No uncommitted changes
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('git branch --show-current')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: 'main\n', stderr: '' }
          );
        } else if ((cmd as string).includes('git status --porcelain')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We save context
      await executor.saveContext();

      // THEN - No stash created
      const context = executor.getContext();
      expect(context.stashCreated).toBe(false);
    });

    it('should restore original branch after execution', async () => {
      // GIVEN - Context was saved
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // Set up context with saved branch
      executor.setContext({ originalBranch: 'feat/original', stashCreated: false });

      // WHEN - We restore context
      await executor.restoreContext();

      // THEN - Should checkout original branch
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout feat/original'),
        expect.any(Function)
      );
    });

    it('should pop stash if stash was created', async () => {
      // GIVEN - Context with stash
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      executor.setContext({ originalBranch: 'main', stashCreated: true });

      // WHEN - We restore context
      await executor.restoreContext();

      // THEN - Stash should be popped
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git stash pop'),
        expect.any(Function)
      );
    });

    it('should clean up context after restore', async () => {
      // GIVEN - Context was saved
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      executor.setContext({ originalBranch: 'main', stashCreated: false });

      // WHEN - We restore context
      await executor.restoreContext();

      // THEN - Context should be cleared
      const context = executor.getContext();
      expect(context.originalBranch).toBeNull();
    });
  });

  describe('Branch Checkout', () => {
    it('should checkout PR branch by name', async () => {
      // GIVEN - Branch exists
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We checkout branch
      await executor.checkoutBranch('feat/pr-123');

      // THEN - Should run git checkout
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git checkout feat/pr-123'),
        expect.any(Function)
      );
    });

    it('should fetch branch if not available locally', async () => {
      // GIVEN - Branch doesn't exist locally, needs fetch
      let callCount = 0;
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        callCount++;
        if ((cmd as string).includes('git checkout') && callCount === 1) {
          const error = new Error('pathspec did not match any file(s)');
          (callback as (error: Error | null) => void)(error);
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We checkout branch
      await executor.checkoutBranch('feat/pr-123');

      // THEN - Should fetch then checkout
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git fetch origin feat/pr-123'),
        expect.any(Function)
      );
    });

    it('should handle checkout failure', async () => {
      // GIVEN - Branch doesn't exist
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        const error = new Error('Branch not found');
        (callback as (error: Error | null) => void)(error);
        return {} as ReturnType<typeof exec>;
      });

      // WHEN/THEN - Should throw with actionable error
      await expect(executor.checkoutBranch('nonexistent')).rejects.toThrow('Branch not found');
    });

    it('should pull latest changes after checkout', async () => {
      // GIVEN - Branch exists
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We pull latest
      await executor.pullLatest('feat/pr-123');

      // THEN - Should run git pull
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git pull origin feat/pr-123'),
        expect.any(Function)
      );
    });
  });

  describe('Quality Gates', () => {
    it('should run test suite and fail if tests fail', async () => {
      // GIVEN - Tests fail
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('npm test')) {
          const error = new Error('Tests failed');
          (callback as (error: Error | null) => void)(error);
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We run tests
      const result = await executor.runTests();

      // THEN - Should return failure
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Tests failed');
    });

    it('should run type check and fail on type errors', async () => {
      // GIVEN - Type check fails
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('npx tsc')) {
          const error = new Error('Type error');
          (callback as (error: Error | null) => void)(error);
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We run type check
      const result = await executor.runTypeCheck();

      // THEN - Should return failure
      expect(result.passed).toBe(false);
    });

    it('should run lint and fail on lint errors', async () => {
      // GIVEN - Lint fails
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('npm run lint')) {
          const error = new Error('Lint error');
          (callback as (error: Error | null) => void)(error);
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We run lint
      const result = await executor.runLint();

      // THEN - Should return failure
      expect(result.passed).toBe(false);
    });

    it('should return overall pass/fail status', async () => {
      // GIVEN - All gates pass
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We validate all gates
      const result = await executor.validateQualityGates();

      // THEN - Should return pass
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Commit and Push', () => {
    it('should create commit with descriptive message', async () => {
      // GIVEN - Changes staged
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: 'abc1234', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We create commit
      const sha = await executor.createCommit({
        prNumber: 123,
        commentId: '456',
        summary: 'Fix the bug',
      });

      // THEN - Should create commit with PR reference
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git commit'),
        expect.any(Function)
      );
      expect(sha).toBe('abc1234');
    });

    it('should include Co-Authored-By trailer', async () => {
      // GIVEN - Changes staged
      let commitCommand = '';
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('git commit')) {
          commitCommand = cmd as string;
        }
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: 'abc1234', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We create commit
      await executor.createCommit({
        prNumber: 123,
        commentId: '456',
        summary: 'Fix the bug',
      });

      // THEN - Should include co-author
      expect(commitCommand).toContain('Co-Authored-By');
    });

    it('should push to PR branch (not main)', async () => {
      // GIVEN - On PR branch
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We push
      await executor.pushToBranch('feat/pr-123');

      // THEN - Should push to PR branch
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git push origin feat/pr-123'),
        expect.any(Function)
      );
    });

    it('should return commit SHA after push', async () => {
      // GIVEN - Commit created
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        if ((cmd as string).includes('git rev-parse')) {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: 'abc1234\n', stderr: '' }
          );
        } else {
          (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
            null,
            { stdout: '', stderr: '' }
          );
        }
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We get commit SHA
      const sha = await executor.getCommitSha();

      // THEN - Should return short SHA
      expect(sha).toBe('abc1234');
    });
  });

  describe('Retry and Escalation', () => {
    it('should retry execution once on failure', async () => {
      // GIVEN - First attempt fails, second succeeds
      let attempts = 0;
      const mockExecute = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          throw new Error('Transient failure');
        }
        return { success: true };
      });

      // WHEN - We execute with retry
      const result = await executor.executeWithRetry(mockExecute);

      // THEN - Should succeed on retry
      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it('should not retry on permanent failures', async () => {
      // GIVEN - Permanent failure
      const mockExecute = vi.fn().mockImplementation(() => {
        const error = new Error('Branch not found');
        (error as Error & { permanent: boolean }).permanent = true;
        throw error;
      });

      // WHEN/THEN - Should fail immediately
      await expect(executor.executeWithRetry(mockExecute)).rejects.toThrow('Branch not found');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should escalate to human queue after retry exhausted', async () => {
      // GIVEN - All retries fail
      const mockExecute = vi.fn().mockImplementation(() => {
        throw new Error('Persistent failure');
      });

      // WHEN - We execute and fail
      try {
        await executor.executeWithRetry(mockExecute);
      } catch {
        // Expected
      }

      // THEN - Should be marked for escalation
      expect(executor.needsEscalation()).toBe(true);
    });
  });
});
