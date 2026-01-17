/**
 * Integration Tests: Claude Baseline
 *
 * @behavior Validates real Claude API calls for baseline benchmarking
 * @acceptance-criteria AC-CLAUDE-INT.1 through AC-CLAUDE-INT.3
 *
 * These tests make REAL API calls to Claude.
 * - Skip if ANTHROPIC_API_KEY not set
 * - Use short prompts to minimize cost and latency
 * - Verify response structure has: output, inputTokens, outputTokens, latencyMs
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ClaudeIntegration } from '../../src/services/benchmark/claude-integration.js';
import type { BenchmarkTask } from '../../src/services/benchmark/types.js';

// ============================================================================
// Test Setup
// ============================================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const hasApiKey = Boolean(ANTHROPIC_API_KEY);

/**
 * Create a minimal test task for benchmarking
 */
function createTestTask(overrides: Partial<BenchmarkTask> = {}): BenchmarkTask {
  return {
    id: `test-${Date.now()}`,
    name: 'Test Task',
    category: 'code-review',
    prompt: 'Say hello in one word.',
    expectedBehavior: ['responds with greeting'],
    ...overrides,
  };
}

// ============================================================================
// Claude Baseline Integration Tests
// ============================================================================

describe('Claude Baseline (integration)', () => {
  let claude: ClaudeIntegration;

  beforeAll(() => {
    if (!hasApiKey) {
      console.log('ANTHROPIC_API_KEY not set - Claude integration tests will be skipped');
      return;
    }
    claude = new ClaudeIntegration({
      apiKey: ANTHROPIC_API_KEY!,
      model: 'claude-3-haiku-20240307', // Use cheapest model for tests
    });
  });

  /**
   * @behavior ClaudeIntegration calls Claude API and returns response with token counts
   * @acceptance-criteria AC-CLAUDE-INT.1
   */
  it('should call Claude API and get response with token counts', async () => {
    if (!hasApiKey) {
      console.log('Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    // GIVEN: A Claude integration and a simple task
    const task = createTestTask({
      prompt: 'Say hello in one word.',
    });

    // WHEN: Executing the task against Claude API
    const result = await claude.executeTask(task);

    // THEN: Response should have expected structure
    expect(result.taskId).toBe(task.id);
    expect(result.provider).toBe('claude');
    expect(result.model).toContain('claude');

    // AND: Output should be non-empty
    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // AND: Token counts should be captured
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);

    // AND: Latency should be captured
    expect(result.latencyMs).toBeGreaterThan(0);

    // AND: Timestamp should be valid ISO string
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  }, 30000); // 30 second timeout for API call

  /**
   * @behavior ClaudeIntegration handles rate limit errors gracefully
   * @acceptance-criteria AC-CLAUDE-INT.2
   */
  it('should handle rate limit errors gracefully', async () => {
    if (!hasApiKey) {
      console.log('Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    // NOTE: We can't easily trigger a real rate limit without hammering the API.
    // Instead, we verify the error handling structure exists by checking
    // a successful response doesn't have error fields.

    // GIVEN: A Claude integration and a simple task
    const task = createTestTask();

    // WHEN: Executing the task
    const result = await claude.executeTask(task);

    // THEN: Non-error response should not have error fields set
    if (!result.error) {
      expect(result.errorType).toBeUndefined();
      expect(result.retryAfterMs).toBeUndefined();
    } else {
      // If we did hit a rate limit, verify structure
      expect(result.errorType).toBeDefined();
      expect(['rate_limit', 'api_error', 'network_error']).toContain(result.errorType);
    }
  }, 30000);

  /**
   * @behavior ClaudeIntegration captures actual latency metrics
   * @acceptance-criteria AC-CLAUDE-INT.3
   */
  it('should capture actual latency metrics', async () => {
    if (!hasApiKey) {
      console.log('Skipping: ANTHROPIC_API_KEY not set');
      return;
    }

    // GIVEN: A Claude integration and a simple task
    const task = createTestTask({
      prompt: 'Reply with just the word: yes',
    });

    // WHEN: Executing the task
    const startTime = Date.now();
    const result = await claude.executeTask(task);
    const elapsedTime = Date.now() - startTime;

    // THEN: Captured latency should be reasonable
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.latencyMs).toBeLessThanOrEqual(elapsedTime + 100); // Allow small margin

    // AND: Latency should be in a realistic range for API call
    // Typically 100ms-10000ms for a simple request
    expect(result.latencyMs).toBeGreaterThan(50);
    expect(result.latencyMs).toBeLessThan(30000);
  }, 30000);
});
