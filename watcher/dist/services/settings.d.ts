/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */
import { NotificationSettings, NotificationStyle, Verbosity, SupervisorMode, SupervisorSettings } from '../types/notification.js';
import { ModelSettings } from '../types/model-settings.js';
/**
 * Prompt type for model configuration
 */
export type PromptType = 'agent' | 'command' | 'skill' | 'hook';
/**
 * The one rule for a saved notification style: a known style is kept, anything else (including the
 * retired "telegram") reads as the default style.
 */
export declare function normalizeStyle(style: unknown): NotificationStyle;
/** How save() waits for the shared settings lock; injectable so tests need not sleep. */
export interface SettingsLockOptions {
    /** how long to wait for a held lock before refusing (default 5000 ms, retried every 100 ms) */
    lockTimeoutMs?: number;
    /** sleeps for the given ms (default: a blocking wait, since save() is synchronous) */
    sleep?: (ms: number) => void;
}
export declare class SettingsService {
    private settings;
    private settingsPath;
    private configDir;
    private modelSettings;
    private apiKeys;
    private lockTimeoutMs;
    private sleep;
    /** what this instance changed since its last save, keyed by path: the only entries a save writes */
    private pending;
    constructor(configDir: string, options?: SettingsLockOptions);
    /**
     * Load settings from settings.json, falling back to defaults
     */
    private loadSettings;
    /**
     * Create a deep copy of default settings to avoid mutation
     */
    private deepCopyDefaults;
    /**
     * Load model settings from settings.json
     */
    private loadModelSettings;
    /**
     * Load API keys from settings.json
     */
    private loadApiKeys;
    /**
     * Validate parsed settings and merge with defaults
     */
    private validateAndMerge;
    /**
     * Get current settings
     */
    getSettings(): NotificationSettings;
    /**
     * Read settings.json for a merge, by the rule every OSS writer shares (oss_settings_set): a missing
     * file is {}; a file that is a link, not a regular file, not the person's, unreadable or not exactly
     * one JSON object is refused (null), because the hooks read such a file as "personal push off".
     */
    private readForMerge;
    /** Record a set at one path for the next save. */
    private record;
    /**
     * Save settings to file. Only the entries this instance changed (setters, recorded as pending changes)
     * are written, on top of the file as it is under the lock, so keys another writer owns (e.g.
     * decisionsPush from /oss:settings decisions off, or a key a concurrent instance set) are kept. A file the shared rule refuses is left as it is
     * and nothing is saved. The whole read-merge-rename runs under the shared settings lock; if the lock
     * cannot be had (held past the timeout, or a link in the way) nothing is saved either.
     */
    save(): void;
    /**
     * Take the lock every settings.json writer shares: the directory locks/settings in ~/.oss, made
     * atomically with mkdir. Its parent must be the person's own folder (700, not a link). A held lock is
     * retried every 100 ms up to the timeout; one older than 30 s is stale and taken over (takeStale). Returns the
     * lock path and its identity right after this save's mkdir, or null to refuse (timeout, a link, or not a
     * directory).
     */
    private acquireLock;
    /** save() under the lock: re-read, apply the pending changes, temp write at 600, rename. */
    private saveLocked;
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
    /**
     * Set model for a specific prompt type and name
     *
     * @param type - The prompt type (agent, command, skill, hook)
     * @param name - The prompt name (e.g., 'oss:code-reviewer')
     * @param model - The model identifier (e.g., 'ollama/codellama')
     */
    setModelForPrompt(type: PromptType, name: string, model: string): Promise<void>;
    /**
     * Get model for a specific prompt type and name
     *
     * @param type - The prompt type (agent, command, skill, hook)
     * @param name - The prompt name (e.g., 'oss:code-reviewer')
     * @returns The model identifier or undefined if not configured
     */
    getModelForPrompt(type: PromptType, name: string): Promise<string | undefined>;
    /**
     * Get all model configuration
     *
     * @returns The complete model settings
     */
    getModelConfig(): Promise<ModelSettings>;
    /**
     * Set API key for a provider
     *
     * @param provider - The provider name (openrouter, openai, gemini, ollama)
     * @param key - The API key (or base URL for ollama)
     */
    setApiKey(provider: string, key: string): Promise<void>;
    /**
     * Get API key for a provider
     * Environment variables take precedence over stored keys.
     *
     * @param provider - The provider name (openrouter, openai, gemini, ollama)
     * @returns The API key or undefined if not configured
     */
    getApiKey(provider: string): Promise<string | undefined>;
    /**
     * Map prompt type to model settings key
     */
    private getModelTypeKey;
}
//# sourceMappingURL=settings.d.ts.map