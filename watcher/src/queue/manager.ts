import * as fs from 'fs';
import * as path from 'path';
import {
  Task,
  QueueFile,
  ArchivedTask,
  ArchiveQueueFile,
  Priority,
  CreateTaskInput,
  PRIORITY_ORDER,
} from '../types.js';

/**
 * Queue Manager - Handles task persistence and ordering
 *
 * Implements AC-007.1 through AC-007.5 from REQUIREMENTS.md
 */
export class QueueManager {
  private readonly queuePath: string;
  private readonly failedQueuePath: string;
  private readonly expiredQueuePath: string;
  private queue: QueueFile;
  private readonly maxQueueSize: number;

  constructor(ossDir: string, maxQueueSize: number = 50) {
    this.queuePath = path.join(ossDir, 'queue.json');
    this.failedQueuePath = path.join(ossDir, 'queue-failed.json');
    this.expiredQueuePath = path.join(ossDir, 'queue-expired.json');
    this.maxQueueSize = maxQueueSize;
    this.queue = this.createEmptyQueue();
  }

  /**
   * Initialize the queue manager - load existing queue or create new one
   */
  async initialize(): Promise<void> {
    if (fs.existsSync(this.queuePath)) {
      const content = fs.readFileSync(this.queuePath, 'utf-8');
      this.queue = JSON.parse(content) as QueueFile;
    } else {
      this.queue = this.createEmptyQueue();
      await this.persist();
    }
  }

  /**
   * Add a new task to the queue
   */
  async addTask(input: CreateTaskInput): Promise<Task> {
    const task: Task = {
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
    return task;
  }

  /**
   * Get the next pending task (highest priority, oldest first)
   */
  async getNextTask(): Promise<Task | null> {
    const pendingTasks = this.queue.tasks.filter(t => t.status === 'pending');
    return pendingTasks.length > 0 ? pendingTasks[0] : null;
  }

  /**
   * Get all tasks in the queue
   */
  async getTasks(): Promise<Task[]> {
    return [...this.queue.tasks];
  }

  /**
   * Update a task by ID
   */
  async updateTask(id: string, updates: Partial<Task>): Promise<void> {
    const taskIndex = this.queue.tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) {
      throw new Error('Task not found');
    }

    const task = this.queue.tasks[taskIndex];

    // Auto-set completed_at when status changes to completed
    if (updates.status === 'completed' && task.status !== 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    this.queue.tasks[taskIndex] = { ...task, ...updates };
    await this.persist();
  }

  /**
   * Remove a task by ID
   */
  async removeTask(id: string): Promise<void> {
    this.queue.tasks = this.queue.tasks.filter(t => t.id !== id);
    await this.persist();
  }

  /**
   * Get count of pending tasks
   */
  async getPendingCount(): Promise<number> {
    return this.queue.tasks.filter(t => t.status === 'pending').length;
  }

  /**
   * Get count of tasks by priority
   */
  async getCountByPriority(): Promise<Record<Priority, number>> {
    const counts: Record<Priority, number> = {
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
  async moveToFailed(id: string, error: string): Promise<void> {
    const task = this.queue.tasks.find(t => t.id === id);
    if (!task) {
      throw new Error('Task not found');
    }

    const archivedTask: ArchivedTask = {
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
  async clear(): Promise<void> {
    this.queue.tasks = [];
    await this.persist();
  }

  // Private methods

  private createEmptyQueue(): QueueFile {
    return {
      version: '1.0',
      updated_at: new Date().toISOString(),
      tasks: [],
    };
  }

  private generateTaskId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toISOString().slice(11, 19).replace(/:/g, '');
    const random = Math.random().toString(36).slice(2, 6);
    return `task-${date}-${time}-${random}`;
  }

  private sortByPriority(): void {
    this.queue.tasks.sort((a, b) => {
      // First by priority
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by creation time (older first)
      return a.created_at.localeCompare(b.created_at);
    });
  }

  private async enforceMaxSize(): Promise<void> {
    if (this.queue.tasks.length <= this.maxQueueSize) {
      return;
    }

    // Find and remove lowest priority, oldest tasks
    // Start from the end (lowest priority) and work backwards
    const sortedByDropPriority = [...this.queue.tasks].sort((a, b) => {
      // Higher number = lower priority = drop first
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Older tasks dropped first within same priority
      return a.created_at.localeCompare(b.created_at);
    });

    const tasksToDrop = this.queue.tasks.length - this.maxQueueSize;
    const droppedTasks = sortedByDropPriority.slice(0, tasksToDrop);

    for (const task of droppedTasks) {
      const archivedTask: ArchivedTask = {
        ...task,
        archived_at: new Date().toISOString(),
        archive_reason: 'dropped',
      };
      await this.appendToArchive(this.expiredQueuePath, archivedTask);
      this.queue.tasks = this.queue.tasks.filter(t => t.id !== task.id);
    }
  }

  private async appendToArchive(archivePath: string, task: ArchivedTask): Promise<void> {
    let archive: ArchiveQueueFile;

    if (fs.existsSync(archivePath)) {
      const content = fs.readFileSync(archivePath, 'utf-8');
      archive = JSON.parse(content) as ArchiveQueueFile;
    } else {
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

  private async persist(): Promise<void> {
    this.queue.updated_at = new Date().toISOString();

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.queuePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.queue, null, 2));
    fs.renameSync(tempPath, this.queuePath);
  }
}
