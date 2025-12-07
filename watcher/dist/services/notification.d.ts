/**
 * NotificationService - Centralized notification dispatch
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */
import { NotificationEvent, NotificationSettings, Priority, NotificationEventType } from '../types/notification.js';
export declare class NotificationService {
    private settings;
    private settingsPath;
    constructor(configDir: string);
    /**
     * Load settings from settings.json, falling back to defaults
     */
    private loadSettings;
    /**
     * Get current settings
     */
    getSettings(): NotificationSettings;
    /**
     * Check if an event should trigger a notification based on verbosity settings
     */
    shouldNotify(event: NotificationEvent): boolean;
    /**
     * Generate the shell command to dispatch a notification
     */
    getNotifyCommand(event: NotificationEvent): string;
    /**
     * Escape shell special characters
     */
    private escapeShell;
    /**
     * Get the default priority for an event type
     */
    static getDefaultPriority(eventType: NotificationEventType): Priority;
}
//# sourceMappingURL=notification.d.ts.map