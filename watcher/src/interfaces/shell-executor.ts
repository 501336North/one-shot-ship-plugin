/**
 * Shell execution abstraction for testability.
 * Use RealShellExecutor in production, MockShellExecutor in tests.
 */

import { spawn } from 'child_process';

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
export class RealShellExecutor implements ShellExecutor {
  async execute(command: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult> {
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

interface CallRecord {
  command: string;
  args: string[];
  options?: ShellOptions;
}

interface MockResponse {
  command: string;
  args: string[];
  result: ShellExecutorResult;
}

/**
 * Mock shell executor for unit testing.
 * Configure responses with whenCalled().thenReturn()
 * Verify calls with wasCalled() and getCalls()
 */
export class MockShellExecutor implements ShellExecutor {
  private responses: MockResponse[] = [];
  private calls: CallRecord[] = [];

  whenCalled(command: string, args: string[]): { thenReturn: (result: ShellExecutorResult) => void } {
    return {
      thenReturn: (result: ShellExecutorResult) => {
        this.responses.push({ command, args, result });
      },
    };
  }

  async execute(command: string, args: string[], options?: ShellOptions): Promise<ShellExecutorResult> {
    this.calls.push({ command, args, options });

    const match = this.responses.find(
      (r) => r.command === command && JSON.stringify(r.args) === JSON.stringify(args)
    );

    if (match) {
      return match.result;
    }

    return { stdout: '', stderr: '', exitCode: 0 };
  }

  getCalls(): CallRecord[] {
    return [...this.calls];
  }

  wasCalled(command: string, args: string[]): boolean {
    return this.calls.some(
      (c) => c.command === command && JSON.stringify(c.args) === JSON.stringify(args)
    );
  }

  reset(): void {
    this.responses = [];
    this.calls = [];
  }
}
