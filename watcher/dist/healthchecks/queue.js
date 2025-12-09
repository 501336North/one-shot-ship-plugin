import { promises as fs } from 'fs';
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
const SUPERVISOR_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILED_TASKS = 5;
export async function checkQueue(options) {
    const { queueManager, statePath } = options;
    try {
        // Get queue statistics
        const pendingCount = await queueManager.getPendingCount();
        const allTasks = await queueManager.getTasks();
        // Calculate failed count
        const failedCount = allTasks.filter(t => t.status === 'failed').length;
        // Find oldest pending task age
        const pendingTasks = allTasks.filter(t => t.status === 'pending');
        let oldestTaskAgeMs = 0;
        if (pendingTasks.length > 0) {
            const oldestTask = pendingTasks.reduce((oldest, task) => {
                return task.created_at < oldest.created_at ? task : oldest;
            });
            oldestTaskAgeMs = Date.now() - new Date(oldestTask.created_at).getTime();
        }
        // Check supervisor heartbeat if state path provided
        if (statePath) {
            try {
                const stats = await fs.stat(statePath);
                const supervisorAgeMs = Date.now() - stats.mtime.getTime();
                if (supervisorAgeMs > SUPERVISOR_STALE_THRESHOLD_MS) {
                    return {
                        status: 'warn',
                        message: `Supervisor heartbeat is stale (${Math.floor(supervisorAgeMs / 1000 / 60)} minutes old)`,
                        details: {
                            pending_count: pendingCount,
                            failed_count: failedCount,
                            oldest_task_age_ms: oldestTaskAgeMs,
                            supervisor_age_ms: supervisorAgeMs,
                        },
                    };
                }
            }
            catch (error) {
                // Missing supervisor state file
                return {
                    status: 'warn',
                    message: 'Supervisor state file is missing (supervisor may not be running)',
                    details: {
                        pending_count: pendingCount,
                        failed_count: failedCount,
                        oldest_task_age_ms: oldestTaskAgeMs,
                        error: error instanceof Error ? error.message : String(error),
                    },
                };
            }
        }
        // Check for excessive failures
        if (failedCount > MAX_FAILED_TASKS) {
            return {
                status: 'fail',
                message: `Too many failed tasks: ${failedCount} (threshold: ${MAX_FAILED_TASKS})`,
                details: {
                    pending_count: pendingCount,
                    failed_count: failedCount,
                    oldest_task_age_ms: oldestTaskAgeMs,
                },
            };
        }
        // Check for stuck tasks
        if (oldestTaskAgeMs > STUCK_THRESHOLD_MS) {
            return {
                status: 'warn',
                message: `Queue has stuck tasks (oldest: ${Math.floor(oldestTaskAgeMs / 1000 / 60)} minutes old)`,
                details: {
                    pending_count: pendingCount,
                    failed_count: failedCount,
                    oldest_task_age_ms: oldestTaskAgeMs,
                },
            };
        }
        // Pass
        return {
            status: 'pass',
            message: 'Queue is healthy',
            details: {
                pending_count: pendingCount,
                failed_count: failedCount,
                oldest_task_age_ms: oldestTaskAgeMs,
            },
        };
    }
    catch (error) {
        // Fail on unexpected errors
        return {
            status: 'fail',
            message: 'Queue health check failed',
            details: {
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
//# sourceMappingURL=queue.js.map