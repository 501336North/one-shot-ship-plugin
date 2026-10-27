/**
 * The one place the CLI decides where its config lives and which API it talks to.
 */

import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from 'fs';
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
 * file -> refused; group-writable (umask 002) is allowed. Unparseable JSON reads as {}. The file is opened once
 * (O_NOFOLLOW) and both checked (fstat) and read through that one descriptor, so it cannot be swapped in between.
 */
export function readConfigFile(): Record<string, unknown> {
  return readConfig().values;
}

interface ConfigRead {
  values: Record<string, unknown>;
  /** config.json and its directory carry no group- or world-write bit (mode & 0o022 == 0). */
  writableOnlyByOwner: boolean;
}

function readConfig(): ConfigRead {
  const configPath = join(getConfigDir(), 'config.json');
  let fd: number;
  try {
    fd = openSync(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { values: {}, writableOnlyByOwner: false };
    throw new Error(UNTRUSTED_CONFIG);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o002) !== 0) {
      throw new Error(UNTRUSTED_CONFIG);
    }
    const writableOnlyByOwner =
      (stat.mode & 0o022) === 0 && (statSync(getConfigDir()).mode & 0o022) === 0;
    try {
      return { values: JSON.parse(readFileSync(fd, 'utf8')) as Record<string, unknown>, writableOnlyByOwner };
    } catch {
      return { values: {}, writableOnlyByOwner };
    }
  } finally {
    closeSync(fd);
  }
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
  return getApiUrlSetting().apiUrl;
}

/** getApiUrl, plus whether config.json and its directory are writable by the owner alone (see ConfigRead). */
export function getApiUrlSetting(): { apiUrl: string; configWritableOnlyByOwner: boolean } {
  const { values, writableOnlyByOwner } = readConfig();
  const apiUrl = values.apiUrl;
  if (apiUrl === undefined || apiUrl === null || apiUrl === '') {
    return { apiUrl: DEFAULT_API_URL, configWritableOnlyByOwner: writableOnlyByOwner };
  }
  if (typeof apiUrl !== 'string' || !isAcceptedApiUrl(apiUrl)) {
    throw new Error(REFUSAL);
  }
  return { apiUrl, configWritableOnlyByOwner: writableOnlyByOwner };
}

/** The one apiUrl rule as a predicate: the https or loopback-http shape, and parses as a URL. */
export function isAcceptedApiUrl(apiUrl: string): boolean {
  return (HTTPS_URL.test(apiUrl) || LOOPBACK_HTTP_URL.test(apiUrl)) && parses(apiUrl);
}
