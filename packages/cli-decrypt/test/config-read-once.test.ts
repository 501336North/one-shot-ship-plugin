/**
 * @behavior oss-decrypt reads config.json exactly once, from the same open file it checked. If another process
 *           replaces config.json with a symlink to its own file in the instant after the trust check, oss-decrypt
 *           still reads the file it checked, never the swapped-in one, so the swap cannot redirect the API key.
 * @business-rule SR3 (release-channels ship round 2): no time-of-check/time-of-use gap in the config trust rule.
 * @boundary The file system. `fs` is wrapped (not replaced) so that, right after any stat-style trust check of
 *           config.json returns, an adversary atomically renames a symlink over config.json. Everything else is the
 *           real file system. This simulates the race deterministically; it does not assert which fs calls are used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as realFs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const swap = vi.hoisted(() => ({ armed: false, configPath: '', attackerLink: '' }));

vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof import('fs')>();
  const adversary = (): void => {
    if (!swap.armed) return;
    swap.armed = false;
    orig.renameSync(swap.attackerLink, swap.configPath);
  };
  const lstatSync = ((...args: Parameters<typeof orig.lstatSync>) => {
    const result = orig.lstatSync(...args);
    if (String(args[0]) === swap.configPath) adversary();
    return result;
  }) as typeof orig.lstatSync;
  const fstatSync = ((...args: Parameters<typeof orig.fstatSync>) => {
    const result = orig.fstatSync(...args);
    adversary();
    return result;
  }) as typeof orig.fstatSync;
  const wrapped = { ...orig, lstatSync, fstatSync };
  return { ...wrapped, default: wrapped };
});

import { readConfigFile } from '../src/config.js';

describe('config.json is read from the file that was checked', () => {
  let dir: string;

  beforeEach(() => {
    dir = realFs.mkdtempSync(join(tmpdir(), 'oss-config-once-'));
    process.env.OSS_CONFIG_DIR = dir;
    swap.configPath = join(dir, 'config.json');
    swap.attackerLink = join(dir, 'attacker-link');
    realFs.writeFileSync(swap.configPath, JSON.stringify({ apiUrl: 'https://one-shot-ship-api.onrender.com' }));
    realFs.chmodSync(swap.configPath, 0o600);
    const attackerFile = join(dir, 'attacker.json');
    realFs.writeFileSync(attackerFile, JSON.stringify({ apiUrl: 'http://127.0.0.1:9' }));
    realFs.chmodSync(attackerFile, 0o600);
    realFs.symlinkSync(attackerFile, swap.attackerLink);
    swap.armed = true;
  });

  afterEach(() => {
    swap.armed = false;
    delete process.env.OSS_CONFIG_DIR;
    realFs.rmSync(dir, { recursive: true, force: true });
  });

  it('a symlink swapped in right after the trust check is not followed', () => {
    const config = readConfigFile();
    expect(swap.armed).toBe(false); // the adversary did act
    expect(config.apiUrl).toBe('https://one-shot-ship-api.onrender.com');
  });
});
