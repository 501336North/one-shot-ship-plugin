/**
 * @behavior A manifest request that never answers is still awaited at 9.999 s, abandoned at 10 s, and the prompt is
 *           refused. (Production measured 2-4 s, so the old 3 s limit skipped verification on about one fetch in three.)
 * @business-rule FR3 (release-channels ship round 1): manifest fetch timeout 10 s, fail closed.
 * @boundary fetchVerifiedManifest, with fetch (the network) stubbed and timers faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { fetchVerifiedManifest } from '../src/verified-manifest.js';

const ORIGIN = 'http://127.0.0.1:4100';
const ANY_KEY = 'MCowBQYDK2VwAyEAKLiCuK8jxJRAfaV1bqE5aSeNP+T5pG3r2jFmLb0sfqI=';

describe('manifest fetch timeout', () => {
  let dir: string;
  let aborted: boolean;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oss-manifest-timeout-'));
    process.env.OSS_CONFIG_DIR = dir;
    aborted = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // A server that never answers: the request settles only when it is aborted.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new Error('aborted'));
            });
          })
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('waits up to 10 s, then gives up and refuses', async () => {
    const outcome = fetchVerifiedManifest(ORIGIN, ANY_KEY);
    const settled = outcome.then(
      () => 'resolved',
      (err: unknown) => (err instanceof Error ? err.message : String(err))
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(await settled).toMatch(/\[SECURITY\]/);
  });
});
