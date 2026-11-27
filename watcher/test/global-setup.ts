/**
 * Vitest globalSetup: runs once in the main process, before any fork starts.
 * If HOME is the account's real (passwd) home, it is replaced by a fresh temp dir, so every
 * fork inherits a temp HOME even when setupFiles is emptied. See complete-gaps (c), D5.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const isPasswdHome = (home: string, passwdHome: string): boolean =>
  fs.realpathSync(home) === fs.realpathSync(passwdHome);

export function ensureTempHome(
  env: NodeJS.ProcessEnv,
  passwdHome: string,
  mkTemp: () => string,
): void {
  // An unset HOME makes os.homedir() fall back to the passwd home, so treat it as the real home.
  if (!isPasswdHome(env.HOME ?? passwdHome, passwdHome)) return;
  env.HOME = mkTemp();
  if (isPasswdHome(env.HOME, passwdHome)) {
    throw new Error('real-HOME guard: HOME still resolves to the real home; refusing to run tests');
  }
}

export default function setup(): () => void {
  const before = process.env.HOME;
  ensureTempHome(process.env, os.userInfo().homedir, () =>
    fs.mkdtempSync(path.join(os.tmpdir(), 'oss-global-home-')),
  );
  const made = process.env.HOME !== before ? process.env.HOME : undefined;
  return () => {
    if (made) fs.rmSync(made, { recursive: true, force: true });
  };
}
