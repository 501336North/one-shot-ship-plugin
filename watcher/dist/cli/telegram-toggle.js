#!/usr/bin/env node
/**
 * Telegram Toggle CLI
 *
 * Enables or disables Telegram notifications.
 *
 * @behavior Telegram toggle CLI enables/disables Telegram notifications
 * @acceptance-criteria AC-TELEGRAM-TOGGLE.1 through AC-TELEGRAM-TOGGLE.5
 *
 * Usage:
 *   node telegram-toggle.js on   # Enable notifications
 *   node telegram-toggle.js off  # Disable notifications
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error (not configured when enabling)
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/**
 * Check if Telegram is configured (has both botToken and chatId)
 */
function isConfigured(telegram) {
    return Boolean(telegram?.botToken && telegram?.chatId);
}
/**
 * Load settings from settings.json
 */
function loadSettings(settingsPath) {
    try {
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            return JSON.parse(content);
        }
    }
    catch {
        // Return empty settings on any error
    }
    return {};
}
/**
 * Save settings to settings.json
 */
function saveSettings(configDir, settingsPath, settings) {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
/**
 * Toggle Telegram notifications on or off
 */
export async function toggleTelegram(action) {
    const configDir = path.join(os.homedir(), '.oss');
    const settingsPath = path.join(configDir, 'settings.json');
    const settings = loadSettings(settingsPath);
    if (action === 'on') {
        // Check if Telegram is configured
        if (!isConfigured(settings.telegram)) {
            return {
                success: false,
                message: 'Error: Telegram not configured.\n\nRun /oss:telegram setup first.',
            };
        }
        // Enable Telegram notifications
        settings.telegram.enabled = true;
        saveSettings(configDir, settingsPath, settings);
        return {
            success: true,
            message: 'Telegram notifications enabled.\n\nYou will receive Telegram messages when Claude needs input or completes tasks.\nTo disable: /oss:telegram off',
        };
    }
    else {
        // Disable Telegram notifications
        if (!settings.telegram) {
            settings.telegram = {
                enabled: false,
                botToken: '',
                chatId: '',
            };
        }
        else {
            settings.telegram.enabled = false;
        }
        saveSettings(configDir, settingsPath, settings);
        return {
            success: true,
            message: 'Telegram notifications disabled.\n\nTo re-enable: /oss:telegram on',
        };
    }
}
/**
 * Main entry point
 */
async function main() {
    const action = process.argv[2];
    if (action !== 'on' && action !== 'off') {
        console.log('Usage: telegram-toggle [on|off]');
        process.exit(1);
    }
    const result = await toggleTelegram(action);
    console.log(result.message);
    process.exit(result.success ? 0 : 1);
}
// Main execution - only run when called directly (not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('telegram-toggle.js');
if (isMainModule) {
    main().catch(console.error);
}
//# sourceMappingURL=telegram-toggle.js.map