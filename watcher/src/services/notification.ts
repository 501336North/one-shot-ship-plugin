/**
 * NotificationService - Centralized notification dispatch
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  NotificationEvent,
  NotificationSettings,
  NotificationStyle,
  Verbosity,
  Priority,
  NotificationEventType,
  DEFAULT_NOTIFICATION_SETTINGS,
  EVENT_TYPE_PRIORITIES,
} from '../types/notification.js';
import { normalizeStyle } from './settings.js';

export class NotificationService {
  private settings: NotificationSettings;
  private settingsPath: string;

  constructor(configDir: string) {
    this.settingsPath = path.join(configDir, 'settings.json');
    this.settings = this.loadSettings();
  }

  /**
   * Load settings from settings.json, falling back to defaults
   */
  private loadSettings(): NotificationSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = JSON.parse(content);

        // Merge with defaults for missing fields
        return {
          notifications: {
            style: normalizeStyle(parsed.notifications?.style),
            voice: parsed.notifications?.voice ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.voice,
            sound: parsed.notifications?.sound ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.sound,
            verbosity:
              parsed.notifications?.verbosity ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.verbosity,
            updates:
              parsed.notifications?.updates ?? DEFAULT_NOTIFICATION_SETTINGS.notifications.updates,
          },
          version: parsed.version ?? DEFAULT_NOTIFICATION_SETTINGS.version,
        };
      }
    } catch {
      // Fall through to defaults on any error
    }

    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return this.settings;
  }

  /**
   * Check if an event should trigger a notification based on verbosity settings
   */
  shouldNotify(event: NotificationEvent): boolean {
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
   * Get the default priority for an event type
   */
  static getDefaultPriority(eventType: NotificationEventType): Priority {
    return EVENT_TYPE_PRIORITIES[eventType];
  }
}
