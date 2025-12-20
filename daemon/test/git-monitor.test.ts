/**
 * @behavior GitMonitor detects when on main/master branch
 * @acceptance-criteria AC-DAEMON-010
 * @business-rule DAEMON-010 - Agents must not push to main
 * @boundary Git Repository
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { GitMonitor, GitBranchResult } from '../src/git-monitor.js';

describe('GitMonitor', () => {
  let monitor: GitMonitor;

  beforeEach(() => {
    monitor = new GitMonitor();
  });

  describe('Branch Detection', () => {
    it('should detect when on main branch', async () => {
      // Mock git output
      vi.spyOn(monitor, 'getCurrentBranch').mockResolvedValue('main');

      const issue = await monitor.checkBranch();

      expect(issue).not.toBeNull();
      expect(issue?.type).toBe('branch_violation');
      expect(issue?.message).toContain('main');
      expect(issue?.severity).toBe('error');
    });

    it('should detect when on master branch', async () => {
      vi.spyOn(monitor, 'getCurrentBranch').mockResolvedValue('master');

      const issue = await monitor.checkBranch();

      expect(issue).not.toBeNull();
      expect(issue?.type).toBe('branch_violation');
      expect(issue?.message).toContain('master');
    });

    it('should return null on feature branch', async () => {
      vi.spyOn(monitor, 'getCurrentBranch').mockResolvedValue('feat/my-feature');

      const issue = await monitor.checkBranch();

      expect(issue).toBeNull();
    });

    it('should return null on fix branch', async () => {
      vi.spyOn(monitor, 'getCurrentBranch').mockResolvedValue('fix/bug-123');

      const issue = await monitor.checkBranch();

      expect(issue).toBeNull();
    });

    it('should handle git not being available', async () => {
      vi.spyOn(monitor, 'getCurrentBranch').mockRejectedValue(new Error('git not found'));

      const issue = await monitor.checkBranch();

      // Should not crash, just return null
      expect(issue).toBeNull();
    });
  });

  describe('Get Current Branch', () => {
    it('should return branch name as string', async () => {
      // This test uses the real git command
      const branch = await monitor.getCurrentBranch();

      // Should be a string (could be any branch)
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    });
  });
});
