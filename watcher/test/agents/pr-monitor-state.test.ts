/**
 * PRMonitorState Tests
 *
 * @behavior Manages persistent state for PR monitoring
 * @acceptance-criteria State persists across restarts and deduplicates comments
 * @business-rule Processed comments are tracked to avoid duplicate handling
 * @boundary State file I/O
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { PRMonitorState } from '../../src/agents/pr-monitor-state';

describe('PRMonitorState', () => {
  let state: PRMonitorState;
  // the state file is <cwd>/.oss/pr-monitor-state.json: each test runs in its own real temp project (T70e)
  let project: string;
  let originalCwd: string;

  beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pr-monitor-state-')));
    originalCwd = process.cwd();
    process.chdir(project);
    state = new PRMonitorState();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(project, { recursive: true, force: true });
  });

  describe('load', () => {
    it('should load state from .oss/pr-monitor-state.json', async () => {
      // GIVEN - A state file exists
      const mockState = {
        processedCommentIds: ['IC_123', 'IC_456'],
        lastPollTime: '2025-12-23T12:00:00Z',
        lastError: null,
        stats: {
          commentsProcessed: 10,
          tasksQueued: 5,
          tasksCompleted: 3,
          tasksFailed: 1,
        },
      };

      fs.mkdirSync(path.join(project, '.oss'));
      fs.writeFileSync(path.join(project, '.oss', 'pr-monitor-state.json'), JSON.stringify(mockState));

      // WHEN - We load state
      await state.load();

      // THEN - State should be loaded
      expect(state.isProcessed('IC_123')).toBe(true);
      expect(state.isProcessed('IC_456')).toBe(true);
      expect(state.getStats().commentsProcessed).toBe(10);
    });

    it('should create default state if file missing', async () => {
      // GIVEN - No state file (the temp project has none)

      // WHEN - We load state
      await state.load();

      // THEN - Should have default empty state
      expect(state.isProcessed('any-id')).toBe(false);
      expect(state.getStats().commentsProcessed).toBe(0);
    });
  });

  describe('save', () => {
    it('should save state to file', async () => {
      // GIVEN - State with some data
      state.addProcessedComment('IC_789');
      state.incrementStat('commentsProcessed');

      // WHEN - We save state (in the temp project)
      await state.save();

      // THEN - Should write to file with proper formatting
      const filePath = path.join(project, '.oss', 'pr-monitor-state.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(parsed.processedCommentIds).toContain('IC_789');
    });
  });

  describe('addProcessedComment', () => {
    it('should add processed comment ID', () => {
      // WHEN - We add a comment ID
      state.addProcessedComment('IC_new');

      // THEN - ID should be tracked
      expect(state.isProcessed('IC_new')).toBe(true);
    });
  });

  describe('isProcessed', () => {
    it('should check if comment was already processed', () => {
      // GIVEN - A processed comment
      state.addProcessedComment('IC_known');

      // WHEN/THEN - Check known and unknown IDs
      expect(state.isProcessed('IC_known')).toBe(true);
      expect(state.isProcessed('IC_unknown')).toBe(false);
    });
  });

  describe('updateLastPollTime', () => {
    it('should update lastPollTime', () => {
      // GIVEN - State with no poll time
      expect(state.getLastPollTime()).toBeNull();

      // WHEN - We update poll time
      state.updateLastPollTime();

      // THEN - Should have a timestamp
      expect(state.getLastPollTime()).not.toBeNull();
    });
  });

  describe('stats', () => {
    it('should update stats (commentsProcessed, tasksQueued)', () => {
      // WHEN - We increment stats
      state.incrementStat('commentsProcessed');
      state.incrementStat('commentsProcessed');
      state.incrementStat('tasksQueued');

      // THEN - Stats should reflect increments
      const stats = state.getStats();
      expect(stats.commentsProcessed).toBe(2);
      expect(stats.tasksQueued).toBe(1);
    });

    it('should provide all stat categories', () => {
      // WHEN - We get stats
      const stats = state.getStats();

      // THEN - All categories should exist
      expect(stats).toHaveProperty('commentsProcessed');
      expect(stats).toHaveProperty('tasksQueued');
      expect(stats).toHaveProperty('tasksCompleted');
      expect(stats).toHaveProperty('tasksFailed');
    });
  });
});
