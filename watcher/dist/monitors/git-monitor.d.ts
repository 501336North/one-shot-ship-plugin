import { QueueManager } from '../queue/manager.js';
/**
 * CI Status from GitHub Actions or similar
 */
export interface CIStatus {
    status: 'success' | 'failure' | 'pending' | 'unknown';
    workflow: string;
    branch: string;
    commit: string;
    url?: string;
}
/**
 * PR check result
 */
export interface PRCheckResult {
    passed: boolean;
    checkName: string;
    prNumber: number;
    branch: string;
    errorMessage?: string;
}
/**
 * CI analysis result
 */
export interface CIAnalysisResult {
    hasFailure: boolean;
    isPending: boolean;
    details?: string;
}
/**
 * PR check analysis result
 */
export interface PRCheckAnalysisResult {
    hasFailure: boolean;
    details?: string;
}
/**
 * Push analysis result
 */
export interface PushAnalysisResult {
    hasFailure: boolean;
    failureType?: 'rejected' | 'permission' | 'network' | 'unknown';
    details?: string;
}
/**
 * Git Monitor - Monitors git operations and CI status
 *
 * Implements AC-004.1 through AC-004.5 from REQUIREMENTS.md
 */
export declare class GitMonitor {
    private readonly queueManager;
    constructor(queueManager: QueueManager);
    /**
     * Analyze CI status
     */
    analyzeCIStatus(status: CIStatus): Promise<CIAnalysisResult>;
    /**
     * Analyze PR check result
     */
    analyzePRCheck(check: PRCheckResult): Promise<PRCheckAnalysisResult>;
    /**
     * Analyze git push output
     */
    analyzePushOutput(output: string): Promise<PushAnalysisResult>;
    /**
     * Report CI failure
     */
    reportCIFailure(status: CIStatus): Promise<void>;
    /**
     * Report PR check failure
     */
    reportPRCheckFailure(check: PRCheckResult): Promise<void>;
    /**
     * Report push failure
     */
    reportPushFailure(errorMessage: string, failureType: 'rejected' | 'permission' | 'network' | 'unknown', branch: string): Promise<void>;
    /**
     * Parse gh CLI status output
     */
    parseGHStatus(output: string): Promise<CIStatus>;
}
//# sourceMappingURL=git-monitor.d.ts.map