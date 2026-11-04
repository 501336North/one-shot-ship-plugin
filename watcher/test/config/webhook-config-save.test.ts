/**
 * WebhookConfig.enable() and disable() never hang on, or silently overwrite, a config.json they cannot safely update
 * (Task 80)
 *
 * @behavior enable() and disable() update config.json only when it is missing or a regular file holding a JSON
 *           object, keeping every other key (the OSS apiKey). A FIFO, a device, a folder, an unreadable file or one
 *           that is not a JSON object is refused: the call rejects with a "Not saved" error at once and the file is
 *           left exactly as it was. In ~/.oss a link to a regular file (dotfiles) is followed, not replaced, and the
 *           saved file is owner-only (600) whatever the umask.
 * @business-rule ~/.oss/config.json holds the apiKey and the webhook secret. Before, an invalid file was read as
 *           empty and replaced, losing the apiKey, and a dotfile link was renamed over. Each case runs in a child
 *           process under a hard time limit, in a temp HOME.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { runInChild, TEST_LIMIT_MS } from '../helpers/child-run.js';

let work: string;
beforeAll(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-webhook-save-')));
});
afterAll(() => {
  fs.rmSync(work, { recursive: true, force: true });
});

interface Home {
  home: string;
  config: string;
}

/** A temp HOME; the config is ~/.oss/config.json, or with `project` a project's .oss/config.json. */
function newHome(project = false): Home {
  const home = fs.mkdtempSync(path.join(work, 'h-'));
  const oss = project ? path.join(home, 'proj', '.oss') : path.join(home, '.oss');
  fs.mkdirSync(oss, { recursive: true });
  return { home, config: path.join(oss, 'config.json') };
}

/** Call enable() or disable() on the config's folder; returns 'ok' or the error, with HOME shown as <home>. */
function call(h: Home, method: 'enable' | 'disable', umask = 0o022): string {
  const run = runInChild(
    `import { WebhookConfig } from './config/webhook-config.js';
     process.umask(${umask});
     const w = new WebhookConfig(${JSON.stringify(path.dirname(h.config))});
     try { await w.${method}(${method === 'enable' ? '{ port: 4000 }' : ''}); console.log('ok'); }
     catch (e) { console.log(e.message); }`,
    { home: h.home },
  );
  expect(run.hung, `${method} hung`).toBe(false);
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.trim().split(h.home).join('<home>');
}

const notSaved = (why: string, rel = '.oss/config.json'): string => `Not saved: <home>/${rel} ${why}. Nothing was changed.`;
const NOT_REGULAR = notSaved('is not a regular file');
const NOT_JSON = notSaved('is not a valid JSON object. Fix or remove it, then try again');
const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const ENABLED = JSON.stringify({ apiKey: 'oss-key-1', webhook: { enabled: true, port: 3456, secret: 's'.repeat(64) } });

describe('WebhookConfig saves to config.json (Task 80)', () => {
  describe.each(['enable', 'disable'] as const)('%s()', (method) => {
    it.each([
      ['a FIFO', (h: Home) => execFileSync('mkfifo', [h.config])],
      ['a link to /dev/null', (h: Home) => fs.symlinkSync('/dev/null', h.config)],
      ['a folder', (h: Home) => fs.mkdirSync(h.config)],
    ])('refuses %s at config.json, without a hang or a write', (_name, place) => {
      const h = newHome();
      place(h);
      const before = fs.lstatSync(h.config);

      expect(call(h, method)).toBe(NOT_REGULAR);
      const after = fs.lstatSync(h.config);
      expect([after.ino, after.mode]).toEqual([before.ino, before.mode]);
    }, TEST_LIMIT_MS);

    it.each([
      ['unparseable JSON', '{"apiKey": "oss-key-1", '],
      ['a JSON array', '["oss-key-1"]'],
      ['JSON null', 'null'],
    ])('refuses %s and leaves it exactly as it was', (_name, text) => {
      const h = newHome();
      fs.writeFileSync(h.config, text);

      expect(call(h, method)).toBe(NOT_JSON);
      expect(fs.readFileSync(h.config, 'utf-8')).toBe(text);
    }, TEST_LIMIT_MS);

    it('refuses an invalid project .oss/config.json too', () => {
      const h = newHome(true);
      fs.writeFileSync(h.config, '{"apiKey": ');

      expect(call(h, method)).toBe(notSaved('is not a valid JSON object. Fix or remove it, then try again', 'proj/.oss/config.json'));
      expect(fs.readFileSync(h.config, 'utf-8')).toBe('{"apiKey": ');
    }, TEST_LIMIT_MS);

    it('keeps the apiKey, follows a dotfile link and ends at 600', () => {
      const h = newHome();
      const real = path.join(h.home, 'dotfiles-config.json');
      fs.writeFileSync(real, ENABLED);
      fs.chmodSync(real, 0o644);
      fs.symlinkSync(real, h.config);

      expect(call(h, method)).toBe('ok');
      expect(fs.lstatSync(h.config).isSymbolicLink()).toBe(true);
      const saved = JSON.parse(fs.readFileSync(real, 'utf-8')) as { apiKey: string; webhook: { enabled: boolean } };
      expect([saved.apiKey, saved.webhook.enabled]).toEqual(['oss-key-1', method === 'enable']);
      expect(mode(real)).toBe(0o600);
    }, TEST_LIMIT_MS);
  });

  it.each([['022', 0o022], ['000', 0o000]])('enable() creates a missing ~/.oss/config.json at 600 under umask %s', (_n, umask) => {
    const h = newHome();

    expect(call(h, 'enable', umask)).toBe('ok');
    expect(mode(h.config)).toBe(0o600);
  }, TEST_LIMIT_MS);

  it('enable() tightens an existing 666 ~/.oss/config.json to 600 under umask 000, keeping the apiKey', () => {
    const h = newHome();
    fs.writeFileSync(h.config, '{"apiKey": "oss-key-1"}');
    fs.chmodSync(h.config, 0o666);

    expect(call(h, 'enable', 0o000)).toBe('ok');
    expect(mode(h.config)).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(h.config, 'utf-8')).apiKey).toBe('oss-key-1');
  }, TEST_LIMIT_MS);

  it('disable() with no config.json writes nothing', () => {
    const h = newHome();

    expect(call(h, 'disable')).toBe('ok');
    expect(fs.existsSync(h.config)).toBe(false);
  }, TEST_LIMIT_MS);
});
