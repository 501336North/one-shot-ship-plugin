import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { QueueManager } from '../src/queue/manager';
import { Task, Priority, CreateTaskInput } from '../src/types';

/**
 * @behavior Queue manager handles task persistence and ordering
 * @acceptance-criteria AC-007.1, AC-007.2, AC-007.3, AC-007.4, AC-007.5
 */
describe('QueueManager', () => {
  let testDir: string;
  let ossDir: string;
  let manager: QueueManager;

  beforeEach(() => {
    // Create unique temp directory for each test
    testDir = path.join(os.tmpdir(), `oss-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    ossDir = path.join(testDir, '.oss');
    fs.mkdirSync(ossDir, { recursive: true });
    manager = new QueueManager(ossDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Helper to create test task input
  const createTestTaskInput = (overrides: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    priority: 'medium',
    source: 'test-monitor',
    anomaly_type: 'test_failure',
    prompt: 'Fix the failing test',
    suggested_agent: 'debugger',
    context: { test_file: 'foo.test.ts' },
    ...overrides,
  });

  // AC-007.1: Queue stored in .oss/queue.json
  describe('file persistence', () => {
    it('should create queue.json if not exists', async () => {
      await manager.initialize();
      const queuePath = path.join(ossDir, 'queue.json');
      expect(fs.existsSync(queuePath)).toBe(true);
    });

    it('should create valid queue structure', async () => {
      await manager.initialize();
      const queuePath = path.join(ossDir, 'queue.json');
      const content = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      expect(content.version).toBe('1.0');
      expect(content.tasks).toEqual([]);
      expect(content.updated_at).toBeDefined();
    });

    it('should load existing queue on initialize', async () => {
      // Setup: Create queue with tasks
      const existingQueue = {
        version: '1.0',
        updated_at: new Date().toISOString(),
        tasks: [{
          id: 'task-existing-1',
          created_at: new Date().toISOString(),
          priority: 'high',
          source: 'manual',
          anomaly_type: 'exception',
          prompt: 'Test prompt',
          suggested_agent: 'debugger',
          context: {},
          status: 'pending',
          attempts: 0,
        }],
      };
      fs.writeFileSync(path.join(ossDir, 'queue.json'), JSON.stringify(existingQueue));

      // Act
      await manager.initialize();
      const tasks = await manager.getTasks();

      // Assert
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-existing-1');
    });

    it('should persist queue after addTask', async () => {
      await manager.initialize();
      await manager.addTask(createTestTaskInput());

      // Read file directly
      const queuePath = path.join(ossDir, 'queue.json');
      const content = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      expect(content.tasks).toHaveLength(1);
    });

    it('should persist queue after removeTask', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());
      await manager.removeTask(task.id);

      const queuePath = path.join(ossDir, 'queue.json');
      const content = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      expect(content.tasks).toHaveLength(0);
    });
  });

  // AC-007.2: Tasks sorted by priority
  describe('priority ordering', () => {
    it('should return critical tasks before high', async () => {
      await manager.initialize();

      // Add high first, then critical
      await manager.addTask(createTestTaskInput({ priority: 'high' }));
      await manager.addTask(createTestTaskInput({ priority: 'critical' }));

      const nextTask = await manager.getNextTask();
      expect(nextTask?.priority).toBe('critical');
    });

    it('should return high tasks before medium', async () => {
      await manager.initialize();

      await manager.addTask(createTestTaskInput({ priority: 'medium' }));
      await manager.addTask(createTestTaskInput({ priority: 'high' }));

      const nextTask = await manager.getNextTask();
      expect(nextTask?.priority).toBe('high');
    });

    it('should return medium tasks before low', async () => {
      await manager.initialize();

      await manager.addTask(createTestTaskInput({ priority: 'low' }));
      await manager.addTask(createTestTaskInput({ priority: 'medium' }));

      const nextTask = await manager.getNextTask();
      expect(nextTask?.priority).toBe('medium');
    });

    it('should return same-priority tasks by creation time (older first)', async () => {
      await manager.initialize();

      const task1 = await manager.addTask(createTestTaskInput({
        priority: 'high',
        prompt: 'First task',
      }));

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      await manager.addTask(createTestTaskInput({
        priority: 'high',
        prompt: 'Second task',
      }));

      const nextTask = await manager.getNextTask();
      expect(nextTask?.id).toBe(task1.id);
      expect(nextTask?.prompt).toBe('First task');
    });

    it('should maintain sort order after task removal', async () => {
      await manager.initialize();

      const criticalTask = await manager.addTask(createTestTaskInput({ priority: 'critical' }));
      await manager.addTask(createTestTaskInput({ priority: 'high' }));
      await manager.addTask(createTestTaskInput({ priority: 'medium' }));

      await manager.removeTask(criticalTask.id);

      const nextTask = await manager.getNextTask();
      expect(nextTask?.priority).toBe('high');
    });
  });

  // AC-007.3: Task includes required fields
  describe('task structure', () => {
    it('should generate unique task ID', async () => {
      await manager.initialize();

      const task1 = await manager.addTask(createTestTaskInput());
      const task2 = await manager.addTask(createTestTaskInput());

      expect(task1.id).toBeDefined();
      expect(task2.id).toBeDefined();
      expect(task1.id).not.toBe(task2.id);
    });

    it('should generate ID in correct format', async () => {
      await manager.initialize();

      const task = await manager.addTask(createTestTaskInput());

      // Format: task-YYYYMMDD-HHMMSS-xxxx
      expect(task.id).toMatch(/^task-\d{8}-\d{6}-[a-z0-9]{4}$/);
    });

    it('should set created_at as valid ISO 8601 timestamp', async () => {
      await manager.initialize();

      const before = new Date().toISOString();
      const task = await manager.addTask(createTestTaskInput());
      const after = new Date().toISOString();

      expect(task.created_at).toBeDefined();
      expect(new Date(task.created_at).toISOString()).toBe(task.created_at);
      expect(task.created_at >= before).toBe(true);
      expect(task.created_at <= after).toBe(true);
    });

    it('should set initial status to pending', async () => {
      await manager.initialize();

      const task = await manager.addTask(createTestTaskInput());

      expect(task.status).toBe('pending');
    });

    it('should set initial attempts to 0', async () => {
      await manager.initialize();

      const task = await manager.addTask(createTestTaskInput());

      expect(task.attempts).toBe(0);
    });

    it('should accept and persist all required fields', async () => {
      await manager.initialize();

      const input = createTestTaskInput({
        priority: 'critical',
        source: 'log-monitor',
        anomaly_type: 'agent_loop',
        prompt: 'Fix the loop',
        suggested_agent: 'test-engineer',
        context: {
          file: 'src/foo.ts',
          line: 42,
          repeat_count: 7,
        },
        report_path: '.oss/reports/test-report.md',
      });

      const task = await manager.addTask(input);

      expect(task.priority).toBe('critical');
      expect(task.source).toBe('log-monitor');
      expect(task.anomaly_type).toBe('agent_loop');
      expect(task.prompt).toBe('Fix the loop');
      expect(task.suggested_agent).toBe('test-engineer');
      expect(task.context.file).toBe('src/foo.ts');
      expect(task.context.line).toBe(42);
      expect(task.context.repeat_count).toBe(7);
      expect(task.report_path).toBe('.oss/reports/test-report.md');
    });
  });

  // AC-007.4: Queue persists across sessions
  describe('session persistence', () => {
    it('should reload queue after process restart (new instance)', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput({ prompt: 'Persistent task' }));

      // Create new manager instance (simulates restart)
      const newManager = new QueueManager(ossDir);
      await newManager.initialize();
      const tasks = await newManager.getTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(task.id);
      expect(tasks[0].prompt).toBe('Persistent task');
    });

    it('should preserve task status across restarts', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());
      await manager.updateTask(task.id, { status: 'executing', attempts: 1 });

      // Create new manager instance
      const newManager = new QueueManager(ossDir);
      await newManager.initialize();
      const tasks = await newManager.getTasks();

      expect(tasks[0].status).toBe('executing');
      expect(tasks[0].attempts).toBe(1);
    });
  });

  // AC-007.5: Queue capped at 50 tasks
  describe('queue overflow', () => {
    it('should enforce max queue size of 50', async () => {
      await manager.initialize();

      // Add 50 low-priority tasks
      for (let i = 0; i < 50; i++) {
        await manager.addTask(createTestTaskInput({
          priority: 'low',
          prompt: `Task ${i}`,
        }));
      }

      // Add 51st task (critical)
      await manager.addTask(createTestTaskInput({
        priority: 'critical',
        prompt: 'Critical task',
      }));

      const tasks = await manager.getTasks();
      expect(tasks.length).toBe(50);
    });

    it('should drop oldest low-priority when exceeding 50', async () => {
      await manager.initialize();

      // Add 50 low-priority tasks
      const firstTaskPrompt = 'Task 0';
      for (let i = 0; i < 50; i++) {
        await manager.addTask(createTestTaskInput({
          priority: 'low',
          prompt: `Task ${i}`,
        }));
      }

      // Add 51st task (critical)
      await manager.addTask(createTestTaskInput({
        priority: 'critical',
        prompt: 'Critical task',
      }));

      const tasks = await manager.getTasks();

      // First task should be dropped
      const hasFirstTask = tasks.some(t => t.prompt === firstTaskPrompt);
      expect(hasFirstTask).toBe(false);

      // Critical task should be present
      const hasCriticalTask = tasks.some(t => t.prompt === 'Critical task');
      expect(hasCriticalTask).toBe(true);
    });

    it('should prefer dropping low priority over higher priority', async () => {
      await manager.initialize();

      // Add 25 high + 25 low priority tasks
      for (let i = 0; i < 25; i++) {
        await manager.addTask(createTestTaskInput({
          priority: 'high',
          prompt: `High ${i}`,
        }));
        await manager.addTask(createTestTaskInput({
          priority: 'low',
          prompt: `Low ${i}`,
        }));
      }

      // Add critical task (should drop a low-priority task)
      await manager.addTask(createTestTaskInput({
        priority: 'critical',
        prompt: 'Critical task',
      }));

      const tasks = await manager.getTasks();
      const highCount = tasks.filter(t => t.priority === 'high').length;
      const lowCount = tasks.filter(t => t.priority === 'low').length;

      expect(highCount).toBe(25); // All high priority kept
      expect(lowCount).toBe(24); // One low priority dropped
    });

    it('should archive dropped tasks to queue-expired.json', async () => {
      await manager.initialize();

      // Add 51 tasks
      for (let i = 0; i < 51; i++) {
        await manager.addTask(createTestTaskInput({
          priority: 'low',
          prompt: `Task ${i}`,
        }));
      }

      // Check expired queue
      const expiredPath = path.join(ossDir, 'queue-expired.json');
      expect(fs.existsSync(expiredPath)).toBe(true);

      const expired = JSON.parse(fs.readFileSync(expiredPath, 'utf-8'));
      expect(expired.tasks.length).toBeGreaterThan(0);
      expect(expired.tasks[0].archive_reason).toBe('dropped');
    });
  });

  // Additional tests for updateTask and error handling
  describe('task updates', () => {
    it('should update task status', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());

      await manager.updateTask(task.id, { status: 'executing' });

      const tasks = await manager.getTasks();
      expect(tasks[0].status).toBe('executing');
    });

    it('should update task attempts', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());

      await manager.updateTask(task.id, { attempts: 2 });

      const tasks = await manager.getTasks();
      expect(tasks[0].attempts).toBe(2);
    });

    it('should set completed_at when status changes to completed', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());

      await manager.updateTask(task.id, { status: 'completed' });

      const tasks = await manager.getTasks();
      expect(tasks[0].completed_at).toBeDefined();
    });

    it('should set error message when status changes to failed', async () => {
      await manager.initialize();
      const task = await manager.addTask(createTestTaskInput());

      await manager.updateTask(task.id, { status: 'failed', error: 'Execution error' });

      const tasks = await manager.getTasks();
      expect(tasks[0].error).toBe('Execution error');
    });

    it('should throw error for non-existent task', async () => {
      await manager.initialize();

      await expect(manager.updateTask('non-existent-id', { status: 'executing' }))
        .rejects.toThrow('Task not found');
    });
  });

  // Pending tasks filter
  describe('pending tasks', () => {
    it('should only return pending tasks from getNextTask', async () => {
      await manager.initialize();

      const task1 = await manager.addTask(createTestTaskInput({ priority: 'high' }));
      await manager.addTask(createTestTaskInput({ priority: 'critical' }));

      // Mark high priority as executing
      await manager.updateTask(task1.id, { status: 'executing' });

      // Add another critical but mark as completed
      const task3 = await manager.addTask(createTestTaskInput({ priority: 'critical' }));
      await manager.updateTask(task3.id, { status: 'completed' });

      // Should get the remaining pending critical task
      const nextTask = await manager.getNextTask();
      expect(nextTask?.status).toBe('pending');
    });

    it('should return null when no pending tasks', async () => {
      await manager.initialize();

      const task = await manager.addTask(createTestTaskInput());
      await manager.updateTask(task.id, { status: 'completed' });

      const nextTask = await manager.getNextTask();
      expect(nextTask).toBeNull();
    });
  });

  // Task count
  describe('task counting', () => {
    it('should return count of pending tasks', async () => {
      await manager.initialize();

      await manager.addTask(createTestTaskInput());
      await manager.addTask(createTestTaskInput());
      const task3 = await manager.addTask(createTestTaskInput());
      await manager.updateTask(task3.id, { status: 'completed' });

      const count = await manager.getPendingCount();
      expect(count).toBe(2);
    });

    it('should return count by priority', async () => {
      await manager.initialize();

      await manager.addTask(createTestTaskInput({ priority: 'critical' }));
      await manager.addTask(createTestTaskInput({ priority: 'high' }));
      await manager.addTask(createTestTaskInput({ priority: 'high' }));
      await manager.addTask(createTestTaskInput({ priority: 'low' }));

      const counts = await manager.getCountByPriority();
      expect(counts.critical).toBe(1);
      expect(counts.high).toBe(2);
      expect(counts.medium).toBe(0);
      expect(counts.low).toBe(1);
    });
  });
});
