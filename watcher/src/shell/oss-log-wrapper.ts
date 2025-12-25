/**
 * Wrapper for oss-log.sh shell script.
 * Uses ShellExecutor for testability.
 */

import type { ShellExecutor } from '../interfaces/shell-executor.js';

export class OssLogWrapper {
  private scriptPath: string;

  constructor(
    private executor: ShellExecutor,
    hooksPath: string
  ) {
    this.scriptPath = `${hooksPath}/oss-log.sh`;
  }

  async logHook(hookName: string, event: string, reason?: string): Promise<void> {
    const args = ['hook', hookName, event];
    if (reason) {
      args.push(reason);
    }
    await this.executor.execute(this.scriptPath, args);
  }

  async logPhase(workflow: string, phase: string, event: string): Promise<void> {
    await this.executor.execute(this.scriptPath, ['phase', workflow, phase, event]);
  }

  async logTest(workflow: string, result: string, details: string): Promise<void> {
    await this.executor.execute(this.scriptPath, ['test', workflow, result, details]);
  }

  async init(workflow: string): Promise<string> {
    const result = await this.executor.execute(this.scriptPath, ['init', workflow]);
    return result.stdout.trim();
  }
}
