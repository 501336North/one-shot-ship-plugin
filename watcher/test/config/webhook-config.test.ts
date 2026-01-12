/**
 * WebhookConfig Tests
 *
 * @behavior Webhook configuration is generated, persisted, and loaded from .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.1: Secret generation is cryptographically secure
 * @acceptance-criteria AC-WEBHOOK-CONFIG.2: Config is persisted to .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.3: Config is loaded from .oss/config.json
 * @acceptance-criteria AC-WEBHOOK-CONFIG.4: Config merges with existing .oss/config.json
 * @business-rule Webhook secret must be 64 hex characters (32 bytes)
 * @boundary Filesystem / Configuration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebhookConfig, WebhookConfigData } from '../../src/config/webhook-config.js';

describe('WebhookConfig', () => {
  // Track directories for cleanup
  const dirsToClean: string[] = [];

  function createTestDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `webhook-config-test-${Date.now()}-`));
    dirsToClean.push(dir);
    return dir;
  }

  afterEach(() => {
    // Clean up all test directories
    for (const dir of dirsToClean) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    dirsToClean.length = 0;
  });

  describe('Secret Generation', () => {
    /**
     * @behavior generateSecret returns a 64-character hex string (32 bytes)
     * @acceptance-criteria AC-WEBHOOK-CONFIG.1
     */
    it('should generate a 64-character hex string', () => {
      // WHEN - We generate a secret
      const secret = WebhookConfig.generateSecret();

      // THEN - It should be 64 characters (32 bytes in hex)
      expect(secret).toHaveLength(64);
    });

    /**
     * @behavior generateSecret returns only valid hex characters
     * @acceptance-criteria AC-WEBHOOK-CONFIG.1
     */
    it('should generate valid hex characters only', () => {
      // WHEN - We generate a secret
      const secret = WebhookConfig.generateSecret();

      // THEN - It should contain only valid hex characters
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    /**
     * @behavior generateSecret produces unique values each time
     * @acceptance-criteria AC-WEBHOOK-CONFIG.1
     */
    it('should generate unique secrets on each call', () => {
      // WHEN - We generate multiple secrets
      const secret1 = WebhookConfig.generateSecret();
      const secret2 = WebhookConfig.generateSecret();
      const secret3 = WebhookConfig.generateSecret();

      // THEN - All secrets should be different
      expect(secret1).not.toBe(secret2);
      expect(secret2).not.toBe(secret3);
      expect(secret1).not.toBe(secret3);
    });

    /**
     * @behavior generateSecret uses cryptographically secure randomness
     * @acceptance-criteria AC-WEBHOOK-CONFIG.1
     */
    it('should produce cryptographically random output', () => {
      // WHEN - We generate 10 secrets
      const secrets = Array.from({ length: 10 }, () => WebhookConfig.generateSecret());

      // THEN - Each should be unique (probability of collision is astronomically low)
      const uniqueSecrets = new Set(secrets);
      expect(uniqueSecrets.size).toBe(10);
    });
  });

  describe('Enable (Configuration Persistence)', () => {
    /**
     * @behavior enable() saves webhook config to .oss/config.json
     * @acceptance-criteria AC-WEBHOOK-CONFIG.2
     */
    it('should create config.json with webhook settings', async () => {
      // GIVEN - A fresh .oss directory
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We enable webhook
      await webhookConfig.enable({ port: 3456 });

      // THEN - config.json should exist with webhook settings
      expect(fs.existsSync(configPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.webhook).toBeDefined();
      expect(content.webhook.enabled).toBe(true);
      expect(content.webhook.port).toBe(3456);
      expect(content.webhook.secret).toHaveLength(64);
    });

    /**
     * @behavior enable() uses default port 3456 when not specified
     * @acceptance-criteria AC-WEBHOOK-CONFIG.2
     */
    it('should use default port 3456 when not specified', async () => {
      // GIVEN - A fresh .oss directory
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We enable webhook without specifying port
      await webhookConfig.enable({});

      // THEN - config.json should have default port
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.webhook.port).toBe(3456);
    });

    /**
     * @behavior enable() merges with existing config.json
     * @acceptance-criteria AC-WEBHOOK-CONFIG.4
     */
    it('should merge webhook config with existing settings', async () => {
      // GIVEN - An existing config.json with other settings
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const existingConfig = {
        apiKey: 'existing-api-key',
        someOtherSetting: true,
      };
      fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We enable webhook
      await webhookConfig.enable({ port: 8080 });

      // THEN - Both existing and new settings should be preserved
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(content.apiKey).toBe('existing-api-key');
      expect(content.someOtherSetting).toBe(true);
      expect(content.webhook.enabled).toBe(true);
      expect(content.webhook.port).toBe(8080);
    });

    /**
     * @behavior enable() creates .oss directory if it doesn't exist
     * @acceptance-criteria AC-WEBHOOK-CONFIG.2
     */
    it('should create parent directory if it does not exist', async () => {
      // GIVEN - A path to a non-existent directory
      const testDir = createTestDir();
      const ossDir = path.join(testDir, 'new-oss-dir');
      const webhookConfig = new WebhookConfig(ossDir);

      // WHEN - We enable webhook
      await webhookConfig.enable({});

      // THEN - The directory and config should be created
      expect(fs.existsSync(ossDir)).toBe(true);
      expect(fs.existsSync(path.join(ossDir, 'config.json'))).toBe(true);
    });

    /**
     * @behavior enable() does not regenerate secret if already configured
     * @acceptance-criteria AC-WEBHOOK-CONFIG.4
     */
    it('should preserve existing secret when re-enabling', async () => {
      // GIVEN - Webhook already configured
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);
      await webhookConfig.enable({ port: 3456 });

      const firstLoad = await webhookConfig.load();
      const originalSecret = firstLoad.webhook.secret;

      // WHEN - We enable again
      await webhookConfig.enable({ port: 4567 });

      // THEN - Secret should be preserved, only port updated
      const secondLoad = await webhookConfig.load();
      expect(secondLoad.webhook.secret).toBe(originalSecret);
      expect(secondLoad.webhook.port).toBe(4567);
    });
  });

  describe('Load Configuration', () => {
    /**
     * @behavior load() returns stored webhook configuration
     * @acceptance-criteria AC-WEBHOOK-CONFIG.3
     */
    it('should load webhook configuration from config.json', async () => {
      // GIVEN - A config.json with webhook settings
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const configData: WebhookConfigData = {
        webhook: {
          enabled: true,
          port: 9999,
          secret: 'a'.repeat(64), // Valid 64-char hex
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We load the config
      const loaded = await webhookConfig.load();

      // THEN - Should return the stored values
      expect(loaded.webhook.enabled).toBe(true);
      expect(loaded.webhook.port).toBe(9999);
      expect(loaded.webhook.secret).toBe('a'.repeat(64));
    });

    /**
     * @behavior load() returns defaults when config.json doesn't exist
     * @acceptance-criteria AC-WEBHOOK-CONFIG.3
     */
    it('should return defaults when config.json does not exist', async () => {
      // GIVEN - No config.json exists
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We load the config
      const loaded = await webhookConfig.load();

      // THEN - Should return disabled webhook config with defaults
      expect(loaded.webhook.enabled).toBe(false);
      expect(loaded.webhook.port).toBe(3456);
      expect(loaded.webhook.secret).toBe('');
    });

    /**
     * @behavior load() returns defaults when webhook section is missing
     * @acceptance-criteria AC-WEBHOOK-CONFIG.3
     */
    it('should return defaults when webhook section is missing', async () => {
      // GIVEN - A config.json without webhook section
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ apiKey: 'test' }));

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We load the config
      const loaded = await webhookConfig.load();

      // THEN - Should return disabled webhook config
      expect(loaded.webhook.enabled).toBe(false);
    });

    /**
     * @behavior load() handles malformed JSON gracefully
     * @acceptance-criteria AC-WEBHOOK-CONFIG.3
     */
    it('should return defaults when config.json contains invalid JSON', async () => {
      // GIVEN - A malformed config.json
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We load the config
      const loaded = await webhookConfig.load();

      // THEN - Should return defaults
      expect(loaded.webhook.enabled).toBe(false);
    });
  });

  describe('isConfigured', () => {
    /**
     * @behavior isConfigured() returns true when webhook is enabled with secret
     */
    it('should return true when webhook is fully configured', async () => {
      // GIVEN - Webhook is enabled
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);
      await webhookConfig.enable({});

      // WHEN - We check if configured
      const configured = webhookConfig.isConfigured();

      // THEN - Should return true
      expect(configured).toBe(true);
    });

    /**
     * @behavior isConfigured() returns false when not enabled
     */
    it('should return false when webhook is not configured', () => {
      // GIVEN - Fresh instance with no config
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We check if configured
      const configured = webhookConfig.isConfigured();

      // THEN - Should return false
      expect(configured).toBe(false);
    });

    /**
     * @behavior isConfigured() returns false when config exists but disabled
     */
    it('should return false when webhook exists but is disabled', async () => {
      // GIVEN - Config with disabled webhook
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const configData = {
        webhook: {
          enabled: false,
          port: 3456,
          secret: 'a'.repeat(64),
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData));

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We check if configured
      const configured = webhookConfig.isConfigured();

      // THEN - Should return false
      expect(configured).toBe(false);
    });

    /**
     * @behavior isConfigured() returns false when secret is missing
     */
    it('should return false when secret is missing', async () => {
      // GIVEN - Config with enabled but no secret
      const testDir = createTestDir();
      const configPath = path.join(testDir, 'config.json');
      const configData = {
        webhook: {
          enabled: true,
          port: 3456,
          secret: '',
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(configData));

      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We check if configured
      const configured = webhookConfig.isConfigured();

      // THEN - Should return false
      expect(configured).toBe(false);
    });
  });

  describe('getSecret', () => {
    /**
     * @behavior getSecret() returns the configured secret
     */
    it('should return the webhook secret', async () => {
      // GIVEN - Webhook is configured
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);
      await webhookConfig.enable({});

      // WHEN - We get the secret
      const secret = webhookConfig.getSecret();

      // THEN - Should return a valid secret
      expect(secret).toHaveLength(64);
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    /**
     * @behavior getSecret() returns empty string when not configured
     */
    it('should return empty string when not configured', () => {
      // GIVEN - No webhook configured
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We get the secret
      const secret = webhookConfig.getSecret();

      // THEN - Should return empty string
      expect(secret).toBe('');
    });
  });

  describe('getPort', () => {
    /**
     * @behavior getPort() returns the configured port
     */
    it('should return the configured port', async () => {
      // GIVEN - Webhook is configured with custom port
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);
      await webhookConfig.enable({ port: 8080 });

      // WHEN - We get the port
      const port = webhookConfig.getPort();

      // THEN - Should return the configured port
      expect(port).toBe(8080);
    });

    /**
     * @behavior getPort() returns default port when not configured
     */
    it('should return default port when not configured', () => {
      // GIVEN - No webhook configured
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We get the port
      const port = webhookConfig.getPort();

      // THEN - Should return default port
      expect(port).toBe(3456);
    });
  });

  describe('disable', () => {
    /**
     * @behavior disable() sets enabled to false but preserves other settings
     */
    it('should disable webhook while preserving secret and port', async () => {
      // GIVEN - Webhook is enabled
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);
      await webhookConfig.enable({ port: 8080 });

      const originalSecret = webhookConfig.getSecret();

      // WHEN - We disable webhook
      await webhookConfig.disable();

      // THEN - Should be disabled but preserve other settings
      const loaded = await webhookConfig.load();
      expect(loaded.webhook.enabled).toBe(false);
      expect(loaded.webhook.port).toBe(8080);
      expect(loaded.webhook.secret).toBe(originalSecret);
    });

    /**
     * @behavior disable() is idempotent
     */
    it('should handle disabling when already disabled', async () => {
      // GIVEN - Webhook is not configured
      const testDir = createTestDir();
      const webhookConfig = new WebhookConfig(testDir);

      // WHEN - We disable (no-op)
      await webhookConfig.disable();

      // THEN - Should remain disabled without error
      expect(webhookConfig.isConfigured()).toBe(false);
    });
  });
});
