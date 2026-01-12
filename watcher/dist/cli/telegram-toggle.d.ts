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
export interface ToggleResult {
    success: boolean;
    message: string;
}
/**
 * Toggle Telegram notifications on or off
 */
export declare function toggleTelegram(action: 'on' | 'off'): Promise<ToggleResult>;
//# sourceMappingURL=telegram-toggle.d.ts.map