/**
 * WebhookConfig
 *
 * Manages webhook configuration persistence in .oss/config.json.
 * Generates cryptographically secure secrets for GitHub webhook validation.
 *
 * @behavior Configuration is persisted to and loaded from .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.1: Secret is 64 hex chars (32 bytes)
 * @acceptance-criteria AC-WEBHOOK-CONFIG.2: Config saved to .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.3: Config loaded from .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.4: Merges with existing config
 */
/**
 * Webhook configuration data structure
 */
export interface WebhookConfigData {
    webhook: {
        enabled: boolean;
        port: number;
        secret: string;
    };
}
/**
 * Options for enabling webhook configuration
 */
export interface EnableOptions {
    port?: number;
}
/**
 * WebhookConfig - Manages webhook secret and configuration persistence
 */
export declare class WebhookConfig {
    private readonly ossDir;
    private readonly configPath;
    private cachedConfig;
    constructor(ossDir: string);
    /**
     * Generate a cryptographically secure webhook secret
     * Returns a 64-character hex string (32 bytes)
     */
    static generateSecret(): string;
    /**
     * Enable webhook configuration and save to .oss/config.json
     * Merges with existing config and preserves existing secret if present
     */
    enable(options: EnableOptions): Promise<void>;
    /**
     * Disable webhook configuration
     * Preserves secret and port for potential re-enable
     */
    disable(): Promise<void>;
    /**
     * Load webhook configuration from .oss/config.json
     * Returns defaults if file doesn't exist or is invalid
     */
    load(): Promise<WebhookConfigData>;
    /**
     * Check if webhook is fully configured (enabled with secret)
     */
    isConfigured(): boolean;
    /**
     * Get the webhook secret
     * Returns empty string if not configured
     */
    getSecret(): string;
    /**
     * Get the configured port
     * Returns default port if not configured
     */
    getPort(): number;
    /**
     * Ensure the .oss directory exists
     */
    private ensureDirectoryExists;
    /**
     * Write config to file
     */
    private writeConfig;
    /**
     * Read full config file, returning empty object if not exists/invalid
     */
    private readFullConfig;
    /**
     * Load webhook config from file into cache synchronously
     */
    private loadConfigSync;
}
//# sourceMappingURL=webhook-config.d.ts.map