/**
 * The one place the CLI decides where its config lives and which API it talks to.
 */

import { lstatSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

// The one apiUrl rule, written identically in hooks/oss-api-curl.sh (oss_api_url). The case table both
// are tested against: test/fixtures/api-url-cases.json.
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
const LOOPBACK_HTTP_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
const REFUSAL =
  'apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment.';

/**
 * Config directory: $OSS_CONFIG_DIR, else ~/.oss
 */
export function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || join(homedir(), '.oss');
}

const UNTRUSTED_CONFIG =
  'Refusing to read config.json in your OSS config directory: it must be a regular file (not a symlink) ' +
  'owned by you and not writable by other users. Fix it with: chmod 600 config.json';

/**
 * The one config.json reader (FR7): missing -> {}; a symlink, a file owned by another user or a world-writable
 * file -> refused; group-writable (umask 002) is allowed. Unparseable JSON reads as {}.
 */
export function readConfigFile(): Record<string, unknown> {
  const configPath = join(getConfigDir(), 'config.json');
  let stat;
  try {
    stat = lstatSync(configPath);
  } catch {
    return {};
  }
  if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o002) !== 0) {
    throw new Error(UNTRUSTED_CONFIG);
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readConfiguredApiUrl(): unknown {
  return readConfigFile().apiUrl;
}

function parses(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * API base URL from config (missing, null or empty: the default), returned unchanged only when it is a
 * string matching the https or loopback-http rule and parses as a URL. One message for every refusal,
 * never echoing the value.
 */
export function getApiUrl(): string {
  const apiUrl = readConfiguredApiUrl();
  if (apiUrl === undefined || apiUrl === null || apiUrl === '') return DEFAULT_API_URL;
  if (typeof apiUrl !== 'string' || !isAcceptedApiUrl(apiUrl)) {
    throw new Error(REFUSAL);
  }
  return apiUrl;
}

/** The one apiUrl rule as a predicate: the https or loopback-http shape, and parses as a URL. */
export function isAcceptedApiUrl(apiUrl: string): boolean {
  return (HTTPS_URL.test(apiUrl) || LOOPBACK_HTTP_URL.test(apiUrl)) && parses(apiUrl);
}
