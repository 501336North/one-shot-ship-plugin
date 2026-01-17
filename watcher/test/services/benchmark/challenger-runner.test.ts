/**
 * @file Challenger Runner Tests
 * @behavior ChallengerRunner executes tasks against Ollama and captures responses with token counts
 * @acceptance-criteria AC-CHALLENGER.1 through AC-CHALLENGER.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ChallengerRunner,
  ChallengerResponse,
} from '../../../src/services/benchmark/challenger-runner.js';
import type { ComparisonTask } from '../../../src/services/benchmark/comparison-tasks.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Challenger Runner', () => {
  let runner: ChallengerRunner;
  let testTask: ComparisonTask;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new ChallengerRunner({ model: 'qwen2.5-coder:7b' });
    testTask = {
      id: 'test-task-01',
      name: 'Test Task',
      category: 'code-review',
      codeSnippet: 'function test() { return null; }',
      prompt: 'Review this code for issues',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @behavior ChallengerRunner calls Ollama API with task prompt and code snippet
   * @acceptance-criteria AC-CHALLENGER.1
   */
  it('should call Ollama API with task prompt and code snippet', async () => {
    // GIVEN a successful Ollama API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: 'This code could have null reference issues.',
        prompt_eval_count: 150,
        eval_count: 45,
      }),
    });

    // WHEN running a task
    await runner.run(testTask);

    // THEN fetch should be called with the correct Ollama API endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining(testTask.codeSnippet),
      })
    );

    // AND the body should include both prompt and code snippet
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('qwen2.5-coder:7b');
    expect(callBody.prompt).toContain(testTask.prompt);
    expect(callBody.prompt).toContain(testTask.codeSnippet);
    expect(callBody.stream).toBe(false);
  });

  /**
   * @behavior ChallengerRunner captures response and actual token counts
   * @acceptance-criteria AC-CHALLENGER.2
   */
  it('should capture response and actual token counts', async () => {
    // GIVEN an Ollama response with token counts
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: 'The code has a potential null reference bug.',
        prompt_eval_count: 175,
        eval_count: 89,
      }),
    });

    // WHEN running a task
    const result = await runner.run(testTask);

    // THEN the result should contain the response
    expect(result.taskId).toBe('test-task-01');
    expect(result.response).toBe('The code has a potential null reference bug.');

    // AND should capture actual token counts from Ollama
    expect(result.inputTokens).toBe(175);
    expect(result.outputTokens).toBe(89);

    // AND should have latency measurement
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  /**
   * @behavior ChallengerRunner handles Ollama connection errors gracefully
   * @acceptance-criteria AC-CHALLENGER.3
   */
  it('should handle Ollama connection errors gracefully', async () => {
    // GIVEN Ollama is not running (connection refused)
    mockFetch.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

    // WHEN running a task
    const result = await runner.run(testTask);

    // THEN the result should indicate an error
    expect(result.error).toBe(true);
    expect(result.errorType).toBe('connection_error');
    expect(result.response).toContain('Error');

    // AND tokens should be 0
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  /**
   * @behavior ChallengerRunner handles API errors gracefully
   */
  it('should handle API errors gracefully', async () => {
    // GIVEN Ollama returns an error response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    // WHEN running a task
    const result = await runner.run(testTask);

    // THEN the result should indicate an API error
    expect(result.error).toBe(true);
    expect(result.errorType).toBe('api_error');
  });
});
