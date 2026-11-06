/**
 * The watcher never hangs on a settings.json that is not a plain file (Task 70d)
 *
 * @behavior SettingsService and NotificationService load ~/.oss/settings.json only when it is a regular file,
 *           itself or where its links lead (at most 8, as settingsTarget, T70c). A FIFO, a device, a folder, a
 *           dangling link, a loop or more than 8 links loads the defaults, with no hang and no throw; a linked
 *           regular file is still read.
 * @business-rule A FIFO at settings.json (or a link to one) blocked the watcher at startup forever. Each load
 *           runs in a child process under a hard time limit, so a hang fails the test instead of blocking vitest.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { buildSync } from 'esbuild';
import { SettingsService } from '../../src/services/settings.js';
import { NotificationService } from '../../src/services/notification.js';
import { runInChild } from '../helpers/child-run.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/services');
/** A load that has not finished by now has hung. */
const LOAD_LIMIT_MS = 10_000;
/** Each test's own limit: room for LOAD_LIMIT_MS plus a slow child start on a busy machine. */
const TEST_LIMIT_MS = 30_000;

interface Loaded {
  settingsVerbosity: string;
  modelDefault: string;
  ollamaKey: string | null;
  notificationVerbosity: string;
}

let work: string;
let harness: string;

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-settings-non-plain-'));
  harness = path.join(work, 'load.mjs');
  // The real loaders, bundled from src, run in a child: prints what each loader read from argv[2]/settings.json.
  buildSync({
    stdin: {
      contents: `
        import { SettingsService } from ${JSON.stringify(path.join(SRC, 'settings.ts'))};
        import { NotificationService } from ${JSON.stringify(path.join(SRC, 'notification.ts'))};
        const dir = process.argv[2];
        const s = new SettingsService(dir);
        const n = new NotificationService(dir);
        console.log(JSON.stringify({
          settingsVerbosity: s.getSettings().notifications.verbosity,
          modelDefault: (await s.getModelConfig()).default,
          ollamaKey: (await s.getApiKey('ollama')) ?? null,
          notificationVerbosity: n.getSettings().notifications.verbosity,
        }));
      `,
      resolveDir: SRC,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: harness,
    logLevel: 'silent',
  });
});

afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

/** Load settings from `dir` in a child process, killed if it outlives LOAD_LIMIT_MS. */
function load(dir: string): Loaded {
  const run = spawnSync(process.execPath, [harness, dir], {
    encoding: 'utf-8',
    timeout: LOAD_LIMIT_MS,
    killSignal: 'SIGKILL',
    env: { PATH: process.env.PATH, HOME: dir },
  });
  if (run.error) {
    throw new Error(`settings load did not finish: ${run.error.message}`);
  }
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as Loaded;
}

const DEFAULTS: Loaded = {
  settingsVerbosity: 'important',
  modelDefault: 'claude',
  ollamaKey: null,
  notificationVerbosity: 'important',
};

const SAVED = JSON.stringify({
  notifications: { verbosity: 'errors-only' },
  models: { default: 'ollama/qwen' },
  apiKeys: { ollama: 'http://localhost:11434' },
});

function newDir(): string {
  return fs.mkdtempSync(path.join(work, 'oss-'));
}

describe('loading a settings.json that is not a plain file (Task 70d)', () => {
  it.each([
    ['a FIFO', (dir: string, at: string) => execFileSync('mkfifo', [at])],
    ['a link to a FIFO', (dir: string, at: string) => {
      execFileSync('mkfifo', [path.join(dir, 'target')]);
      fs.symlinkSync(path.join(dir, 'target'), at);
    }],
    ['a link to a device', (_dir: string, at: string) => fs.symlinkSync('/dev/null', at)],
    ['a folder', (_dir: string, at: string) => fs.mkdirSync(at)],
    ['a dangling link', (dir: string, at: string) => fs.symlinkSync(path.join(dir, 'target'), at)],
    ['a link loop', (dir: string, at: string) => {
      fs.symlinkSync(path.join(dir, 'loop'), at);
      fs.symlinkSync(at, path.join(dir, 'loop'));
    }],
    ['nine links in a row', (dir: string, at: string) => {
      fs.writeFileSync(path.join(dir, 'l9'), SAVED);
      for (let i = 8; i >= 1; i--) fs.symlinkSync(`l${i + 1}`, path.join(dir, `l${i}`));
      fs.symlinkSync(path.join(dir, 'l1'), at);
    }],
  ])('loads the defaults for %s, without hanging', (_what, make) => {
    const dir = newDir();
    make(dir, path.join(dir, 'settings.json'));

    expect(load(dir)).toEqual(DEFAULTS);
  }, TEST_LIMIT_MS);

  it('still reads a regular file that settings.json links to (eight links)', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'l8'), SAVED);
    for (let i = 7; i >= 1; i--) fs.symlinkSync(`l${i + 1}`, path.join(dir, `l${i}`));
    fs.symlinkSync(path.join(dir, 'l1'), path.join(dir, 'settings.json'));

    expect(load(dir)).toEqual({
      settingsVerbosity: 'errors-only',
      modelDefault: 'ollama/qwen',
      ollamaKey: 'http://localhost:11434',
      notificationVerbosity: 'errors-only',
    });
  }, TEST_LIMIT_MS);

  it('still reads a plain settings.json', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), SAVED);

    expect(load(dir).notificationVerbosity).toBe('errors-only');
  }, TEST_LIMIT_MS);
});

/**
 * Task 70e: the check and the read are one open file. A writer that swaps settings.json for a FIFO right after
 * every check of the path (lstat) must not make a load or a save block: the file is opened non-blocking and
 * checked with fstat on that open file. And a settings.json someone else owns loads the defaults, as the hooks do.
 */
describe('settings.json swapped for a FIFO after the check (Task 70e)', () => {
  // An fs for the child where each lstat of SWAP_TARGET sees a regular file, and the path is a FIFO right after.
  const SHIM = `
    import * as real from 'node:fs';
    export * from 'node:fs';
    const target = process.env.SWAP_TARGET;
    const put = (from) => { real.rmSync(target, { force: true }); real.linkSync(from, target); };
    export function lstatSync(p, o) {
      if (globalThis.swapOn !== true || p !== target) return real.lstatSync(p, o);
      put(target + '.file');
      const st = real.lstatSync(p, o);
      put(target + '.fifo');
      return st;
    }
    export default { ...real, lstatSync };
  `;

  function swapDir(): { dir: string; shim: string } {
    const dir = newDir();
    const at = path.join(dir, 'settings.json');
    fs.writeFileSync(`${at}.file`, SAVED);
    execFileSync('mkfifo', [`${at}.fifo`]);
    fs.writeFileSync(at, SAVED);
    const shim = path.join(dir, 'fs-shim.mjs');
    fs.writeFileSync(shim, SHIM);
    return { dir, shim };
  }

  it('loads the defaults, without hanging', () => {
    const { dir, shim } = swapDir();
    const run = runInChild(
      `
      import { SettingsService } from './services/settings.js';
      import { NotificationService } from './services/notification.js';
      globalThis.swapOn = true;
      const s = new SettingsService(process.env.HOME);
      const n = new NotificationService(process.env.HOME);
      console.log(JSON.stringify([s.getSettings().notifications.verbosity, n.getSettings().notifications.verbosity]));
      `,
      { home: dir, fsShim: shim, env: { SWAP_TARGET: path.join(dir, 'settings.json') } },
    );

    expect(run.hung, 'the load hung').toBe(false);
    expect(run.stdout.trim(), run.stderr).toBe(JSON.stringify(['important', 'important']));
  }, TEST_LIMIT_MS);

  it('a save refuses the file and writes nothing, without hanging', () => {
    const { dir, shim } = swapDir();
    const run = runInChild(
      `
      import { SettingsService } from './services/settings.js';
      const s = new SettingsService(process.env.HOME, { lockTimeoutMs: 0 });
      globalThis.swapOn = true;
      s.setVerbosity('important');
      s.save();
      console.log('saved');
      `,
      { home: dir, fsShim: shim, env: { SWAP_TARGET: path.join(dir, 'settings.json') } },
    );

    expect(run.hung, 'the save hung').toBe(false);
    expect(run.stdout.trim(), run.stderr).toBe('saved');
    expect(fs.lstatSync(path.join(dir, 'settings.json')).isFIFO()).toBe(true);
  }, TEST_LIMIT_MS);
});

describe('a settings.json someone else owns (Task 70e)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the defaults in every loader, as the hooks do', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), SAVED);
    vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(path.join(dir, 'settings.json')).uid + 1);

    const s = new SettingsService(dir);
    const n = new NotificationService(dir);

    expect(s.getSettings().notifications.verbosity).toBe('important');
    expect(n.getSettings().notifications.verbosity).toBe('important');
    return s.getModelConfig().then(async (models) => {
      expect(models.default).toBe('claude');
      expect(await s.getApiKey('ollama')).toBeUndefined();
    });
  });

  it('still loads the person\'s own settings.json', () => {
    const dir = newDir();
    fs.writeFileSync(path.join(dir, 'settings.json'), SAVED);

    expect(new SettingsService(dir).getSettings().notifications.verbosity).toBe('errors-only');
    expect(new NotificationService(dir).getSettings().notifications.verbosity).toBe('errors-only');
  });
});
