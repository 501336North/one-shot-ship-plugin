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

  it.each(CASES.map((row) => [row.why, row] as const))(
    'should agree with oss_api_url on every row of api-url-cases.json: %s',
    (_why, row) => {
      const config: Record<string, unknown> = { apiKey: 'test-key' };
      if ('apiUrl' in row) config.apiUrl = row.apiUrl;
      const credentials = readApiCredentials(writeConfig(config));

      if (!row.accept) {
        expect(credentials).toBeNull();
        return;
      }
      const isDefault = row.apiUrl === undefined || row.apiUrl === null || row.apiUrl === '';
      expect(credentials).toEqual({
        apiKey: 'test-key',
        apiUrl: isDefault ? DEFAULT_API_URL : row.apiUrl,
      });
    }
  );

  it('should give the production API when apiUrl is missing', () => {
    expect(readApiCredentials(writeConfig({ apiKey: 'k' }))?.apiUrl).toBe(
      'https://one-shot-ship-api.onrender.com'
    );
  });
});

describe('readApiCredentials: which config file', () => {
  it('should read key and URL from $OSS_CONFIG_DIR/config.json when OSS_CONFIG_DIR is set', () => {
    const home = tempDir();
    process.env.HOME = home;
    writeConfig({ apiKey: 'home-key', apiUrl: 'https://home.example.com' }, path.join(home, '.oss'));
    process.env.OSS_CONFIG_DIR = writeConfig({ apiKey: 'staging-key', apiUrl: 'https://staging.example.com' });

    expect(readApiCredentials()).toEqual({ apiKey: 'staging-key', apiUrl: 'https://staging.example.com' });
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
    const real = writeConfig({ apiKey: 'k', apiUrl: 'https://api.example.com' });
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
    ['group-writable', 0o620],
    ['world-writable', 0o602],
  ])('should refuse a config.json that is %s', (_label, mode) => {
    const dir = writeConfig({ apiKey: 'k' });
    expect(readApiCredentials(dir)).not.toBeNull();

    fs.chmodSync(path.join(dir, 'config.json'), mode);
    expect(readApiCredentials(dir)).toBeNull();
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
