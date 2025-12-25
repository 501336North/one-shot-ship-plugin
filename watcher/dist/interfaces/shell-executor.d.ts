/**
 * Shell execution abstraction for testability.
 * Use RealShellExecutor in production, MockShellExecutor in tests.
 */
export interface ShellExecutorResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
export interface ShellOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
}
export interface ShellExecutor {
    execute(command: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult>;
}
/**
 * Real shell executor that spawns actual processes.
 * Use in production code.
 */
export declare class RealShellExecutor implements ShellExecutor {
    execute(command: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult>;
}
interface CallRecord {
    command: string;
    args: string[];
    options?: ShellOptions;
}
/**
 * Mock shell executor for unit testing.
 * Configure responses with whenCalled().thenReturn()
 * Verify calls with wasCalled() and getCalls()
 */
export declare class MockShellExecutor implements ShellExecutor {
    private responses;
    private calls;
    whenCalled(command: string, args: string[]): {
        thenReturn: (result: ShellExecutorResult) => void;
    };
    execute(command: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult>;
    getCalls(): CallRecord[];
    wasCalled(command: string, args: string[]): boolean;
    reset(): void;
}
export {};
//# sourceMappingURL=shell-executor.d.ts.map