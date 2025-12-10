import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execAsync } from '../../src/utils/exec';
import { checkGitSafety } from '../../src/healthchecks/git-safety';

vi.mock('../../src/utils/exec');

const mockExec = vi.mocked(execAsync);

describe('GitSafetyHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass when on feature branch with no direct main pushes', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'feat/my-feature\n',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    mockExec.mockResolvedValueOnce({
      stdout: '', // No direct agent commits on main
      stderr: '',
    });

    const result = await checkGitSafety();

    expect(result.status).toBe('pass');
    expect(result.details?.currentBranch).toBe('feat/my-feature');
    expect(result.details?.onProtectedBranch).toBe(false);
    expect(result.message).toContain('On feature branch');
  });

  it('should FAIL when agent pushed directly to main (not via PR)', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'feat/safe-branch\n',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    // This returns a commit WITHOUT (#123) pattern, indicating direct push
    mockExec.mockResolvedValueOnce({
      stdout: 'abc1234 feat: direct push without PR\n',
      stderr: '',
    });

    const result = await checkGitSafety();

    expect(result.status).toBe('fail');
    expect(result.message).toContain('IRON LAW #4');
    expect(result.message).toContain('Direct push to main');
    expect(result.details?.violation).toBeDefined();
    expect(result.details?.violation).toMatchObject({
      hash: 'abc1234',
      message: 'feat: direct push without PR',
    });
  });

  it('should pass when agent commit has PR number (squash merge is OK)', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'feat/my-feature\n',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    // This returns a squash-merged commit WITH (#123) pattern
    mockExec.mockResolvedValueOnce({
      stdout: 'abc1234 feat: add new feature (#42)\n',
      stderr: '',
    });

    const result = await checkGitSafety();

    // Should pass because (#42) indicates it came through a PR
    expect(result.status).toBe('pass');
    expect(result.details?.violation).toBeUndefined();
  });

  it('should warn if currently on main branch', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'main\n',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    const result = await checkGitSafety();

    expect(result.status).toBe('warn');
    expect(result.details?.onProtectedBranch).toBe(true);
    expect(result.message).toContain('protected branch');
    expect(result.message).toContain('create feature branch');
  });

  it('should warn if currently on master branch', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'master\n',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    const result = await checkGitSafety();

    expect(result.status).toBe('warn');
    expect(result.details?.onProtectedBranch).toBe(true);
  });

  it('should handle git command errors gracefully', async () => {
    mockExec.mockRejectedValueOnce(new Error('Not a git repository'));

    const result = await checkGitSafety();

    expect(result.status).toBe('fail');
    expect(result.message).toContain('Git safety check failed');
  });

  it('should handle detached HEAD state', async () => {
    // Mock git branch --show-current (detached HEAD returns empty)
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    // Mock git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1
    mockExec.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
    });

    const result = await checkGitSafety();

    expect(result.details?.currentBranch).toBe('(detached HEAD)');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Detached HEAD');
  });

  it('should ignore errors when checking main branch commits', async () => {
    // Mock git branch --show-current
    mockExec.mockResolvedValueOnce({
      stdout: 'feat/my-feature\n',
      stderr: '',
    });

    // Mock git log main --no-merges failing (e.g., main doesn't exist)
    mockExec.mockRejectedValueOnce(new Error('fatal: bad revision main'));

    const result = await checkGitSafety();

    // Should still pass - errors checking main are ignored
    expect(result.status).toBe('pass');
    expect(result.details?.currentBranch).toBe('feat/my-feature');
  });
});
