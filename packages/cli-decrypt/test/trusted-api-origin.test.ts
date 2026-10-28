/**
 * @behavior oss-decrypt sends the user's API key, and trusts signed prompts, only from the production API, the
 *           staging API, or plain-http loopback (local development). Each trusted address is reduced to one
 *           canonical origin before anything is compared or requested, so `…com/` and `…com:443` are production.
 * @business-rule FR4 + FR6 (release-channels ship round 1): one trust rule for every API-key sender, written as a
 *           shared case table (test/fixtures/trusted-api-url-cases.json) that the shell, the watcher and this CLI
 *           all answer identically.
 * @boundary trustedApiOrigin(apiUrl) and publicKeyFor(apiUrl): pure functions, no mocks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { trustedApiOrigin, publicKeyFor } from '../src/manifest-keys.js';

interface TrustedApiUrlCase {
  apiUrl: string;
  trusted: boolean;
  canonical: string | null;
  why: string;
}

const CASES = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'trusted-api-url-cases.json'), 'utf8')
) as TrustedApiUrlCase[];

describe('one trusted-address rule (shared case table)', () => {
  it('the table has trusted and untrusted rows', () => {
    expect(CASES.some((c) => c.trusted)).toBe(true);
    expect(CASES.some((c) => !c.trusted)).toBe(true);
  });

  it.each(CASES.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    if (c.trusted) {
      expect(trustedApiOrigin(c.apiUrl)).toBe(c.canonical);
      expect(() => publicKeyFor(c.apiUrl)).not.toThrow();
    } else {
      expect(trustedApiOrigin(c.apiUrl)).toBeNull();
      expect(() => publicKeyFor(c.apiUrl)).toThrow(/apiUrl/);
    }
  });
});
