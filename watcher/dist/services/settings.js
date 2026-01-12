/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_SUPERVISOR_SETTINGS, } from '../types/notification.js';
import { DEFAULT_TELEGRAM_CONFIG } from '../types/telegram.js';
import { DEFAULT_MODEL_SETTINGS, } from '../types/model-settings.js';
/**
 * Environment variable names for API keys
 */
const ENV_VAR_NAMES = {
    openrouter: 'OPENROUTER_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
};
const VALID_STYLES = ['visual', 'audio', 'sound', 'none'];
const VALID_VERBOSITIES = ['all', 'important', 'errors-only'];
const VALID_SUPERVISOR_MODES = ['always', 'workflow-only'];
export class SettingsService {
    settings;
    settingsPath;
    configDir;
    modelSettings;
    apiKeys;
    constructor(configDir) {
        this.configDir = configDir;
        this.settingsPath = path.join(configDir, 'settings.json');
        this.settings = this.loadSettings();
        this.modelSettings = this.loadModelSettings();
        this.apiKeys = this.loadApiKeys();
    }
    /**
     * Load settings from settings.json, falling back to defaults
     */
    loadSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const content = fs.readFileSync(this.settingsPath, 'utf-8');
                const parsed = JSON.parse(content);
                // Validate and merge with defaults
                return this.validateAndMerge(parsed);
            }
        }
        catch {
            // Fall through to defaults on any error (invalid JSON, etc.)
        }
        return this.deepCopyDefaults();
    }
    /**
     * Create a deep copy of default settings to avoid mutation
     */
    deepCopyDefaults() {
        return {
            notifications: { ...DEFAULT_NOTIFICATION_SETTINGS.notifications },
            supervisor: {
                ...DEFAULT_SUPERVISOR_SETTINGS,
                ironLawChecks: { ...DEFAULT_SUPERVISOR_SETTINGS.ironLawChecks },
            },
            telegram: { ...DEFAULT_TELEGRAM_CONFIG },
            version: DEFAULT_NOTIFICATION_SETTINGS.version,
        };
    }
    /**
     * Load model settings from settings.json
     */
    loadModelSettings() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const content = fs.readFileSync(this.settingsPath, 'utf-8');
                const parsed = JSON.parse(content);
                if (parsed.models && typeof parsed.models === 'object') {
                    return {
                        default: parsed.models.default || DEFAULT_MODEL_SETTINGS.default,
                        fallbackEnabled: typeof parsed.models.fallbackEnabled === 'boolean'
                            ? parsed.models.fallbackEnabled
                            : DEFAULT_MODEL_SETTINGS.fallbackEnabled,
                        agents: parsed.models.agents || {},
                        commands: parsed.models.commands || {},
                        skills: parsed.models.skills || {},
                        hooks: parsed.models.hooks || {},
                    };
                }
            }
        }
        catch {
            // Fall through to defaults on any error
        }
        return {
            default: DEFAULT_MODEL_SETTINGS.default,
            fallbackEnabled: DEFAULT_MODEL_SETTINGS.fallbackEnabled,
            agents: {},
            commands: {},
            skills: {},
            hooks: {},
        };
    }
    /**
     * Load API keys from settings.json
     */
    loadApiKeys() {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const content = fs.readFileSync(this.settingsPath, 'utf-8');
                const parsed = JSON.parse(content);
                if (parsed.apiKeys && typeof parsed.apiKeys === 'object') {
                    return { ...parsed.apiKeys };
                }
            }
        }
        catch {
            // Fall through to empty config on any error
        }
        return {};
    }
    /**
     * Validate parsed settings and merge with defaults
     */
    validateAndMerge(parsed) {
        const settings = this.deepCopyDefaults();
        if (typeof parsed !== 'object' || parsed === null) {
            return settings;
        }
        const p = parsed;
        const notifications = p.notifications;
        if (notifications) {
            // Validate style
            if (VALID_STYLES.includes(notifications.style)) {
                settings.notifications.style = notifications.style;
            }
            // Validate verbosity
            if (VALID_VERBOSITIES.includes(notifications.verbosity)) {
                settings.notifications.verbosity = notifications.verbosity;
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
        const supervisor = p.supervisor;
        if (supervisor && settings.supervisor) {
            // Validate mode
            if (VALID_SUPERVISOR_MODES.includes(supervisor.mode)) {
                settings.supervisor.mode = supervisor.mode;
            }
            // Validate checkIntervalMs
            if (typeof supervisor.checkIntervalMs === 'number' && supervisor.checkIntervalMs > 0) {
                settings.supervisor.checkIntervalMs = supervisor.checkIntervalMs;
            }
            // Validate ironLawChecks
            const checks = supervisor.ironLawChecks;
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
        // Validate telegram settings
        const telegram = p.telegram;
        if (telegram && settings.telegram) {
            if (typeof telegram.enabled === 'boolean') {
                settings.telegram.enabled = telegram.enabled;
            }
            if (typeof telegram.botToken === 'string') {
                settings.telegram.botToken = telegram.botToken;
            }
            if (typeof telegram.chatId === 'string') {
                settings.telegram.chatId = telegram.chatId;
            }
        }
        return settings;
    }
    /**
     * Get current settings
     */
    getSettings() {
        return this.settings;
    }
    /**
     * Save settings to file
     */
    save() {
        // Ensure directory exists
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
        // Combine all settings into one object
        const allSettings = {
            ...this.settings,
            models: this.modelSettings,
            apiKeys: this.apiKeys,
        };
        fs.writeFileSync(this.settingsPath, JSON.stringify(allSettings, null, 2));
    }
    /**
     * Set notification style
     */
    setNotificationStyle(style) {
        if (VALID_STYLES.includes(style)) {
            this.settings.notifications.style = style;
        }
    }
    /**
     * Set verbosity level
     */
    setVerbosity(verbosity) {
        if (VALID_VERBOSITIES.includes(verbosity)) {
            this.settings.notifications.verbosity = verbosity;
        }
    }
    /**
     * Set voice for audio notifications
     */
    setVoice(voice) {
        this.settings.notifications.voice = voice;
    }
    /**
     * Set sound for sound notifications
     */
    setSound(sound) {
        this.settings.notifications.sound = sound;
    }
    /**
     * Get supervisor settings
     */
    getSupervisorSettings() {
        return this.settings.supervisor || DEFAULT_SUPERVISOR_SETTINGS;
    }
    /**
     * Set supervisor monitoring mode
     */
    setSupervisorMode(mode) {
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
    setCheckInterval(ms) {
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
    setIronLawCheck(law, enabled) {
        if (!this.settings.supervisor) {
            this.settings.supervisor = { ...DEFAULT_SUPERVISOR_SETTINGS };
        }
        this.settings.supervisor.ironLawChecks[law] = enabled;
    }
    /**
     * Get telegram configuration
     */
    getTelegram() {
        return this.settings.telegram || { ...DEFAULT_TELEGRAM_CONFIG };
    }
    /**
     * Set telegram configuration
     */
    setTelegram(config) {
        this.settings.telegram = { ...config };
        this.save();
    }
    /**
     * Toggle telegram enabled state
     */
    setTelegramEnabled(enabled) {
        if (!this.settings.telegram) {
            this.settings.telegram = { ...DEFAULT_TELEGRAM_CONFIG };
        }
        this.settings.telegram.enabled = enabled;
        this.save();
    }
    /**
     * Migrate from old audio-config format
     */
    migrateFromAudioConfig() {
        const audioConfigPath = path.join(this.configDir, 'audio-config');
        if (!fs.existsSync(audioConfigPath)) {
            return;
        }
        try {
            const content = fs.readFileSync(audioConfigPath, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
                const [key, value] = line.split('=');
                if (!key || !value)
                    continue;
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
        }
        catch {
            // Ignore migration errors
        }
    }
    // ============================================
    // Model Configuration Methods
    // ============================================
    /**
     * Set model for a specific prompt type and name
     *
     * @param type - The prompt type (agent, command, skill, hook)
     * @param name - The prompt name (e.g., 'oss:code-reviewer')
     * @param model - The model identifier (e.g., 'ollama/codellama')
     */
    async setModelForPrompt(type, name, model) {
        const typeKey = this.getModelTypeKey(type);
        if (!this.modelSettings[typeKey]) {
            this.modelSettings[typeKey] = {};
        }
        this.modelSettings[typeKey][name] = model;
        this.save();
    }
    /**
     * Get model for a specific prompt type and name
     *
     * @param type - The prompt type (agent, command, skill, hook)
     * @param name - The prompt name (e.g., 'oss:code-reviewer')
     * @returns The model identifier or undefined if not configured
     */
    async getModelForPrompt(type, name) {
        const typeKey = this.getModelTypeKey(type);
        return this.modelSettings[typeKey]?.[name];
    }
    /**
     * Get all model configuration
     *
     * @returns The complete model settings
     */
    async getModelConfig() {
        return { ...this.modelSettings };
    }
    /**
     * Set API key for a provider
     *
     * @param provider - The provider name (openrouter, openai, gemini, ollama)
     * @param key - The API key (or base URL for ollama)
     */
    async setApiKey(provider, key) {
        this.apiKeys[provider] = key;
        this.save();
    }
    /**
     * Get API key for a provider
     * Environment variables take precedence over stored keys.
     *
     * @param provider - The provider name (openrouter, openai, gemini, ollama)
     * @returns The API key or undefined if not configured
     */
    async getApiKey(provider) {
        // Check environment variable first (takes precedence)
        const envVarName = ENV_VAR_NAMES[provider];
        if (envVarName) {
            const envValue = process.env[envVarName];
            if (envValue) {
                return envValue;
            }
        }
        // Fall back to stored key
        return this.apiKeys[provider];
    }
    /**
     * Map prompt type to model settings key
     */
    getModelTypeKey(type) {
        switch (type) {
            case 'agent':
                return 'agents';
            case 'command':
                return 'commands';
            case 'skill':
                return 'skills';
            case 'hook':
                return 'hooks';
        }
    }
}
//# sourceMappingURL=settings.js.map