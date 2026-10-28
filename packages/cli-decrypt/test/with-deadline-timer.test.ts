/**
 * @behavior Once a CLI request to the OSS API has finished, successfully or not, its deadline timer is gone, so the
 *           oss-decrypt process exits as soon as its work is done instead of waiting out the 60 s limit.
 * @business-rule UR9 (release-channels ship round 4): the IRON LAWS sync gives oss-decrypt a 15 s watchdog; a request
 *           deadline left pending would keep the process alive past it and every sync would be killed.
 * @boundary withDeadline itself, under fake timers, so the pending-timer count is observed directly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { withDeadline } from '../src/with-deadline.js';

const LIMIT_MS = 60_000;
const timeoutError = (): Error => new Error('timed out');

describe('withDeadline leaves no timer behind once the request has settled (UR9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('after a request that answers', async () => {
    expect(await withDeadline(LIMIT_MS, async () => 'answer', timeoutError)).toBe('answer');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('after a request that fails', async () => {
    const failing = withDeadline(
      LIMIT_MS,
      async () => {
        throw new Error('connection refused');
      },
      timeoutError
    );

    await expect(failing).rejects.toThrow('connection refused');
    expect(vi.getTimerCount()).toBe(0);
  });
});
