/**
 * @behavior The tool gate reads its settings from the plugin's base file and lets a repo add
 *   to them with `.oss/tool-gates.json`: extra protected paths, production hosts, test
 *   patterns, source extensions and protected branches, or `tagsAllowed: false`.
 * @business-rule A repo file can only add or tighten. A repo file that drops a base value,
 *   loosens `tagsAllowed`, or is malformed in any way is ignored as a whole: the base rules
 *   apply and a one-line reason says why, without echoing the file. A missing or broken
 *   base file is a gate error.
 */

import { describe, it, expect } from 'vitest';
import { loadSettings, type GateSettings, type ReadFile } from '../../src/tool-gate/rule-file.js';

const PLUGIN_ROOT = '/plugin';
const REPO_ROOT = '/work/repo';
const BASE_PATH = '/plugin/config/tool-gates.json';
const REPO_PATH = '/work/repo/.oss/tool-gates.json';

const BASE: GateSettings = {
  version: 1,
  protectedBranches: ['main', 'master'],
  testFilePatterns: ['**/*.test.*', '**/*.spec.*'],
  testCommandPatterns: ['npm test', 'npx vitest'],
  sourceExtensions: ['.ts', '.js'],
  protectedPaths: ['.oss/tool-gates.json', '.oss/tool-gates/**'],
  productionHosts: [],
  tagsAllowed: true,
};

const LIST_KEYS = [
  'protectedBranches',
  'testFilePatterns',
  'testCommandPatterns',
  'sourceExtensions',
  'protectedPaths',
  'productionHosts',
] as const;

function files(base: string | null, repo: string | null): ReadFile {
  return (absPath: string) => {
    if (absPath === BASE_PATH) return base;
    if (absPath === REPO_PATH) return repo;
    return null;
  };
}

function load(repo: unknown, base: GateSettings = BASE) {
  const repoText = typeof repo === 'string' ? repo : JSON.stringify(repo);
  return loadSettings(files(JSON.stringify(base), repoText), PLUGIN_ROOT, REPO_ROOT);
}

function expectRejected(result: ReturnType<typeof loadSettings>, base: GateSettings = BASE): string {
  expect(result.settings).toEqual(base);
  expect(typeof result.rejected).toBe('string');
  const reason = result.rejected ?? '';
  expect(reason.length).toBeGreaterThan(0);
  expect(reason.length).toBeLessThan(200);
  expect(reason).not.toMatch(/[\r\n]/);
  return reason;
}

describe('loadSettings: the base file alone', () => {
  it('should use the base file when there is no repo file', () => {
    const result = loadSettings(files(JSON.stringify(BASE), null), PLUGIN_ROOT, REPO_ROOT);
    expect(result.settings).toEqual(BASE);
    expect(result.rejected).toBeUndefined();
  });

  it('should fail as a gate error when the base file is missing', () => {
    expect(() => loadSettings(files(null, null), PLUGIN_ROOT, REPO_ROOT)).toThrow();
  });

  it('should fail as a gate error when the base file is malformed or incomplete', () => {
    expect(() => loadSettings(files('{ not json', null), PLUGIN_ROOT, REPO_ROOT)).toThrow();
    const { tagsAllowed: _dropped, ...incomplete } = BASE;
    expect(() => loadSettings(files(JSON.stringify(incomplete), null), PLUGIN_ROOT, REPO_ROOT)).toThrow();
  });
});

describe('loadSettings: a repo file that adds or tightens (AC-009.1, AC-009.2)', () => {
  it.each(LIST_KEYS)('should add new %s values after the base ones, without duplicates', (key) => {
    const repo = { version: 1, [key]: [...BASE[key], 'added-one', 'added-two', 'added-one'] };
    const result = load(repo);
    expect(result.rejected).toBeUndefined();
    expect(result.settings[key]).toEqual([...BASE[key], 'added-one', 'added-two']);
  });

  it('should add a repo protectedPath, productionHost and pattern together', () => {
    const result = load({
      version: 1,
      protectedPaths: ['deploy/**', ...BASE.protectedPaths],
      productionHosts: ['api.example.com'],
      testCommandPatterns: [...BASE.testCommandPatterns, 'make verify'],
    });
    expect(result.rejected).toBeUndefined();
    expect(result.settings.protectedPaths).toEqual([...BASE.protectedPaths, 'deploy/**']);
    expect(result.settings.productionHosts).toEqual(['api.example.com']);
    expect(result.settings.testCommandPatterns).toEqual([...BASE.testCommandPatterns, 'make verify']);
    expect(result.settings.protectedBranches).toEqual(BASE.protectedBranches);
  });

  it('should apply tagsAllowed false from the repo file', () => {
    const result = load({ version: 1, tagsAllowed: false });
    expect(result.rejected).toBeUndefined();
    expect(result.settings).toEqual({ ...BASE, tagsAllowed: false });
  });

  it('should accept a repo file that only repeats the base settings', () => {
    const result = load(BASE);
    expect(result.rejected).toBeUndefined();
    expect(result.settings).toEqual(BASE);
  });
});

describe('loadSettings: a repo file that tries to loosen is ignored as a whole (AC-009.3)', () => {
  it('should reject the whole repo file when it omits a base value from a list it sets', () => {
    const result = load({ version: 1, protectedBranches: ['master'], productionHosts: ['api.example.com'] });
    const reason = expectRejected(result);
    expect(reason).toContain('protectedBranches');
  });

  it.each(LIST_KEYS.filter((key) => BASE[key].length > 0))(
    'should reject a repo file whose %s drops a base value, naming the key',
    (key) => {
      const repo = { version: 1, [key]: [...BASE[key].slice(1), 'secret-value-xyz'] };
      const reason = expectRejected(load(repo));
      expect(reason).toContain(key);
      expect(reason).not.toContain('secret-value-xyz');
    },
  );

  it('should reject tagsAllowed true over a base false', () => {
    const strictBase: GateSettings = { ...BASE, tagsAllowed: false };
    const reason = expectRejected(load({ version: 1, tagsAllowed: true }, strictBase), strictBase);
    expect(reason).toContain('tagsAllowed');
  });

  it('should keep tagsAllowed false when the repo file also says false', () => {
    const strictBase: GateSettings = { ...BASE, tagsAllowed: false };
    const result = load({ version: 1, tagsAllowed: false }, strictBase);
    expect(result.rejected).toBeUndefined();
    expect(result.settings).toEqual(strictBase);
  });
});

describe('loadSettings: a malformed repo file is ignored as a whole (AC-009.4)', () => {
  const cases: Array<[string, string]> = [
    ['malformed JSON', '{ "version": 1, "protectedPaths": [secret-value-xyz'],
    ['an empty file', ''],
    ['a top-level array', '[1, 2]'],
    ['a top-level null', 'null'],
    ['a top-level string', '"secret-value-xyz"'],
    ['a top-level number', '1'],
    ['version 2', JSON.stringify({ version: 2 })],
    ['version "1" as a string', JSON.stringify({ version: '1' })],
    ['no version', JSON.stringify({ productionHosts: ['api.example.com'] })],
    ['an unknown key', JSON.stringify({ version: 1, secretKeyXyz: true })],
    ['an inherited-looking key', '{ "version": 1, "__proto__": { "tagsAllowed": true } }'],
    ['a list that is a string', JSON.stringify({ version: 1, productionHosts: 'api.example.com' })],
    ['a list with a number', JSON.stringify({ version: 1, productionHosts: ['api.example.com', 7] })],
    ['a list with an empty string', JSON.stringify({ version: 1, protectedPaths: [...BASE.protectedPaths, ''] })],
    ['a list with null', JSON.stringify({ version: 1, productionHosts: [null] })],
    ['tagsAllowed as a string', JSON.stringify({ version: 1, tagsAllowed: 'false' })],
    ['tagsAllowed as null', JSON.stringify({ version: 1, tagsAllowed: null })],
  ];

  it.each(cases)('should reject %s and keep the base settings', (_name, text) => {
    const reason = expectRejected(load(text));
    expect(reason).not.toContain('secret-value-xyz');
    expect(reason).not.toContain('secretKeyXyz');
  });

  it('should reject a repo file over 64 KB even when it is otherwise valid', () => {
    const valid = JSON.stringify({ version: 1, productionHosts: ['api.example.com'] });
    const padded = valid.slice(0, -1) + ' '.repeat(64 * 1024) + '}';
    expect(JSON.parse(padded)).toEqual({ version: 1, productionHosts: ['api.example.com'] });
    expectRejected(load(padded));
  });

  it('should accept a valid repo file just under 64 KB', () => {
    const valid = JSON.stringify({ version: 1, productionHosts: ['api.example.com'] });
    const padded = valid.slice(0, -1) + ' '.repeat(64 * 1024 - valid.length - 1) + '}';
    const result = load(padded);
    expect(result.rejected).toBeUndefined();
    expect(result.settings.productionHosts).toEqual(['api.example.com']);
  });
});
