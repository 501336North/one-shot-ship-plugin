/**
 * @behavior oss-decrypt refuses a signed manifest older than the newest one it has accepted from the same API
 * @business-rule R-273 D11 / ADR-007: a rising signed version blocks replay of an old (signed, but stale) manifest.
 *   The floor is kept per apiUrl, starts at a compiled-in minimum, and only rises: recording a version only ever
 *   ADDS a file named by that version, so no interleaving of writers can lower it.
 * @boundary Filesystem (the config dir is a temp OSS_CONFIG_DIR)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'fs';
import { spawn, spawnSync } from 'child_process';
import { buildSync } from 'esbuild';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

// The filesystem is the boundary: passthrough, so a row can make one call fail like a full disk would.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    fstatSync: vi.fn(actual.fstatSync),
    mkdirSync: vi.fn(actual.mkdirSync),
    readdirSync: vi.fn(actual.readdirSync),
    closeSync: vi.fn(actual.closeSync),
    fsyncSync: vi.fn(actual.fsyncSync),
  };
});

const realFs = await vi.importActual<typeof import('fs')>('fs');
const SEAMS = [fs.openSync, fs.fstatSync, fs.mkdirSync, fs.readdirSync, fs.closeSync, fs.fsyncSync] as const;

import {
  MIN_MANIFEST_VERSION,
  readManifestFloor,
  checkAndRecordManifestVersion,
} from '../src/manifest-floor.js';

const LIVE_VERSION = 1794940034;
const UNTRUSTED_RE = /^\[verify\] .*not a private folder of yours/;
const REPAIRED_RE = /^\[verify\] .*owner-only \(0700\)/;
const API = 'https://one-shot-ship-api.onrender.com';
const OTHER_API = 'https://sprint-d.example.com';

/** Where a config dir keeps the floor of one API: one folder per API, one empty file per recorded version. */
const storeOf = (configDir: string): string => join(configDir, 'manifest-floor.d');
const keyDirOf = (configDir: string, api: string): string =>
  join(storeOf(configDir), createHash('sha256').update(api).digest('hex'));

/** Puts a recorded floor in place the way oss-decrypt stores it. */
function seedFloor(configDir: string, api: string, version: number): void {
  mkdirSync(keyDirOf(configDir, api), { recursive: true, mode: 0o700 });
  writeFileSync(join(keyDirOf(configDir, api), String(version)), '', { mode: 0o600 });
}

describe('Manifest anti-rollback floor (R-273 P4)', () => {
  let dir: string;
  let warnings: string[];
  const recorded = (api = API): string[] => readdirSync(keyDirOf(dir, api)).sort();

  beforeEach(() => {
    dir = join(tmpdir(), `oss-manifest-floor-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    process.env.OSS_CONFIG_DIR = dir;
    warnings = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const seam of SEAMS) vi.mocked(seam).mockReset();
    spawnSync('chmod', ['-R', 'u+rwx', dir]);
    for (const path of [dir, `${dir}-aside`, `${dir}-elsewhere`]) rmSync(path, { recursive: true, force: true });
    delete process.env.OSS_CONFIG_DIR;
  });

  /** A private folder outside the config dir (with `sub` folders in it), and the listing of everything in it. */
  function privateFolder(sub = ''): { path: string; listing: () => string[] } {
    const path = join(`${dir}-elsewhere`, Math.random().toString(36).slice(2));
    mkdirSync(join(path, sub), { recursive: true, mode: 0o700 });
    return { path, listing: () => (realFs.readdirSync(path, { recursive: true }) as string[]).map(String).sort() };
  }

  /** Moves the folder at `path` aside (to `<path>-aside`) and puts a link to `target` in its place. */
  function swapForLink(path: string, target: string): string {
    realFs.renameSync(path, `${path}-aside`);
    symlinkSync(target, path);
    return `${path}-aside`;
  }

  /** Runs `swap` once, right after the folder at `path` has been checked (its first fstat by descriptor). */
  function afterCheckOf(path: string, swap: () => void): void {
    const fds = new Set<number>();
    let done = false;
    vi.mocked(fs.openSync).mockImplementation((...args: Parameters<typeof realFs.openSync>) => {
      const fd = realFs.openSync(...args);
      if (args[0] === path) fds.add(fd);
      return fd;
    });
    vi.mocked(fs.fstatSync).mockImplementation(((fd: number) => {
      const stats = realFs.fstatSync(fd);
      if (fds.has(fd) && !done) {
        done = true;
        swap();
      }
      return stats;
    }) as typeof realFs.fstatSync);
  }

  it('starts at the live manifest version compiled into the binary', () => {
    expect(MIN_MANIFEST_VERSION).toBe(LIVE_VERSION);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION);
  });

  it('refuses a version below the floor on first use and writes nothing', () => {
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION - 1)).toBe('older');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('accepts a newer version and records it as the new floor for that API', () => {
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
    expect(recorded()).toEqual([String(LIVE_VERSION + 10)]);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
    expect(warnings).toEqual([]);
  });

  it('then refuses a version below the recorded floor and leaves the floor where it was', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 10);
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('older');
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
  });

  it('accepts an equal version and records nothing new', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 10);

    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
    expect(recorded()).toEqual([String(LIVE_VERSION + 10)]);
  });

  it('keeps every recorded version as an owner-only file in owner-only folders, and nothing else', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 1);
    checkAndRecordManifestVersion(API, LIVE_VERSION + 2);

    expect(readdirSync(dir)).toEqual(['manifest-floor.d']);
    expect(recorded()).toEqual([String(LIVE_VERSION + 1), String(LIVE_VERSION + 2)]);
    expect(statSync(storeOf(dir)).mode & 0o777).toBe(0o700);
    expect(statSync(keyDirOf(dir, API)).mode & 0o777).toBe(0o700);
    expect(statSync(join(keyDirOf(dir, API), String(LIVE_VERSION + 2))).mode & 0o777).toBe(0o600);
  });

  /**
   * @behavior A floor can only go up: recording never removes or rewrites what another run recorded
   * @business-rule R-273 ship fix pass 2 (user-approved add-only store): the floor is the highest version name
   */
  it('add-only: a lower version recorded after a higher one leaves the floor at the higher one', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 10);
    // a slower run that read the floor before the raise lands its lower version afterwards
    writeFileSync(join(keyDirOf(dir, API), String(LIVE_VERSION + 5)), '', { mode: 0o600 });

    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 7)).toBe('older');
    expect(recorded()).toEqual([String(LIVE_VERSION + 5), String(LIVE_VERSION + 10)]);
  });

  it('a recorded version below the compiled floor does not lower it', () => {
    seedFloor(dir, API, 1);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION);
    expect(checkAndRecordManifestVersion(API, 2)).toBe('older');
  });

  it('names in the floor folder that are not a version are ignored', () => {
    seedFloor(dir, API, LIVE_VERSION + 3);
    for (const junk of ['abc', '12.tmp', '-5', '9999999999999999', `${LIVE_VERSION + 90}.tmp`]) {
      writeFileSync(join(keyDirOf(dir, API), junk), '', { mode: 0o600 });
    }

    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 3);
    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 4)).toBe('accepted');
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 4);
  });

  it.each([
    ['missing', undefined],
    ['a fraction', LIVE_VERSION + 0.5],
    ['a numeric string', String(LIVE_VERSION + 1)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('a version that is %s is refused as invalid and the floor is unchanged', (_label, version) => {
    expect(checkAndRecordManifestVersion(API, version)).toBe('invalid');
    expect(readdirSync(dir)).toEqual([]);
  });

  /**
   * @business-rule R-273 ship fix pass 3: a version is recorded as a 1-15 digit name, so only those are accepted
   */
  it.each([
    ['10^15 (16 digits)', 1e15],
    ['Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['negative', -1],
  ])('a version that is %s is refused as invalid, nothing is recorded and the floor is unchanged', (_label, version) => {
    expect(checkAndRecordManifestVersion(API, version)).toBe('invalid');
    expect(readdirSync(dir)).toEqual([]);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION);
  });

  it('keeps one floor per API, so another API starts at the compiled floor', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 100);
    expect(checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION)).toBe('accepted');
    expect(readManifestFloor(OTHER_API)).toBe(LIVE_VERSION);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 100);
  });

  it('recording one API keeps the floors of the others', () => {
    checkAndRecordManifestVersion(API, LIVE_VERSION + 100);
    checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION + 7);
    expect(readManifestFloor(API)).toBe(LIVE_VERSION + 100);
    expect(readManifestFloor(OTHER_API)).toBe(LIVE_VERSION + 7);
  });

  it.each([
    ['upper-case host and a trailing slash', 'https://SPRINT-D.Example.com/'],
    ['the default https port', 'https://sprint-d.example.com:443'],
    ['a dot segment', 'https://sprint-d.example.com/.'],
    ['a percent-encoded dot segment', 'https://sprint-d.example.com/%2e'],
  ])('one API spelled with %s shares its floor', (_label, alias) => {
    checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION + 50);

    expect(readManifestFloor(alias)).toBe(LIVE_VERSION + 50);
    expect(checkAndRecordManifestVersion(alias, LIVE_VERSION + 40)).toBe('older');
  });

  it('another port or path on the same host is another API', () => {
    checkAndRecordManifestVersion(OTHER_API, LIVE_VERSION + 50);

    expect(readManifestFloor('https://sprint-d.example.com:8443')).toBe(LIVE_VERSION);
    expect(readManifestFloor('https://sprint-d.example.com/v2')).toBe(LIVE_VERSION);
  });

  describe('when the floor cannot be written, the run is accepted with one [verify] warning', () => {
    function expectAcceptedWithOneWarning(): void {
      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^\[verify\] /);
    }

    it('creates a missing config dir (owner-only) and records the floor there', () => {
      const fresh = join(dir, 'no-such', '.oss');
      process.env.OSS_CONFIG_DIR = fresh;

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(readManifestFloor(API)).toBe(LIVE_VERSION + 1);
      expect(statSync(fresh).mode & 0o777).toBe(0o700);
      expect(warnings).toEqual([]);
    });

    it('a read-only config dir: nothing is written', () => {
      chmodSync(dir, 0o500);

      expectAcceptedWithOneWarning();
      expect(readdirSync(dir)).toEqual([]);
    });

    it('a read-only floor folder: nothing is written', () => {
      seedFloor(dir, API, LIVE_VERSION);
      chmodSync(keyDirOf(dir, API), 0o500);

      expectAcceptedWithOneWarning();
      expect(recorded()).toEqual([String(LIVE_VERSION)]);
    });

    it.each(['EACCES', 'ENOSPC', 'EIO', 'ENOENT', 'EMFILE'])('creating the version file fails with %s', (code) => {
      vi.mocked(fs.openSync).mockImplementation((...args: Parameters<typeof realFs.openSync>) => {
        if (String(args[0]).endsWith(`/${LIVE_VERSION + 1}`)) throw Object.assign(new Error(code), { code });
        return realFs.openSync(...args);
      });

      expectAcceptedWithOneWarning();
      expect(readManifestFloor(API)).toBe(LIVE_VERSION);
    });

    /**
     * @behavior No file-system error on the way to recording a floor ever stops a prompt from being delivered
     * @business-rule R-273 ship fix pass 2: every write-path error is one warning + accept (the version already
     *   passed the floor); nothing throws out of checkAndRecordManifestVersion
     */
    it.each([
      ['creating a folder', fs.mkdirSync],
      ['opening a file or folder', fs.openSync],
      ['checking a folder', fs.fstatSync],
      ['listing a folder', fs.readdirSync],
      ['closing a file or folder', fs.closeSync],
      ['flushing the folder', fs.fsyncSync],
    ] as const)('an error while %s never escapes: the run is accepted', (_label, seam) => {
      vi.mocked(seam).mockImplementation(() => {
        throw Object.assign(new Error('input/output error'), { code: 'EIO' });
      });

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(warnings.length).toBeLessThanOrEqual(1);
    });
  });

  describe('when the config dir or the floor folders are not trusted, the compiled floor applies and nothing is written', () => {
    function expectIgnoredAndUntouched(check: () => void): void {
      expect(readManifestFloor(API)).toBe(LIVE_VERSION);
      warnings = [];
      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^\[verify\] /);
      check();
    }

    /** A config dir elsewhere holding a high floor, and the listing of everything in it. */
    function seededTarget(): { target: string; listing: () => string[] } {
      const target = `${dir}-target`;
      mkdirSync(target, { mode: 0o700 });
      seedFloor(target, API, LIVE_VERSION + 50);
      const listing = (): string[] =>
        (realFs.readdirSync(target, { recursive: true }) as string[]).map(String).sort();
      return { target, listing };
    }

    it.each([
      ['<link>', ''],
      ['<link>/', '/'],
      ['<link>/.', '/.'],
      ['<link>/./', '/./'],
      ['<link>//.', '//.'],
      ['<link>/sub/..', '/sub/..'],
    ])('the config dir is a symlink, given as %s', (_label, suffix) => {
      const { target, listing } = seededTarget();
      mkdirSync(join(target, 'sub'), { mode: 0o700 });
      const before = listing();
      const link = `${dir}-link`;
      symlinkSync(target, link);
      process.env.OSS_CONFIG_DIR = `${link}${suffix}`;
      try {
        expectIgnoredAndUntouched(() => expect(listing()).toEqual(before));
      } finally {
        rmSync(link, { force: true });
        rmSync(target, { recursive: true, force: true });
      }
    });

    it.each([
      ['the floor store (manifest-floor.d)', (): string => storeOf(dir)],
      ['the floor folder of this API', (): string => keyDirOf(dir, API)],
    ])('%s is a symlink to a folder holding a high floor', (_label, at) => {
      const { target, listing } = seededTarget();
      const before = listing();
      const pointsTo = at() === storeOf(dir) ? storeOf(target) : keyDirOf(target, API);
      mkdirSync(dirname(at()), { recursive: true, mode: 0o700 });
      symlinkSync(pointsTo, at());
      try {
        expectIgnoredAndUntouched(() => {
          expect(lstatSync(at()).isSymbolicLink()).toBe(true);
          expect(listing()).toEqual(before);
        });
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });

    it.each([
      ['the floor store (manifest-floor.d)', (): string => storeOf(dir)],
      ['the floor folder of this API', (): string => keyDirOf(dir, API)],
    ])('%s is writable by group or others', (_label, at) => {
      seedFloor(dir, API, LIVE_VERSION + 50);
      chmodSync(at(), 0o777);

      expectIgnoredAndUntouched(() => {
        expect(statSync(at()).mode & 0o777).toBe(0o777);
        expect(recorded()).toEqual([String(LIVE_VERSION + 50)]);
      });
    });

    it.each([
      ['the config dir', (): string => dir],
      ['the floor store (manifest-floor.d)', (): string => storeOf(dir)],
      ['the floor folder of this API', (): string => keyDirOf(dir, API)],
    ])("%s is someone else's", (_label, at) => {
      seedFloor(dir, API, LIVE_VERSION + 50);
      asSomeoneElses(at());

      expectIgnoredAndUntouched(() => expect(recorded()).toEqual([String(LIVE_VERSION + 50)]));
    });

    it('the floor store is a regular file', () => {
      writeFileSync(storeOf(dir), 'x', { mode: 0o600 });

      expectIgnoredAndUntouched(() => expect(lstatSync(storeOf(dir)).isFile()).toBe(true));
    });

    it('the floor store is a FIFO: it is never opened for reading, so nothing hangs', () => {
      expect(spawnSync('mkfifo', [storeOf(dir)]).status).toBe(0);

      expectIgnoredAndUntouched(() => expect(lstatSync(storeOf(dir)).isFIFO()).toBe(true));
    }, 5_000);
  });

  /**
   * @behavior A config dir of yours that a umask left group/other-writable is made owner-only and then used
   * @business-rule R-273 ship round 2 (sec F1): repairing our own dir keeps the floor working; a link or
   *   someone else's dir is still refused (rows above)
   */
  describe('a group/other-writable config dir of yours', () => {
    /**
     * @business-rule R-273 ship fix pass 3: a dir that was open to others until a moment ago may hold a floor
     *   someone else planted, so the run that repairs it does not trust it; the next run does
     */
    it('is made owner-only (0700); its floor is trusted from the next run on', () => {
      seedFloor(dir, API, LIVE_VERSION + 50);
      chmodSync(dir, 0o777);

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(warnings).toEqual([expect.stringMatching(REPAIRED_RE), expect.stringMatching(UNTRUSTED_RE)]);
      expect(recorded()).toEqual([String(LIVE_VERSION + 50)]);

      warnings = [];
      expect(readManifestFloor(API)).toBe(LIVE_VERSION + 50);
      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('older');
      expect(warnings).toEqual([]);
    });

    it('0775: nothing is recorded in the run that repairs it; the next run records and then refuses an older manifest', () => {
      chmodSync(dir, 0o775);

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
      expect(readdirSync(dir)).toEqual([]);
      expect(statSync(dir).mode & 0o777).toBe(0o700);

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('older');
      expect(readManifestFloor(API)).toBe(LIVE_VERSION + 10);
    });
  });

  /**
   * @behavior A folder on the way to the floor that is swapped for a link after it was checked is not used
   * @business-rule R-273 ship fix pass 3: the floor is read from, and recorded in, only the folders that passed
   *   the trust check (same device and inode when the folder is listed or the version file created)
   */
  describe('a folder swapped for a link after it was checked', () => {
    const LEVELS = [['the config dir', 0], ['the floor store', 1], ['the floor folder of this API', 2]] as const;
    const levelPath = (i: number): string => [dir, storeOf(dir), keyDirOf(dir, API)][i];

    it.each(LEVELS)('%s, between the check and the listing: compiled floor, one warning, nothing recorded', (_label, i) => {
      seedFloor(dir, API, LIVE_VERSION + 50);
      const swapTo = privateFolder();
      let aside = '';
      vi.mocked(fs.readdirSync).mockImplementationOnce(((path: fs.PathLike) => {
        aside = swapForLink(levelPath(i), swapTo.path);
        return realFs.readdirSync(path);
      }) as unknown as typeof realFs.readdirSync);
      const keyDirNow = (): string => aside + keyDirOf(dir, API).slice(levelPath(i).length);

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 10)).toBe('accepted');
      expect(warnings).toEqual([expect.stringMatching(UNTRUSTED_RE)]);
      expect(swapTo.listing()).toEqual([]);
      expect(realFs.readdirSync(keyDirNow())).toEqual([String(LIVE_VERSION + 50)]);
    });

    it.each(LEVELS)('%s, after the check and before the version file is created: nothing is written through the link, one warning', (_label, i) => {
      const key = keyDirOf(dir, API).slice(storeOf(dir).length + 1);
      const swapTo = privateFolder([join('manifest-floor.d', key), key, ''][i]);
      const before = swapTo.listing();
      afterCheckOf(keyDirOf(dir, API), () => swapForLink(levelPath(i), swapTo.path));

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(warnings).toEqual([expect.stringMatching(UNTRUSTED_RE)]);
      expect(swapTo.listing()).toEqual(before);
    });

    /**
     * @behavior Making the new version durable never opens the floor folder again by name, so nothing hangs
     * @business-rule R-273 ship fix pass 3: the folder flushed is the one checked; a swap after the create is
     *   reported by the re-check after the create
     */
    it.each([
      ['a FIFO', (at: string): void => void expect(spawnSync('mkfifo', [at]).status).toBe(0)],
      ['a link to another folder', (at: string): void => symlinkSync(privateFolder().path, at)],
    ])('the floor folder replaced by %s right after the version file is created: nothing hangs, the checked folder is flushed', (_label, plant) => {
      seedFloor(dir, API, LIVE_VERSION);
      const keyDir = keyDirOf(dir, API);
      const versionFile = join(keyDir, String(LIVE_VERSION + 1));
      vi.mocked(fs.openSync).mockImplementation((...args: Parameters<typeof realFs.openSync>) => {
        const fd = realFs.openSync(...args);
        if (args[0] === versionFile) {
          realFs.renameSync(keyDir, `${keyDir}-aside`);
          plant(keyDir);
        }
        return fd;
      });
      const flushed: number[] = [];
      vi.mocked(fs.fsyncSync).mockImplementation((fd: number) => {
        flushed.push(realFs.fstatSync(fd).ino);
        realFs.fsyncSync(fd);
      });

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(realFs.readdirSync(`${keyDir}-aside`).sort()).toEqual([String(LIVE_VERSION), String(LIVE_VERSION + 1)]);
      expect(flushed).toEqual([statSync(`${keyDir}-aside`).ino]);
      expect(warnings).toEqual([expect.stringMatching(UNTRUSTED_RE)]);
    }, 5_000);

    it('a flush of the floor folder that fails is not reported: the version is recorded, no warning', () => {
      vi.mocked(fs.fsyncSync).mockImplementation(() => {
        throw Object.assign(new Error('input/output error'), { code: 'EIO' });
      });

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(recorded()).toEqual([String(LIVE_VERSION + 1)]);
      expect(warnings).toEqual([]);
    });

    it('a link planted at a missing config dir while the run creates it: nothing is written through it, one warning', () => {
      const configDir = join(dir, 'fresh', '.oss');
      process.env.OSS_CONFIG_DIR = configDir;
      const swapTo = privateFolder();
      seedFloor(swapTo.path, API, LIVE_VERSION + 50);
      const before = swapTo.listing();
      let planted = false;
      vi.mocked(fs.mkdirSync).mockImplementation(((path: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
        if (path === configDir && !planted) {
          planted = true;
          realFs.mkdirSync(dirname(configDir), { recursive: true, mode: 0o700 });
          symlinkSync(swapTo.path, configDir);
        }
        return realFs.mkdirSync(path, options);
      }) as typeof realFs.mkdirSync);

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 1)).toBe('accepted');
      expect(planted).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/^\[verify\] /);
      expect(swapTo.listing()).toEqual(before);
    });
  });

  /**
   * @behavior A version file another run recorded first is left exactly as it is, and that is not an error
   * @business-rule R-273 ship fix pass 3: recording only ever adds a name; nothing is ever rewritten
   */
  describe('a version another run recorded between this run\'s read and its write', () => {
    const versionFile = (): string => join(keyDirOf(dir, API), String(LIVE_VERSION + 5));

    /** The run lists the floor folder before `appear` puts the other run's file in place. */
    function appearsAfterTheRead(appear: () => void): void {
      vi.mocked(fs.readdirSync).mockImplementationOnce(((path: fs.PathLike) => {
        const names = realFs.readdirSync(path);
        appear();
        return names;
      }) as unknown as typeof realFs.readdirSync);
    }

    it('the same new version recorded by two runs: accepted, no warning', () => {
      seedFloor(dir, API, LIVE_VERSION);
      appearsAfterTheRead(() => writeFileSync(versionFile(), '', { mode: 0o600 }));

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('accepted');
      expect(warnings).toEqual([]);
      expect(readManifestFloor(API)).toBe(LIVE_VERSION + 5);
    });

    it('a version file holding content stays byte-identical', () => {
      seedFloor(dir, API, LIVE_VERSION);
      appearsAfterTheRead(() => writeFileSync(versionFile(), 'kept as is', { mode: 0o600 }));

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('accepted');
      expect(readFileSync(versionFile(), 'utf8')).toBe('kept as is');
      expect(warnings).toEqual([]);
    });

    it('a version file that is a link to a file with content: the link and its target stay as they are', () => {
      seedFloor(dir, API, LIVE_VERSION);
      const outside = join(privateFolder().path, 'outside');
      writeFileSync(outside, 'not yours to rewrite', { mode: 0o600 });
      appearsAfterTheRead(() => symlinkSync(outside, versionFile()));

      expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 5)).toBe('accepted');
      expect(lstatSync(versionFile()).isSymbolicLink()).toBe(true);
      expect(readFileSync(outside, 'utf8')).toBe('not yours to rewrite');
      expect(warnings).toEqual([]);
    });
  });

  /**
   * @behavior A floor folder with very many recorded versions still yields its highest one
   * @business-rule R-273 ship fix pass 3: the floor never silently falls back to the compiled one because of
   *   how many versions were recorded
   */
  it('200 000 recorded versions: the floor is the highest, with no warning', () => {
    seedFloor(dir, API, LIVE_VERSION);
    const names = Array.from({ length: 200_000 }, (_v, n) => String(LIVE_VERSION + n));
    vi.mocked(fs.readdirSync).mockImplementationOnce((() => names) as unknown as typeof realFs.readdirSync);

    expect(checkAndRecordManifestVersion(API, LIVE_VERSION + 199_999)).toBe('accepted');
    expect(warnings).toEqual([]);
  });

  /**
   * @behavior Many oss-decrypt processes recording at the same moment never lose the highest floor
   * @business-rule R-273 ship fix pass 2: the add-only store needs no lock; every process's version is
   *   either recorded or refused as older, and the floor ends at the highest version any of them saw
   * @boundary Real child processes on a real filesystem, released together by a start file
   */
  describe('several oss-decrypt processes at once', () => {
    let bundle: string;

    beforeAll(() => {
      bundle = join(mkdtempSync(join(tmpdir(), 'oss-floor-bundle-')), 'manifest-floor.cjs');
      buildSync({
        entryPoints: [join(__dirname, '..', 'src', 'manifest-floor.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile: bundle,
        logLevel: 'silent',
      });
    });

    afterAll(() => {
      rmSync(dirname(bundle), { recursive: true, force: true });
    });

    // Each child says it is ready, waits for the start file, then records its own versions interleaved
    // with the others' (child k records base + i*n + k).
    const CHILD = `
      const { existsSync } = require('fs');
      const { checkAndRecordManifestVersion } = require(process.argv[1]);
      const [k, n, rounds, base] = process.argv.slice(2, 6).map(Number);
      const [goFile, api] = process.argv.slice(6);
      process.stdout.write('ready\\n');
      while (!existsSync(goFile)) {}
      let maxAccepted = 0;
      for (let i = 0; i < rounds; i++) {
        const v = base + i * n + k;
        if (checkAndRecordManifestVersion(api, v) === 'accepted') maxAccepted = Math.max(maxAccepted, v);
      }
      process.stdout.write(String(maxAccepted));
    `;

    interface Child {
      ready: Promise<void>;
      done: Promise<{ maxAccepted: number; stderr: string }>;
    }

    function startChild(k: number, n: number, rounds: number, goFile: string): Child {
      const child = spawn(
        process.execPath,
        ['-e', CHILD, bundle, String(k), String(n), String(rounds), String(LIVE_VERSION + 1), goFile, API],
        { env: { ...process.env, OSS_CONFIG_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      let err = '';
      let markReady: () => void = () => undefined;
      const ready = new Promise<void>(r => (markReady = r));
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.startsWith('ready\n')) markReady();
      });
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const done = new Promise<{ maxAccepted: number; stderr: string }>((resolveChild, rejectChild) => {
        child.on('error', rejectChild);
        child.on('close', code =>
          code === 0
            ? resolveChild({ maxAccepted: Number(out.slice('ready\n'.length)), stderr: err })
            : rejectChild(new Error(`child ${k} exited ${code}: ${err}`)),
        );
      });
      return { ready, done };
    }

    it('16 processes recording distinct versions together: the floor ends at the highest, with no warning', async () => {
      const N = 16;
      const ROUNDS = 20;
      const goFile = join(dirname(bundle), `go-${Date.now()}`);
      const children = Array.from({ length: N }, (_v, k) => startChild(k, N, ROUNDS, goFile));
      await Promise.all(children.map(c => c.ready));
      realFs.writeFileSync(goFile, '');

      const results = await Promise.all(children.map(c => c.done));

      const highest = LIVE_VERSION + 1 + (ROUNDS - 1) * N + (N - 1);
      expect(Math.max(...results.map(r => r.maxAccepted))).toBe(highest);
      expect(readManifestFloor(API)).toBe(highest);
      expect(results.map(r => r.stderr).join('')).toBe('');
      expect(recorded().every(name => /^[0-9]+$/.test(name))).toBe(true);
      expect(readdirSync(dir)).toEqual(['manifest-floor.d']);
    }, 60_000);
  });
});

/** Makes `path` look owned by another user to this process (the fstat of a descriptor opened on it). */
function asSomeoneElses(path: string): void {
  const fds = new Set<number>();
  vi.mocked(fs.openSync).mockImplementation((...args: Parameters<typeof realFs.openSync>) => {
    const fd = realFs.openSync(...args);
    if (args[0] === path) fds.add(fd);
    return fd;
  });
  vi.mocked(fs.closeSync).mockImplementation((fd: number) => {
    fds.delete(fd);
    realFs.closeSync(fd);
  });
  vi.mocked(fs.fstatSync).mockImplementation(((fd: number) => {
    const stats = realFs.fstatSync(fd);
    if (!fds.has(fd)) return stats;
    return Object.assign(Object.create(Object.getPrototypeOf(stats) as object) as fs.Stats, stats, { uid: stats.uid + 1 });
  }) as typeof realFs.fstatSync);
}
