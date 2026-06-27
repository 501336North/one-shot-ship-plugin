/**
 * @behavior The launcher's REAL collaborators that runLaunch wires up:
 *   - resolveClaudeBin: find the real `claude` on PATH, NEVER resolving to the launcher itself
 *     (a launcher installed/symlinked as `claude` must not exec itself → infinite recursion).
 *   - ensureProxy: reuse a healthy proxy on the port; if down, start it (start-proxy --router)
 *     and poll /health until it binds; throw loudly if it never comes up (never silently
 *     continue all-cloud).
 * @acceptance-criteria
 *   - resolveClaudeBin returns the first executable `claude` on PATH, skipping dirs without one.
 *   - resolveClaudeBin skips the candidate that resolves to the launcher (self) and returns the next.
 *   - resolveClaudeBin throws when no real claude is found.
 *   - ensureProxy returns WITHOUT starting when /health is already ok (reuse).
 *   - ensureProxy starts the proxy then resolves once /health becomes ok.
 *   - ensureProxy throws when the proxy never becomes healthy.
 * @boundary oss-launch real deps (filesystem / network / spawn injected)
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveClaudeBin, ensureProxy } from '../../src/cli/oss-launch.js';

describe('resolveClaudeBin: find the real claude, never the launcher', () => {
  it('returns the first executable claude on PATH, skipping dirs without one', () => {
    const bin = resolveClaudeBin({
      pathEnv: '/empty:/usr/local/bin:/usr/bin',
      selfPath: '/opt/oss/bin/oss-launch',
      isExecutable: (p) => p === '/usr/local/bin/claude',
    });
    expect(bin).toBe('/usr/local/bin/claude');
  });

  it('skips a claude that resolves to the launcher itself and returns the next real one', () => {
    const bin = resolveClaudeBin({
      pathEnv: '/shadow:/usr/bin',
      selfPath: '/opt/oss/bin/oss-launch',
      isExecutable: () => true, // every candidate "exists"
      // /shadow/claude is a symlink to the launcher → must be skipped
      realpath: (p) => (p === '/shadow/claude' ? '/opt/oss/bin/oss-launch' : p),
    });
    expect(bin).toBe('/usr/bin/claude');
  });

  it('throws when no real claude is found on PATH', () => {
    expect(() =>
      resolveClaudeBin({
        pathEnv: '/a:/b',
        selfPath: '/opt/oss/bin/oss-launch',
        isExecutable: () => false,
      })
    ).toThrow(/claude/i);
  });
});

describe('ensureProxy: reuse-or-start + loud failure', () => {
  it('returns without starting when the proxy is already healthy (reuse)', async () => {
    const startProxy = vi.fn();
    await ensureProxy(8473, {
      healthCheck: vi.fn(async () => true),
      startProxy,
      sleep: vi.fn(async () => {}),
    });
    expect(startProxy).not.toHaveBeenCalled();
  });

  it('starts the proxy then resolves once /health becomes ok', async () => {
    const startProxy = vi.fn();
    // down on the first probe, healthy after start
    const healthCheck = vi
      .fn<[], Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    await ensureProxy(8473, {
      healthCheck,
      startProxy,
      sleep: vi.fn(async () => {}),
      intervalMs: 1,
    });

    expect(startProxy).toHaveBeenCalledTimes(1);
  });

  it('throws when the proxy never becomes healthy', async () => {
    await expect(
      ensureProxy(8473, {
        healthCheck: vi.fn(async () => false),
        startProxy: vi.fn(),
        sleep: vi.fn(async () => {}),
        maxAttempts: 3,
        intervalMs: 1,
      })
    ).rejects.toThrow(/proxy/i);
  });
});
