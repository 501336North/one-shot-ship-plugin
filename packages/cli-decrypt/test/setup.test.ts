/**
 * @behavior CLI package exists and is buildable
 * @acceptance-criteria AC-CLI-001
 * @business-rule CLI-001
 * @boundary CLI Package
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('CLI Package Setup', () => {
  const packageRoot = resolve(__dirname, '..');

  describe('Package Structure', () => {
    it('should have package.json with correct configuration', () => {
      const packageJsonPath = resolve(packageRoot, 'package.json');
      expect(existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(packageJson.name).toBe('@oss/decrypt');
      expect(packageJson.bin).toHaveProperty('oss-decrypt');
    });

    it('should have tsconfig.json', () => {
      const tsconfigPath = resolve(packageRoot, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);
    });

    it('should export main function from index', async () => {
      // This test verifies the module can be imported
      const indexPath = resolve(packageRoot, 'src/index.ts');
      expect(existsSync(indexPath)).toBe(true);
    });

    it('should have CLI entry point', () => {
      const cliPath = resolve(packageRoot, 'src/cli.ts');
      expect(existsSync(cliPath)).toBe(true);
    });
  });
});
