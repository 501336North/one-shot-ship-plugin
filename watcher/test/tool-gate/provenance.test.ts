/**
 * @behavior The tool gate's rule values (protected branches, test patterns, source
 *   extensions, protected paths, production hosts) are shipped in one place: the plugin's
 *   `config/tool-gates.json`.
 * @business-rule No list from the base settings is copied into the gate's code, so changing
 *   a value in the settings file changes what the gate does, and nothing else can drift.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_FILE = fileURLToPath(new URL('../../../config/tool-gates.json', import.meta.url));
const GATE_SRC = fileURLToPath(new URL('../../src/tool-gate/', import.meta.url));

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function baseListValues(): string[] {
  const base: Record<string, unknown> = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  return Object.values(base).flatMap((value) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
  );
}

describe('base settings file', () => {
  it('should ship the design settings, with the gate state folder protected', () => {
    const base: unknown = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
    expect(base).toEqual({
      version: 1,
      protectedBranches: ['main', 'master'],
      testFilePatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test_*.sh', '**/*_test.go'],
      testCommandPatterns: [
        'npm test', 'npm run test*', 'pnpm test', 'pnpm run test*', 'yarn test', 'yarn run test*',
        'bun test', 'npx vitest', 'npx jest', 'vitest', 'jest', 'pytest', 'python -m pytest',
        'go test', 'cargo test', 'swift test', 'make test', 'make check', './gradlew test',
        'gradle test', 'mvn test', 'dotnet test', 'rspec', 'bundle exec rspec', 'phpunit',
        'bash *test*.sh',
      ],
      sourceExtensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.py', '.go', '.rs', '.swift'],
      protectedPaths: ['.oss/tool-gates.json', '.oss/tool-gates/**', '~/.oss/hooks/**', '.claude/settings*.json'],
      productionHosts: [],
      tagsAllowed: true,
    });
  });
});

describe('rule values live only in the settings file', () => {
  it("should find none of the base file's list values as literals in watcher/src/tool-gate/**", () => {
    const values = baseListValues().filter((value) => value.length >= 4);
    expect(values.length).toBeGreaterThan(20);
    const sources = tsFiles(GATE_SRC);
    expect(sources.length).toBeGreaterThan(0);

    const found: string[] = [];
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const value of values) {
        for (const quote of ["'", '"', '`']) {
          if (text.includes(`${quote}${value}${quote}`)) {
            found.push(`${path.relative(GATE_SRC, file)}: ${quote}${value}${quote}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
