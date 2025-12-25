/**
 * Shell execution abstraction for testability.
 * Use RealShellExecutor in production, MockShellExecutor in tests.
 */
import { spawn } from 'child_process';
/**
 * Real shell executor that spawns actual processes.
 * Use in production code.
 */
export class RealShellExecutor {
    async execute(command, args, options) {
        return new Promise((resolve) => {
            const child = spawn(command, args, {
                cwd: options?.cwd,
                env: options?.env,
                shell: false,
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0,
                });
            });
            child.on('error', (err) => {
                resolve({
                    stdout,
                    stderr: stderr + err.message,
                    exitCode: 1,
                });
            });
        });
    }
}
/**
 * Mock shell executor for unit testing.
 * Configure responses with whenCalled().thenReturn()
 * Verify calls with wasCalled() and getCalls()
 */
export class MockShellExecutor {
    responses = [];
    calls = [];
    whenCalled(command, args) {
        return {
            thenReturn: (result) => {
                this.responses.push({ command, args, result });
            },
        };
    }
    async execute(command, args, options) {
        this.calls.push({ command, args, options });
        const match = this.responses.find((r) => r.command === command && JSON.stringify(r.args) === JSON.stringify(args));
        if (match) {
            return match.result;
        }
        return { stdout: '', stderr: '', exitCode: 0 };
    }
    getCalls() {
        return [...this.calls];
    }
    wasCalled(command, args) {
        return this.calls.some((c) => c.command === command && JSON.stringify(c.args) === JSON.stringify(args));
    }
    reset() {
        this.responses = [];
        this.calls = [];
    }
}
//# sourceMappingURL=shell-executor.js.map