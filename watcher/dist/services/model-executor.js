/**
 * @file Model Executor
 * @description Execute model requests with fallback support
 *
 * @behavior ModelExecutor executes requests with fallback support
 */
import { detectProvider } from './provider-detector.js';
/**
 * Model Executor - executes requests with fallback support
 */
export class ModelExecutor {
    fallbackCallbacks = [];
    testModeProviderFail = false;
    /**
     * Execute a request with the specified model
     */
    async execute(request) {
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
        }
        catch (error) {
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
            throw new Error(`Provider ${provider} failed: ${error.message}`);
        }
    }
    /**
     * Register a callback for fallback notifications
     */
    onFallback(callback) {
        this.fallbackCallbacks.push(callback);
    }
    /**
     * Notify all registered callbacks about a fallback
     */
    notifyFallback(message) {
        for (const callback of this.fallbackCallbacks) {
            callback(message);
        }
    }
    /**
     * Set test mode to simulate provider failures
     */
    setTestModeProviderFail(fail) {
        this.testModeProviderFail = fail;
    }
}
//# sourceMappingURL=model-executor.js.map