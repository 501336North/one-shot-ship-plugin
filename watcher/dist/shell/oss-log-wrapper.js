/**
 * Wrapper for oss-log.sh shell script.
 * Uses ShellExecutor for testability.
 */
export class OssLogWrapper {
    executor;
    scriptPath;
    constructor(executor, hooksPath) {
        this.executor = executor;
        this.scriptPath = `${hooksPath}/oss-log.sh`;
    }
    async logHook(hookName, event, reason) {
        const args = ['hook', hookName, event];
        if (reason) {
            args.push(reason);
        }
        await this.executor.execute(this.scriptPath, args);
    }
    async logPhase(workflow, phase, event) {
        await this.executor.execute(this.scriptPath, ['phase', workflow, phase, event]);
    }
    async logTest(workflow, result, details) {
        await this.executor.execute(this.scriptPath, ['test', workflow, result, details]);
    }
    async init(workflow) {
        const result = await this.executor.execute(this.scriptPath, ['init', workflow]);
        return result.stdout.trim();
    }
}
//# sourceMappingURL=oss-log-wrapper.js.map