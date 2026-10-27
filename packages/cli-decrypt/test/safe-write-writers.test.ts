/**
 * @behavior Every file oss-decrypt writes for itself (the prompt cache, the update state, the stored credentials)
 *           is written without following a symlink. If the file is a symlink, the file it points at keeps its content
 *           and mode (the link is replaced by a real, owner-only file). If the directory is a symlink, nothing is
 *           written through it: credentials and the prompt cache refuse, the update state (a best-effort notice
 *           record) is skipped so prompt delivery is not blocked.
 * @business-rule SR17 (release-channels ship round 2, IRON LAW #1b from SR4): one safe-write rule for every writer.
 * @boundary The writers' public functions against the real file system.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { CacheService } from '../src/cache.js';
import { writeUpdateState, type UpdateState } from '../src/update-state.js';
import { storeCredentials } from '../src/storage.js';

const STATE: UpdateState = {
  lastPluginVersion: '1.0.0',
  lastCheckedAt: '2026-10-27T00:00:00Z',
  manifestVersion: 1,
  manifestHashes: {},
  promptSignatures: {},
};

interface Writer {
  what: string;
  /** Write once into `dir`. */
  write: (dir: string) => Promise<void>;
  /** What a write into a symlinked directory does: refuse (reject) or skip (resolve). */
  symlinkedDir: 'refuses' | 'skips';
}

const WRITERS: Writer[] = [
  {
    what: 'prompt cache',
    write: (dir) => new CacheService(dir).set('commands', 'plan', 'user_1', '# Plan'),
    symlinkedDir: 'refuses',
  },
  {
    what: 'update state',
    write: async (dir) => writeUpdateState(join(dir, 'update-state.json'), STATE),
    symlinkedDir: 'skips',
  },
  {
    what: 'credentials',
    write: async (dir) => {
      process.env.OSS_CONFIG_DIR = dir;
      await storeCredentials({ apiKey: 'ak_test', userId: 'user_1', hardwareId: 'hw', salt: 'salt' });
    },
    symlinkedDir: 'refuses',
  },
];

describe.each(WRITERS)('$what never writes through a symlink', ({ write, symlinkedDir }) => {
  let root: string;
  let dir: string;
  let victim: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oss-safe-write-'));
    dir = join(root, 'oss');
    victim = join(root, 'victim');
  });

  afterEach(() => {
    delete process.env.OSS_CONFIG_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  it('a symlinked file: the file it points at keeps its content and mode; an owner-only file replaces the link', async () => {
    await write(dir);
    const [name] = readdirSync(dir);
    writeFileSync(victim, 'original');
    chmodSync(victim, 0o644);
    unlinkSync(join(dir, name));
    symlinkSync(victim, join(dir, name));

    await write(dir);

    expect(readFileSync(victim, 'utf8')).toBe('original');
    expect(statSync(victim).mode & 0o777).toBe(0o644);
    const written = lstatSync(join(dir, name));
    expect(written.isFile()).toBe(true);
    expect(written.mode & 0o777).toBe(0o600);
  });

  it('a symlinked directory: nothing is written into the directory it points at', async () => {
    mkdirSync(victim);
    chmodSync(victim, 0o755);
    symlinkSync(victim, dir);

    if (symlinkedDir === 'refuses') {
      await expect(write(dir)).rejects.toThrow();
    } else {
      await expect(write(dir)).resolves.toBeUndefined();
    }

    expect(readdirSync(victim)).toEqual([]);
    expect(statSync(victim).mode & 0o777).toBe(0o755);
  });

  it("another user's directory: nothing is written into it", async () => {
    mkdirSync(dir, { mode: 0o755 });
    const me = process.getuid?.() ?? 0;
    const getuid = vi.spyOn(process, 'getuid').mockReturnValue(me + 1);
    try {
      if (symlinkedDir === 'refuses') {
        await expect(write(dir)).rejects.toThrow();
      } else {
        await expect(write(dir)).resolves.toBeUndefined();
      }
    } finally {
      getuid.mockRestore();
    }
    expect(readdirSync(dir)).toEqual([]);
  });
});
