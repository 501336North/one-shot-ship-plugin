/**
 * GitHub API Client Tests
 *
 * @behavior Fetches PRs and comments from GitHub via gh CLI
 * @acceptance-criteria PRs and comments are correctly parsed
 * @business-rule Rate limiting is handled gracefully
 * @boundary GitHub API via gh CLI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  GitHubClient,
  RateLimitError,
  type PR,
  type Comment,
} from '../../src/agents/github-client';

// Mock child_process.exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

const mockExec = vi.mocked(exec);

describe('GitHubClient', () => {
  let client: GitHubClient;

  beforeEach(() => {
    client = new GitHubClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOpenPRs', () => {
    it('should fetch open PRs for current repo', async () => {
      // GIVEN - gh api returns PRs
      const mockPRs = [
        { number: 1, title: 'First PR', head: { ref: 'feat/first' } },
        { number: 2, title: 'Second PR', head: { ref: 'feat/second' } },
      ];

      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: JSON.stringify(mockPRs), stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We fetch open PRs
      const result = await client.getOpenPRs();

      // THEN - Should return array of PR objects
      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(1);
      expect(result[0].title).toBe('First PR');
      expect(result[0].branch).toBe('feat/first');
    });
  });

  describe('getPRReviewComments', () => {
    it('should fetch review comments for a PR', async () => {
      // GIVEN - gh api returns comments
      const mockComments = [
        { id: 123, body: 'Please fix this', path: 'src/foo.ts', line: 42 },
        { id: 456, body: 'Good job', path: 'src/bar.ts', line: 10 },
      ];

      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: JSON.stringify(mockComments), stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We fetch comments
      const result = await client.getPRReviewComments(1);

      // THEN - Should return array of comment objects
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('123');
      expect(result[0].body).toBe('Please fix this');
      expect(result[0].path).toBe('src/foo.ts');
      expect(result[0].line).toBe(42);
    });
  });

  describe('replyToComment', () => {
    it('should reply to a comment', async () => {
      // GIVEN - gh api accepts reply
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          { stdout: '{}', stderr: '' }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We reply to comment
      await client.replyToComment(1, '123', 'Thanks!');

      // THEN - Should call gh api
      expect(mockExec).toHaveBeenCalled();
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain('gh api');
      expect(call).toContain('replies');
    });
  });

  describe('getRepoInfo', () => {
    it('should detect repo owner and name from git remote', async () => {
      // GIVEN - git remote returns origin URL
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        const isGitRemote = (cmd as string).includes('git remote');
        (callback as (error: Error | null, result: { stdout: string; stderr: string }) => void)(
          null,
          {
            stdout: isGitRemote
              ? 'git@github.com:owner/repo-name.git\n'
              : '',
            stderr: '',
          }
        );
        return {} as ReturnType<typeof exec>;
      });

      // WHEN - We get repo info
      const result = await client.getRepoInfo();

      // THEN - Should parse owner and repo
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo-name');
    });
  });

  describe('rate limiting', () => {
    it('should handle rate limiting gracefully', async () => {
      // GIVEN - gh api returns rate limit error
      mockExec.mockImplementation((cmd: string, callback: unknown) => {
        const error = new Error('rate limit exceeded');
        (error as NodeJS.ErrnoException).code = 'RATE_LIMITED';
        (callback as (error: Error | null) => void)(error);
        return {} as ReturnType<typeof exec>;
      });

      // WHEN/THEN - Should throw RateLimitError
      await expect(client.getOpenPRs()).rejects.toThrow(RateLimitError);
    });
  });
});
