/**
 * @file Model Executor
 * @description Execute model requests with fallback support
 *
 * @behavior ModelExecutor executes requests with fallback support
 */

import { detectProvider } from './provider-detector.js';

/**
 * Execution request
 */
export interface ExecutionRequest {
  prompt: string;
  model: string;
  fallbackEnabled?: boolean;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  provider: string;
  fallbackUsed: boolean;
  response?: string;
  error?: string;
}

/**
 * Fallback notification callback
 */
type FallbackCallback = (message: string) => void;

/**
 * Model Executor - executes requests with fallback support
 */
export class ModelExecutor {
  private fallbackCallbacks: FallbackCallback[] = [];
  private testModeProviderFail = false;

  /**
   * Execute a request with the specified model
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const { prompt, model, fallbackEnabled = true } = request;

    // Detect provider
    const provider = detectProvider(model);

    // Handle Claude/default - execute natively
    if (provider === 'claude' || model === 'default' || model === 'claude') {
      return {
        provider: 'claude',
        fallbackUsed: false,
        response: `[Native Claude execution for: ${prompt.substring(0, 50)}...]`,
      };
    }

    // Try to execute with the specified provider
    try {
      if (this.testModeProviderFail) {
        throw new Error('Provider unavailable (test mode)');
      }

      // In real implementation, this would:
      // 1. Start the proxy server
      // 2. Transform the request
      // 3. Forward to the provider
      // 4. Transform the response

      return {
        provider: provider || 'unknown',
        fallbackUsed: false,
        response: `[Proxy execution via ${provider} for: ${prompt.substring(0, 50)}...]`,
      };
    } catch (error) {
      // Provider failed
      if (fallbackEnabled) {
        // Notify about fallback
        const message = `Model ${model} failed, falling back to Claude`;
        this.notifyFallback(message);

        return {
          provider: 'claude',
          fallbackUsed: true,
          response: `[Fallback to Claude for: ${prompt.substring(0, 50)}...]`,
        };
      }

      // Fallback disabled - throw
      throw new Error(`Provider ${provider} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Register a callback for fallback notifications
   */
  onFallback(callback: FallbackCallback): void {
    this.fallbackCallbacks.push(callback);
  }

  /**
   * Notify all registered callbacks about a fallback
   */
  private notifyFallback(message: string): void {
    for (const callback of this.fallbackCallbacks) {
      callback(message);
    }
  }

  /**
   * Set test mode to simulate provider failures
   */
  setTestModeProviderFail(fail: boolean): void {
    this.testModeProviderFail = fail;
  }
}
