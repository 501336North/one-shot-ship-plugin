import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { checkQueue } from '../../src/healthchecks/queue.js';
import type { QueueManager } from '../../src/queue/manager.js';

// Mock QueueManager
const createMockQueueManager = (): QueueManager => ({
  getPendingCount: vi.fn(),
  getTasks: vi.fn(),
  // Add other methods as stubs (not used in this check)
  initialize: vi.fn(),
  addTask: vi.fn(),
  getNextTask: vi.fn(),
  updateTask: vi.fn(),
  removeTask: vi.fn(),
  getCountByPriority: vi.fn(),
  moveToFailed: vi.fn(),
  clear: vi.fn(),
  setDebugNotifications: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
} as unknown as QueueManager);

// Mock fs module
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
  },
}));

const mockFs = fs as {
  stat: ReturnType<typeof vi.fn>;
};

describe('QueueHealthCheck', () => {
  let mockQueueManager: QueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueManager = createMockQueueManager();
  });

  /**
   * @behavior Queue system processes tasks without accumulation
   * @acceptance-criteria AC-QUEUE-001: Queue empty or processing normally = pass
   * @business-rule BR-QUEUE-001: Queue must not accumulate unbounded tasks
   * @boundary QueueManager
   */
  it('should pass when queue is empty or processing normally', async () => {
    // GIVEN - Queue with few pending tasks and no failures
    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
      { id: 'task-2', created_at: new Date(Date.now() - 3000).toISOString(), status: 'pending' as const },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(2);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health
    const result = await checkQueue({ queueManager: mockQueueManager });

    // THEN - Should pass
    expect(result.status).toBe('pass');
  });

  /**
   * @behavior Detect stuck tasks in queue
   * @acceptance-criteria AC-QUEUE-002: Tasks >10 min old = warn
   * @business-rule BR-QUEUE-002: Tasks must not get stuck
   * @boundary QueueManager
   */
  it('should warn when queue has stuck tasks (>10 min old)', async () => {
    // GIVEN - Queue with old pending task (15 minutes)
    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), status: 'pending' as const },
      { id: 'task-2', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(2);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health
    const result = await checkQueue({ queueManager: mockQueueManager });

    // THEN - Should warn about stuck tasks
    expect(result.status).toBe('warn');
    expect(result.message).toContain('stuck');
  });

  /**
   * @behavior Detect excessive failures
   * @acceptance-criteria AC-QUEUE-003: >5 failed tasks = fail
   * @business-rule BR-QUEUE-003: High failure rate indicates system issues
   * @boundary QueueManager
   */
  it('should fail when queue has too many failed tasks (>5)', async () => {
    // GIVEN - Queue with many failed tasks
    const tasks = [
      { id: 'task-1', status: 'failed' as const, created_at: new Date().toISOString() },
      { id: 'task-2', status: 'failed' as const, created_at: new Date().toISOString() },
      { id: 'task-3', status: 'failed' as const, created_at: new Date().toISOString() },
      { id: 'task-4', status: 'failed' as const, created_at: new Date().toISOString() },
      { id: 'task-5', status: 'failed' as const, created_at: new Date().toISOString() },
      { id: 'task-6', status: 'failed' as const, created_at: new Date().toISOString() },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(0);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health
    const result = await checkQueue({ queueManager: mockQueueManager });

    // THEN - Should fail
    expect(result.status).toBe('fail');
  });

  /**
   * @behavior Report queue statistics
   * @acceptance-criteria AC-QUEUE-004: Report pending count, failed count, oldest task age
   * @business-rule BR-QUEUE-004: Observability requires queue metrics
   * @boundary QueueManager
   */
  it('should report queue depth and age stats', async () => {
    // GIVEN - Queue with various tasks
    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 30000).toISOString(), status: 'pending' as const },
      { id: 'task-2', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
      { id: 'task-3', status: 'failed' as const, created_at: new Date().toISOString() },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(2);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health
    const result = await checkQueue({ queueManager: mockQueueManager });

    // THEN - Should report all stats
    expect(result.details).toHaveProperty('pending_count');
    expect(result.details).toHaveProperty('failed_count');
    expect(result.details).toHaveProperty('oldest_task_age_ms');
    expect(result.details?.pending_count).toBe(2);
    expect(result.details?.failed_count).toBe(1);
  });

  /**
   * @behavior Verify supervisor is alive
   * @acceptance-criteria AC-QUEUE-005: Supervisor heartbeat >5min = warn
   * @business-rule BR-QUEUE-005: Supervisor must be actively managing queue
   * @boundary Filesystem
   */
  it('should verify supervisor heartbeat is recent', async () => {
    // GIVEN - Stale supervisor state file (10 minutes old)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: tenMinutesAgo } as any);

    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(1);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health with state path
    const statePath = '/mock/path/workflow-state.json';
    const result = await checkQueue({ queueManager: mockQueueManager, statePath });

    // THEN - Should warn about stale supervisor
    expect(result.status).toBe('warn');
    expect(result.message.toLowerCase()).toContain('supervisor');
  });

  /**
   * @behavior Handle missing supervisor state gracefully
   * @acceptance-criteria AC-QUEUE-006: Missing state file = warn (supervisor may not be running)
   * @business-rule BR-QUEUE-006: Supervisor state must exist for active monitoring
   * @boundary Filesystem
   */
  it('should warn when supervisor state file is missing', async () => {
    // GIVEN - Missing supervisor state file
    mockFs.stat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(1);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health with state path
    const statePath = '/mock/path/workflow-state.json';
    const result = await checkQueue({ queueManager: mockQueueManager, statePath });

    // THEN - Should warn about missing supervisor state
    expect(result.status).toBe('warn');
    expect(result.message.toLowerCase()).toContain('supervisor');
  });

  /**
   * @behavior Pass when supervisor heartbeat is fresh
   * @acceptance-criteria AC-QUEUE-007: Supervisor heartbeat <5min = pass
   * @business-rule BR-QUEUE-007: Fresh heartbeat indicates active supervisor
   * @boundary Filesystem
   */
  it('should pass when supervisor heartbeat is recent', async () => {
    // GIVEN - Recent supervisor state file (2 minutes old)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    mockFs.stat.mockResolvedValue({ mtime: twoMinutesAgo } as any);

    const tasks = [
      { id: 'task-1', created_at: new Date(Date.now() - 5000).toISOString(), status: 'pending' as const },
    ];
    vi.mocked(mockQueueManager.getPendingCount).mockResolvedValue(1);
    vi.mocked(mockQueueManager.getTasks).mockResolvedValue(tasks as any);

    // WHEN - Check queue health with state path
    const statePath = '/mock/path/workflow-state.json';
    const result = await checkQueue({ queueManager: mockQueueManager, statePath });

    // THEN - Should pass
    expect(result.status).toBe('pass');
  });
});
