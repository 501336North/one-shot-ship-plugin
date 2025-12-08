import { Task, Priority, CreateTaskInput } from '../types.js';
/**
 * Queue event listener callback type
 */
export type QueueEventCallback = (event: QueueEvent) => void;
/**
 * Queue event for debugging/notifications
 */
export interface QueueEvent {
    type: 'task_added' | 'task_removed' | 'task_completed' | 'task_failed' | 'queue_cleared';
    task?: Task;
    queueCount: number;
    message: string;
}
/**
 * Queue Manager - Handles task persistence and ordering
 *
 * Implements AC-007.1 through AC-007.5 from REQUIREMENTS.md
 */
export declare class QueueManager {
    private readonly queuePath;
    private readonly failedQueuePath;
    private readonly expiredQueuePath;
    private queue;
    private readonly maxQueueSize;
    private readonly ossDir;
    private debugNotifications;
    private eventListeners;
    constructor(ossDir: string, maxQueueSize?: number);
    /**
     * Enable or disable debug notifications
     */
    setDebugNotifications(enabled: boolean): void;
    /**
     * Register an event listener for queue operations
     */
    addEventListener(callback: QueueEventCallback): void;
    /**
     * Remove an event listener
     */
    removeEventListener(callback: QueueEventCallback): void;
    /**
     * Emit a queue event to all listeners and send debug notification
     */
    private emitEvent;
    /**
     * Send a debug notification via terminal-notifier
     */
    private sendDebugNotification;
    /**
     * Initialize the queue manager - load existing queue or create new one
     */
    initialize(): Promise<void>;
    /**
     * Add a new task to the queue
     */
    addTask(input: CreateTaskInput): Promise<Task>;
    /**
     * Get the next pending task (highest priority, oldest first)
     */
    getNextTask(): Promise<Task | null>;
    /**
     * Get all tasks in the queue
     */
    getTasks(): Promise<Task[]>;
    /**
     * Update a task by ID
     */
    updateTask(id: string, updates: Partial<Task>): Promise<void>;
    /**
     * Remove a task by ID
     */
    removeTask(id: string): Promise<void>;
    /**
     * Get count of pending tasks
     */
    getPendingCount(): Promise<number>;
    /**
     * Get count of tasks by priority
     */
    getCountByPriority(): Promise<Record<Priority, number>>;
    /**
     * Move a task to the failed queue
     */
    moveToFailed(id: string, error: string): Promise<void>;
    /**
     * Clear all tasks from the queue
     */
    clear(): Promise<void>;
    private createEmptyQueue;
    private generateTaskId;
    private sortByPriority;
    private enforceMaxSize;
    private appendToArchive;
    private persist;
}
//# sourceMappingURL=manager.d.ts.map