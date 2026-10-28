/**
 * @behavior Once a watcher request to the OSS API has finished, successfully or not, its deadline timer is gone,
 *           so no stray timer outlives the request (and none keeps a short-lived process alive).
 * @business-rule UR9 (release-channels ship round 4): the deadline timer is cleared when the request settles,
 *           the same guarantee the CLI's withDeadline gives (packages/cli-decrypt/src/with-deadline.ts).
 * @boundary withDeadline itself, under fake timers, so the pending-timer count is observed directly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { withDeadline } from '../../src/api/with-deadline.js';

const LIMIT_MS = 60_000;

describe('withDeadline leaves no timer behind once the request has settled (UR9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('after a request that answers', async () => {
    expect(await withDeadline(LIMIT_MS, async () => 'answer')).toBe('answer');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a request that fails', async () => {
    const failing = withDeadline(LIMIT_MS, async () => {
      throw new Error('connection refused');
    });

    await expect(failing).rejects.toThrow('connection refused');
    expect(vi.getTimerCount()).toBe(0);
  });
});
