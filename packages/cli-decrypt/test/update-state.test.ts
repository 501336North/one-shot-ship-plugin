/**
 * @behavior Update state file persists version/hash/signature data across sessions
 * @business-rule Malformed or missing state files must not crash the CLI
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readUpdateState, writeUpdateState, type UpdateState } from '../src/update-state.js';

const TEST_DIR = join(tmpdir(), `oss-update-state-test-${process.pid}`);
const TEST_STATE_PATH = join(TEST_DIR, 'update-state.json');

describe('Update State Management', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should return default state when file does not exist', () => {
    const state = readUpdateState(join(TEST_DIR, 'nonexistent.json'));

    expect(state.lastPluginVersion).toBe('');
    expect(state.manifestHashes).toEqual({});
    expect(state.promptSignatures).toEqual({});
    expect(state.lastCheckedAt).toBe('');
  });

  it('should read existing update-state.json correctly', () => {
    const existing: UpdateState = {
      lastPluginVersion: '2.0.44',
      lastCheckedAt: '2026-02-25T04:00:00Z',
      manifestVersion: 1,
      manifestHashes: { ideate: 'sha256:abc123', plan: 'sha256:def456' },
      promptSignatures: { ideate: 'ed25519:sig123' },
    };
    writeFileSync(TEST_STATE_PATH, JSON.stringify(existing));

    const state = readUpdateState(TEST_STATE_PATH);

    expect(state.lastPluginVersion).toBe('2.0.44');
    expect(state.manifestHashes).toEqual({ ideate: 'sha256:abc123', plan: 'sha256:def456' });
    expect(state.promptSignatures).toEqual({ ideate: 'ed25519:sig123' });
  });

  it('should recover gracefully from malformed JSON', () => {
    writeFileSync(TEST_STATE_PATH, '{ broken json !!!');

    const state = readUpdateState(TEST_STATE_PATH);

    expect(state.lastPluginVersion).toBe('');
    expect(state.manifestHashes).toEqual({});
    expect(state.promptSignatures).toEqual({});
  });

  it('should write update-state.json preserving all fields', () => {
    const state: UpdateState = {
      lastPluginVersion: '2.0.45',
      lastCheckedAt: '2026-02-25T05:00:00Z',
      manifestVersion: 2,
      manifestHashes: { build: 'sha256:new123' },
      promptSignatures: { build: 'ed25519:newsig' },
    };

    writeUpdateState(TEST_STATE_PATH, state);

    expect(existsSync(TEST_STATE_PATH)).toBe(true);
    const written = JSON.parse(readFileSync(TEST_STATE_PATH, 'utf8'));
    expect(written.lastPluginVersion).toBe('2.0.45');
    expect(written.manifestHashes.build).toBe('sha256:new123');
    expect(written.promptSignatures.build).toBe('ed25519:newsig');
  });
});
