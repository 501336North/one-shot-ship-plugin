/**
 * The one reader of the OSS API credentials (config.json apiKey + apiUrl).
 *
 * chain-trigger and workflow-config both read through here, so the config file
 * whose apiUrl is validated is the same file whose apiKey is sent (T2).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ApiCredentials {
  apiKey: string;
  apiUrl: string;
}

const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

/** OSS_CONFIG_DIR when set, else ~/.oss */
export function getConfigDir(): string {
  return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), '.oss');
}

/**
 * Read API credentials from config.json.
 *
 * @param configDir - The config directory (defaults to getConfigDir())
 * @returns Credentials, or null if not configured or apiUrl is not https
 */
export function readApiCredentials(configDir?: string): ApiCredentials | null {
  const configPath = path.join(configDir || getConfigDir(), 'config.json');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as { apiKey?: string; apiUrl?: string };

    if (!config.apiKey) {
      return null;
    }

    // M-2: Validate API URL protocol - reject non-HTTPS to prevent MitM
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== 'https:') {
        return null;
      }
    } catch {
      return null;
    }

    return {
      apiKey: config.apiKey,
      apiUrl,
    };
  } catch {
    return null;
  }
}
