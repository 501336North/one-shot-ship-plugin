/**
 * @behavior A test that needs a fake command gets one that has already been run once, so the
 *           first-exec security scan (macOS: 0.3-60 s per new file) is paid before any timed section.
 * @business-rule Hook tests must not fail because of how long the OS takes to vet a new file (T7).
 *           The warm-up run must not perform the stub's real work, and later runs must.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeWarmStub, WARMUP_TIMEOUT_MS } from './warm-stub';

describe('writeWarmStub', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warm-stub-test-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it(
    'should run a new stub once before handing it over',
    () => {
      const stub = path.join(dir, 'bin', 'fake-tool');
      const sideEffect = path.join(dir, 'ran');
      const warmMarkers: boolean[] = [];

      writeWarmStub(stub, `echo body > "${sideEffect}"\n`, (marker) => {
        warmMarkers.push(fs.existsSync(marker));
      });

      // The warm-up ran the stub and left its marker.
      expect(warmMarkers).toEqual([true]);
      // ...but did not do the stub's real work.
      expect(fs.existsSync(sideEffect)).toBe(false);

      // A normal run, by direct exec, does the real work.
      execFileSync(stub);
      expect(fs.readFileSync(sideEffect, 'utf8')).toBe('body\n');
    },
    WARMUP_TIMEOUT_MS
  );
});
