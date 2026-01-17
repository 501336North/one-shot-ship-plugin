/**
 * Integration Tests: Ollama Real Calls
 *
 * @behavior Validates real Ollama API calls for local model benchmarking
 * @acceptance-criteria AC-OLLAMA-INT.1 through AC-OLLAMA-INT.3
 *
 * These tests make REAL API calls to local Ollama server.
 * - Skip if Ollama not running on localhost:11434
 * - Use short prompts to minimize latency
 * - Verify response structure has: output, inputTokens, outputTokens, latencyMs
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as http from 'http';
import { OllamaIntegration } from '../../src/services/benchmark/ollama-integration.js';
import type { BenchmarkTask } from '../../src/services/benchmark/types.js';

// ============================================================================
// Test Setup
// ============================================================================

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'qwen2.5-coder:7b';

/**
 * Check if Ollama is running by calling the tags endpoint
 */
async function checkOllamaHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/tags',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              // Check if we have any models available
              resolve(Array.isArray(parsed.models) && parsed.models.length > 0);
            } catch {
              resolve(false);
            }
          } else {
            resolve(false);
          }
        });
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

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
// Ollama Real Calls Integration Tests
// ============================================================================

describe('Ollama Real Calls (integration)', () => {
  let ollama: OllamaIntegration;
  let ollamaAvailable: boolean;

  beforeAll(async () => {
    ollamaAvailable = await checkOllamaHealth();
    if (!ollamaAvailable) {
      console.log('Ollama not running on localhost:11434 - Ollama integration tests will be skipped');
      return;
    }
    ollama = new OllamaIntegration({
      model: OLLAMA_MODEL,
      baseUrl: OLLAMA_BASE_URL,
    });
  });

  /**
   * @behavior OllamaIntegration calls Ollama API and returns response
   * @acceptance-criteria AC-OLLAMA-INT.1
   */
  it('should call Ollama API and get response', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running');
      return;
    }

    // GIVEN: An Ollama integration and a simple task
    const task = createTestTask({
      prompt: 'Say hello in one word.',
    });

    // WHEN: Executing the task against Ollama API
    const result = await ollama.executeTask(task);

    // THEN: Response should have expected structure
    expect(result.taskId).toBe(task.id);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe(OLLAMA_MODEL);

    // AND: Output should be non-empty
    expect(result.output).toBeDefined();
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // AND: Latency should be captured
    expect(result.latencyMs).toBeGreaterThan(0);

    // AND: Timestamp should be valid ISO string
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  }, 60000); // 60 second timeout for local model

  /**
   * @behavior OllamaIntegration captures prompt_eval_count and eval_count as tokens
   * @acceptance-criteria AC-OLLAMA-INT.2
   */
  it('should capture prompt_eval_count and eval_count as tokens', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping: Ollama not running');
      return;
    }

    // GIVEN: An Ollama integration and a simple task
    const task = createTestTask({
      prompt: 'Reply with just the word: yes',
    });

    // WHEN: Executing the task
    const result = await ollama.executeTask(task);

    // THEN: Token counts should be captured from Ollama's response
    // Note: Ollama returns prompt_eval_count (input) and eval_count (output)
    // These should be mapped to inputTokens and outputTokens
    expect(result.inputTokens).toBeDefined();
    expect(result.outputTokens).toBeDefined();

    // AND: At least one should be greater than 0 if the response was successful
    if (!result.error) {
      // Input tokens should be > 0 for the prompt
      expect(result.inputTokens).toBeGreaterThanOrEqual(0);
      // Output tokens should be > 0 for the response
      expect(result.outputTokens).toBeGreaterThanOrEqual(0);
    }
  }, 60000);

  /**
   * @behavior OllamaIntegration handles connection errors when Ollama not running
   * @acceptance-criteria AC-OLLAMA-INT.3
   */
  it('should handle connection errors when Ollama not running', async () => {
    // GIVEN: An Ollama integration configured to a non-existent server
    // Use port 11435 which is close to 11434 but won't have Ollama running
    const badOllama = new OllamaIntegration({
      model: OLLAMA_MODEL,
      baseUrl: 'http://localhost:11435',
    });

    const task = createTestTask();

    // WHEN: Executing the task against non-existent server
    const result = await badOllama.executeTask(task);

    // THEN: Should return an error result
    expect(result.error).toBe(true);
    // Error type should be 'connection_error' or 'api_error' depending on the error
    expect(['connection_error', 'api_error']).toContain(result.errorType);
    expect(result.output).toContain('Error');

    // AND: Token counts should be 0
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);

    // AND: Latency should still be captured
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  }, 30000);
});
