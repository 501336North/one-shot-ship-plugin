/**
 * File Matcher Tests
 *
 * @behavior File matcher finds implementation files for spec components
 * @acceptance-criteria AC-FILE-MATCHER.1 through AC-FILE-MATCHER.6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  findMatchingFile,
  findExtraFiles,
  normalizeComponentName,
} from '../../../src/services/spec-reconciler/file-matcher.js';
import { SpecItem } from '../../../src/services/spec-reconciler/types.js';

describe('File Matcher', () => {
  // Test directories
  let testDir: string;
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-matcher-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('normalizeComponentName', () => {
    it('returns PascalCase variation', () => {
      const variations = normalizeComponentName('UserService');
      expect(variations).toContain('UserService');
    });

    it('returns kebab-case variation', () => {
      const variations = normalizeComponentName('UserService');
      expect(variations).toContain('user-service');
    });

    it('returns camelCase variation', () => {
      const variations = normalizeComponentName('UserService');
      expect(variations).toContain('userService');
    });

    it('returns snake_case variation', () => {
      const variations = normalizeComponentName('UserService');
      expect(variations).toContain('user_service');
    });

    it('handles already kebab-case names', () => {
      const variations = normalizeComponentName('user-service');
      expect(variations).toContain('UserService');
      expect(variations).toContain('user-service');
      expect(variations).toContain('userService');
    });

    it('handles single word names', () => {
      const variations = normalizeComponentName('Auth');
      expect(variations).toContain('Auth');
      expect(variations).toContain('auth');
    });

    it('handles acronyms', () => {
      const variations = normalizeComponentName('APIClient');
      expect(variations).toContain('APIClient');
      expect(variations).toContain('api-client');
    });
  });

  describe('findMatchingFile', () => {
    it('finds file with exact PascalCase name', async () => {
      const filePath = path.join(testDir, 'AuthService.ts');
      fs.writeFileSync(filePath, 'export class AuthService {}');

      const match = await findMatchingFile('AuthService', [testDir]);
      expect(match).toBe(filePath);
    });

    it('finds file with kebab-case name', async () => {
      const filePath = path.join(testDir, 'auth-service.ts');
      fs.writeFileSync(filePath, 'export class AuthService {}');

      const match = await findMatchingFile('AuthService', [testDir]);
      expect(match).toBe(filePath);
    });

    it('finds file with camelCase name', async () => {
      const filePath = path.join(testDir, 'authService.ts');
      fs.writeFileSync(filePath, 'export class AuthService {}');

      const match = await findMatchingFile('AuthService', [testDir]);
      expect(match).toBe(filePath);
    });

    it('finds file in nested directory', async () => {
      const nestedDir = path.join(testDir, 'services', 'auth');
      fs.mkdirSync(nestedDir, { recursive: true });
      const filePath = path.join(nestedDir, 'AuthService.ts');
      fs.writeFileSync(filePath, 'export class AuthService {}');

      const match = await findMatchingFile('AuthService', [testDir]);
      expect(match).toBe(filePath);
    });

    it('returns null when no match found', async () => {
      const match = await findMatchingFile('NonExistent', [testDir]);
      expect(match).toBeNull();
    });

    it('searches multiple paths in order', async () => {
      const dir1 = createTestDir();
      const dir2 = createTestDir();

      const file2 = path.join(dir2, 'Service.ts');
      fs.writeFileSync(file2, 'export class Service {}');

      const match = await findMatchingFile('Service', [dir1, dir2]);
      expect(match).toBe(file2);
    });

    it('finds .tsx files for React components', async () => {
      const filePath = path.join(testDir, 'UserProfile.tsx');
      fs.writeFileSync(filePath, 'export function UserProfile() {}');

      const match = await findMatchingFile('UserProfile', [testDir]);
      expect(match).toBe(filePath);
    });

    it('finds .js files', async () => {
      const filePath = path.join(testDir, 'auth-service.js');
      fs.writeFileSync(filePath, 'module.exports = {}');

      const match = await findMatchingFile('AuthService', [testDir]);
      expect(match).toBe(filePath);
    });

    it('prefers .ts over .js when both exist', async () => {
      const tsFile = path.join(testDir, 'Service.ts');
      const jsFile = path.join(testDir, 'Service.js');
      fs.writeFileSync(tsFile, 'export class Service {}');
      fs.writeFileSync(jsFile, 'module.exports = {}');

      const match = await findMatchingFile('Service', [testDir]);
      expect(match).toBe(tsFile);
    });

    it('ignores test files', async () => {
      const testFile = path.join(testDir, 'Service.test.ts');
      fs.writeFileSync(testFile, 'describe("Service", () => {})');

      const match = await findMatchingFile('Service', [testDir]);
      expect(match).toBeNull();
    });

    it('ignores spec files', async () => {
      const specFile = path.join(testDir, 'Service.spec.ts');
      fs.writeFileSync(specFile, 'describe("Service", () => {})');

      const match = await findMatchingFile('Service', [testDir]);
      expect(match).toBeNull();
    });

    it('ignores node_modules directory', async () => {
      const nodeModules = path.join(testDir, 'node_modules', 'some-package');
      fs.mkdirSync(nodeModules, { recursive: true });
      const filePath = path.join(nodeModules, 'Service.ts');
      fs.writeFileSync(filePath, 'export class Service {}');

      const match = await findMatchingFile('Service', [testDir]);
      expect(match).toBeNull();
    });
  });

  describe('findExtraFiles', () => {
    it('finds files not in spec', async () => {
      // Create files
      fs.writeFileSync(path.join(testDir, 'AuthService.ts'), '');
      fs.writeFileSync(path.join(testDir, 'OrphanService.ts'), '');

      // Spec only has AuthService
      const specComponents: SpecItem[] = [
        {
          id: 'AuthService',
          description: 'Auth handler',
          status: 'checked',
          type: 'component',
        },
      ];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras).toHaveLength(1);
      expect(extras[0]).toContain('OrphanService.ts');
    });

    it('returns empty array when all files are in spec', async () => {
      fs.writeFileSync(path.join(testDir, 'AuthService.ts'), '');

      const specComponents: SpecItem[] = [
        {
          id: 'AuthService',
          description: 'Auth handler',
          status: 'checked',
          type: 'component',
        },
      ];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras).toHaveLength(0);
    });

    it('ignores index files', async () => {
      fs.writeFileSync(path.join(testDir, 'index.ts'), '');
      fs.writeFileSync(path.join(testDir, 'AuthService.ts'), '');

      const specComponents: SpecItem[] = [
        {
          id: 'AuthService',
          description: 'Auth handler',
          status: 'checked',
          type: 'component',
        },
      ];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras).toHaveLength(0);
    });

    it('ignores types files', async () => {
      fs.writeFileSync(path.join(testDir, 'types.ts'), '');
      fs.writeFileSync(path.join(testDir, 'AuthService.ts'), '');

      const specComponents: SpecItem[] = [
        {
          id: 'AuthService',
          description: 'Auth handler',
          status: 'checked',
          type: 'component',
        },
      ];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras).toHaveLength(0);
    });

    it('handles case variations in component matching', async () => {
      fs.writeFileSync(path.join(testDir, 'auth-service.ts'), '');

      const specComponents: SpecItem[] = [
        {
          id: 'AuthService',
          description: 'Auth handler',
          status: 'checked',
          type: 'component',
        },
      ];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras).toHaveLength(0);
    });

    it('searches nested directories', async () => {
      const nested = path.join(testDir, 'services');
      fs.mkdirSync(nested);
      fs.writeFileSync(path.join(nested, 'OrphanService.ts'), '');

      const specComponents: SpecItem[] = [];

      const extras = await findExtraFiles(specComponents, [testDir]);
      expect(extras.some((f) => f.includes('OrphanService.ts'))).toBe(true);
    });
  });
});
