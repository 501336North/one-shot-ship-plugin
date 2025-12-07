/**
 * Notification System Type Definitions
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */
/**
 * Default notification preferences
 */
export const DEFAULT_NOTIFICATION_PREFERENCES = {
    style: 'visual',
    voice: 'Samantha',
    sound: 'Glass',
    verbosity: 'important',
};
/**
 * Default IRON LAW check settings (all enabled)
 */
export const DEFAULT_IRON_LAW_CHECKS = {
    tdd: true,
    gitFlow: true,
    agentDelegation: true,
    devDocs: true,
};
/**
 * Default supervisor settings - always monitoring
 */
export const DEFAULT_SUPERVISOR_SETTINGS = {
    mode: 'always',
    ironLawChecks: DEFAULT_IRON_LAW_CHECKS,
    checkIntervalMs: 5000,
};
/**
 * Default settings
 */
export const DEFAULT_NOTIFICATION_SETTINGS = {
    notifications: DEFAULT_NOTIFICATION_PREFERENCES,
    supervisor: DEFAULT_SUPERVISOR_SETTINGS,
    version: 1,
};
/**
 * Priority mapping for event types
 */
export const EVENT_TYPE_PRIORITIES = {
    COMMAND_START: 'low',
    COMMAND_COMPLETE: 'high',
    COMMAND_FAILED: 'critical',
    AGENT_SPAWN: 'low',
    AGENT_COMPLETE: 'high',
    QUALITY_PASSED: 'high',
    PR_CREATED: 'high',
    PR_MERGED: 'high',
    LOOP_DETECTED: 'critical',
    INTERVENTION: 'critical',
};
//# sourceMappingURL=notification.js.map