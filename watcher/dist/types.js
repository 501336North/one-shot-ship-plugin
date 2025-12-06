/**
 * Queue-Based Watcher Agent System - Type Definitions
 *
 * Based on DATA-MODEL.md specification
 */
export const DEFAULT_CONFIG = {
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
export const PRIORITY_ORDER = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};
//# sourceMappingURL=types.js.map