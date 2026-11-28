/**
 * Vitest globalSetup: runs once in the main process, before any fork starts.
 * If HOME is the account's real (passwd) home, it is replaced by a fresh temp dir, so every
 * fork inherits a temp HOME even when setupFiles is emptied. See complete-gaps (c), D5.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Stat = (p: string) => fs.Stats;

// Same folder = same device and inode, so another spelling (case-insensitive APFS) or a firmlink
// (/System/Volumes/Data/Users/<u>) counts as the passwd home too; a relative HOME always counts.
// A folder inside the passwd home (e.g. ~/dev) counts too: after resolving links, every parent of
// HOME is checked, and so are the targets of HOME/.oss and HOME/.claude. A HOME or passwd home that cannot be
// resolved (missing) stops the run: we cannot prove where it is.
const isPasswdHome = (home: string, passwdHome: string, stat: Stat): boolean => {
  if (!path.isAbsolute(home)) return true;
  let real: string;
  try {
    real = fs.realpathSync(home);
  } catch (e) {
    throw new Error(`real-HOME guard: HOME (${home}) cannot be resolved; refusing to run tests`, { cause: e });
  }
  let b: fs.Stats;
  try {
    b = stat(passwdHome);
  } catch (e) {
    throw new Error(`real-HOME guard: passwd home (${passwdHome}) cannot be read; refusing to run tests`, { cause: e });
  }
  const leadsInto = (start: string): boolean => {
    for (let p = start; ; p = path.dirname(p)) {
      const a = stat(p);
      if (a.dev === b.dev && a.ino === b.ino) return true;
      if (path.dirname(p) === p) return false;
    }
  };
  if (leadsInto(real)) return true;
  // A temp HOME whose .oss or .claude links into the passwd home would let tests write the real one.
  return ['.oss', '.claude'].some((name) => {
    let target: string;
    try {
      target = fs.realpathSync(path.join(real, name));
    } catch {
      return false;
    }
    return leadsInto(target);
  });
};

export function ensureTempHome(
  env: NodeJS.ProcessEnv,
  passwdHome: string,
  mkTemp: () => string,
  stat: Stat = fs.statSync,
): void {
  delete env.OSS_CONFIG_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  // An unset HOME makes os.homedir() fall back to the passwd home, so treat it as the real home.
  if (!isPasswdHome(env.HOME ?? passwdHome, passwdHome, stat)) return;
  env.HOME = mkTemp();
  if (isPasswdHome(env.HOME, passwdHome, stat)) {
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
