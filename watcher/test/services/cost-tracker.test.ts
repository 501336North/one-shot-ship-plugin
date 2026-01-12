/**
 * @file Cost Tracker Tests
 * @behavior CostTracker tracks tokens and calculates costs per request
 * @acceptance-criteria AC-COST.1 through AC-COST.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll implement CostTracker
import { CostTracker, UsageRecord } from '../../src/services/cost-tracker.js';

describe('CostTracker', () => {
  let tracker: CostTracker;
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `cost-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    tracker = new CostTracker(testDir);
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('recordUsage', () => {
    it('should track tokens per request', () => {
      // GIVEN - Usage data
      const usage: UsageRecord = {
        command: 'oss:ship',
        model: 'openrouter/deepseek/chat',
        inputTokens: 1000,
        outputTokens: 500,
        timestamp: new Date().toISOString(),
      };

      // WHEN - Record usage
      tracker.recordUsage(usage);

      // THEN - Usage is tracked
      const stats = tracker.getStats();
      expect(stats.totalTokens).toBe(1500);
    });

    it('should accumulate multiple requests', () => {
      // GIVEN - Multiple usage records
      tracker.recordUsage({
        command: 'oss:ship',
        model: 'openrouter/deepseek/chat',
        inputTokens: 1000,
        outputTokens: 500,
        timestamp: new Date().toISOString(),
      });

      tracker.recordUsage({
        command: 'oss:review',
        model: 'openai/gpt-4o',
        inputTokens: 2000,
        outputTokens: 800,
        timestamp: new Date().toISOString(),
      });

      // THEN - Total tokens accumulated
      const stats = tracker.getStats();
      expect(stats.totalTokens).toBe(4300);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost based on model pricing', () => {
      // GIVEN - Usage with GPT-4o
      tracker.recordUsage({
        command: 'oss:review',
        model: 'openai/gpt-4o',
        inputTokens: 10000,
        outputTokens: 2000,
        timestamp: new Date().toISOString(),
      });

      // WHEN - Get cost
      const stats = tracker.getStats();

      // THEN - Cost calculated based on GPT-4o pricing
      // GPT-4o: $2.50/1M input, $10/1M output
      // Input: 10000 * 2.50 / 1000000 = 0.025
      // Output: 2000 * 10 / 1000000 = 0.02
      // Total: 0.045
      expect(stats.totalCostUsd).toBeCloseTo(0.045, 3);
    });

    it('should return zero cost for local models', () => {
      // GIVEN - Usage with Ollama (local)
      tracker.recordUsage({
        command: 'oss:build',
        model: 'ollama/codellama',
        inputTokens: 5000,
        outputTokens: 2000,
        timestamp: new Date().toISOString(),
      });

      // THEN - Cost is zero (local model)
      const stats = tracker.getStats();
      expect(stats.totalCostUsd).toBe(0);
    });

    it('should handle default/claude model with zero cost', () => {
      // Claude is handled by user's account, not our cost
      tracker.recordUsage({
        command: 'oss:ideate',
        model: 'default',
        inputTokens: 3000,
        outputTokens: 1000,
        timestamp: new Date().toISOString(),
      });

      const stats = tracker.getStats();
      expect(stats.totalCostUsd).toBe(0);
    });
  });

  describe('getUsageByDate', () => {
    it('should return usage for a specific date', () => {
      // GIVEN - Usage records
      const today = new Date().toISOString().split('T')[0];
      tracker.recordUsage({
        command: 'oss:ship',
        model: 'openrouter/deepseek/chat',
        inputTokens: 1000,
        outputTokens: 500,
        timestamp: new Date().toISOString(),
      });

      // WHEN - Get usage by date
      const usage = tracker.getUsageByDate(today);

      // THEN - Usage returned
      expect(usage).toBeDefined();
      expect(usage.totalTokens).toBe(1500);
    });

    it('should return empty usage for dates with no data', () => {
      const usage = tracker.getUsageByDate('2020-01-01');
      expect(usage.totalTokens).toBe(0);
    });
  });

  describe('getUsageByCommand', () => {
    it('should aggregate usage by command', () => {
      // GIVEN - Multiple usage records for same command
      tracker.recordUsage({
        command: 'oss:ship',
        model: 'openrouter/deepseek/chat',
        inputTokens: 1000,
        outputTokens: 500,
        timestamp: new Date().toISOString(),
      });

      tracker.recordUsage({
        command: 'oss:ship',
        model: 'openrouter/deepseek/chat',
        inputTokens: 2000,
        outputTokens: 1000,
        timestamp: new Date().toISOString(),
      });

      // WHEN - Get by command
      const usage = tracker.getUsageByCommand('oss:ship');

      // THEN - Aggregated
      expect(usage.totalTokens).toBe(4500);
      expect(usage.requests).toBe(2);
    });
  });

  describe('persistence', () => {
    it('should persist usage to file', async () => {
      // GIVEN - Usage recorded
      tracker.recordUsage({
        command: 'test',
        model: 'test',
        inputTokens: 100,
        outputTokens: 50,
        timestamp: new Date().toISOString(),
      });

      // WHEN - Flush to disk
      await tracker.flush();

      // THEN - File exists
      const usagePath = path.join(testDir, 'usage.json');
      expect(fs.existsSync(usagePath)).toBe(true);
    });

    it('should load persisted usage on init', async () => {
      // GIVEN - Usage recorded and flushed
      tracker.recordUsage({
        command: 'test',
        model: 'test',
        inputTokens: 100,
        outputTokens: 50,
        timestamp: new Date().toISOString(),
      });
      await tracker.flush();

      // WHEN - Create new tracker instance
      const newTracker = new CostTracker(testDir);
      await newTracker.load();

      // THEN - Usage loaded
      const stats = newTracker.getStats();
      expect(stats.totalTokens).toBe(150);
    });
  });
});
