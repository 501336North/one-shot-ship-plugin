#!/usr/bin/env node
/**
 * Drain Queue Script
 *
 * Called by preCommand hook to drain the task queue before user commands.
 * Outputs task prompts for Claude Code to execute.
 */

import * as fs from 'fs';
import * as path from 'path';
import { QueueManager } from './queue/manager.js';
import { Task } from './types.js';

async function drainQueue(): Promise<void> {
  // Find .oss directory (current working directory)
  const ossDir = path.join(process.cwd(), '.oss');

  if (!fs.existsSync(ossDir)) {
    // No .oss directory - nothing to do
    process.exit(0);
  }

  const queuePath = path.join(ossDir, 'queue.json');
  if (!fs.existsSync(queuePath)) {
    // No queue file - nothing to do
    process.exit(0);
  }

  const manager = new QueueManager(ossDir);
  await manager.initialize();

  // Get pending task count
  const pendingCount = await manager.getPendingCount();
  if (pendingCount === 0) {
    process.exit(0);
  }

  // Get next task
  const task = await manager.getNextTask();
  if (!task) {
    process.exit(0);
  }

  // Mark as executing
  await manager.updateTask(task.id, { status: 'executing', attempts: task.attempts + 1 });

  // Output the task for Claude Code to execute
  console.log(`\n--- QUEUED TASK (${pendingCount} remaining) ---`);
  console.log(`Priority: ${task.priority.toUpperCase()}`);
  console.log(`Type: ${task.anomaly_type}`);
  console.log(`Agent: ${task.suggested_agent}`);
  console.log(`\n${task.prompt}`);

  if (task.context.test_file) {
    console.log(`\nFile: ${task.context.test_file}`);
  }
  if (task.context.line) {
    console.log(`Line: ${task.context.line}`);
  }
  if (task.report_path) {
    console.log(`\nSee report: ${task.report_path}`);
  }

  console.log('\n--- END QUEUED TASK ---\n');

  // Note: Task completion is handled by the watcher observing the outcome
  // For now, we mark it as completed after output
  // In a real implementation, this would be updated based on execution result
  await manager.updateTask(task.id, { status: 'completed' });
}

drainQueue().catch((error) => {
  console.error('Error draining queue:', error);
  process.exit(1);
});
