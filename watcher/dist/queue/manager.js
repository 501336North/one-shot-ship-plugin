import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PRIORITY_ORDER, } from '../types.js';
/**
 * Queue Manager - Handles task persistence and ordering
 *
 * Implements AC-007.1 through AC-007.5 from REQUIREMENTS.md
 */
export class QueueManager {
    queuePath;
    failedQueuePath;
    expiredQueuePath;
    queue;
    maxQueueSize;
    ossDir;
    debugNotifications = false;
    eventListeners = [];
    constructor(ossDir, maxQueueSize = 50) {
        this.ossDir = ossDir;
        this.queuePath = path.join(ossDir, 'queue.json');
        this.failedQueuePath = path.join(ossDir, 'queue-failed.json');
        this.expiredQueuePath = path.join(ossDir, 'queue-expired.json');
        this.maxQueueSize = maxQueueSize;
        this.queue = this.createEmptyQueue();
    }
    /**
     * Enable or disable debug notifications
     */
    setDebugNotifications(enabled) {
        this.debugNotifications = enabled;
    }
    /**
     * Register an event listener for queue operations
     */
    addEventListener(callback) {
        this.eventListeners.push(callback);
    }
    /**
     * Remove an event listener
     */
    removeEventListener(callback) {
        this.eventListeners = this.eventListeners.filter(cb => cb !== callback);
    }
    /**
     * Emit a queue event to all listeners and send debug notification
     */
    emitEvent(event) {
        // Notify listeners
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch {
                // Ignore listener errors
            }
        }
        // Send debug notification if enabled
        if (this.debugNotifications) {
            this.sendDebugNotification(event);
        }
    }
    /**
     * Send a debug notification via oss-notify.sh or status line CLI
     * All queue notifications use the status line as the visual notification mechanism
     */
    sendDebugNotification(event) {
        try {
            const title = `🤖 Queue: ${event.type.replace('_', ' ')}`;
            const message = `${event.message} (${event.queueCount} pending)`;
            // Use the plugin's oss-notify.sh if available
            const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(this.ossDir, '..');
            const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');
            if (fs.existsSync(notifyScript)) {
                execSync(`"${notifyScript}" "${title}" "${message}" critical`, {
                    timeout: 5000,
                    stdio: 'ignore',
                });
            }
            else {
                // Fallback to status line CLI - status line is the only visual notification method
                const cliPath = path.join(pluginRoot, 'watcher', 'dist', 'cli', 'update-workflow-state.js');
                if (fs.existsSync(cliPath)) {
                    execSync(`node "${cliPath}" setMessage "${title}: ${message}"`, {
                        timeout: 5000,
                        stdio: 'ignore',
                    });
                }
                // If neither available, silently fail - no visual notification
            }
        }
        catch {
            // Ignore notification errors - don't break queue operations
        }
    }
    /**
     * Initialize the queue manager - load existing queue or create new one
     */
    async initialize() {
        if (fs.existsSync(this.queuePath)) {
            const content = fs.readFileSync(this.queuePath, 'utf-8');
            this.queue = JSON.parse(content);
        }
        else {
            this.queue = this.createEmptyQueue();
            await this.persist();
        }
    }
    /**
     * Add a new task to the queue
     */
    async addTask(input) {
        const task = {
            ...input,
            id: this.generateTaskId(),
            created_at: new Date().toISOString(),
            status: 'pending',
            attempts: 0,
        };
        this.queue.tasks.push(task);
        this.sortByPriority();
        // Enforce max queue size
        await this.enforceMaxSize();
        await this.persist();
        // Emit event for debugging
        const pendingCount = this.queue.tasks.filter(t => t.status === 'pending').length;
        this.emitEvent({
            type: 'task_added',
            task,
            queueCount: pendingCount,
            message: `Added: ${task.anomaly_type}`,
        });
        return task;
    }
    /**
     * Get the next pending task (highest priority, oldest first)
     */
    async getNextTask() {
        const pendingTasks = this.queue.tasks.filter(t => t.status === 'pending');
        return pendingTasks.length > 0 ? pendingTasks[0] : null;
    }
    /**
     * Get all tasks in the queue
     */
    async getTasks() {
        return [...this.queue.tasks];
    }
    /**
     * Update a task by ID
     */
    async updateTask(id, updates) {
        const taskIndex = this.queue.tasks.findIndex(t => t.id === id);
        if (taskIndex === -1) {
            throw new Error('Task not found');
        }
        const task = this.queue.tasks[taskIndex];
        const wasCompleted = task.status === 'completed';
        const wasFailed = task.status === 'failed';
        // Auto-set completed_at when status changes to completed
        if (updates.status === 'completed' && task.status !== 'completed') {
            updates.completed_at = new Date().toISOString();
        }
        this.queue.tasks[taskIndex] = { ...task, ...updates };
        await this.persist();
        // Emit events for status changes
        const pendingCount = this.queue.tasks.filter(t => t.status === 'pending').length;
        if (updates.status === 'completed' && !wasCompleted) {
            this.emitEvent({
                type: 'task_completed',
                task: this.queue.tasks[taskIndex],
                queueCount: pendingCount,
                message: `Completed: ${task.anomaly_type}`,
            });
        }
        else if (updates.status === 'failed' && !wasFailed) {
            this.emitEvent({
                type: 'task_failed',
                task: this.queue.tasks[taskIndex],
                queueCount: pendingCount,
                message: `Failed: ${task.anomaly_type}`,
            });
        }
    }
    /**
     * Remove a task by ID
     */
    async removeTask(id) {
        const task = this.queue.tasks.find(t => t.id === id);
        this.queue.tasks = this.queue.tasks.filter(t => t.id !== id);
        await this.persist();
        // Emit event for debugging
        const pendingCount = this.queue.tasks.filter(t => t.status === 'pending').length;
        this.emitEvent({
            type: 'task_removed',
            task,
            queueCount: pendingCount,
            message: task ? `Removed: ${task.anomaly_type}` : 'Removed task',
        });
    }
    /**
     * Get count of pending tasks
     */
    async getPendingCount() {
        return this.queue.tasks.filter(t => t.status === 'pending').length;
    }
    /**
     * Get count of tasks by priority
     */
    async getCountByPriority() {
        const counts = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
        };
        for (const task of this.queue.tasks) {
            if (task.status === 'pending') {
                counts[task.priority]++;
            }
        }
        return counts;
    }
    /**
     * Move a task to the failed queue
     */
    async moveToFailed(id, error) {
        const task = this.queue.tasks.find(t => t.id === id);
        if (!task) {
            throw new Error('Task not found');
        }
        const archivedTask = {
            ...task,
            status: 'failed',
            error,
            archived_at: new Date().toISOString(),
            archive_reason: 'failed',
        };
        await this.appendToArchive(this.failedQueuePath, archivedTask);
        await this.removeTask(id);
    }
    /**
     * Clear all tasks from the queue
     */
    async clear() {
        const previousCount = this.queue.tasks.length;
        this.queue.tasks = [];
        await this.persist();
        // Emit event for debugging
        if (previousCount > 0) {
            this.emitEvent({
                type: 'queue_cleared',
                queueCount: 0,
                message: `Cleared ${previousCount} task(s)`,
            });
        }
    }
    // Private methods
    createEmptyQueue() {
        return {
            version: '1.0',
            updated_at: new Date().toISOString(),
            tasks: [],
        };
    }
    generateTaskId() {
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const time = now.toISOString().slice(11, 19).replace(/:/g, '');
        const random = Math.random().toString(36).slice(2, 6);
        return `task-${date}-${time}-${random}`;
    }
    sortByPriority() {
        this.queue.tasks.sort((a, b) => {
            // First by priority
            const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
            if (priorityDiff !== 0)
                return priorityDiff;
            // Then by creation time (older first)
            return a.created_at.localeCompare(b.created_at);
        });
    }
    async enforceMaxSize() {
        if (this.queue.tasks.length <= this.maxQueueSize) {
            return;
        }
        // Find and remove lowest priority, oldest tasks
        // Start from the end (lowest priority) and work backwards
        const sortedByDropPriority = [...this.queue.tasks].sort((a, b) => {
            // Higher number = lower priority = drop first
            const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
            if (priorityDiff !== 0)
                return priorityDiff;
            // Older tasks dropped first within same priority
            return a.created_at.localeCompare(b.created_at);
        });
        const tasksToDrop = this.queue.tasks.length - this.maxQueueSize;
        const droppedTasks = sortedByDropPriority.slice(0, tasksToDrop);
        for (const task of droppedTasks) {
            const archivedTask = {
                ...task,
                archived_at: new Date().toISOString(),
                archive_reason: 'dropped',
            };
            await this.appendToArchive(this.expiredQueuePath, archivedTask);
            this.queue.tasks = this.queue.tasks.filter(t => t.id !== task.id);
        }
    }
    async appendToArchive(archivePath, task) {
        let archive;
        if (fs.existsSync(archivePath)) {
            const content = fs.readFileSync(archivePath, 'utf-8');
            archive = JSON.parse(content);
        }
        else {
            archive = {
                version: '1.0',
                updated_at: new Date().toISOString(),
                tasks: [],
            };
        }
        archive.tasks.push(task);
        archive.updated_at = new Date().toISOString();
        // Atomic write
        const tempPath = `${archivePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(archive, null, 2));
        fs.renameSync(tempPath, archivePath);
    }
    async persist() {
        this.queue.updated_at = new Date().toISOString();
        // Atomic write: write to temp file, then rename
        const tempPath = `${this.queuePath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(this.queue, null, 2));
        fs.renameSync(tempPath, this.queuePath);
    }
}
//# sourceMappingURL=manager.js.map