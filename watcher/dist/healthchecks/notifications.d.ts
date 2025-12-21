import type { CheckResult } from '../types.js';
interface StatusLineCheckOptions {
    logPath: string;
    sessionActive?: boolean;
    testStatusLine?: boolean;
    projectDir?: string;
}
/**
 * Check status line health (replaces terminal-notifier check)
 * The status line is now the primary notification mechanism in Claude Code
 */
export declare function checkNotifications(options: StatusLineCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=notifications.d.ts.map