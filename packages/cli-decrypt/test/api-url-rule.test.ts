/**
 * @behavior getApiUrl accepts exactly the apiUrl values listed as accepted in the shared case table
 *   (returning the value unchanged, or the default API when it is missing/null/empty) and refuses every
 *   other value with one message that never echoes the value.
 * @business-rule The API key may only go to an https URL, or plain http to the literal loopback, with no
 *   userinfo, query, fragment, glob characters, whitespace or control characters. The bash helper
 *   oss_api_url (hooks/oss-api-curl.sh) answers the same table the same way
 *   (hooks/__tests__/oss-api-url-cases.test.sh).
 * @boundary config.json in OSS_CONFIG_DIR (file system) -> getApiUrl
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { getApiUrl, DEFAULT_API_URL } from '../src/config.js';

interface ApiUrlCase {
  apiUrl?: unknown;
  accept: boolean;
  why: string;
}

const CASES = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'api-url-cases.json'), 'utf8')
) as ApiUrlCase[];

const REFUSAL =
  'apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment.';

describe('one apiUrl rule (shared case table)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'oss-apiurl-rule-'));
    process.env.OSS_CONFIG_DIR = dir;
  });

  afterEach(() => {
    delete process.env.OSS_CONFIG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(CASES.map((c) => [c.why, c] as const))('%s', (_why, c) => {
    const config = 'apiUrl' in c ? { apiUrl: c.apiUrl } : {};
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    if (c.accept) {
      const expected = typeof c.apiUrl === 'string' && c.apiUrl !== '' ? c.apiUrl : DEFAULT_API_URL;
      expect(getApiUrl()).toBe(expected);
    } else {
      expect(() => getApiUrl()).toThrow(REFUSAL);
    }
  });
});
