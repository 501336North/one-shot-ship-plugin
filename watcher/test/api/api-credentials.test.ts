/**
 * readApiCredentials: the watcher's one reader of the OSS API key and the API it may go to.
 *
 * @behavior The watcher sends the OSS API key only to the API the OSS config names (STAGING or a
 *           loopback DEV API when apiUrl says so, production when apiUrl is missing), and only when
 *           the config file is one the user alone controls.
 * @business-rule One apiUrl rule for the whole plugin: the watcher must agree with oss_api_url
 *           (hooks/oss-api-curl.sh) and getApiUrl (packages/cli-decrypt) on every row of the shared
 *           case table, so no sender can route the key somewhere the others refuse.
 * @boundary A real config.json on disk under a temp OSS_CONFIG_DIR / HOME. Nothing is mocked except
 *           the process's user id, to stand in for a file owned by someone else.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readApiCredentials, DEFAULT_API_URL } from '../../src/api/api-credentials.js';

interface ApiUrlCase {
  apiUrl?: unknown;
  accept: boolean;
  why: string;
}

const CASES_PATH = path.resolve(
  __dirname,
  '../../../packages/cli-decrypt/test/fixtures/api-url-cases.json'
);
const CASES = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8')) as ApiUrlCase[];

interface TrustedApiUrlCase {
  apiUrl: string;
  trusted: boolean;
  canonical: string | null;
  why: string;
}

const TRUSTED_CASES_PATH = path.resolve(
  __dirname,
  '../../../packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json'
);
const TRUSTED_CASES = JSON.parse(fs.readFileSync(TRUSTED_CASES_PATH, 'utf8')) as TrustedApiUrlCase[];

const STAGING = 'https://one-shot-ship-api-staging.onrender.com';

const dirs: string[] = [];
let savedConfigDir: string | undefined;
let savedHome: string | undefined;

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-api-creds-'));
  dirs.push(dir);
  return dir;
}

/** Write config.json the way /oss:login does (0600) and return its directory. */
function writeConfig(config: Record<string, unknown>, dir: string = tempDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  return dir;
}

beforeEach(() => {
  savedConfigDir = process.env.OSS_CONFIG_DIR;
  savedHome = process.env.HOME;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedConfigDir === undefined) delete process.env.OSS_CONFIG_DIR;
  else process.env.OSS_CONFIG_DIR = savedConfigDir;
  process.env.HOME = savedHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('readApiCredentials: the apiUrl rule', () => {
  it('has a non-empty shared case table to agree with', () => {
    expect(CASES.length).toBeGreaterThan(10);
  });

  // The syntax table's refused rows stay refused. Its accepted rows are well-formed addresses, but
  // whether the key may go there is the trust table's decision (FR4), checked below.
  it.each(CASES.filter((row) => !row.accept).map((row) => [row.why, row] as const))(
    'should refuse every row api-url-cases.json refuses: %s',
    (_why, row) => {
      const config: Record<string, unknown> = { apiKey: 'test-key' };
      if ('apiUrl' in row) config.apiUrl = row.apiUrl;
      expect(readApiCredentials(writeConfig(config))).toBeNull();
    }
  );

  it.each(
    CASES.filter((row) => row.accept && (row.apiUrl === undefined || row.apiUrl === null || row.apiUrl === ''))
      .map((row) => [row.why, row] as const)
  )('should give the production API for a missing apiUrl: %s', (_why, row) => {
    const config: Record<string, unknown> = { apiKey: 'test-key' };
    if ('apiUrl' in row) config.apiUrl = row.apiUrl;
    expect(readApiCredentials(writeConfig(config))).toEqual({ apiKey: 'test-key', apiUrl: DEFAULT_API_URL });
  });

  it('should give the production API when apiUrl is missing', () => {
    expect(readApiCredentials(writeConfig({ apiKey: 'k' }))?.apiUrl).toBe(
      'https://one-shot-ship-api.onrender.com'
    );
  });
});

describe('readApiCredentials: the trusted-address rule (FR4, FR6)', () => {
  it('has a non-empty shared trust table with both trusted and untrusted rows', () => {
    expect(TRUSTED_CASES.some((row) => row.trusted)).toBe(true);
    expect(TRUSTED_CASES.some((row) => !row.trusted)).toBe(true);
  });

  it.each(TRUSTED_CASES.map((row) => [row.why, row] as const))(
    'should agree with every row of trusted-api-url-cases.json: %s',
    (_why, row) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const credentials = readApiCredentials(writeConfig({ apiKey: 'test-key', apiUrl: row.apiUrl }));

      if (row.trusted) {
        expect(credentials).toEqual({ apiKey: 'test-key', apiUrl: row.canonical });
      } else {
        expect(credentials).toBeNull();
      }
    }
  );

  it('should warn once, naming apiUrl but never the key, when the address is not trusted', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = writeConfig({ apiKey: 'secret-key-123', apiUrl: 'https://api.example.com' });

    expect(readApiCredentials(dir)).toBeNull();
    expect(readApiCredentials(dir)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('apiUrl');
    expect(message).not.toContain('secret-key-123');
  });
});

describe('readApiCredentials: which config file', () => {
  it('should read key and URL from $OSS_CONFIG_DIR/config.json when OSS_CONFIG_DIR is set', () => {
    const home = tempDir();
    process.env.HOME = home;
    writeConfig({ apiKey: 'home-key', apiUrl: 'http://localhost:4100' }, path.join(home, '.oss'));
    process.env.OSS_CONFIG_DIR = writeConfig({ apiKey: 'staging-key', apiUrl: STAGING });

    expect(readApiCredentials()).toEqual({ apiKey: 'staging-key', apiUrl: STAGING });
  });

  it('should read key and URL from ~/.oss/config.json when OSS_CONFIG_DIR is not set', () => {
    const home = tempDir();
    process.env.HOME = home;
    delete process.env.OSS_CONFIG_DIR;
    writeConfig({ apiKey: 'home-key', apiUrl: 'http://127.0.0.1:4100' }, path.join(home, '.oss'));

    expect(readApiCredentials()).toEqual({ apiKey: 'home-key', apiUrl: 'http://127.0.0.1:4100' });
  });
});

describe('readApiCredentials: a config file only the user controls (#47)', () => {
  it('should refuse a config.json that is a symlink', () => {
    const real = writeConfig({ apiKey: 'k', apiUrl: STAGING });
    const dir = tempDir();
    fs.symlinkSync(path.join(real, 'config.json'), path.join(dir, 'config.json'));

    expect(readApiCredentials(real)).not.toBeNull();
    expect(readApiCredentials(dir)).toBeNull();
  });

  it('should refuse a config.json not owned by the current user', () => {
    const dir = writeConfig({ apiKey: 'k' });
    expect(readApiCredentials(dir)).not.toBeNull();

    const myUid = fs.statSync(path.join(dir, 'config.json')).uid;
    vi.spyOn(process, 'getuid').mockReturnValue(myUid + 1);
    expect(readApiCredentials(dir)).toBeNull();
  });

  it.each([
    ['world-writable', 0o602],
    ['world-writable under umask 000', 0o666],
  ])('should refuse a config.json that is %s', (_label, mode) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = writeConfig({ apiKey: 'k' });
    expect(readApiCredentials(dir)).not.toBeNull();

    fs.chmodSync(path.join(dir, 'config.json'), mode);
    expect(readApiCredentials(dir)).toBeNull();
  });

  // FR7: the shell and the CLI allow group-writable; umask 002 (common on Ubuntu) writes 0664.
  it.each([
    ['group-writable', 0o620],
    ['0664 (umask 002)', 0o664],
  ])('should accept a config.json that is %s', (_label, mode) => {
    const dir = writeConfig({ apiKey: 'k' });
    fs.chmodSync(path.join(dir, 'config.json'), mode);

    expect(readApiCredentials(dir)).toEqual({ apiKey: 'k', apiUrl: DEFAULT_API_URL });
  });

  it.each([
    ['a symlink', (dir: string): string => {
      const link = tempDir();
      fs.symlinkSync(path.join(dir, 'config.json'), path.join(link, 'config.json'));
      return link;
    }],
    ['world-writable', (dir: string): string => {
      fs.chmodSync(path.join(dir, 'config.json'), 0o602);
      return dir;
    }],
    ['owned by another user', (dir: string): string => {
      const myUid = fs.statSync(path.join(dir, 'config.json')).uid;
      vi.spyOn(process, 'getuid').mockReturnValue(myUid + 1);
      return dir;
    }],
  ])('should warn once, naming the file but never the key, when config.json is %s', (_label, refuse) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = refuse(writeConfig({ apiKey: 'secret-key-456' }));

    expect(readApiCredentials(dir)).toBeNull();
    expect(readApiCredentials(dir)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(path.join(dir, 'config.json'));
    expect(message).not.toContain('secret-key-456');
  });

  it('should not warn when there is no config.json at all (not logged in)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(readApiCredentials(tempDir())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('readApiCredentials: the apiKey (#47)', () => {
  it.each([
    ['a number', 12345],
    ['an array', ['k']],
    ['an object', { key: 'k' }],
    ['true', true],
    ['empty', ''],
    ['a string with LF', 'key\nX-Evil: 1'],
    ['a string with CR', 'key\rX-Evil: 1'],
  ])('should refuse an apiKey that is %s', (_label, apiKey) => {
    expect(readApiCredentials(writeConfig({ apiKey }))).toBeNull();
  });

  it('should accept a plain string apiKey', () => {
    expect(readApiCredentials(writeConfig({ apiKey: 'ak_live_123' }))?.apiKey).toBe('ak_live_123');
  });
});

// SR2: a loopback apiUrl sends the key to whatever listens on this machine, so it is trusted only from
// a config only the user can write: neither config.json nor its directory has a group- or world-write
// bit. Production and staging keep the FR7 rule (group-writable file accepted, directory not checked).
describe('readApiCredentials: a loopback apiUrl needs a config only the user can write (SR2)', () => {
  const LOOPBACK = 'http://127.0.0.1:3001';

  it('should refuse a loopback apiUrl from a group-writable (0664) config.json, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = writeConfig({ apiKey: 'secret-key-789', apiUrl: LOOPBACK });
    fs.chmodSync(dir, 0o700);
    fs.chmodSync(path.join(dir, 'config.json'), 0o664);

    expect(readApiCredentials(dir)).toBeNull();
    expect(readApiCredentials(dir)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('secret-key-789');
  });

  it('should refuse a loopback apiUrl from a 0600 config.json in a group-writable (0775) directory', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dir = writeConfig({ apiKey: 'k', apiUrl: LOOPBACK });
    fs.chmodSync(path.join(dir, 'config.json'), 0o600);
    fs.chmodSync(dir, 0o775);

    expect(readApiCredentials(dir)).toBeNull();
  });

  it('should trust a loopback apiUrl from a 0600 config.json in a 0700 directory', () => {
    const dir = writeConfig({ apiKey: 'k', apiUrl: LOOPBACK });
    fs.chmodSync(path.join(dir, 'config.json'), 0o600);
    fs.chmodSync(dir, 0o700);

    expect(readApiCredentials(dir)).toEqual({ apiKey: 'k', apiUrl: LOOPBACK });
  });

  // The channel layout (scripts/oss-channel.sh): ~/.oss is a symlink to ~/.oss-stable, ~/.oss-beta or
  // ~/.oss-dev. The directory rule is about the directory the symlink resolves to; a symlinked
  // config.json FILE stays refused (O_NOFOLLOW, above).
  it.each([
    ['0700', 0o700, true],
    ['0775', 0o775, false],
  ])('should judge a loopback apiUrl by the directory ~/.oss resolves to (~/.oss -> ~/.oss-beta, %s)', (_label, mode, trusted) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const home = tempDir();
    const beta = writeConfig({ apiKey: 'k', apiUrl: LOOPBACK }, path.join(home, '.oss-beta'));
    fs.chmodSync(path.join(beta, 'config.json'), 0o600);
    fs.chmodSync(beta, mode);
    fs.symlinkSync(beta, path.join(home, '.oss'));

    expect(readApiCredentials(path.join(home, '.oss'))).toEqual(
      trusted ? { apiKey: 'k', apiUrl: LOOPBACK } : null
    );
  });

  it('should still trust production from a group-writable (0664) config.json in a 0775 directory', () => {
    const dir = writeConfig({ apiKey: 'k', apiUrl: DEFAULT_API_URL });
    fs.chmodSync(path.join(dir, 'config.json'), 0o664);
    fs.chmodSync(dir, 0o775);

    expect(readApiCredentials(dir)).toEqual({ apiKey: 'k', apiUrl: DEFAULT_API_URL });
  });
});
