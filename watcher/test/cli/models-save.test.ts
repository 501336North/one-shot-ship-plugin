/**
 * /oss:models never hangs on, or silently overwrites, a ~/.oss/config.json it cannot safely update (Task 80)
 *
 * @behavior `/oss:models keys set` and `/oss:models set` update ~/.oss/config.json only when it is missing or a
 *           regular file holding a JSON object (a link to one is followed and the file it leads to is updated).
 *           A FIFO, a device, a folder, a file that cannot be read or a file that is not a JSON object is refused
 *           with a "Not saved" message: the command returns at once and the file is left exactly as it was.
 * @business-rule config.json holds the OSS apiKey. Before, a FIFO there blocked the command forever, and an invalid
 *           file was read as empty and overwritten, losing the apiKey. Each case runs in a child process under a
 *           hard time limit, in a temp HOME.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-models-save-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

const KEYS_SET = ['keys', 'set', 'openrouter', 'sk-or-new'];
const MODEL_SET = ['set', 'oss:code-reviewer', 'ollama/codellama'];

interface Home {
  home: string;
  config: string;
}

function newHome(): Home {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  fs.mkdirSync(path.join(home, '.oss'));
  return { home, config: path.join(home, '.oss', 'config.json') };
}

/** Run /oss:models with args in HOME (under `umask`, default 022); returns its output with HOME shown as <home>. */
function models(h: Home, args: string[], fsShim?: string, umask = 0o022): string {
  const run = runInChild(
    `import { executeModelsCommand } from './cli/models.js';
     process.umask(${umask});
     console.log(await executeModelsCommand(${JSON.stringify(args)}));`,
    { home: h.home, fsShim, env: { SWAP_TARGET: h.config } },
  );
  expect(run.hung, 'the command hung').toBe(false);
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim().split(h.home).join('<home>');
}

const NOT_REGULAR = 'Not saved: <home>/.oss/config.json is not a regular file. Nothing was changed.';
const NOT_JSON =
  'Not saved: <home>/.oss/config.json is not a valid JSON object. Fix or remove it, then try again. Nothing was changed.';
const UNREADABLE = 'Not saved: <home>/.oss/config.json could not be read. Nothing was changed.';
const UNWRITABLE = 'Not saved: <home>/.oss/config.json could not be written. Nothing was changed.';

describe('/oss:models saves to ~/.oss/config.json (Task 80)', () => {
  describe('something other than a regular file at config.json is refused, without a hang or a write', () => {
    it.each([
      ['a FIFO', (h: Home) => execFileSync('mkfifo', [h.config])],
      ['a link to a FIFO', (h: Home) => {
        execFileSync('mkfifo', [`${h.config}.fifo`]);
        fs.symlinkSync(`${h.config}.fifo`, h.config);
      }],
      ['a link to /dev/null', (h: Home) => fs.symlinkSync('/dev/null', h.config)],
      ['a folder', (h: Home) => fs.mkdirSync(h.config)],
    ])('%s', (_name, place) => {
      for (const args of [KEYS_SET, MODEL_SET]) {
        const h = newHome();
        place(h);
        const before = fs.lstatSync(h.config);

        expect(models(h, args)).toBe(NOT_REGULAR);
        const after = fs.lstatSync(h.config);
        expect([after.ino, after.mode, after.isSymbolicLink()]).toEqual([before.ino, before.mode, before.isSymbolicLink()]);
      }
    }, TEST_LIMIT_MS);
  });

  describe('a config.json that is not a JSON object is never overwritten', () => {
    it.each([
      ['unparseable JSON', '{"apiKey": "oss-key-1", '],
      ['a JSON array', '["oss-key-1"]'],
      ['JSON null', 'null'],
    ])('%s is refused and left exactly as it was', (_name, text) => {
      for (const args of [KEYS_SET, MODEL_SET]) {
        const h = newHome();
        fs.writeFileSync(h.config, text);

        expect(models(h, args)).toBe(NOT_JSON);
        expect(fs.readFileSync(h.config, 'utf-8')).toBe(text);
      }
    }, TEST_LIMIT_MS);
  });

  it('a config.json that cannot be read (write-only) is refused and left as it was', () => {
    const h = newHome();
    fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');
    fs.chmodSync(h.config, 0o200);

    expect(models(h, KEYS_SET)).toBe(UNREADABLE);
    fs.chmodSync(h.config, 0o600);
    expect(fs.readFileSync(h.config, 'utf-8')).toBe('{"apiKey": "oss-key-1"}');
  }, TEST_LIMIT_MS);

  it('a config.json that cannot be written (read-only) is refused and left as it was', () => {
    const h = newHome();
    fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');
    fs.chmodSync(h.config, 0o400);

    expect(models(h, KEYS_SET)).toBe(UNWRITABLE);
    expect(fs.readFileSync(h.config, 'utf-8')).toBe('{"apiKey": "oss-key-1"}');
  }, TEST_LIMIT_MS);

  it('a config.json link that loops is refused', () => {
    const h = newHome();
    fs.symlinkSync(h.config, h.config);

    expect(models(h, KEYS_SET)).toBe(UNREADABLE);
    expect(fs.readlinkSync(h.config)).toBe(h.config);
  }, TEST_LIMIT_MS);

  it.each([
    ['a FIFO', (at: string) => execFileSync('mkfifo', [at]), (st: fs.Stats) => st.isFIFO()],
    ['a link to /dev/null', (at: string) => fs.symlinkSync('/dev/null', at), (st: fs.Stats) => st.isSymbolicLink()],
  ])('config.json swapped for %s after it was read is refused at the write, without a hang', (_name, make, still) => {
    const h = newHome();
    fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');
    make(`${h.config}.fifo`);
    // an fs where config.json becomes the swapped-in thing once it has been read: the swap wins the race to the write
    const shim = path.join(h.home, 'fs-shim.mjs');
    fs.writeFileSync(shim, `
      import * as real from 'node:fs';
      export * from 'node:fs';
      const target = process.env.SWAP_TARGET;
      export function readFileSync(p, ...a) {
        const text = real.readFileSync(p, ...a);
        real.rmSync(target, { force: true });
        real.renameSync(target + '.fifo', target);
        return text;
      }
      export default { ...real, readFileSync };
    `);

    expect(models(h, KEYS_SET, shim)).toBe(NOT_REGULAR);
    expect(still(fs.lstatSync(h.config))).toBe(true);
  }, TEST_LIMIT_MS);

  describe('a saved config.json is owner-only (600), whatever the umask (T80)', () => {
    const mode = (file: string): number => fs.statSync(file).mode & 0o777;

    it.each([['022', 0o022], ['000', 0o000]])('a new config.json is created at 600 under umask %s', (_name, umask) => {
      const h = newHome();

      expect(models(h, KEYS_SET, undefined, umask)).toBe('API key stored for openrouter');
      expect(mode(h.config)).toBe(0o600);
    }, TEST_LIMIT_MS);

    it.each([['644 under umask 022', 0o644, 0o022], ['666 under umask 000', 0o666, 0o000]])(
      'an existing config.json at %s is tightened to 600 on save',
      (_name, before, umask) => {
        const h = newHome();
        fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');
        fs.chmodSync(h.config, before);

        expect(models(h, KEYS_SET, undefined, umask)).toBe('API key stored for openrouter');
        expect(mode(h.config)).toBe(0o600);
        expect(JSON.parse(fs.readFileSync(h.config, 'utf-8')).apiKey).toBe('oss-key-1');
      },
      TEST_LIMIT_MS,
    );

    it('a new config.json is created at 600 by the open itself, not only by the later fchmod (umask 000)', () => {
      const h = newHome();
      // an fs whose fchmod does nothing: the mode can only come from the create
      const shim = path.join(h.home, 'fs-shim.mjs');
      fs.writeFileSync(shim, `
        import * as real from 'node:fs';
        export * from 'node:fs';
        export function fchmodSync() {}
        export default { ...real, fchmodSync };
      `);

      expect(models(h, KEYS_SET, shim, 0o000)).toBe('API key stored for openrouter');
      expect(mode(h.config)).toBe(0o600);
    }, TEST_LIMIT_MS);

    it('a 600 config.json stays 600', () => {
      const h = newHome();
      fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}', { mode: 0o600 });

      expect(models(h, MODEL_SET)).toBe('Updated: oss:code-reviewer -> ollama/codellama (agent)');
      expect(mode(h.config)).toBe(0o600);
    }, TEST_LIMIT_MS);

    it('a linked config.json: the file it leads to ends at 600 and the link stays', () => {
      const h = newHome();
      const real = path.join(h.home, 'dotfiles-config.json');
      fs.writeFileSync(real, '{"apiKey": "oss-key-1"}');
      fs.chmodSync(real, 0o644);
      fs.symlinkSync(real, h.config);

      expect(models(h, KEYS_SET)).toBe('API key stored for openrouter');
      expect(fs.lstatSync(h.config).isSymbolicLink()).toBe(true);
      expect(mode(real)).toBe(0o600);
    }, TEST_LIMIT_MS);
  });

  describe('a missing or valid config.json is still saved', () => {
    it('a missing config.json is created with the key', () => {
      const h = newHome();

      expect(models(h, KEYS_SET)).toBe('API key stored for openrouter');
      expect(JSON.parse(fs.readFileSync(h.config, 'utf-8'))).toEqual({ apiKeys: { openrouter: 'sk-or-new' } });
    }, TEST_LIMIT_MS);

    it('a valid config.json keeps its apiKey and gains the new setting', () => {
      const h = newHome();
      fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');

      expect(models(h, MODEL_SET)).toBe('Updated: oss:code-reviewer -> ollama/codellama (agent)');
      expect(JSON.parse(fs.readFileSync(h.config, 'utf-8'))).toEqual({
        apiKey: 'oss-key-1',
        models: { agents: { 'oss:code-reviewer': 'ollama/codellama' } },
      });
    }, TEST_LIMIT_MS);

    it('a config.json that is a link to a regular file (dotfiles) is followed: the link stays, its file is updated', () => {
      const h = newHome();
      const real = path.join(h.home, 'dotfiles-config.json');
      fs.writeFileSync(real, '{"apiKey": "oss-key-1", "apiKeys": {"gemini": "g-1"}}');
      fs.symlinkSync(real, h.config);

      expect(models(h, KEYS_SET)).toBe('API key stored for openrouter');
      expect(fs.lstatSync(h.config).isSymbolicLink()).toBe(true);
      expect(JSON.parse(fs.readFileSync(real, 'utf-8'))).toEqual({
        apiKey: 'oss-key-1',
        apiKeys: { gemini: 'g-1', openrouter: 'sk-or-new' },
      });
    }, TEST_LIMIT_MS);

    it('a shorter config replaces a longer one with no old bytes left at the end', () => {
      const h = newHome();
      fs.writeFileSync(h.config, JSON.stringify({ apiKey: 'oss-key-1', models: { agents: { 'oss:code-reviewer': 'x'.repeat(200) } } }));

      expect(models(h, MODEL_SET)).toBe('Updated: oss:code-reviewer -> ollama/codellama (agent)');
      expect(JSON.parse(fs.readFileSync(h.config, 'utf-8'))).toEqual({
        apiKey: 'oss-key-1',
        models: { agents: { 'oss:code-reviewer': 'ollama/codellama' } },
      });
    }, TEST_LIMIT_MS);
  });
});
