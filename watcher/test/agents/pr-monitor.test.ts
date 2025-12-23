/**
 * PRMonitorAgent Tests
 *
 * @behavior Monitors PRs for review comments and queues remediation tasks
 * @acceptance-criteria Agent implements BackgroundAgent and processes comments
 * @business-rule Only unprocessed change request comments are queued
 * @boundary PR Monitor Agent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRMonitorAgent } from '../../src/agents/pr-monitor';
import { PRMonitorState } from '../../src/agents/pr-monitor-state';
import { GitHubClient } from '../../src/agents/github-client';
import { isBackgroundAgent } from '../../src/agents/types';

// Mock dependencies
vi.mock('../../src/agents/pr-monitor-state');
vi.mock('../../src/agents/github-client');

describe('PRMonitorAgent', () => {
  let agent: PRMonitorAgent;
  let mockState: PRMonitorState;
  let mockClient: GitHubClient;

  beforeEach(() => {
    mockState = new PRMonitorState();
    mockClient = new GitHubClient();
    agent = new PRMonitorAgent(mockState, mockClient);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BackgroundAgent Interface', () => {
    it('should implement BackgroundAgent interface', () => {
      // WHEN - We check if agent implements interface
      const result = isBackgroundAgent(agent);

      // THEN - Should be a valid BackgroundAgent
      expect(result).toBe(true);
    });

    it('should have correct metadata', () => {
      // WHEN - We check metadata
      const metadata = agent.metadata;

      // THEN - Should have proper metadata
      expect(metadata.name).toBe('pr-monitor');
      expect(metadata.description).toContain('PR');
      expect(metadata.version).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize by loading state and config', async () => {
      // GIVEN - Mock state load
      vi.mocked(mockState.load).mockResolvedValue(undefined);

      // WHEN - We initialize
      await agent.initialize();

      // THEN - State should be loaded
      expect(mockState.load).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return current status with health metrics', () => {
      // GIVEN - Agent has been initialized
      vi.mocked(mockState.getLastPollTime).mockReturnValue('2025-12-23T12:00:00Z');

      // WHEN - We get status
      const status = agent.getStatus();

      // THEN - Should return AgentStatus object
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastPollTime');
      expect(status).toHaveProperty('errorCount');
      expect(status).toHaveProperty('lastError');
    });
  });

  describe('start and stop', () => {
    it('should start and mark as running', async () => {
      // WHEN - We start
      await agent.start();

      // THEN - Should be running
      const status = agent.getStatus();
      expect(status.isRunning).toBe(true);
    });

    it('should stop and mark as not running', async () => {
      // GIVEN - Agent is running
      await agent.start();

      // WHEN - We stop
      await agent.stop();

      // THEN - Should not be running
      const status = agent.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });

  describe('poll', () => {
    it('should fetch all open PRs on poll', async () => {
      // GIVEN - GitHub returns open PRs
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
        { number: 2, title: 'PR 2', branch: 'feat/two' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);

      // WHEN - We poll
      await agent.poll();

      // THEN - Should fetch PRs
      expect(mockClient.getOpenPRs).toHaveBeenCalled();
    });

    it('should fetch comments for each open PR', async () => {
      // GIVEN - GitHub returns PRs
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
        { number: 2, title: 'PR 2', branch: 'feat/two' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);

      // WHEN - We poll
      await agent.poll();

      // THEN - Should fetch comments for each PR
      expect(mockClient.getPRReviewComments).toHaveBeenCalledWith(1);
      expect(mockClient.getPRReviewComments).toHaveBeenCalledWith(2);
    });

    it('should skip already-processed comment IDs', async () => {
      // GIVEN - PR with processed and unprocessed comments
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([
        { id: '123', body: 'Fix this', path: 'src/foo.ts', line: 10 },
        { id: '456', body: 'Also fix', path: 'src/bar.ts', line: 20 },
      ]);
      vi.mocked(mockState.isProcessed).mockImplementation((id) => id === '123');

      // WHEN - We poll
      const result = await agent.poll();

      // THEN - Should only get unprocessed comments
      expect(mockState.isProcessed).toHaveBeenCalledWith('123');
      expect(mockState.isProcessed).toHaveBeenCalledWith('456');
    });

    it('should identify change request comments', async () => {
      // GIVEN - Comments with different types
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([
        { id: '1', body: 'Please fix this bug', path: 'src/foo.ts', line: 10 },
        { id: '2', body: 'LGTM!', path: 'src/bar.ts', line: 20 },
        { id: '3', body: 'Could you refactor this?', path: 'src/baz.ts', line: 30 },
      ]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);

      // WHEN - We poll
      await agent.poll();

      // THEN - Should identify change requests (tested via isChangeRequest)
      expect(agent.isChangeRequest({ id: '1', body: 'Please fix this', path: '', line: 0 })).toBe(true);
      expect(agent.isChangeRequest({ id: '2', body: 'LGTM!', path: '', line: 0 })).toBe(false);
    });

    it('should update lastPollTime after successful poll', async () => {
      // GIVEN - Empty PRs
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([]);

      // WHEN - We poll
      await agent.poll();

      // THEN - Should update poll time
      expect(mockState.updateLastPollTime).toHaveBeenCalled();
    });
  });

  describe('task queuing', () => {
    it('should reply to comment before queuing with acknowledgment', async () => {
      // GIVEN - A change request comment
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([
        { id: '123', body: 'Please fix this bug', path: 'src/foo.ts', line: 10 },
      ]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);
      vi.mocked(mockClient.replyToComment).mockResolvedValue(undefined);

      // WHEN - We poll
      await agent.poll();

      // THEN - Should reply with acknowledgment
      expect(mockClient.replyToComment).toHaveBeenCalledWith(
        1,
        '123',
        expect.stringContaining('Addressing')
      );
    });

    it('should analyze comment and determine suggested agent', () => {
      // WHEN - Analyzing different comment types
      const typeScriptComment = { id: '1', body: 'Fix the TypeScript types here', path: 'src/foo.ts', line: 10 };
      const testComment = { id: '2', body: 'Please add tests for this', path: 'src/bar.ts', line: 20 };
      const performanceComment = { id: '3', body: 'Optimize this for performance', path: 'src/baz.ts', line: 30 };
      const genericComment = { id: '4', body: 'Please fix this issue', path: 'src/qux.ts', line: 40 };

      // THEN - Should suggest appropriate agents
      expect(agent.determineSuggestedAgent(typeScriptComment)).toBe('typescript-pro');
      expect(agent.determineSuggestedAgent(testComment)).toBe('test-engineer');
      expect(agent.determineSuggestedAgent(performanceComment)).toBe('performance-engineer');
      expect(agent.determineSuggestedAgent(genericComment)).toBe('debugger');
    });

    it('should queue task with full PR context', async () => {
      // GIVEN - A change request comment
      const pr = { number: 1, title: 'PR 1', branch: 'feat/one' };
      const comment = { id: '123', body: 'Please fix this bug', path: 'src/foo.ts', line: 10 };

      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([pr]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([comment]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);
      vi.mocked(mockClient.replyToComment).mockResolvedValue(undefined);

      // WHEN - We poll
      await agent.poll();

      // THEN - Task should be queued (check via getQueuedTasks)
      const tasks = agent.getQueuedTasks();
      expect(tasks.length).toBe(1);
      expect(tasks[0]).toMatchObject({
        prNumber: 1,
        branch: 'feat/one',
        path: 'src/foo.ts',
        line: 10,
        commentId: '123',
        commentBody: 'Please fix this bug',
      });
    });

    it('should mark comment as processed after queuing', async () => {
      // GIVEN - A change request comment
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([
        { id: '123', body: 'Please fix this bug', path: 'src/foo.ts', line: 10 },
      ]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);
      vi.mocked(mockClient.replyToComment).mockResolvedValue(undefined);

      // WHEN - We poll
      await agent.poll();

      // THEN - Comment should be marked as processed
      expect(mockState.addProcessedComment).toHaveBeenCalledWith('123');
    });

    it('should increment stats after successful queue', async () => {
      // GIVEN - A change request comment
      vi.mocked(mockClient.getOpenPRs).mockResolvedValue([
        { number: 1, title: 'PR 1', branch: 'feat/one' },
      ]);
      vi.mocked(mockClient.getPRReviewComments).mockResolvedValue([
        { id: '123', body: 'Please fix this bug', path: 'src/foo.ts', line: 10 },
      ]);
      vi.mocked(mockState.isProcessed).mockReturnValue(false);
      vi.mocked(mockClient.replyToComment).mockResolvedValue(undefined);

      // WHEN - We poll
      await agent.poll();

      // THEN - Stats should be incremented
      expect(mockState.incrementStat).toHaveBeenCalledWith('tasksQueued');
    });
  });
});
