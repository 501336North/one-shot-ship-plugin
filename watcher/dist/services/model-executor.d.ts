/**
 * @file Model Executor
 * @description Execute model requests with fallback support
 *
 * @behavior ModelExecutor executes requests with fallback support
 */
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
export declare class ModelExecutor {
    private fallbackCallbacks;
    private testModeProviderFail;
    /**
     * Execute a request with the specified model
     */
    execute(request: ExecutionRequest): Promise<ExecutionResult>;
    /**
     * Register a callback for fallback notifications
     */
    onFallback(callback: FallbackCallback): void;
    /**
     * Notify all registered callbacks about a fallback
     */
    private notifyFallback;
    /**
     * Set test mode to simulate provider failures
     */
    setTestModeProviderFail(fail: boolean): void;
}
export {};
//# sourceMappingURL=model-executor.d.ts.map