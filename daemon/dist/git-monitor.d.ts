/**
 * GitMonitor - Monitor git branch for IRON LAW #4 violations
 *
 * Detects when the current branch is main/master, which violates
 * the rule that agents must never push to protected branches.
 */
import { Issue } from './state-manager.js';
export interface GitBranchResult {
    branch: string;
    isProtected: boolean;
}
export declare class GitMonitor {
    /**
     * Get current git branch name
     */
    getCurrentBranch(): Promise<string>;
    /**
     * Check if on a protected branch and return issue if so
     */
    checkBranch(): Promise<Issue | null>;
}
//# sourceMappingURL=git-monitor.d.ts.map