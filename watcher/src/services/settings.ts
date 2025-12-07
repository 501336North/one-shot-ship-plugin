/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  NotificationSettings,
  NotificationStyle,
  Verbosity,
  SupervisorMode,
  SupervisorSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_SUPERVISOR_SETTINGS,
} from '../types/notification.js';

const VALID_STYLES: NotificationStyle[] = ['visual', 'audio', 'sound', 'none'];
const VALID_VERBOSITIES: Verbosity[] = ['all', 'important', 'errors-only'];
const VALID_SUPERVISOR_MODES: SupervisorMode[] = ['always', 'workflow-only'];

export class SettingsService {
  private settings: NotificationSettings;
  private settingsPath: string;
  private configDir: string;

  constructor(configDir: string) {
    this.configDir = configDir;
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

        // Validate and merge with defaults
        return this.validateAndMerge(parsed);
      }
    } catch {
      // Fall through to defaults on any error (invalid JSON, etc.)
    }

    return this.deepCopyDefaults();
  }

  /**
   * Create a deep copy of default settings to avoid mutation
   */
  private deepCopyDefaults(): NotificationSettings {
    return {
      notifications: { ...DEFAULT_NOTIFICATION_SETTINGS.notifications },
      supervisor: {
        ...DEFAULT_SUPERVISOR_SETTINGS,
        ironLawChecks: { ...DEFAULT_SUPERVISOR_SETTINGS.ironLawChecks },
      },
      version: DEFAULT_NOTIFICATION_SETTINGS.version,
    };
  }

  /**
   * Validate parsed settings and merge with defaults
   */
  private validateAndMerge(parsed: unknown): NotificationSettings {
    const settings = this.deepCopyDefaults();

    if (typeof parsed !== 'object' || parsed === null) {
      return settings;
    }

    const p = parsed as Record<string, unknown>;
    const notifications = p.notifications as Record<string, unknown> | undefined;

    if (notifications) {
      // Validate style
      if (VALID_STYLES.includes(notifications.style as NotificationStyle)) {
        settings.notifications.style = notifications.style as NotificationStyle;
      }

      // Validate verbosity
      if (VALID_VERBOSITIES.includes(notifications.verbosity as Verbosity)) {
        settings.notifications.verbosity = notifications.verbosity as Verbosity;
      }

      // Voice and sound are strings, just copy if present
      if (typeof notifications.voice === 'string') {
        settings.notifications.voice = notifications.voice;
      }

      if (typeof notifications.sound === 'string') {
        settings.notifications.sound = notifications.sound;
      }
    }

    if (typeof p.version === 'number') {
      settings.version = p.version;
    }

    // Validate supervisor settings
    const supervisor = p.supervisor as Record<string, unknown> | undefined;
    if (supervisor && settings.supervisor) {
      // Validate mode
      if (VALID_SUPERVISOR_MODES.includes(supervisor.mode as SupervisorMode)) {
        settings.supervisor.mode = supervisor.mode as SupervisorMode;
      }

      // Validate checkIntervalMs
      if (typeof supervisor.checkIntervalMs === 'number' && supervisor.checkIntervalMs > 0) {
        settings.supervisor.checkIntervalMs = supervisor.checkIntervalMs;
      }

      // Validate ironLawChecks
      const checks = supervisor.ironLawChecks as Record<string, unknown> | undefined;
      if (checks) {
        if (typeof checks.tdd === 'boolean') {
          settings.supervisor.ironLawChecks.tdd = checks.tdd;
        }
        if (typeof checks.gitFlow === 'boolean') {
          settings.supervisor.ironLawChecks.gitFlow = checks.gitFlow;
        }
        if (typeof checks.agentDelegation === 'boolean') {
          settings.supervisor.ironLawChecks.agentDelegation = checks.agentDelegation;
        }
        if (typeof checks.devDocs === 'boolean') {
          settings.supervisor.ironLawChecks.devDocs = checks.devDocs;
        }
      }
    }

    return settings;
  }

  /**
   * Get current settings
   */
  getSettings(): NotificationSettings {
    return this.settings;
  }

  /**
   * Save settings to file
   */
  save(): void {
    // Ensure directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
  }

  /**
   * Set notification style
   */
  setNotificationStyle(style: NotificationStyle): void {
    if (VALID_STYLES.includes(style)) {
      this.settings.notifications.style = style;
    }
  }

  /**
   * Set verbosity level
   */
  setVerbosity(verbosity: Verbosity): void {
    if (VALID_VERBOSITIES.includes(verbosity)) {
      this.settings.notifications.verbosity = verbosity;
    }
  }

  /**
   * Set voice for audio notifications
   */
  setVoice(voice: string): void {
    this.settings.notifications.voice = voice;
  }

  /**
   * Set sound for sound notifications
   */
  setSound(sound: string): void {
    this.settings.notifications.sound = sound;
  }

  /**
   * Get supervisor settings
   */
  getSupervisorSettings(): SupervisorSettings {
    return this.settings.supervisor || DEFAULT_SUPERVISOR_SETTINGS;
  }

  /**
   * Set supervisor monitoring mode
   */
  setSupervisorMode(mode: SupervisorMode): void {
    if (VALID_SUPERVISOR_MODES.includes(mode)) {
      if (!this.settings.supervisor) {
        this.settings.supervisor = { ...DEFAULT_SUPERVISOR_SETTINGS };
      }
      this.settings.supervisor.mode = mode;
    }
  }

  /**
   * Set check interval
   */
  setCheckInterval(ms: number): void {
    if (ms > 0) {
      if (!this.settings.supervisor) {
        this.settings.supervisor = { ...DEFAULT_SUPERVISOR_SETTINGS };
      }
      this.settings.supervisor.checkIntervalMs = ms;
    }
  }

  /**
   * Enable/disable specific IRON LAW check
   */
  setIronLawCheck(law: keyof SupervisorSettings['ironLawChecks'], enabled: boolean): void {
    if (!this.settings.supervisor) {
      this.settings.supervisor = { ...DEFAULT_SUPERVISOR_SETTINGS };
    }
    this.settings.supervisor.ironLawChecks[law] = enabled;
  }

  /**
   * Migrate from old audio-config format
   */
  migrateFromAudioConfig(): void {
    const audioConfigPath = path.join(this.configDir, 'audio-config');

    if (!fs.existsSync(audioConfigPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(audioConfigPath, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const [key, value] = line.split('=');
        if (!key || !value) continue;

        const trimmedValue = value.trim();

        switch (key.trim()) {
          case 'OSS_AUDIO_ENABLED':
            // If audio was enabled, set style to audio
            if (trimmedValue === 'true') {
              this.settings.notifications.style = 'audio';
            }
            break;

          case 'OSS_USE_VOICE':
            // If voice was enabled, ensure style is audio
            if (trimmedValue === 'true') {
              this.settings.notifications.style = 'audio';
            }
            break;

          case 'OSS_VOICE':
            this.settings.notifications.voice = trimmedValue;
            break;

          case 'OSS_SOUND_SUCCESS':
            this.settings.notifications.sound = trimmedValue;
            break;
        }
      }
    } catch {
      // Ignore migration errors
    }
  }
}
