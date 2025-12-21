/**
 * Notification System Type Definitions
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */
/**
 * Notification style options
 * - visual: Status line message (primary feedback mechanism)
 * - audio: Text-to-speech via say command
 * - sound: System sound via afplay
 * - muted: Silent mode (no notifications)
 * - none: Same as muted (legacy)
 */
export type NotificationStyle = 'visual' | 'audio' | 'sound' | 'muted' | 'none';
/**
 * Verbosity levels for filtering notifications
 * - all: Show all notifications including low priority
 * - important: Show high and critical priority only
 * - errors-only: Show only critical priority (errors)
 */
export type Verbosity = 'all' | 'important' | 'errors-only';
/**
 * Priority levels for notification events
 * - low: Informational (command start, agent spawn)
 * - high: Success/important (command complete, PR created)
 * - critical: Errors requiring attention (failures, loops)
 */
export type Priority = 'low' | 'high' | 'critical';
/**
 * Notification event types matching workflow moments
 */
export type NotificationEventType = 'COMMAND_START' | 'COMMAND_COMPLETE' | 'COMMAND_FAILED' | 'AGENT_SPAWN' | 'AGENT_COMPLETE' | 'QUALITY_PASSED' | 'PR_CREATED' | 'PR_MERGED' | 'LOOP_DETECTED' | 'INTERVENTION';
/**
 * A notification event to be dispatched
 */
export interface NotificationEvent {
    type: NotificationEventType;
    title: string;
    message: string;
    priority: Priority;
    data?: Record<string, unknown>;
}
/**
 * User notification preferences
 */
export interface NotificationPreferences {
    style: NotificationStyle;
    voice: string;
    sound: string;
    verbosity: Verbosity;
}
/**
 * Supervisor monitoring mode
 * - always: Monitor for IRON LAW violations continuously
 * - workflow-only: Only monitor during workflow commands
 */
export type SupervisorMode = 'always' | 'workflow-only';
/**
 * IRON LAW check toggles
 */
export interface IronLawCheckSettings {
    tdd: boolean;
    gitFlow: boolean;
    agentDelegation: boolean;
    devDocs: boolean;
}
/**
 * Supervisor settings
 */
export interface SupervisorSettings {
    mode: SupervisorMode;
    ironLawChecks: IronLawCheckSettings;
    checkIntervalMs: number;
}
/**
 * Settings file schema
 */
export interface NotificationSettings {
    notifications: NotificationPreferences;
    supervisor?: SupervisorSettings;
    version: number;
}
/**
 * Default notification preferences
 */
export declare const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences;
/**
 * Default IRON LAW check settings (all enabled)
 */
export declare const DEFAULT_IRON_LAW_CHECKS: IronLawCheckSettings;
/**
 * Default supervisor settings - always monitoring
 */
export declare const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings;
/**
 * Default settings
 */
export declare const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings;
/**
 * Priority mapping for event types
 */
export declare const EVENT_TYPE_PRIORITIES: Record<NotificationEventType, Priority>;
//# sourceMappingURL=notification.d.ts.map