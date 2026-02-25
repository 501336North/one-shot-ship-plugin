/**
 * @behavior Prompt hash changes are detected and reported to user via stderr
 * @business-rule Valid signature + changed hash = update notification; first run = silent cache
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readUpdateState, type UpdateState } from '../src/update-state.js';

// We test the extracted detection logic, not the full decrypt pipeline
import { detectPromptChange, type ChangeDetectionResult } from '../src/change-detection.js';

const TEST_DIR = join(tmpdir(), `oss-sig-change-test-${process.pid}`);
const TEST_STATE_PATH = join(TEST_DIR, 'update-state.json');

describe('Signature Change Detection', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should cache hash after successful verification', () => {
    // Given no prior state
    const state = readUpdateState(TEST_STATE_PATH);

    // When we detect with a new hash
    const result = detectPromptChange(
      state,
      'workflows',
      'build',
      'abc123hash'
    );

    // Then it should want to cache the new hash
    expect(result.updatedSignatures['workflows/build']).toBe('abc123hash');
  });

  it('should detect hash change and indicate update', () => {
    // Given a cached hash for workflows/build
    const state: UpdateState = {
      lastPluginVersion: '',
      lastCheckedAt: '',
      manifestVersion: 0,
      manifestHashes: {},
      promptSignatures: { 'workflows/build': 'oldhash123' },
    };

    // When the hash has changed
    const result = detectPromptChange(
      state,
      'workflows',
      'build',
      'newhash456'
    );

    // Then it should indicate an update occurred
    expect(result.changed).toBe(true);
    expect(result.promptKey).toBe('workflows/build');
    expect(result.updatedSignatures['workflows/build']).toBe('newhash456');
  });

  it('should be silent when hash is unchanged', () => {
    // Given a cached hash that matches
    const state: UpdateState = {
      lastPluginVersion: '',
      lastCheckedAt: '',
      manifestVersion: 0,
      manifestHashes: {},
      promptSignatures: { 'workflows/build': 'samehash' },
    };

    // When the hash is the same
    const result = detectPromptChange(
      state,
      'workflows',
      'build',
      'samehash'
    );

    // Then it should not indicate a change
    expect(result.changed).toBe(false);
  });

  it('should not indicate change on first run (no cached hash)', () => {
    // Given empty state (first run)
    const state = readUpdateState(TEST_STATE_PATH);

    // When we detect with a hash but nothing is cached
    const result = detectPromptChange(
      state,
      'commands',
      'adr',
      'firsthash'
    );

    // Then it should cache but not indicate change
    expect(result.changed).toBe(false);
    expect(result.firstRun).toBe(true);
    expect(result.updatedSignatures['commands/adr']).toBe('firsthash');
  });

  it('should not detect change when hash is null (no manifest entry)', () => {
    // Given a cached hash
    const state: UpdateState = {
      lastPluginVersion: '',
      lastCheckedAt: '',
      manifestVersion: 0,
      manifestHashes: {},
      promptSignatures: { 'workflows/build': 'cachedhash' },
    };

    // When manifest entry is null (prompt not in manifest or verification skipped)
    const result = detectPromptChange(
      state,
      'workflows',
      'build',
      null
    );

    // Then it should not indicate change and not update cache
    expect(result.changed).toBe(false);
    expect(result.updatedSignatures).toEqual({});
  });
});
