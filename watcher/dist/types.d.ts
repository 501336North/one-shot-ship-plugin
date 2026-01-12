/**
 * Queue-Based Watcher Agent System - Type Definitions
 *
 * Based on DATA-MODEL.md specification
 */
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type MonitorSource = 'log-monitor' | 'test-monitor' | 'git-monitor' | 'iron-law-monitor' | 'manual';
export type AnomalyType = 'agent_error' | 'agent_loop' | 'agent_stuck' | 'exception' | 'test_failure' | 'test_flaky' | 'coverage_drop' | 'ci_failure' | 'pr_check_failed' | 'push_failed' | 'unusual_pattern' | 'recommended_investigation' | 'iron_law_violation' | 'iron_law_repeated' | 'iron_law_ignored';
export type TaskStatus = 'pending' | 'executing' | 'completed' | 'failed';
export interface TaskContext {
    file?: string;
    line?: number;
    log_excerpt?: string;
    tool_name?: string;
    repeat_count?: number;
    test_name?: string;
    test_file?: string;
    failure_count?: number;
    last_error?: string;
    commit?: string;
    branch?: string;
    pr_number?: number;
    pr_title?: string;
    review_body?: string;
    ci_url?: string;
    analysis?: string;
    confidence?: number;
    law?: number;
    type?: string;
    message?: string;
}
export interface Task {
    id: string;
    created_at: string;
    priority: Priority;
    source: MonitorSource;
    anomaly_type: AnomalyType;
    prompt: string;
    suggested_agent: string;
    context: TaskContext;
    report_path?: string;
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
    enabled: boolean;
    monitors: {
        logs: boolean;
        tests: boolean;
        git: boolean;
    };
    loop_detection_threshold: number;
    stuck_timeout_seconds: number;
    task_expiry_hours: number;
    max_queue_size: number;
    use_llm_analysis: boolean;
    llm_confidence_threshold: number;
}
export declare const DEFAULT_CONFIG: WatcherConfig;
export declare const PRIORITY_ORDER: Record<Priority, number>;
export type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'status' | 'attempts' | 'completed_at' | 'error'>;
export type CheckStatus = 'pass' | 'warn' | 'fail';
export type OverallStatus = 'healthy' | 'warning' | 'critical';
/**
 * CheckResultDetails - Typed details for health check results
 * Uses Record<string, unknown> for flexibility while avoiding 'any'
 */
export type CheckResultDetails = Record<string, unknown>;
export interface CheckResult {
    status: CheckStatus;
    message: string;
    details?: CheckResultDetails;
}
export interface HealthReport {
    timestamp: string;
    overall_status: OverallStatus;
    checks: {
        logging: CheckResult;
        dev_docs: CheckResult;
        delegation: CheckResult;
        queue: CheckResult;
        archive: CheckResult;
        quality_gates: CheckResult;
        notifications: CheckResult;
        git_safety: CheckResult;
    };
}
//# sourceMappingURL=types.d.ts.map