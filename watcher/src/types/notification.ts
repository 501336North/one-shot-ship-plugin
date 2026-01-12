/**
 * Notification System Type Definitions
 *
 * @behavior Notifications are dispatched based on user settings
 * @acceptance-criteria AC-NOTIF.1 through AC-NOTIF.12
 */

import { TelegramConfig } from './telegram.js';

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
export type NotificationEventType =
  | 'COMMAND_START'
  | 'COMMAND_COMPLETE'
  | 'COMMAND_FAILED'
  | 'AGENT_SPAWN'
  | 'AGENT_COMPLETE'
  | 'QUALITY_PASSED'
  | 'PR_CREATED'
  | 'PR_MERGED'
  | 'LOOP_DETECTED'
  | 'INTERVENTION';

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
  telegram?: TelegramConfig;
  version: number;
}

/**
 * Default notification preferences
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  style: 'visual',
  voice: 'Samantha',
  sound: 'Glass',
  verbosity: 'important',
};

/**
 * Default IRON LAW check settings (all enabled)
 */
export const DEFAULT_IRON_LAW_CHECKS: IronLawCheckSettings = {
  tdd: true,
  gitFlow: true,
  agentDelegation: true,
  devDocs: true,
};

/**
 * Default supervisor settings - always monitoring
 */
export const DEFAULT_SUPERVISOR_SETTINGS: SupervisorSettings = {
  mode: 'always',
  ironLawChecks: DEFAULT_IRON_LAW_CHECKS,
  checkIntervalMs: 5000,
};

/**
 * Default settings
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  supervisor: DEFAULT_SUPERVISOR_SETTINGS,
  version: 1,
};

/**
 * Priority mapping for event types
 */
export const EVENT_TYPE_PRIORITIES: Record<NotificationEventType, Priority> = {
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
