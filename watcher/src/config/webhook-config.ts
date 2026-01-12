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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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
 * Default webhook configuration values
 */
const DEFAULT_WEBHOOK_CONFIG: WebhookConfigData['webhook'] = {
  enabled: false,
  port: 3456,
  secret: '',
};

/**
 * WebhookConfig - Manages webhook secret and configuration persistence
 */
export class WebhookConfig {
  private readonly ossDir: string;
  private readonly configPath: string;
  private cachedConfig: WebhookConfigData['webhook'] | null = null;

  constructor(ossDir: string) {
    this.ossDir = ossDir;
    this.configPath = path.join(ossDir, 'config.json');
    // Load initial config into cache
    this.loadConfigSync();
  }

  /**
   * Generate a cryptographically secure webhook secret
   * Returns a 64-character hex string (32 bytes)
   */
  static generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Enable webhook configuration and save to .oss/config.json
   * Merges with existing config and preserves existing secret if present
   */
  async enable(options: EnableOptions): Promise<void> {
    const port = options.port ?? DEFAULT_WEBHOOK_CONFIG.port;

    // Read existing config
    const existingConfig = this.readFullConfig();
    const existingWebhook = existingConfig.webhook as WebhookConfigData['webhook'] | undefined;

    // Determine secret - preserve existing or generate new
    let secret = existingWebhook?.secret || '';
    if (!secret) {
      secret = WebhookConfig.generateSecret();
    }

    // Create webhook config
    const webhookConfig = {
      enabled: true,
      port,
      secret,
    };

    // Merge with existing config
    const newConfig = {
      ...existingConfig,
      webhook: webhookConfig,
    };

    // Write config
    this.writeConfig(newConfig);

    // Update cache
    this.cachedConfig = webhookConfig;
  }

  /**
   * Disable webhook configuration
   * Preserves secret and port for potential re-enable
   */
  async disable(): Promise<void> {
    const existingConfig = this.readFullConfig();
    const existingWebhook = existingConfig.webhook as WebhookConfigData['webhook'] | undefined;

    if (!existingWebhook) {
      // Nothing to disable
      return;
    }

    // Set enabled to false but preserve other settings
    const webhookConfig: WebhookConfigData['webhook'] = {
      enabled: false,
      port: existingWebhook.port,
      secret: existingWebhook.secret,
    };

    const newConfig = {
      ...existingConfig,
      webhook: webhookConfig,
    };

    // Write config
    this.writeConfig(newConfig);

    // Update cache
    this.cachedConfig = webhookConfig;
  }

  /**
   * Load webhook configuration from .oss/config.json
   * Returns defaults if file doesn't exist or is invalid
   */
  async load(): Promise<WebhookConfigData> {
    this.loadConfigSync();
    return {
      webhook: this.cachedConfig || { ...DEFAULT_WEBHOOK_CONFIG },
    };
  }

  /**
   * Check if webhook is fully configured (enabled with secret)
   */
  isConfigured(): boolean {
    const config = this.cachedConfig;
    return config !== null && config.enabled && config.secret.length > 0;
  }

  /**
   * Get the webhook secret
   * Returns empty string if not configured
   */
  getSecret(): string {
    return this.cachedConfig?.secret || '';
  }

  /**
   * Get the configured port
   * Returns default port if not configured
   */
  getPort(): number {
    return this.cachedConfig?.port || DEFAULT_WEBHOOK_CONFIG.port;
  }

  /**
   * Ensure the .oss directory exists
   */
  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.ossDir)) {
      fs.mkdirSync(this.ossDir, { recursive: true });
    }
  }

  /**
   * Write config to file
   */
  private writeConfig(config: Record<string, unknown>): void {
    this.ensureDirectoryExists();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Read full config file, returning empty object if not exists/invalid
   */
  private readFullConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // Invalid JSON or read error - return empty
    }
    return {};
  }

  /**
   * Load webhook config from file into cache synchronously
   */
  private loadConfigSync(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);

        if (config.webhook && typeof config.webhook === 'object') {
          this.cachedConfig = {
            enabled: config.webhook.enabled ?? DEFAULT_WEBHOOK_CONFIG.enabled,
            port: config.webhook.port ?? DEFAULT_WEBHOOK_CONFIG.port,
            secret: config.webhook.secret ?? DEFAULT_WEBHOOK_CONFIG.secret,
          };
          return;
        }
      }
    } catch {
      // Invalid JSON or read error - use defaults
    }

    this.cachedConfig = null;
  }
}
