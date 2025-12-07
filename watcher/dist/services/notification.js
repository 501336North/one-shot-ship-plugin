/**
 * NotificationService - Centralized notification dispatch
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_NOTIFICATION_SETTINGS, EVENT_TYPE_PRIORITIES, } from '../types/notification.js';
export class NotificationService {
    settings;
    settingsPath;
    constructor(configDir) {
        this.settingsPath = path.join(configDir, 'settings.json');
        this.settings = this.loadSettings();
    }
    /**
     * Load settings from settings.json, falling back to defaults
     */
    loadSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const content = fs.readFileSync(this.settingsPath, 'utf-8');
                const parsed = JSON.parse(content);
                // Merge with defaults for missing fields
                return {
                    notifications: {
                        style: parsed.notifications?.style ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.style,
                        voice: parsed.notifications?.voice ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.voice,
                        sound: parsed.notifications?.sound ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.sound,
                        verbosity: parsed.notifications?.verbosity ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.verbosity,
                    },
                    version: parsed.version ?? DEFAULT_NOTIFICATION_SETTINGS.version,
                };
            }
        }
        catch {
            // Fall through to defaults on any error
        }
        return { ...DEFAULT_NOTIFICATION_SETTINGS };
    }
    /**
     * Get current settings
     */
    getSettings() {
        return this.settings;
    }
    /**
     * Check if an event should trigger a notification based on verbosity settings
     */
    shouldNotify(event) {
        const { style, verbosity } = this.settings.notifications;
        // Style "none" skips all notifications
        if (style === 'none') {
            return false;
        }
        // Filter by verbosity
        switch (verbosity) {
            case 'all':
                return true;
            case 'important':
                // Allow high and critical, filter low
                return event.priority !== 'low';
            case 'errors-only':
                // Only allow critical
                return event.priority === 'critical';
            default:
                return true;
        }
    }
    /**
     * Generate the shell command to dispatch a notification
     */
    getNotifyCommand(event) {
        const { style, voice, sound } = this.settings.notifications;
        // Strip emojis from title for terminal-notifier (they render poorly)
        const cleanTitle = event.title.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        switch (style) {
            case 'visual':
                return `terminal-notifier -title "${this.escapeShell(cleanTitle)}" -message "${this.escapeShell(event.message)}" -sound default`;
            case 'audio':
                return `say -v ${voice} "${this.escapeShell(event.message)}"`;
            case 'sound':
                return `afplay "/System/Library/Sounds/${sound}.aiff"`;
            case 'none':
                return '';
            default:
                return '';
        }
    }
    /**
     * Escape shell special characters
     */
    escapeShell(str) {
        return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    }
    /**
     * Get the default priority for an event type
     */
    static getDefaultPriority(eventType) {
        return EVENT_TYPE_PRIORITIES[eventType];
    }
}
//# sourceMappingURL=notification.js.map