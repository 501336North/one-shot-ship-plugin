/**
 * @behavior Build script creates executable binaries
 * @acceptance-criteria AC-DECRYPT-010
 * @business-rule DECRYPT-010
 * @boundary Build Pipeline
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PACKAGE_ROOT = join(__dirname, '..');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');

describe('Build Pipeline', () => {
  describe('TypeScript compilation', () => {
    beforeAll(() => {
      // Run build before tests
      execSync('npm run build', { cwd: PACKAGE_ROOT, stdio: 'pipe' });
    });

    it('should create dist directory', () => {
      expect(existsSync(DIST_DIR)).toBe(true);
    });

    it('should create cli.js entry point', () => {
      expect(existsSync(join(DIST_DIR, 'cli.js'))).toBe(true);
    });

    it('should create index.js', () => {
      expect(existsSync(join(DIST_DIR, 'index.js'))).toBe(true);
    });

    it('should create all command files', () => {
      expect(existsSync(join(DIST_DIR, 'commands', 'setup.js'))).toBe(true);
      expect(existsSync(join(DIST_DIR, 'commands', 'decrypt.js'))).toBe(true);
    });

    it('should create all utility files', () => {
      expect(existsSync(join(DIST_DIR, 'encryption.js'))).toBe(true);
      expect(existsSync(join(DIST_DIR, 'storage.js'))).toBe(true);
      expect(existsSync(join(DIST_DIR, 'hardware.js'))).toBe(true);
      expect(existsSync(join(DIST_DIR, 'api-client.js'))).toBe(true);
    });
  });

  describe('Package scripts', () => {
    it('should have build script in package.json', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../package.json');
      expect(pkg.scripts.build).toBeDefined();
    });

    it('should have bundle script for creating single-file output', () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../package.json');
      expect(pkg.scripts['build:bundle']).toBeDefined();
    });
  });
});
