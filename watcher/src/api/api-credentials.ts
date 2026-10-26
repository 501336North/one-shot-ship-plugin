/**
 * The one reader of the OSS API credentials (config.json apiKey + apiUrl).
 *
 * Every watcher sender of the OSS API key reads through here, so the config file whose apiUrl is
 * validated is the same file whose apiKey is sent (T2), and production is used only when apiUrl
 * is missing, null or empty.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ApiCredentials {
  apiKey: string;
  apiUrl: string;
}

export const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

// The one apiUrl rule, written identically in hooks/oss-api-curl.sh (oss_api_url) and
// packages/cli-decrypt/src/config.ts (getApiUrl). The case table all three are tested against:
// packages/cli-decrypt/test/fixtures/api-url-cases.json.
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
const LOOPBACK_HTTP_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;

/** OSS_CONFIG_DIR when set, else ~/.oss */
export function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), '.oss');
}

function parses(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** apiUrl per the rule: missing/null/empty is the default; else a matching string, or null (refused) */
function resolveApiUrl(apiUrl: unknown): string | null {
  if (apiUrl === undefined || apiUrl === null || apiUrl === '') return DEFAULT_API_URL;
  if (typeof apiUrl !== 'string') return null;
  if (!(HTTPS_URL.test(apiUrl) || LOOPBACK_HTTP_URL.test(apiUrl)) || !parses(apiUrl)) return null;
  return apiUrl;
}

/** config.json content, only when it is a regular file (not a symlink) owned by us and not group/world-writable */
function readOwnConfigFile(configPath: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(configPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const stat = fs.fstatSync(fd);
    const uid = process.getuid?.();
    if (!stat.isFile() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o022) !== 0) {
      return null;
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read API credentials from config.json.
 *
 * @param configDir - The config directory (defaults to getConfigDir())
 * @returns Credentials, or null if not configured, the file is not the user's alone, the apiKey is
 *          not a CR/LF-free string, or apiUrl fails the shared rule
 */
export function readApiCredentials(configDir?: string): ApiCredentials | null {
  const content = readOwnConfigFile(path.join(configDir || getConfigDir(), 'config.json'));
  if (content === null) return null;

  try {
    const config = JSON.parse(content) as { apiKey?: unknown; apiUrl?: unknown };
    const { apiKey } = config;
    if (typeof apiKey !== 'string' || apiKey === '' || /[\r\n]/.test(apiKey)) {
      return null;
    }

    const apiUrl = resolveApiUrl(config.apiUrl);
    if (apiUrl === null) return null;

    return { apiKey, apiUrl };
  } catch {
    return null;
  }
}
