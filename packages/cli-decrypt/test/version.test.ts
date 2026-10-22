/**
 * @behavior A user running `oss-decrypt --version` sees the version that was released.
 * @acceptance-criteria The VERSION constant and the built bundle's `--version` output both
 *           equal package.json `version`.
 * @business-rule VER-001: a release cannot report a different version than the one published.
 * @boundary Source constant (src/index.ts) and the tracked bundle (dist/oss-decrypt.cjs)
 *
 * tsconfig `rootDir: ./src` forbids importing ../package.json from src, so the constant
 * stays and this test is the single-source guard that keeps it in step with package.json.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { VERSION } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const bundlePath = resolve(__dirname, '../dist/oss-decrypt.cjs');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

describe('oss-decrypt version', () => {
  it('should report the package.json version', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('should print that version from the built CLI', () => {
    const stdout = execFileSync(process.execPath, [bundlePath, '--version'], {
      encoding: 'utf8',
    });

    expect(stdout.trim()).toBe(`oss-decrypt v${pkg.version}`);
  });
});
