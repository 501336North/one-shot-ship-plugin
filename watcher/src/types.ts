/**
 * Queue-Based Watcher Agent System - Type Definitions
 *
 * Based on DATA-MODEL.md specification
 */

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type MonitorSource = 'log-monitor' | 'test-monitor' | 'git-monitor' | 'manual';

export type AnomalyType =
  // Log anomalies
  | 'agent_error'
  | 'agent_loop'
  | 'agent_stuck'
  | 'exception'
  // Test anomalies
  | 'test_failure'
  | 'test_flaky'
  | 'coverage_drop'
  // Git anomalies
  | 'ci_failure'
  | 'pr_check_failed'
  | 'push_failed'
  // LLM-detected
  | 'unusual_pattern'
  | 'recommended_investigation';

export type TaskStatus = 'pending' | 'executing' | 'completed' | 'failed';

export interface TaskContext {
  // Common fields
  file?: string;
  line?: number;

  // Log context
  log_excerpt?: string;
  tool_name?: string;
  repeat_count?: number;

  // Test context
  test_name?: string;
  test_file?: string;
  failure_count?: number;
  last_error?: string;

  // Git context
  commit?: string;
  branch?: string;
  pr_number?: number;
  ci_url?: string;

  // LLM analysis
  analysis?: string;
  confidence?: number;
}

export interface Task {
  // Identity
  id: string;                    // Format: "task-YYYYMMDD-HHMMSS-xxxx"
  created_at: string;            // ISO 8601 timestamp

  // Classification
  priority: Priority;
  source: MonitorSource;
  anomaly_type: AnomalyType;

  // Execution
  prompt: string;
  suggested_agent: string;

  // Context
  context: TaskContext;
  report_path?: string;

  // Status tracking
  status: TaskStatus;
  attempts: number;
  error?: string;
  completed_at?: string;
}

export interface QueueFile {
  version: '1.0';
  updated_at: string;
  tasks: Task[];
}

export interface ArchivedTask extends Task {
  archived_at: string;
  archive_reason: 'failed' | 'expired' | 'dropped';
}

export interface ArchiveQueueFile {
  version: '1.0';
  updated_at: string;
  tasks: ArchivedTask[];
}

export interface WatcherConfig {
  version: '1.0';

  // Feature toggles
  enabled: boolean;
  monitors: {
    logs: boolean;
    tests: boolean;
    git: boolean;
  };

  // Thresholds
  loop_detection_threshold: number;
  stuck_timeout_seconds: number;
  task_expiry_hours: number;
  max_queue_size: number;

  // LLM settings
  use_llm_analysis: boolean;
  llm_confidence_threshold: number;
}

export const DEFAULT_CONFIG: WatcherConfig = {
  version: '1.0',
  enabled: true,
  monitors: {
    logs: true,
    tests: true,
    git: true,
  },
  loop_detection_threshold: 5,
  stuck_timeout_seconds: 60,
  task_expiry_hours: 24,
  max_queue_size: 50,
  use_llm_analysis: true,
  llm_confidence_threshold: 0.7,
};

// Priority ordering for sorting
export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Task creation input (without auto-generated fields)
export type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'status' | 'attempts' | 'completed_at' | 'error'>;
