/**
 * @behavior oss-decrypt refuses a signed manifest older than the newest one it has accepted from the same API
 * @business-rule R-273 D11 / ADR-007: a rising signed version blocks replay of an old (signed, but stale) manifest.
 *   The floor lives in its own file keyed by apiUrl, starts at a compiled-in minimum, and only rises.
 * @boundary Filesystem (the config dir is a temp OSS_CONFIG_DIR)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  MIN_MANIFEST_VERSION,
  readManifestFloor,
  checkAndRecordManifestVersion,
} from '../src/manifest-floor.js';

const LIVE_VERSION = 1794940034;
const API = 'https://one-shot-ship-api.onrender.com';
const OTHER_API = 'https://sprint-d.example.com';

describe('Manifest anti-rollback floor (R-273 P4)', () => {
  let dir: string;
  let floorPath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `oss-manifest-floor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    process.env.OSS_CONFIG_DIR = dir;
    floorPath = join(dir, 'manifest-floor.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OSS_CONFIG_DIR;
  });

  const stored = (): Record<string, number> => JSON.parse(readFileSync(floorPath, 'utf8')) as Record<string, number>;

  it('starts at the live manifest version compiled into the binary', () => {
    expect(MIN_MANIFEST_VERSION).toBe(LIVE_VERSION);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION);
  });

  it('refuses a version below the floor on first use and writes nothing', () => {
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION - 1)).toBe('older');
    expect(existsSync(floorPath)).toBe(false);
  });

  it('accepts a newer version and records it as the new floor for that API', () => {
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
    expect(stored()[API]).toBe(LIVE_VERSION + 10);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
  });

  it('then refuses a version below the recorded floor and leaves the floor where it was', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 10);
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('older');
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
  });

  it('accepts an equal version without rewriting the floor file', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 10);
    const past = new Date('2020-01-01T00:00:00Z');
    utimesSync(floorPath, past, past);

    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
    expect(statSync(floorPath).mtimeMs).toBe(past.getTime());
  });

  it('writes through a temp file in the same directory and leaves nothing else behind', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 1);
    checkAndRecordManifestVersion(API, LIVE_VERSION + 2);
    expect(readdirSync(dir)).toEqual(['manifest-floor.json']);
  });

  it.each([
    ['torn JSON', `{"${API}": 17949`],
    ['empty file', ''],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['a number', '99999999999'],
    ['a non-integer value', JSON.stringify({ [API]: 'big' })],
  ])('a floor file holding %s falls back to the compiled floor', (_label, content) => {
    writeFileSync(floorPath, content);
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION - 1)).toBe('older');
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 1);
  });

  it('a stored value below the compiled floor does not lower it', () => {
    writeFileSync(floorPath, JSON.stringify({ [API]: 1 }));
    expect(readManifestFloor(API)).toBe(LIVE_VERSION);
    expect(checkAndRecordManifestVersion(API, 2)).toBe('older');
  });

  it.each([
    ['missing', undefined],
    ['a fraction', LIVE_VERSION + 0.5],
    ['a numeric string', String(LIVE_VERSION + 1)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('a version that is %s is refused as invalid and the floor is unchanged', (_label, version) => {
    expect(checkAndRecordManifestVersion(API, version)).toBe('invalid');
    expect(existsSync(floorPath)).toBe(false);
  });

  it('keeps one floor per API, so another API starts at the compiled floor', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 100);
    expect(checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION)).toBe('accepted');
    expect(readManifestFloor(OTHER_API)).toBe(LIVE_VERSION);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 100);
  });

  it('recording one API keeps the floors of the others', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 100);
    checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION + 7);
    expect(stored()).toEqual({ [API]: LIVE_VERSION + 100, [OTHER_API]: LIVE_VERSION + 7 });
  });

  it('an inherited key such as __proto__ is not a floor', () => {
    writeFileSync(floorPath, JSON.stringify({ [API]: LIVE_VERSION + 3 }));
    expect(readManifestFloor('__proto__')).toBe(LIVE_VERSION);
    expect(readManifestFloor('constructor')).toBe(LIVE_VERSION);
  });

  it('parallel checks never leave the floor below an accepted version nor accept one below the floor', async () => {
    const versions = [5, 1, 9, 3, 9, 7, 2].map(d => LIVE_VERSION + d);
    const verdicts = await Promise.all(
      versions.map(v => Promise.resolve().then(() => ({ v, verdict: checkAndRecordManifestVersion(API, v) })))
    );

    const accepted = verdicts.filter(r => r.verdict === 'accepted').map(r => r.v);
    const floor = readManifestFloor(API);
    expect(accepted.length).toBeGreaterThan(0);
    expect(floor).toBe(Math.max(...accepted));
    let seen = MIN_MANIFEST_VERSION;
    for (const { v, verdict } of verdicts) {
      expect(verdict).toBe(v >= seen ? 'accepted' : 'older');
      seen = Math.max(seen, v);
    }
  });
});
