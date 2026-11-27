/**
 * @behavior A watcher test run never uses the developer's real home: when HOME is the passwd home (the account's
 *           home from the user database, compared after realpath, so a link to it counts too), the global setup
 *           swaps in a fresh temp HOME before any test runs; if HOME still resolves to the passwd home after that, the
 *           run stops with an error; a HOME that is already a temp folder is kept as it is.
 * @business-rule complete-gaps (c), card 3 (D5): no test may write the real ~/.oss (hooks, config, ledger).
 * @boundary ensureTempHome(env, passwdHome, mkTemp) from test/global-setup.ts. The passwd home and the temp-folder
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

  it('should keep an already-temp HOME', () => {
    const already = mkTemp();
    made = [];
    const env: NodeJS.ProcessEnv = { HOME: already };

    ensureTempHome(env, fakePasswdHome, mkTemp);

    expect(env.HOME).toBe(already);
    expect(made).toHaveLength(0);
  });
});
