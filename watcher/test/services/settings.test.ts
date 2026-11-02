/**
 * SettingsService Tests
 *
 * @behavior Settings are persisted to ~/.oss/settings.json
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SettingsService } from '../../src/services/settings.js';
import { NotificationSettings } from '../../src/types/notification.js';

// A step another writer runs right after the next read of a file: lets a test land a concurrent write
// between save()'s first read and its write without relying on timing.
// lstatHook (Task 16ag): the same for the next lstat of one path, so a test can replace the lock between
// save()'s identity read of it and its removal.
const readHook = vi.hoisted(() => ({ afterNextRead: null as null | (() => void) }));
const lstatHook = vi.hoisted(() => ({ afterNextLstatOf: null as null | { path: string; step: () => void } }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const out = actual.readFileSync(...args);
    const step = readHook.afterNextRead;
    readHook.afterNextRead = null;
    if (step) step();
    return out;
  }) as typeof actual.readFileSync;
  const lstatSync = ((...args: Parameters<typeof actual.lstatSync>) => {
    const out = actual.lstatSync(...args);
    const hook = lstatHook.afterNextLstatOf;
    if (hook && args[0] === hook.path) {
      lstatHook.afterNextLstatOf = null;
      hook.step();
    }
    return out;
  }) as typeof actual.lstatSync;
  return { ...actual, default: { ...actual, readFileSync, lstatSync }, readFileSync, lstatSync };
});

describe('SettingsService', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
    dirsToClean.push(dir);
    return dir;
  }

  afterEach(() => {
    readHook.afterNextRead = null;
    lstatHook.afterNextLstatOf = null;
    vi.restoreAllMocks();
    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('file management', () => {
    it('should create settings.json if not exists', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const service = new SettingsService(testDir);
      service.save();

      expect(fs.existsSync(settingsPath)).toBe(true);
    });

    it('should read existing settings.json', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings: NotificationSettings = {
        notifications: {
          style: 'audio',
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
          updates: true,
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded.notifications.voice).toBe('Daniel');
    });

    it('should write updated settings', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const service = new SettingsService(testDir);
      service.setNotificationStyle('sound');
      service.save();

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.notifications.style).toBe('sound');
    });
  });

  describe('keys the watcher does not own (Sec-R2-LOW-254)', () => {
    // A user who turned off sending decision records (/oss:settings decisions off) must stay opted out
    // when the watcher later saves one of its own settings.
    it('keeps decisionsPush:false and other unknown keys, and applies the watcher change', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ decisionsPush: false, someOtherTool: { a: 1 }, notifications: { style: 'audio' } })
      );

      const service = new SettingsService(testDir);
      service.setNotificationStyle('sound');
      service.save();

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.decisionsPush).toBe(false);
      expect(saved.someOtherTool).toEqual({ a: 1 });
      expect(saved.notifications.style).toBe('sound');
    });

    // Task 16ao: the watcher wins only on the fields it changed; a field it merely loaded (here the
    // default style 'visual') no longer overwrites what another writer saved since.
    it('lets the watcher win on the fields it changed, and keeps the ones it did not change', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: false }));

      // loaded with no notifications block, so the watcher holds the defaults (style 'visual')
      const service = new SettingsService(testDir);
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({ decisionsPush: false, notifications: { style: 'audio', verbosity: 'all' } })
      );
      service.setVerbosity('errors-only');
      service.save();

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.notifications.verbosity).toBe('errors-only');
      expect(saved.notifications.style).toBe('audio');
      expect(saved.decisionsPush).toBe(false);
    });
  });

  describe('a settings file the watcher cannot safely merge (Task 16p)', () => {
    // The hooks read a settings.json that is not exactly one JSON object as "personal push off". If the
    // watcher rewrote such a file it would drop that opt-out, so save() must leave it exactly as it is.
    it.each([
      ['invalid JSON', '{ "decisionsPush": false, '],
      ['a JSON array', '[{"decisionsPush": false}]'],
      ['a JSON scalar', '"off"'],
      ['two JSON objects', '{"decisionsPush": false}{}'],
      ['empty', ''],
    ])('leaves a file holding %s byte-identical and does not throw', (_label, content) => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, content);

      const service = new SettingsService(testDir);
      expect(() => service.setApiKey('openai', 'sk-test')).not.toThrow();
      service.setVerbosity('errors-only');
      expect(() => service.save()).not.toThrow();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(content);
      expect(fs.readdirSync(testDir).sort()).toEqual(['locks', 'settings.json']);
    });

    it('leaves an unreadable file untouched', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: false }));
      fs.chmodSync(settingsPath, 0o000);

      const service = new SettingsService(testDir);
      expect(() => service.save()).not.toThrow();

      fs.chmodSync(settingsPath, 0o600);
      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(JSON.stringify({ decisionsPush: false }));
      expect(fs.readdirSync(testDir).sort()).toEqual(['locks', 'settings.json']);
    });

    it('leaves a file owned by someone else untouched', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'audio' } }));
      const owner = fs.statSync(settingsPath).uid;
      vi.spyOn(process, 'getuid').mockReturnValue(owner + 1);

      const service = new SettingsService(testDir);
      service.setVerbosity('errors-only');
      service.save();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(JSON.stringify({ notifications: { style: 'audio' } }));
    });

    it('still saves where the platform has no user ids (no process.getuid)', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: false }));
      const getuid = process.getuid;
      Object.assign(process, { getuid: undefined });
      try {
        const service = new SettingsService(testDir);
        service.setVerbosity('errors-only');
        service.save();
      } finally {
        Object.assign(process, { getuid });
      }

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.notifications.verbosity).toBe('errors-only');
      expect(saved.decisionsPush).toBe(false);
    });

    it('never writes through a symlinked settings.json', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const target = path.join(testDir, 'elsewhere.json');
      fs.writeFileSync(target, JSON.stringify({ decisionsPush: false }));
      fs.symlinkSync(target, settingsPath);

      const service = new SettingsService(testDir);
      service.setVerbosity('errors-only');
      service.save();

      expect(fs.readFileSync(target, 'utf-8')).toBe(JSON.stringify({ decisionsPush: false }));
      expect(fs.lstatSync(settingsPath).isSymbolicLink()).toBe(true);
    });
  });

  describe('how save() writes (Task 16p)', () => {
    it('creates a new settings file readable only by the person (mode 600), since it holds API keys', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const oldMask = process.umask(0o022);
      try {
        new SettingsService(testDir).save();
      } finally {
        process.umask(oldMask);
      }

      expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
    });

    it('makes an existing world-readable (644) file private (600) and keeps its other keys (Task 16ac)', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: false, team: 'kept' }));
      fs.chmodSync(settingsPath, 0o644);

      new SettingsService(testDir).save();

      expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.decisionsPush).toBe(false);
      expect(saved.team).toBe('kept');
    });

    it('keeps a decisionsPush:false that another writer saves while the watcher is saving', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'audio' } }));

      const service = new SettingsService(testDir);
      service.setVerbosity('errors-only');
      // /oss:settings decisions off lands right after save() first reads the file
      readHook.afterNextRead = () =>
        fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'audio' }, decisionsPush: false }));
      service.save();

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.decisionsPush).toBe(false);
      expect(saved.notifications.verbosity).toBe('errors-only');
    });

    it('refuses, leaving it as written, when the other writer leaves the file unmergeable mid-save', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, '{}');

      const service = new SettingsService(testDir);
      readHook.afterNextRead = () => fs.writeFileSync(settingsPath, '[1]');
      service.save();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('[1]');
      expect(fs.readdirSync(testDir).sort()).toEqual(['locks', 'settings.json']);
    });
  });

  describe('the shared settings lock (Task 16ad)', () => {
    // The lock every settings.json writer takes (the shell writers too): the directory locks/settings
    // in the person's ~/.oss. Waits are injected so no test sleeps for real.
    function lockPaths(testDir: string): { locks: string; lock: string; settingsPath: string } {
      const locks = path.join(testDir, 'locks');
      return { locks, lock: path.join(locks, 'settings'), settingsPath: path.join(testDir, 'settings.json') };
    }
    const original = JSON.stringify({ notifications: { style: 'audio' } });

    it('refuses to save while another writer holds the lock, leaving the file byte-identical', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      fs.mkdirSync(lock);
      let waits = 0;

      const service = new SettingsService(testDir, { lockTimeoutMs: 500, sleep: () => waits++ });
      service.setVerbosity('errors-only');
      service.save();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original);
      expect(waits).toBe(5);
      expect(fs.existsSync(lock)).toBe(true);
    });

    it('keeps a decisionsPush:false written while the lock was held, once the lock is released', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      fs.mkdirSync(lock);

      // the other writer saves decisions off, then releases the lock, while the watcher waits
      const service = new SettingsService(testDir, {
        sleep: () => {
          fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'audio' }, decisionsPush: false }));
          fs.rmdirSync(lock);
        },
      });
      service.setVerbosity('errors-only');
      service.save();

      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(saved.decisionsPush).toBe(false);
      expect(saved.notifications.verbosity).toBe('errors-only');
    });

    it('takes over a stale lock (older than 30 s) and saves', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      fs.mkdirSync(lock);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, old, old);

      const service = new SettingsService(testDir, { lockTimeoutMs: 0, sleep: () => undefined });
      service.setVerbosity('errors-only');
      service.save();

      expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).notifications.verbosity).toBe('errors-only');
      expect(fs.existsSync(lock)).toBe(false);
    });

    // Task 16ag
    // @behavior Another writer took the settings lock over while the watcher was saving (or it is gone): the
    //           watcher's release leaves that writer's lock in place and does not crash the save.
    // @business-rule A writer removes only the lock it made itself (same inode and mtime as right after its
    //           mkdir); a stale takeover removes a lock only if it is still the stale one it judged stale.
    it('leaves the lock of a writer that took it over during the save, and does not throw', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      let theirs = -1;

      const service = new SettingsService(testDir, { lockTimeoutMs: 0, sleep: () => undefined });
      service.setVerbosity('errors-only');
      // while the watcher saves, another writer takes the lock over and holds a fresh one
      readHook.afterNextRead = () => {
        fs.rmdirSync(lock);
        fs.mkdirSync(lock);
        theirs = fs.statSync(lock).ino;
      };
      expect(() => service.save()).not.toThrow();

      expect(theirs).toBeGreaterThan(-1);
      expect(fs.statSync(lock).ino).toBe(theirs);
    });

    it('does not throw when its lock was removed by someone else during the save', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });

      const service = new SettingsService(testDir, { lockTimeoutMs: 0, sleep: () => undefined });
      service.setVerbosity('errors-only');
      readHook.afterNextRead = () => fs.rmdirSync(lock);
      expect(() => service.save()).not.toThrow();

      expect(fs.existsSync(lock)).toBe(false);
    });

    it('leaves a fresh lock another writer made after this one judged the old lock stale, and saves nothing', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      fs.mkdirSync(lock);
      const old = new Date(Date.now() - 60_000);
      fs.utimesSync(lock, old, old);
      let theirs = -1;
      // right after the watcher reads the stale lock, another writer takes it over first
      lstatHook.afterNextLstatOf = {
        path: lock,
        step: () => {
          fs.rmdirSync(lock);
          fs.mkdirSync(lock);
          theirs = fs.statSync(lock).ino;
        },
      };

      const service = new SettingsService(testDir, { lockTimeoutMs: 0, sleep: () => undefined });
      service.setVerbosity('errors-only');
      service.save();

      expect(theirs).toBeGreaterThan(-1);
      expect(fs.statSync(lock).ino).toBe(theirs);
      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original);
    });

    it('releases the lock after a save, in a private (700) locks folder', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);

      new SettingsService(testDir).save();

      expect(fs.existsSync(settingsPath)).toBe(true);
      expect(fs.lstatSync(locks).mode & 0o777).toBe(0o700);
      expect(fs.existsSync(lock)).toBe(false);
    });

    it('makes an existing locks folder private (700), as the shell writers do', () => {
      const testDir = createTestDir();
      const { locks } = lockPaths(testDir);
      fs.mkdirSync(locks);
      fs.chmodSync(locks, 0o755);

      new SettingsService(testDir).save();

      expect(fs.lstatSync(locks).mode & 0o777).toBe(0o700);
    });

    it('refuses a lock path that is a symlink, and leaves its target alone', () => {
      const testDir = createTestDir();
      const { locks, lock, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      fs.mkdirSync(locks, { mode: 0o700 });
      const elsewhere = createTestDir();
      fs.symlinkSync(elsewhere, lock);
      let waits = 0;

      const service = new SettingsService(testDir, { sleep: () => waits++ });
      service.setVerbosity('errors-only');
      service.save();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original);
      expect(waits).toBe(0); // refused at once, not waited on as if another writer held it
      expect(fs.lstatSync(lock).isSymbolicLink()).toBe(true);
      expect(fs.statSync(elsewhere).isDirectory()).toBe(true);
    });

    it('refuses when the locks folder is a symlink', () => {
      const testDir = createTestDir();
      const { locks, settingsPath } = lockPaths(testDir);
      fs.writeFileSync(settingsPath, original);
      const elsewhere = createTestDir();
      fs.symlinkSync(elsewhere, locks);

      const service = new SettingsService(testDir, { sleep: () => undefined });
      service.setVerbosity('errors-only');
      service.save();

      expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(original);
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    });

    it('refuses when the locks folder is not the person’s own', () => {
      const testDir = createTestDir();
      const { locks, settingsPath } = lockPaths(testDir);
      fs.mkdirSync(locks, { mode: 0o700 });
      vi.spyOn(process, 'getuid').mockReturnValue(fs.statSync(locks).uid + 1);

      // no settings.json yet, so only the locks folder's owner can stop the save
      new SettingsService(testDir, { sleep: () => undefined }).save();

      expect(fs.existsSync(settingsPath)).toBe(false);
    });
  });

  // Task 16ao (Pen-R5-N4)
  // @behavior Several watcher or CLI instances save settings.json at about the same time (each loaded it
  //           earlier): every key each of them set is on disk afterwards, and nothing another writer saved
  //           meanwhile is lost.
  // @business-rule A save writes only the entries this instance changed (set or delete), on top of the file
  //           as it is under the lock; every other key stays exactly as it is on disk.
  describe('concurrent instances only write what they changed (Task 16ao)', () => {
    function readSaved(settingsPath: string): Record<string, Record<string, unknown>> {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }

    it('keeps every provider key when instances that loaded together each set a different one', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const providers = ['openrouter', 'openai', 'gemini', 'ollama'];
      const services = providers.map(() => new SettingsService(testDir));

      for (const [i, provider] of providers.entries()) {
        await services[i].setApiKey(provider, `key-${provider}`);
      }

      expect(readSaved(settingsPath).apiKeys).toEqual({
        openrouter: 'key-openrouter',
        openai: 'key-openai',
        gemini: 'key-gemini',
        ollama: 'key-ollama',
      });
    });

    it('keeps a notification change another writer saved after this instance loaded, when it sets a model', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'visual', voice: 'Samantha' } }));

      const service = new SettingsService(testDir);
      // /oss:settings changes the style and voice after the watcher loaded
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { style: 'audio', voice: 'Daniel' } }));
      await service.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');

      const saved = readSaved(settingsPath);
      expect(saved.notifications).toEqual({ style: 'audio', voice: 'Daniel' });
      expect(saved.models.agents).toEqual({ 'oss:code-reviewer': 'ollama/codellama' });
    });

    it('keeps the other models and supervisor settings another writer saved, when it changes one of each', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const service = new SettingsService(testDir);
      fs.writeFileSync(
        settingsPath,
        JSON.stringify({
          models: { default: 'claude', agents: { 'oss:debugger': 'gemini/flash' }, commands: { 'oss:ship': 'x/y' } },
          supervisor: { mode: 'always', ironLawChecks: { tdd: true, gitFlow: true } },
        })
      );

      service.setIronLawCheck('tdd', false);
      await service.setModelForPrompt('agent', 'oss:code-reviewer', 'ollama/codellama');

      const saved = readSaved(settingsPath);
      expect(saved.models).toEqual({
        default: 'claude',
        agents: { 'oss:debugger': 'gemini/flash', 'oss:code-reviewer': 'ollama/codellama' },
        commands: { 'oss:ship': 'x/y' },
      });
      expect(saved.supervisor).toEqual({ mode: 'always', ironLawChecks: { tdd: false, gitFlow: true } });
    });

    it('overwrites one provider key without touching the others, including one added after it loaded', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ apiKeys: { openai: 'old', gemini: 'g' } }));

      const service = new SettingsService(testDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ apiKeys: { openai: 'old', gemini: 'g', openrouter: 'r' } }));
      await service.setApiKey('openai', 'new');

      expect(readSaved(settingsPath).apiKeys).toEqual({ openai: 'new', gemini: 'g', openrouter: 'r' });
    });

    it('saves every field a setter changed, on top of a file another writer saved after it loaded', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const service = new SettingsService(testDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ notifications: { updates: false }, team: 'kept' }));

      service.setNotificationStyle('sound');
      service.setVerbosity('all');
      service.setVoice('Karen');
      service.setSound('Ping');
      service.setSupervisorMode('always');
      service.setCheckInterval(1234);
      service.setIronLawCheck('devDocs', false);
      service.save();

      expect(readSaved(settingsPath)).toEqual({
        team: 'kept',
        notifications: { updates: false, style: 'sound', verbosity: 'all', voice: 'Karen', sound: 'Ping' },
        supervisor: { mode: 'always', checkIntervalMs: 1234, ironLawChecks: { devDocs: false } },
      });
    });

    it('does not write an entry again once it is saved, so a newer value another writer saved is kept', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      const service = new SettingsService(testDir);

      await service.setApiKey('openai', 'mine');
      fs.writeFileSync(settingsPath, JSON.stringify({ apiKeys: { openai: 'theirs, newer' } }));
      await service.setApiKey('gemini', 'g');

      expect(readSaved(settingsPath).apiKeys).toEqual({ openai: 'theirs, newer', gemini: 'g' });
    });

    it('never writes decisionsPush: a switch another writer flipped after it loaded stays as they left it', async () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: false }));

      const service = new SettingsService(testDir);
      fs.writeFileSync(settingsPath, JSON.stringify({ decisionsPush: true }));
      await service.setApiKey('openai', 'k');
      expect(readSaved(settingsPath).decisionsPush).toBe(true);

      fs.writeFileSync(settingsPath, JSON.stringify({ apiKeys: { openai: 'k' } }));
      service.save();
      expect(readSaved(settingsPath)).not.toHaveProperty('decisionsPush');
    });
  });

  describe('partial updates', () => {
    it('should merge partial updates with existing settings', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings: NotificationSettings = {
        notifications: {
          style: 'audio',
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
          updates: true,
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      service.setNotificationStyle('visual');
      service.save();

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const saved = JSON.parse(content);

      // Changed field
      expect(saved.notifications.style).toBe('visual');
      // Preserved fields
      expect(saved.notifications.voice).toBe('Daniel');
      expect(saved.notifications.sound).toBe('Purr');
      expect(saved.notifications.verbosity).toBe('all');
    });
  });

  describe('validation', () => {
    /**
     * @behavior A settings.json written before Telegram was removed still loads:
     *           the user's other preferences survive and the stale telegram block
     *           (bot token, chat id) is dropped instead of being carried forward.
     * @business-rule Customer Telegram is gone; old files must not crash the watcher.
     */
    it('should load an old settings file with a telegram block and drop it', () => {
      const testDir = createTestDir();
      fs.writeFileSync(
        path.join(testDir, 'settings.json'),
        JSON.stringify({
          notifications: { style: 'audio', voice: 'Daniel', sound: 'Purr', verbosity: 'all' },
          telegram: { enabled: true, botToken: 'old-token', chatId: '42' },
          version: 1,
        })
      );

      const service = new SettingsService(testDir);
      service.save();
      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded).not.toHaveProperty('telegram');
      expect(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf8')).not.toContain('old-token');
    });

    it('should validate settings schema and fall back to defaults on invalid', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      // Write invalid JSON
      fs.writeFileSync(settingsPath, '{ invalid json }');

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      // Should use defaults
      expect(loaded.notifications.style).toBe('visual');
      expect(loaded.notifications.voice).toBe('Samantha');
    });

    it('should validate notification style values', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings = {
        notifications: {
          style: 'invalid-style', // Invalid
          voice: 'Daniel',
          sound: 'Purr',
          verbosity: 'all',
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      // Invalid style should fall back to default
      expect(loaded.notifications.style).toBe('visual');
    });
  });

  describe('migration', () => {
    it('should migrate from old audio-config format', () => {
      const testDir = createTestDir();

      // Create old-style audio-config file
      const audioConfigPath = path.join(testDir, 'audio-config');
      const oldConfig = `OSS_AUDIO_ENABLED=true
OSS_USE_VOICE=true
OSS_VOICE=Daniel
OSS_SOUND_SUCCESS=Glass
OSS_SOUND_ERROR=Basso`;
      fs.writeFileSync(audioConfigPath, oldConfig);

      const service = new SettingsService(testDir);
      service.migrateFromAudioConfig();
      service.save();

      const loaded = service.getSettings();

      expect(loaded.notifications.style).toBe('audio');
      expect(loaded.notifications.voice).toBe('Daniel');
      // the migrated values are saved too (Task 16ao: only changed fields are written, so these must count)
      const saved = JSON.parse(fs.readFileSync(path.join(testDir, 'settings.json'), 'utf-8'));
      expect(saved.notifications).toMatchObject({ style: 'audio', voice: 'Daniel', sound: 'Glass' });
    });
  });

  describe('notifications.updates toggle', () => {
    it('should default notifications.updates to true when not in settings', () => {
      const testDir = createTestDir();

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.updates).toBe(true);
    });

    it('should respect notifications.updates=false from settings', () => {
      const testDir = createTestDir();
      const settingsPath = path.join(testDir, 'settings.json');

      const settings = {
        notifications: {
          style: 'visual',
          voice: 'Samantha',
          sound: 'Glass',
          verbosity: 'important',
          updates: false,
        },
        version: 1,
      };
      fs.writeFileSync(settingsPath, JSON.stringify(settings));

      const service = new SettingsService(testDir);
      const loaded = service.getSettings();

      expect(loaded.notifications.updates).toBe(false);
    });
  });

  describe('setter methods', () => {
    it('should set notification style', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setNotificationStyle('audio');
      expect(service.getSettings().notifications.style).toBe('audio');
    });

    it('should set verbosity', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setVerbosity('errors-only');
      expect(service.getSettings().notifications.verbosity).toBe('errors-only');
    });

    it('should set voice', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setVoice('Karen');
      expect(service.getSettings().notifications.voice).toBe('Karen');
    });

    it('should set sound', () => {
      const testDir = createTestDir();
      const service = new SettingsService(testDir);

      service.setSound('Ping');
      expect(service.getSettings().notifications.sound).toBe('Ping');
    });
  });
});
