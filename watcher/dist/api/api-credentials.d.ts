/**
 * The one reader of the OSS API credentials (config.json apiKey + apiUrl).
 *
 * Every watcher sender of the OSS API key reads through here, so the config file whose apiUrl is
 * validated is the same file whose apiKey is sent (T2), and production is used only when apiUrl
 * is missing, null or empty.
 */
export interface ApiCredentials {
    apiKey: string;
    apiUrl: string;
}
export declare const DEFAULT_API_URL = "https://one-shot-ship-api.onrender.com";
/** OSS_CONFIG_DIR when set, else ~/.oss */
export declare function getConfigDir(): string;
/**
 * Read API credentials from config.json.
 *
 * @param configDir - The config directory (defaults to getConfigDir())
 * @returns Credentials, or null if not configured, the file is not the user's alone, the apiKey is
 *          not a CR/LF-free string, or apiUrl fails the shared rule
 */
export declare function readApiCredentials(configDir?: string): ApiCredentials | null;
//# sourceMappingURL=api-credentials.d.ts.map