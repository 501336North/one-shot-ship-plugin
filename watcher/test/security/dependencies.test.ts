/**
 * @behavior The watcher's dev toolchain has no known CRITICAL advisory
 * @business-rule vitest <= 4.0.0-beta.19 / tinypool <= 2.1.1 carry CRITICAL advisories (mocker path traversal,
 *                prototype pollution leading to RCE in worker options); every lockfile copy must be past them.
 * @boundary Infrastructure (package-lock.json)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const lockfile = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package-lock.json'), 'utf-8'));

/** Every lockfile copy of `name` (hoisted or nested) older than `minimum`, as "path version". */
function outdatedCopies(name: string, minimum: string): string[] {
  const below = (version = '') => {
    const [a, b] = [version, minimum].map((v) => v.split('-')[0].split('.').map(Number));
    const i = a.findIndex((part, n) => part !== b[n]);
    return a.some(Number.isNaN) || (i !== -1 && a[i] < b[i]);
  };
  return Object.entries(lockfile.packages as Record<string, { version?: string }>)
    .filter(([key, { version }]) => (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) && below(version))
    .map(([key, { version }]) => `${key} ${version}`);
}

describe('watcher dev dependencies', () => {
  it('uses vitest >= 4.1.12', () => {
    expect(lockfile.packages['node_modules/vitest'], 'vitest should be in package-lock.json').toBeDefined();
    expect(outdatedCopies('vitest', '4.1.12')).toEqual([]);
    expect(outdatedCopies('@vitest/mocker', '4.1.12')).toEqual([]);
  });

  // vitest 4 no longer depends on tinypool; no copy at all is also secure
  it('has no tinypool <= 2.1.1', () => {
    expect(outdatedCopies('tinypool', '2.1.2')).toEqual([]);
  });
});
