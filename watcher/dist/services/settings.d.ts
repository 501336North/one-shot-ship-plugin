/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */
import { NotificationSettings, NotificationStyle, Verbosity, SupervisorMode, SupervisorSettings } from '../types/notification.js';
import { TelegramConfig } from '../types/telegram.js';
import { ModelSettings } from '../types/model-settings.js';
/**
 * Prompt type for model configuration
 */
export type PromptType = 'agent' | 'command' | 'skill' | 'hook';
export declare class SettingsService {
    private settings;
    private settingsPath;
    private configDir;
    private modelSettings;
    private apiKeys;
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
     * Get telegram configuration
     */
    getTelegram(): TelegramConfig;
    /**
     * Set telegram configuration
     */
    setTelegram(config: TelegramConfig): void;
    /**
     * Toggle telegram enabled state
     */
    setTelegramEnabled(enabled: boolean): void;
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