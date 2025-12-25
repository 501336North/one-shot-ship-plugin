/**
 * Wrapper for oss-log.sh shell script.
 * Uses ShellExecutor for testability.
 */
import type { ShellExecutor } from '../interfaces/shell-executor.js';
export declare class OssLogWrapper {
    private executor;
    private scriptPath;
    constructor(executor: ShellExecutor, hooksPath: string);
    logHook(hookName: string, event: string, reason?: string): Promise<void>;
    logPhase(workflow: string, phase: string, event: string): Promise<void>;
    logTest(workflow: string, result: string, details: string): Promise<void>;
    init(workflow: string): Promise<string>;
}
//# sourceMappingURL=oss-log-wrapper.d.ts.map