/**
 * @file Claude Baseline Integration Tests
 * @behavior ClaudeIntegration calls Claude API directly (not via proxy) for baseline benchmarking
 * @acceptance-criteria AC-CLAUDE.1 through AC-CLAUDE.3
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaudeIntegration } from '../../../src/services/benchmark/claude-integration.js';
import type { BenchmarkTask } from '../../../src/services/benchmark/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Claude baseline integration', () => {
  let claudeIntegration: ClaudeIntegration;
  let testTask: BenchmarkTask;

  beforeEach(() => {
    vi.clearAllMocks();

    claudeIntegration = new ClaudeIntegration({
      apiKey: 'test-api-key',
    });

    testTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      prompt: 'Review this code for issues',
      expectedBehavior: ['identify issues'],
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior ClaudeIntegration calls Claude API directly using Anthropic's API endpoint
   * @acceptance-criteria AC-CLAUDE.1
   */
  it('should call Claude API directly (not via proxy)', async () => {
    // GIVEN a successful Claude API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Code review complete' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    // WHEN executing a task
    await claudeIntegration.executeTask(testTask);

    // THEN fetch should be called with Anthropic's API endpoint (not a proxy URL)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'test-api-key',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }),
        body: expect.stringContaining('Review this code for issues'),
      })
    );
  });

  /**
   * @behavior ClaudeIntegration captures token usage from API response
   * @acceptance-criteria AC-CLAUDE.2
   */
  it('should capture token usage from response', async () => {
    // GIVEN a Claude API response with token usage
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'msg_456',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-sonnet-20240229',
        content: [{ type: 'text', text: 'Analysis complete' }],
        usage: { input_tokens: 250, output_tokens: 125 },
      }),
    });

    // WHEN executing a task
    const result = await claudeIntegration.executeTask(testTask);

    // THEN the result should contain captured token usage
    expect(result.inputTokens).toBe(250);
    expect(result.outputTokens).toBe(125);
  });

  /**
   * @behavior ClaudeIntegration handles rate limits gracefully by returning error result
   * @acceptance-criteria AC-CLAUDE.3
   */
  it('should handle rate limits gracefully', async () => {
    // GIVEN a rate limit error from Claude API
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: 'Rate limit exceeded. Please retry after 60 seconds.',
        },
      }),
    });

    // WHEN executing a task that gets rate limited
    const result = await claudeIntegration.executeTask(testTask);

    // THEN the result should indicate rate limit error (not throw)
    expect(result.error).toBe(true);
    expect(result.errorType).toBe('rate_limit');
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.output).toContain('rate limit');
  });
});
