/**
 * The one place the CLI decides where its config lives and which API it talks to.
 */

import { existsSync, readFileSync } from 'fs';
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

function readConfiguredApiUrl(): unknown {
  const configPath = join(getConfigDir(), 'config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as { apiUrl?: unknown };
      return config.apiUrl;
    } catch {
      // Fall through to default
    }
  }
  return undefined;
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
