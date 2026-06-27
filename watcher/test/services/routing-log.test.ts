/**
 * @behavior Loud, always-on routing log: one JSON line per decision; never throws into the
 *           request path. Plus a Node preflight guard so a missing/old Node fails LOUDLY
 *           instead of letting the session silently run all-cloud.
 * @boundary Observability + preflight
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRoutingLogger } from '../../src/services/routing-log.js';
import { checkNode } from '../../src/services/node-guard.js';

describe('createRoutingLogger', () => {
  it('appends one JSON line per entry and is readable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-routelog-'));
    const file = path.join(dir, 'sub', 'model-routing.log');
    const log = createRoutingLogger(file);
    log({ agent: 'oss:code-reviewer', model: 'gpt-oss:120b', route: 'ollama' });
    log({ route: 'anthropic', fallback: true, reason: 'timeout' });

    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ route: 'ollama', model: 'gpt-oss:120b' });
    expect(JSON.parse(lines[1])).toMatchObject({ route: 'anthropic', fallback: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never throws even if the path is unwritable', () => {
    const log = createRoutingLogger('/nonexistent-root/cannot/write.log');
    expect(() => log({ route: 'anthropic' })).not.toThrow();
  });
});

describe('checkNode', () => {
  it('accepts a modern Node', () => {
    expect(checkNode('v20.11.0', 18).ok).toBe(true);
  });
  it('rejects an old Node loudly', () => {
    const r = checkNode('v16.20.0', 18);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Node/);
  });
  it('rejects when node version is unavailable', () => {
    expect(checkNode(undefined, 18).ok).toBe(false);
  });
});
