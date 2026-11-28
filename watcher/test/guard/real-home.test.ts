/**
 * @behavior A watcher test run never uses the developer's real home: when HOME is the passwd home (the account's
 *           home from the user database, compared after realpath, so a link to it counts too), the global setup
 *           swaps in a fresh temp HOME before any test runs (same folder means same device and inode, so another
 *           spelling or firmlink counts too, and a relative HOME is always replaced); OSS_CONFIG_DIR, CLAUDE_PLUGIN_ROOT
 *           and CLAUDE_PROJECT_DIR are removed; if HOME still resolves to the passwd home after that, the
 *           run stops with an error; a HOME that is already a temp folder is kept as it is.
 * @business-rule complete-gaps (c), card 3 (D5): no test may write the real ~/.oss (hooks, config, ledger).
 * @boundary ensureTempHome(env, passwdHome, mkTemp, stat?) from test/global-setup.ts. The passwd home and the temp-folder
 *           maker are injected, so this test never reads or writes the real home: every "home" here is a temp folder.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureTempHome } from '../global-setup';

describe('real-HOME guard for watcher tests', () => {
  let scratch: string;
  let fakePasswdHome: string;
  let made: string[];
  const mkTemp = (): string => {
    const d = fs.mkdtempSync(path.join(scratch, 'temp-home-'));
    made.push(d);
    return d;
  };

  beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'real-home-guard-')));
    fakePasswdHome = path.join(scratch, 'passwd-home');
    fs.mkdirSync(fakePasswdHome);
    made = [];
  });

  afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('should replace HOME with a fresh temp dir when HOME is the passwd home', () => {
    const env: NodeJS.ProcessEnv = { HOME: fakePasswdHome };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
    expect(fs.realpathSync(env.HOME ?? '')).not.toBe(fakePasswdHome);
  });

  it('should replace HOME when it is a link to the passwd home (compared after realpath)', () => {
    const link = path.join(scratch, 'home-link');
    fs.symlinkSync(fakePasswdHome, link);
    const env: NodeJS.ProcessEnv = { HOME: link };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should throw before any test runs when HOME still resolves to the passwd home after setup', () => {
    const env: NodeJS.ProcessEnv = { HOME: fakePasswdHome };
    const badTemp = (): string => fakePasswdHome;

    expect(() => ensureTempHome(env, fakePasswdHome, badTemp)).toThrow();
  });

  it('should replace an unset HOME, since os.homedir() then falls back to the passwd home', () => {
    const env: NodeJS.ProcessEnv = {};

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should replace HOME when it is the passwd home spelled in another case (case-insensitive volume)', () => {
    const upper = path.join(scratch, 'PASSWD-HOME');
    // Only a case-insensitive volume (default APFS) resolves the other spelling to the same folder.
    // On a case-sensitive volume this path is a different (missing) folder, so there is nothing to check.
    if (!fs.existsSync(upper)) return;
    const env: NodeJS.ProcessEnv = { HOME: upper };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should replace HOME when it is another path to the same folder (same device and inode, like a firmlink)', () => {
    const firmlink = path.join(scratch, 'firmlink-home');
    fs.mkdirSync(firmlink);
    // A firmlink (e.g. /System/Volumes/Data/Users/<u>) cannot be made in a test; the stat seam reports
    // what the OS would: this other path has the passwd home's device and inode.
    const stat = (p: string): fs.Stats => fs.statSync(p === firmlink ? fakePasswdHome : p);
    const env: NodeJS.ProcessEnv = { HOME: firmlink };

    ensureTempHome(env, fakePasswdHome, mkTemp, stat);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should replace a relative HOME, since its meaning depends on the working folder', () => {
    const env: NodeJS.ProcessEnv = { HOME: '..' };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should remove OSS_CONFIG_DIR, CLAUDE_PLUGIN_ROOT and CLAUDE_PROJECT_DIR so tests cannot reach real config through them', () => {
    const env: NodeJS.ProcessEnv = {
      HOME: fakePasswdHome,
      OSS_CONFIG_DIR: path.join(fakePasswdHome, '.oss'),
      CLAUDE_PLUGIN_ROOT: path.join(fakePasswdHome, 'plugin'),
      CLAUDE_PROJECT_DIR: path.join(fakePasswdHome, 'project'),
    };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(env.OSS_CONFIG_DIR).toBeUndefined();
    expect(env.CLAUDE_PLUGIN_ROOT).toBeUndefined();
    expect(env.CLAUDE_PROJECT_DIR).toBeUndefined();
  });

  it('should replace HOME when it is a folder inside the passwd home (like ~/dev), so tests cannot write ~/dev/.oss', () => {
    const inside = path.join(fakePasswdHome, 'dev', 'project');
    fs.mkdirSync(inside, { recursive: true });
    const env: NodeJS.ProcessEnv = { HOME: inside };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should replace HOME when it is a link that leads to a folder inside the passwd home', () => {
    const inside = path.join(fakePasswdHome, 'dev');
    fs.mkdirSync(inside);
    const link = path.join(scratch, 'dev-link');
    fs.symlinkSync(inside, link);
    const env: NodeJS.ProcessEnv = { HOME: link };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should replace HOME when it is a folder inside the passwd home spelled in another case (case-insensitive volume)', () => {
    fs.mkdirSync(path.join(fakePasswdHome, 'dev'));
    const upper = path.join(scratch, 'PASSWD-HOME', 'DEV');
    // Only a case-insensitive volume (default APFS) resolves the other spelling to the same folder.
    if (!fs.existsSync(upper)) return;
    const env: NodeJS.ProcessEnv = { HOME: upper };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(made).toHaveLength(1);
    expect(env.HOME).toBe(made[0]);
  });

  it('should stop the run with the guard message when HOME is an absolute folder that does not exist', () => {
    const env: NodeJS.ProcessEnv = { HOME: path.join(scratch, 'no-such-home') };

    expect(() => ensureTempHome(env, fakePasswdHome, mkTemp)).toThrow(/^real-HOME guard: /);
    expect(made).toHaveLength(0);
  });

  it.each(['.oss', '.claude'])(
    'should replace a temp HOME whose %s is a link into the passwd home, so tests cannot write the real one through it',
    (name) => {
      const realDir = path.join(fakePasswdHome, name);
      fs.mkdirSync(realDir);
      const tempHome = mkTemp();
      made = [];
      fs.symlinkSync(realDir, path.join(tempHome, name));
      const env: NodeJS.ProcessEnv = { HOME: tempHome };

      ensureTempHome(env, fakePasswdHome, mkTemp);

      expect(made).toHaveLength(1);
      expect(env.HOME).toBe(made[0]);
    },
  );

  it('should keep a temp HOME that has a real .oss folder of its own', () => {
    const tempHome = mkTemp();
    made = [];
    fs.mkdirSync(path.join(tempHome, '.oss'));
    const env: NodeJS.ProcessEnv = { HOME: tempHome };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(env.HOME).toBe(tempHome);
    expect(made).toHaveLength(0);
  });

  it('should stop the run with the guard message when the passwd home does not exist', () => {
    const tempHome = mkTemp();
    made = [];
    const env: NodeJS.ProcessEnv = { HOME: tempHome };

    expect(() => ensureTempHome(env, path.join(scratch, 'no-such-passwd-home'), mkTemp)).toThrow(/^real-HOME guard: /);
    expect(made).toHaveLength(0);
  });

  it('should keep an already-temp HOME', () => {
    const already = mkTemp();
    made = [];
    const env: NodeJS.ProcessEnv = { HOME: already };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(env.HOME).toBe(already);
    expect(made).toHaveLength(0);
  });
});
