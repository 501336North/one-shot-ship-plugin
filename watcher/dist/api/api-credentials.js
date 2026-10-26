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
export const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';
export const STAGING_API_URL = 'https://one-shot-ship-api-staging.onrender.com';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
// The one apiUrl rule, written identically in hooks/oss-api-curl.sh (oss_api_url) and
// packages/cli-decrypt/src/config.ts (getApiUrl). The case table all three are tested against:
// packages/cli-decrypt/test/fixtures/api-url-cases.json.
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
const LOOPBACK_HTTP_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
/** OSS_CONFIG_DIR when set, else ~/.oss */
export function getConfigDir() {
    return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), '.oss');
}
/**
 * The trust rule (FR4), shared with oss_api_url and the CLI through
 * packages/cli-decrypt/test/fixtures/trusted-api-url-cases.json: a well-formed address whose origin is
 * production, staging or loopback http, with no path. Returns the canonical origin, or null.
 */
function trustedOrigin(apiUrl) {
    if (!(HTTPS_URL.test(apiUrl) || LOOPBACK_HTTP_URL.test(apiUrl)))
        return null;
    let url;
    try {
        url = new URL(apiUrl);
    }
    catch {
        return null;
    }
    if (url.pathname !== '/')
        return null;
    const trusted = url.origin === DEFAULT_API_URL ||
        url.origin === STAGING_API_URL ||
        (url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname));
    return trusted ? url.origin : null;
}
const warned = new Set();
/** One warning per message per process, so a polling caller does not flood the log */
function warnOnce(message) {
    if (warned.has(message))
        return;
    warned.add(message);
    console.warn(message);
}
/** apiUrl per the rule: missing/null/empty is the default; else the trusted canonical origin, or null (refused) */
function resolveApiUrl(apiUrl, configPath) {
    if (apiUrl === undefined || apiUrl === null || apiUrl === '')
        return DEFAULT_API_URL;
    const origin = typeof apiUrl === 'string' ? trustedOrigin(apiUrl) : null;
    if (origin === null) {
        warnOnce(`[oss-watcher] apiUrl in ${configPath} is not a trusted OSS API address; the API key will not be sent. ` +
            `Accepted: ${DEFAULT_API_URL} (production), ${STAGING_API_URL} (staging), ` +
            `or http://localhost, http://127.0.0.1 or http://[::1] with any port (local development).`);
    }
    return origin;
}
const UNSAFE_CONFIG = 'is refused: it must be a regular file (not a symlink) owned by you and not world-writable ' +
    '(chmod 600 it); the OSS API key will not be used';
/**
 * config.json content, only when it is a regular file (not a symlink) owned by us and not
 * world-writable. Group-writable is allowed (umask 002), the same rule as the shell and the CLI (FR7).
 * A missing file is silent (not logged in); a refused one warns once.
 */
function readOwnConfigFile(configPath) {
    let fd;
    try {
        fd = fs.openSync(configPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            warnOnce(`[oss-watcher] ${configPath} ${UNSAFE_CONFIG}.`);
        }
        return null;
    }
    try {
        const stat = fs.fstatSync(fd);
        const uid = process.getuid?.();
        if (!stat.isFile() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o002) !== 0) {
            warnOnce(`[oss-watcher] ${configPath} ${UNSAFE_CONFIG}.`);
            return null;
        }
        return fs.readFileSync(fd, 'utf8');
    }
    finally {
        fs.closeSync(fd);
    }
}
/**
 * Read API credentials from config.json.
 *
 * @param configDir - The config directory (defaults to getConfigDir())
 * @returns Credentials, or null if not configured, the file is not the user's alone, the apiKey is
 *          not a CR/LF-free string, or apiUrl is not a trusted OSS API address (one warning)
 */
export function readApiCredentials(configDir) {
    const configPath = path.join(configDir || getConfigDir(), 'config.json');
    const content = readOwnConfigFile(configPath);
    if (content === null)
        return null;
    try {
        const config = JSON.parse(content);
        const { apiKey } = config;
        if (typeof apiKey !== 'string' || apiKey === '' || /[\r\n]/.test(apiKey)) {
            return null;
        }
        const apiUrl = resolveApiUrl(config.apiUrl, configPath);
        if (apiUrl === null)
            return null;
        return { apiKey, apiUrl };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=api-credentials.js.map