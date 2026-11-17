/**
 * The OS sandbox a review agent's Bash call runs in (R-266 round 8 D1-D4, round 9 D-R9-1).
 *
 * On macOS a review agent's Bash call that passed the gate is rewritten to run under an allowlist
 * Seatbelt profile (rounds 7 and 8 showed a deny-list never converges):
 * - writes: only a private per-session folder (`<user temp>/oss-review/<session>/`, 0700, ours, no
 *   symlinks), which is also TMPDIR and holds the caches; plus /dev/null, /dev/tty, fds, dtracehelper;
 * - Unix sockets: none but the DNS one (mDNSResponder); TCP and UDP stay on (D3);
 * - reads under the home folder (HOME and the password-database home): none, except the reviewed
 *   repos, the private folder and the toolchain folders; never the credential stores;
 * - no preference writes, apps, Apple Events, signals outside its own sandbox or keychain lookups;
 * - the inner shell starts from `env -i` with an allowlist of non-secret names.
 * The profile is given inline (`-p`), so there is no file for the agent to change.
 *
 * Where it can't run (Linux, Windows, the session turned it off, or Claude Code's own sandbox mode is
 * on: Seatbelt can't nest) review agents get the stricter fallback rules (gate-agent-write.ts). On
 * macOS without Claude Code's sandbox, a sandbox that can't be trusted (failed self-test, planted
 * private folder) refuses the call: it never runs unsandboxed. Builders and the main agent are never wrapped.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { credentialPaths } from './credential-places.js';
import { timeLeft } from './deadline.js';
import { readableUnderHome, reviewFoldersRoot, transcriptPattern, transcriptRoots } from './review-places.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const ENV = '/usr/bin/env';
const SHELL = ['/bin/bash', '--norc', '--noprofile', '-c'];
/**
 * The inner shell runs the call as a child in its own process group and ends that group when the
 * call ends (round 10, SEC LOW-3), so a job it leaves running dies with it. A child that starts its
 * own session (setsid) or process group (setpgrp) leaves the group and is not ended: an accepted
 * limit (round 11). It stays in the sandbox, which makes no symlink (SEC CRITICAL-1), so it can't
 * swap a checked file for a link later. The wrapper's own stderr is
 * closed while it starts the child: bash's `child setpgid` warning, when a fast child has already
 * exited, is noise.
 */
const GROUP_WRAPPER = 'set -m; exec 3>&2 2>/dev/null; /bin/bash --norc --noprofile -c "$1" 2>&3 3>&- & p=$!; exec 2>&3 3>&-; set +m; trap \'kill -TERM -- -$p 2>/dev/null\' EXIT; trap \'exit 143\' TERM INT HUP; wait $p';
/** OSS's own local port (the model proxy): a review agent's call may not listen on it (round 10, SEC LOW-3). */
export const OSS_PORT = 8473;
const DNS_SOCKET = '/private/var/run/mDNSResponder';
const MANAGED_SETTINGS = '/Library/Application Support/ClaudeCode/managed-settings.json';

/** The keychain's services (D3): asking them is how git's osxkeychain helper and `security` read secrets. */
const KEYCHAIN_SERVICES = ['com.apple.SecurityServer', 'com.apple.securityd.xpc', 'com.apple.secd', 'com.apple.trustd.agent'];
const KEYCHAIN_PREFIXES = ['com.apple.security.'];

export { TOOLCHAIN_PLACES } from './review-places.js';

/** Non-secret names copied from the hook's environment into the sandboxed shell (D-R9-1). */
const ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'JAVA_HOME',
  'GOPATH',
  'GOROOT',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'NVM_DIR',
  'PYENV_ROOT',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'NODE_ENV',
  'CI',
]);
const LOCALE_NAME = /^LC_[A-Z]+$/;

export interface SandboxPlaces {
  /** HOME and the password-database home, as they are on disk. */
  homes: readonly string[];
  /** The private per-session folder: the only place the call may write. */
  privateDir: string;
  /** The reviewed repos, as given and as they are on disk: readable, never writable. */
  repos: readonly string[];
  /** The session TMPDIR, whose `claude-*` transcript folders are denied (round 10, D-R10-1). */
  tmpdir?: string;
  /** Local ports the call may not listen on; OSS_PORT when absent (round 10, SEC LOW-3). */
  ports?: readonly number[];
  /** Other repos and worktrees inside the reviewed repos: their contents are denied (round 11, SEC LOW-1). */
  hidden?: readonly string[];
}

/** A string as an SBPL string literal. */
function sbString(text: string): string {
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function inside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(`${root}/`);
}

/** The folders from `dir`'s parent up to and including `top`. */
function ancestorsUpTo(dir: string, top: string): string[] {
  const out: string[] = [];
  for (let at = path.dirname(dir); inside(at, top); at = path.dirname(at)) {
    out.push(at);
    if (at === top || at === path.dirname(at)) break;
  }
  return out;
}

/** The Seatbelt profile for a review agent's call (D-R9-1). */
export function reviewSandboxProfile(places: SandboxPlaces): string {
  const homes = [...new Set(places.homes.map((dir) => dir.replace(/(.)\/+$/, '$1')))];
  const priv = places.privateDir;
  const readable = readableUnderHome({ homes, repos: places.repos, privateDir: priv });
  // getcwd and realpath stat each folder above a readable place: its metadata only, not its contents
  // round 11, SEC LOW-3: the other agents' private folders are not readable; the way to its own is (metadata only)
  const agents = reviewFoldersRoot(priv);
  const metadata = [
    ...new Set([...homes, ...readable.flatMap((r) => homes.filter((home) => inside(r.at, home)).flatMap((home) => ancestorsUpTo(r.at, home))), ...(agents === null ? [] : ancestorsUpTo(priv, agents))]),
  ];
  // a protected path inside the writable folder: no write to it, nor a rename of a folder above it
  const shielded = [...places.repos, ...homes].filter((p) => inside(p, priv) && p !== priv);
  const writeDenied = [...shielded.map((p) => `(subpath ${sbString(p)})`), ...[...new Set(shielded.flatMap((p) => ancestorsUpTo(p, priv)))].map((p) => `(literal ${sbString(p)})`)];
  const credentials = credentialPaths(homes).map(({ path: p, kind }) => `(${kind === 'folder' ? 'subpath' : kind === 'file' ? 'literal' : 'prefix'} ${sbString(p)})`);
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    // round 16, SEC INFO-1: the controlling terminal only, not the user's other ttys (/dev/ttys*)
    `(allow file-write* (subpath ${sbString(priv)}) (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
    ...(writeDenied.length > 0 ? [`(deny file-write* ${writeDenied.join(' ')})`] : []),
    // round 11, SEC CRITICAL-1: no symlink anywhere (ln -s, symlink(), then a rename over a checked
    // file), so a file the gate checked can't become a link before Claude Code's tools open it
    '(deny file-write-create (vnode-type SYMLINK))',
    '(deny user-preference-write)',
    '(deny lsopen)',
    '(deny appleevent-send)',
    '(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))',
    '(deny signal)',
    '(allow signal (target same-sandbox))',
    '(deny network-outbound (remote unix-socket))',
    `(allow network-outbound (remote unix-socket (path-literal ${sbString(DNS_SOCKET)})))`,
    `(deny file-read* ${[...homes, ...(agents === null ? [] : [agents])].map((dir) => `(subpath ${sbString(dir)})`).join(' ')})`,
    `(allow file-read* ${readable.map((r) => `(${r.kind === 'file' ? 'literal' : 'subpath'} ${sbString(r.at)})`).join(' ')})`,
    `(allow file-read-metadata ${metadata.map((p) => `(literal ${sbString(p)})`).join(' ')})`,
    // their contents only: git status in the root still sees that a nested repo is there
    ...((places.hidden ?? []).length > 0 ? [`(deny file-read-data ${(places.hidden ?? []).map((p) => `(subpath ${sbString(p)})`).join(' ')})`] : []),
    `(deny file-read* ${credentials.join(' ')})`,
    `(deny file-read* ${transcriptRoots([places.tmpdir]).map((root) => `(regex #"${transcriptPattern(root)}")`).join(' ')})`,
    '(deny mach-lookup (global-name-prefix "com.apple.pasteboard"))',
    // round 12, SEC CRITICAL-A: no mounts (a disk image over `.git/hooks`): no DiskArbitration, no mount tools
    '(deny mach-lookup (global-name-prefix "com.apple.DiskArbitration"))',
    // round 13, SEC INFO-1: and the third-party file-system tools (macFUSE and the like)
    '(deny process-exec (literal "/usr/bin/hdiutil") (regex #"^/sbin/mount(_|$)") (subpath "/System/Library/Filesystems") (subpath "/Library/Filesystems"))',
    // round 14, SEC CRITICAL-1: nor mount(2)/unmount(2) called directly (devfs over ~/.claude/plugins)
    '(deny file-mount)',
    '(deny file-unmount)',
    `(deny network-bind ${[...new Set(places.ports ?? [OSS_PORT])].map((port) => `(local ip "*:${port}")`).join(' ')})`,
    `(deny mach-lookup ${[...KEYCHAIN_SERVICES.map((name) => `(global-name ${sbString(name)})`), ...KEYCHAIN_PREFIXES.map((name) => `(global-name-prefix ${sbString(name)})`)].join(' ')})`,
  ].join('\n');
}

/** A word as a shell word that means exactly itself. */
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * The cache variables pointed into the private folder (one folder per tool), so the agents' usual
 * checks don't try to write their caches in the home folder or the repo. pytest's cache plugin is
 * off: it writes `.pytest_cache` in the repo, and its warning fails a `filterwarnings = error` run.
 */
export function cacheEnv(root: string): Record<string, string> {
  const at = (name: string): string => path.join(root, name);
  return {
    npm_config_cache: at('npm'),
    GOCACHE: at('go-build'),
    PYTHONPYCACHEPREFIX: at('pycache'),
    XDG_CACHE_HOME: at('xdg'),
    CARGO_TARGET_DIR: at('cargo-target'),
    RUFF_CACHE_DIR: at('ruff'),
    MYPY_CACHE_DIR: at('mypy'),
    CLANG_MODULE_CACHE_PATH: at('clang-modules'),
    PYTEST_ADDOPTS: '-p no:cacheprovider',
  };
}

/** The sandboxed shell's environment: the allowlisted names from the hook's, then TMPDIR and the caches. */
export function sandboxEnv(hookEnv: Readonly<Record<string, string | undefined>>, privateDir: string): Record<string, string> {
  const kept = Object.entries(hookEnv).filter((entry): entry is [string, string] => entry[1] !== undefined && (ENV_NAMES.has(entry[0]) || LOCALE_NAME.test(entry[0])));
  return { ...Object.fromEntries(kept), TMPDIR: privateDir, ...cacheEnv(privateDir) };
}

/** The command that runs `command` in the sandbox, in a shell started from an empty environment plus `env`. */
export function wrapCommand(command: string, profile: string, env: Record<string, string>): string {
  const assignments = Object.entries(env).map(([name, value]) => shellQuote(`${name}=${value}`));
  return [SANDBOX_EXEC, '-p', shellQuote(profile), ENV, '-i', ...assignments, ...SHELL, shellQuote(GROUP_WRAPPER), 'oss-review', shellQuote(command)].join(' ');
}

function realOrNull(dir: string): string | null {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
}

/** The user's home from the password database (getpwuid), as it is on disk; undefined when unknown. */
function passwordHome(): string | undefined {
  try {
    const dir = os.userInfo().homedir;
    return path.isAbsolute(dir) ? (realOrNull(dir) ?? dir) : undefined;
  } catch {
    return undefined;
  }
}

/** The user's own temp folder (`getconf DARWIN_USER_TEMP_DIR`), as it is on disk; null when unknown. */
function darwinUserTemp(): string | null {
  const read = spawnSync('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8', timeout: timeLeft(500) });
  const dir = read.status === 0 ? read.stdout.trim() : '';
  return path.isAbsolute(dir) ? realOrNull(dir) : null;
}

/**
 * Makes (or finds) a folder that is ours alone: a real folder, not a link, owned by us, then mode 0700
 * (one of ours left more open is closed again; a link or someone else's is refused).
 */
function ownPrivateFolder(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return false;
  }
  try {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) return false;
    if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
    return (fs.lstatSync(dir).mode & 0o777) === 0o700;
  } catch {
    return false;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The agent's private folder `<userTemp>/oss-review/<session>/<agent id>` (round 10, D-R10-2): the
 * session folder when the hook names no safe agent id. Not made here.
 */
export function privateFolderPath(userTemp: string, sessionId: unknown, agentId?: unknown): string {
  const session = typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? sessionId : 'session';
  const dir = path.join(userTemp, 'oss-review', session);
  return typeof agentId === 'string' && SAFE_ID.test(agentId) ? path.join(dir, agentId) : dir;
}

/** The agent's private folder (see privateFolderPath), each level made 0700 and ours; null when it can't be trusted. */
export function privateFolder(userTemp: string, sessionId: unknown, agentId?: unknown): string | null {
  const dir = privateFolderPath(userTemp, sessionId, agentId);
  const levels = [path.join(userTemp, 'oss-review'), ...(path.dirname(dir) === path.join(userTemp, 'oss-review') ? [] : [path.dirname(dir)]), dir];
  return levels.every(ownPrivateFolder) && realOrNull(dir) === dir ? dir : null;
}

/**
 * The user temp folder the private folders live in, as it is on disk: on macOS `getconf
 * DARWIN_USER_TEMP_DIR`; elsewhere the session's TMPDIR, else /tmp. null when unknown.
 */
export function reviewUserTemp(platform: NodeJS.Platform, tmpdir: string | undefined, override?: string): string | null {
  if (override !== undefined) return realOrNull(override);
  if (platform === 'darwin') return darwinUserTemp();
  const given = tmpdir !== undefined && path.isAbsolute(tmpdir) ? tmpdir : '/tmp';
  const real = realOrNull(given);
  return real === '/' ? null : real;
}

/** `sandbox.enabled` in one settings file: true, false, or undefined when it doesn't say. */
function sandboxSetting(file: string): boolean | undefined {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sandbox = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).sandbox : undefined;
    const enabled = typeof sandbox === 'object' && sandbox !== null ? (sandbox as Record<string, unknown>).enabled : undefined;
    return typeof enabled === 'boolean' ? enabled : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when Claude Code runs Bash calls in its own sandbox: the hook itself runs inside it (Claude
 * Code sets SANDBOX_RUNTIME=1 in a sandboxed command's environment), or `sandbox.enabled` in the
 * user's own settings (`~/.claude/settings.json`, `settings.local.json`, in each home) or the managed
 * settings (each later one wins). Never from a file under the project or a reviewed repo, which the
 * reviewed code controls (round 10, SEC MEDIUM-3, PEN LOW-1).
 */
export function hostSandboxOn(homes: readonly string[], env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.SANDBOX_RUNTIME === '1') return true;
  const files = [...homes.flatMap((home) => [path.join(home, '.claude', 'settings.json'), path.join(home, '.claude', 'settings.local.json')]), MANAGED_SETTINGS];
  return files.map(sandboxSetting).reduce<boolean>((on, setting) => setting ?? on, false);
}

/** How a review agent's call is contained: wrapped in the sandbox, the stricter fallback rules, or refused. */
export type Containment =
  | { kind: 'sandbox'; wrap: (command: string, repos: readonly string[], hidden?: readonly string[]) => string | null }
  | { kind: 'fallback'; why: 'off' | 'platform' | 'host-sandbox' }
  | { kind: 'refused'; reason: string };

/** Checks whether sandbox-exec can run the profile here; `run` is swapped in tests. */
export type SandboxRunner = (args: readonly string[]) => boolean;

const realRunner: SandboxRunner = (args) => {
  const run = spawnSync(SANDBOX_EXEC, [...args], { stdio: 'ignore', timeout: timeLeft(1000) });
  return run.status === 0;
};

export interface ContainmentOptions {
  platform: NodeJS.Platform;
  /** HOME as the hook has it. */
  home: string;
  sessionId: unknown;
  /** The hook's environment: the sandboxed shell gets only its allowlisted names. */
  env: Readonly<Record<string, string | undefined>>;
  /** The calling agent's id (hook input `agent_id`): its private folder is its own (round 10, D-R10-2). */
  agentId?: unknown;
  /** The session TMPDIR, whose transcript folders the profile denies. */
  tmpdir?: string;
  /** Local ports the call may not listen on (round 10, SEC LOW-3). */
  ports?: readonly number[];
  /** The Bash call's input (`dangerouslyDisableSandbox` takes it out of Claude Code's sandbox). */
  toolInput: unknown;
  /** The hook's own OSS_TOOL_GATE_SANDBOX=off, which an agent's call can't set. */
  disabled: boolean;
  /** The user temp folder; `getconf DARWIN_USER_TEMP_DIR` when absent. */
  userTemp?: string;
  /** The home from the password database; getpwuid's when absent (round 11, CR LOW-A: tests give their own). */
  passwordHome?: string;
  /** The homes whose Claude Code user settings say whether Claude Code's sandbox is on; the homes when absent (CR LOW-A). */
  settingsHomes?: readonly string[];
}

const UNSAFE =
  "the review sandbox can't be used on this Mac right now, and a review agent's Bash call runs only inside it";

/**
 * The containment for a review agent's call on this machine, checked on every call (about 10 ms).
 */
export function reviewContainment(opts: ContainmentOptions, run: SandboxRunner = realRunner): Containment {
  if (opts.disabled) return { kind: 'fallback', why: 'off' };
  if (opts.platform !== 'darwin') return { kind: 'fallback', why: 'platform' };
  const optedOut = typeof opts.toolInput === 'object' && opts.toolInput !== null && (opts.toolInput as Record<string, unknown>).dangerouslyDisableSandbox === true;
  const pwHome = opts.passwordHome === undefined ? passwordHome() : (realOrNull(opts.passwordHome) ?? opts.passwordHome);
  const homes = [...new Set([realOrNull(opts.home) ?? opts.home, pwHome].filter((dir): dir is string => dir !== undefined))];
  if (!optedOut && hostSandboxOn(opts.settingsHomes ?? homes, opts.env)) return { kind: 'fallback', why: 'host-sandbox' };
  const refused = (why: string): Containment => ({ kind: 'refused', reason: `${UNSAFE} (${why})` });
  if (!path.isAbsolute(opts.home) || !fs.existsSync(SANDBOX_EXEC)) return refused('no sandbox-exec, or HOME is not a full path');
  const temp = opts.userTemp !== undefined ? realOrNull(opts.userTemp) : darwinUserTemp();
  if (temp === null) return refused('no user temp folder');
  const privateDir = privateFolder(temp, opts.sessionId, opts.agentId);
  if (privateDir === null) return refused('its private folder is a link, not ours or not private');
  const base = { homes, privateDir, ...(opts.tmpdir === undefined ? {} : { tmpdir: opts.tmpdir }), ...(opts.ports === undefined ? {} : { ports: opts.ports }) };
  if (!run(['-p', reviewSandboxProfile({ ...base, repos: [] }), '/usr/bin/true'])) return refused('sandbox-exec failed its self-test');
  const env = sandboxEnv(opts.env, privateDir);
  return {
    kind: 'sandbox',
    wrap: (command, repos, hidden = []) => {
      const all = [...new Set(repos.flatMap((repo) => [repo, realOrNull(repo) ?? repo]))];
      // a repo or home inside the private folder, or the private folder inside a repo: it could be written
      if ([...all, ...homes].some((p) => inside(p, privateDir)) || all.some((repo) => inside(privateDir, repo))) return null;
      return wrapCommand(command, reviewSandboxProfile({ ...base, repos: all, hidden: [...new Set(hidden.flatMap((h) => [h, realOrNull(h) ?? h]))] }), env);
    },
  };
}
