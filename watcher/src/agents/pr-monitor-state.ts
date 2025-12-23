/**
 * PR Monitor State
 *
 * Manages persistent state for the PR monitor agent.
 * Tracks processed comment IDs to avoid duplicate handling.
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Stats tracked by the PR monitor
 */
export interface PRMonitorStats {
  commentsProcessed: number;
  tasksQueued: number;
  tasksCompleted: number;
  tasksFailed: number;
}

/**
 * Comment entry with timestamp for TTL
 */
interface ProcessedComment {
  id: string;
  processedAt: string;
}

/**
 * Serialized state format
 */
interface PRMonitorStateData {
  processedCommentIds: string[];
  processedComments?: ProcessedComment[];
  lastPollTime: string | null;
  lastError: string | null;
  stats: PRMonitorStats;
}

/**
 * TTL for processed comment IDs (30 days in milliseconds)
 */
const COMMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Default state file path
 */
const STATE_FILE = '.oss/pr-monitor-state.json';

/**
 * Manages PR monitor state with persistence
 */
export class PRMonitorState {
  private processedCommentIds: Set<string> = new Set();
  private processedComments: Map<string, string> = new Map(); // id -> processedAt
  private lastPollTime: string | null = null;
  private lastError: string | null = null;
  private stats: PRMonitorStats = {
    commentsProcessed: 0,
    tasksQueued: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
  };

  /**
   * Load state from file
   */
  async load(): Promise<void> {
    const filePath = path.join(process.cwd(), STATE_FILE);

    try {
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      const data: PRMonitorStateData = JSON.parse(content);

      // Load processedComments with TTL support
      if (data.processedComments) {
        // New format with timestamps
        for (const entry of data.processedComments) {
          this.processedComments.set(entry.id, entry.processedAt);
          this.processedCommentIds.add(entry.id);
        }
      } else {
        // Legacy format without timestamps - migrate
        this.processedCommentIds = new Set(data.processedCommentIds);
        const now = new Date().toISOString();
        for (const id of data.processedCommentIds) {
          this.processedComments.set(id, now);
        }
      }

      this.lastPollTime = data.lastPollTime;
      this.lastError = data.lastError;
      this.stats = data.stats;

      // Clean up expired entries
      this.cleanupExpiredComments();
    } catch {
      // File doesn't exist or is invalid, use defaults
      this.processedCommentIds = new Set();
      this.processedComments = new Map();
      this.lastPollTime = null;
      this.lastError = null;
      this.stats = {
        commentsProcessed: 0,
        tasksQueued: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
      };
    }
  }

  /**
   * Remove comment entries older than TTL
   */
  private cleanupExpiredComments(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, processedAt] of this.processedComments.entries()) {
      const processedTime = new Date(processedAt).getTime();
      if (now - processedTime > COMMENT_TTL_MS) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.processedComments.delete(id);
      this.processedCommentIds.delete(id);
    }
  }

  /**
   * Save state to file
   */
  async save(): Promise<void> {
    const filePath = path.join(process.cwd(), STATE_FILE);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Clean up expired entries before saving
    this.cleanupExpiredComments();

    // Build processedComments array with timestamps
    const processedComments: ProcessedComment[] = [];
    for (const [id, processedAt] of this.processedComments.entries()) {
      processedComments.push({ id, processedAt });
    }

    const data: PRMonitorStateData = {
      processedCommentIds: Array.from(this.processedCommentIds),
      processedComments,
      lastPollTime: this.lastPollTime,
      lastError: this.lastError,
      stats: this.stats,
    };

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Add a comment ID to the processed set
   */
  addProcessedComment(id: string): void {
    this.processedCommentIds.add(id);
    this.processedComments.set(id, new Date().toISOString());
  }

  /**
   * Check if a comment has been processed
   */
  isProcessed(id: string): boolean {
    return this.processedCommentIds.has(id);
  }

  /**
   * Update the last poll time to now
   */
  updateLastPollTime(): void {
    this.lastPollTime = new Date().toISOString();
  }

  /**
   * Get the last poll time
   */
  getLastPollTime(): string | null {
    return this.lastPollTime;
  }

  /**
   * Set the last error
   */
  setLastError(error: string | null): void {
    this.lastError = error;
  }

  /**
   * Increment a stat counter
   */
  incrementStat(stat: keyof PRMonitorStats): void {
    this.stats[stat]++;
  }

  /**
   * Get all stats
   */
  getStats(): PRMonitorStats {
    return { ...this.stats };
  }
}
