/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */
import { NotificationSettings, NotificationStyle, Verbosity, SupervisorMode, SupervisorSettings } from '../types/notification.js';
export declare class SettingsService {
    private settings;
    private settingsPath;
    private configDir;
    constructor(configDir: string);
    /**
     * Load settings from settings.json, falling back to defaults
     */
    private loadSettings;
    /**
     * Create a deep copy of default settings to avoid mutation
     */
    private deepCopyDefaults;
    /**
     * Validate parsed settings and merge with defaults
     */
    private validateAndMerge;
    /**
     * Get current settings
     */
    getSettings(): NotificationSettings;
    /**
     * Save settings to file
     */
    save(): void;
    /**
     * Set notification style
     */
    setNotificationStyle(style: NotificationStyle): void;
    /**
     * Set verbosity level
     */
    setVerbosity(verbosity: Verbosity): void;
    /**
     * Set voice for audio notifications
     */
    setVoice(voice: string): void;
    /**
     * Set sound for sound notifications
     */
    setSound(sound: string): void;
    /**
     * Get supervisor settings
     */
    getSupervisorSettings(): SupervisorSettings;
    /**
     * Set supervisor monitoring mode
     */
    setSupervisorMode(mode: SupervisorMode): void;
    /**
     * Set check interval
     */
    setCheckInterval(ms: number): void;
    /**
     * Enable/disable specific IRON LAW check
     */
    setIronLawCheck(law: keyof SupervisorSettings['ironLawChecks'], enabled: boolean): void;
    /**
     * Migrate from old audio-config format
     */
    migrateFromAudioConfig(): void;
}
//# sourceMappingURL=settings.d.ts.map