/**
 * SettingsService - Read/write ~/.oss/settings.json
 *
 * @behavior Settings are persisted and validated
 * @acceptance-criteria AC-SETTINGS.1 through AC-SETTINGS.6
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_NOTIFICATION_SETTINGS, DEFAULT_SUPERVISOR_SETTINGS, } from '../types/notification.js';
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
/**
 * The one rule for a saved notification style: a known style is kept, anything else (including the
 * retired "telegram") reads as the default style.
 */
export function normalizeStyle(style) {
    return VALID_STYLES.includes(style)
        ? style
        : DEFAULT_NOTIFICATION_SETTINGS.notifications.style;
}
const VALID_VERBOSITIES = ['all', 'important', 'errors-only'];
const VALID_SUPERVISOR_MODES = ['always', 'workflow-only'];
const LOCK_RETRY_MS = 100;
const LOCK_STALE_MS = 30_000;
/** A lock's identity: its inode and mtime (ns), so a lock removed and made again is a different one. */
function lockId(lock) {
    try {
        const st = fs.lstatSync(lock, { bigint: true });
        return `${st.ino}-${st.mtimeNs}`;
    }
    catch {
        return null;
    }
}
function rmdirQuiet(dir) {
    try {
        fs.rmdirSync(dir);
    }
    catch {
        // gone already, or not empty: not ours to force
    }
}
/**
 * Remove a stale lock only if it is still the one judged stale (`held`), as the shell's oss_take_stale does:
 * a guard folder named by its inode and mtime (seconds, the shell's spelling, so a shell writer and the
 * watcher exclude each other) is made with mkdir, so only one writer takes over a given stale lock.
 */
function takeStale(lock, held) {
    const guard = `${lock}.stale-${held.ino}-${held.mtimeNs / 1000000000n}`;
    try {
        fs.mkdirSync(guard);
    }
    catch {
        return;
    }
    if (lockId(lock) === `${held.ino}-${held.mtimeNs}`) {
        rmdirQuiet(lock);
    }
    rmdirQuiet(guard);
}
/** Apply one change to a parsed settings object; a missing or non-object parent on the way becomes {}. */
function applyChange(root, change) {
    let node = root;
    for (const key of change.path.slice(0, -1)) {
        const next = node[key];
        if (typeof next !== 'object' || next === null || Array.isArray(next)) {
            node[key] = {};
        }
        node = node[key];
    }
    const leaf = change.path[change.path.length - 1];
    node[leaf] = change.value;
}
function blockingSleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export class SettingsService {
    settings;
    settingsPath;
    configDir;
    modelSettings;
    apiKeys;
    lockTimeoutMs;
    sleep;
    /** what this instance changed since its last save, keyed by path: the only entries a save writes */
    pending = new Map();
    constructor(configDir, options = {}) {
        this.configDir = configDir;
        this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
        this.sleep = options.sleep ?? blockingSleep;
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
            settings.notifications.style = normalizeStyle(notifications.style);
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
            if (typeof notifications.updates === 'boolean') {
                settings.notifications.updates = notifications.updates;
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
        return settings;
    }
    /**
     * Get current settings
     */
    getSettings() {
        return this.settings;
    }
    /**
     * Read settings.json for a merge, by the rule every OSS writer shares (oss_settings_set): a missing
     * file is {}; a file that is a link, not a regular file, not the person's, unreadable or not exactly
     * one JSON object is refused (null), because the hooks read such a file as "personal push off".
     */
    readForMerge() {
        let st;
        try {
            st = fs.lstatSync(this.settingsPath);
        }
        catch {
            return { keys: {} };
        }
        const uid = process.getuid?.();
        if (!st.isFile() || (uid !== undefined && st.uid !== uid)) {
            return null;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return null;
            }
            // the retired telegram block (plaintext bot token) is never carried forward
            const { telegram: _retired, ...rest } = parsed;
            return { keys: rest };
        }
        catch {
            return null;
        }
    }
    /** Record a set at one path for the next save. */
    record(changePath, value) {
        this.pending.set(changePath.join('\u0000'), { path: changePath, value });
    }
    /**
     * Save settings to file. Only the entries this instance changed (setters, recorded as pending changes)
     * are written, on top of the file as it is under the lock, so keys another writer owns (e.g.
     * decisionsPush from /oss:settings decisions off, or a key a concurrent instance set) are kept. A file the shared rule refuses is left as it is
     * and nothing is saved. The whole read-merge-rename runs under the shared settings lock; if the lock
     * cannot be had (held past the timeout, or a link in the way) nothing is saved either.
     */
    save() {
        // Ensure directory exists
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
        const lock = this.acquireLock();
        if (lock === null) {
            return;
        }
        try {
            this.saveLocked();
        }
        finally {
            // only the lock this save made: one taken over meanwhile is another writer's (or gone)
            if (lock.id !== null && lockId(lock.path) === lock.id) {
                rmdirQuiet(lock.path);
            }
        }
    }
    /**
     * Take the lock every settings.json writer shares: the directory locks/settings in ~/.oss, made
     * atomically with mkdir. Its parent must be the person's own folder (700, not a link). A held lock is
     * retried every 100 ms up to the timeout; one older than 30 s is stale and taken over (takeStale). Returns the
     * lock path and its identity right after this save's mkdir, or null to refuse (timeout, a link, or not a
     * directory).
     */
    acquireLock() {
        const locks = path.join(this.configDir, 'locks');
        try {
            if (!fs.existsSync(locks)) {
                fs.mkdirSync(locks, { mode: 0o700 });
            }
            const st = fs.lstatSync(locks);
            const uid = process.getuid?.();
            if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
                return null;
            }
            fs.chmodSync(locks, 0o700);
        }
        catch {
            return null;
        }
        const lock = path.join(locks, 'settings');
        const retries = Math.floor(this.lockTimeoutMs / LOCK_RETRY_MS);
        let tookOver = false;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                fs.mkdirSync(lock, { mode: 0o700 });
                return { path: lock, id: lockId(lock) };
            }
            catch {
                // held, or a link or file in the way: look at it below
            }
            let held;
            try {
                held = fs.lstatSync(lock, { bigint: true });
            }
            catch {
                continue;
            }
            if (!held.isDirectory()) {
                return null;
            }
            if (!tookOver && Date.now() - Number(held.mtimeMs) > LOCK_STALE_MS) {
                takeStale(lock, held);
                // a takeover does not spend a retry, once: a stale lock that will not go still times out
                tookOver = true;
                attempt--;
                continue;
            }
            if (attempt < retries) {
                this.sleep(LOCK_RETRY_MS);
            }
        }
        return null;
    }
    /** save() under the lock: re-read, apply the pending changes, temp write at 600, rename. */
    saveLocked() {
        if (this.readForMerge() === null) {
            return;
        }
        const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
        const tmp = path.join(this.configDir, `.settings.json.${unique}`);
        try {
            fs.writeFileSync(tmp, '', { flag: 'wx', mode: 0o600 });
            // merge again from the file as it is now, so a write that landed since the check is kept
            const current = this.readForMerge();
            if (current === null) {
                fs.rmSync(tmp, { force: true });
                return;
            }
            for (const change of this.pending.values()) {
                applyChange(current.keys, change);
            }
            fs.writeFileSync(tmp, JSON.stringify(current.keys, null, 2));
            // always owner-only (600), whatever mode an older writer left: the file holds provider apiKeys
            fs.chmodSync(tmp, 0o600);
            fs.renameSync(tmp, this.settingsPath);
            this.pending.clear();
        }
        catch {
            // could not write: settings.json is left as it was
            fs.rmSync(tmp, { force: true });
        }
    }
    /**
     * Set notification style
     */
    setNotificationStyle(style) {
        if (normalizeStyle(style) === style) {
            this.settings.notifications.style = style;
            this.record(['notifications', 'style'], style);
        }
    }
    /**
     * Set verbosity level
     */
    setVerbosity(verbosity) {
        if (VALID_VERBOSITIES.includes(verbosity)) {
            this.settings.notifications.verbosity = verbosity;
            this.record(['notifications', 'verbosity'], verbosity);
        }
    }
    /**
     * Set voice for audio notifications
     */
    setVoice(voice) {
        this.settings.notifications.voice = voice;
        this.record(['notifications', 'voice'], voice);
    }
    /**
     * Set sound for sound notifications
     */
    setSound(sound) {
        this.settings.notifications.sound = sound;
        this.record(['notifications', 'sound'], sound);
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
            this.record(['supervisor', 'mode'], mode);
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
            this.record(['supervisor', 'checkIntervalMs'], ms);
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
        this.record(['supervisor', 'ironLawChecks', law], enabled);
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
                            this.record(['notifications', 'style'], 'audio');
                        }
                        break;
                    case 'OSS_USE_VOICE':
                        // If voice was enabled, ensure style is audio
                        if (trimmedValue === 'true') {
                            this.settings.notifications.style = 'audio';
                            this.record(['notifications', 'style'], 'audio');
                        }
                        break;
                    case 'OSS_VOICE':
                        this.settings.notifications.voice = trimmedValue;
                        this.record(['notifications', 'voice'], trimmedValue);
                        break;
                    case 'OSS_SOUND_SUCCESS':
                        this.settings.notifications.sound = trimmedValue;
                        this.record(['notifications', 'sound'], trimmedValue);
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
        this.record(['models', typeKey, name], model);
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
        this.record(['apiKeys', provider], key);
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