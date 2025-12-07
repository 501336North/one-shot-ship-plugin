/**
 * IronLawMonitor - Continuous IRON LAW compliance monitoring
 *
 * @behavior Monitors git state, file changes, and tool usage for IRON LAW violations
 * @acceptance-criteria AC-IRON.1 through AC-IRON.12
 */
export type IronLawViolationType = 'iron_law_branch' | 'iron_law_tdd' | 'iron_law_docs' | 'iron_law_delegation';
export interface IronLawViolation {
    law: number;
    type: IronLawViolationType;
    message: string;
    detected: string;
    resolved: string | null;
    correctiveAction?: string;
}
export interface FileChange {
    path: string;
    action: 'created' | 'modified' | 'deleted';
    timestamp: string;
}
export interface ToolCall {
    tool: string;
    path: string;
    timestamp: string;
}
export interface IronLawState {
    lastCheck: string;
    violations: IronLawViolation[];
    recentFileChanges: FileChange[];
    recentToolCalls: ToolCall[];
}
export interface IronLawMonitorOptions {
    projectDir: string;
    stateFile?: string;
}
export declare class IronLawMonitor {
    private projectDir;
    private stateFile;
    private state;
    private activeFeature;
    private pendingSourceFiles;
    constructor(options: IronLawMonitorOptions);
    /**
     * Run all IRON LAW checks and return violations
     */
    check(): Promise<IronLawViolation[]>;
    /**
     * Track a file change for TDD monitoring
     */
    trackFileChange(filePath: string, action: 'created' | 'modified' | 'deleted'): void;
    /**
     * Track a tool call for TDD order verification
     */
    trackToolCall(tool: string, filePath: string): void;
    /**
     * Set the active feature being worked on
     */
    setActiveFeature(featureName: string): void;
    /**
     * Get current state
     */
    getState(): IronLawState;
    private checkGitBranch;
    private checkTdd;
    private checkDevDocs;
    private isSourceFile;
    private isTestFile;
    private getTestFileForSource;
    private getSourceFileForTest;
    private updateViolationState;
    private loadState;
    private saveState;
}
//# sourceMappingURL=iron-law-monitor.d.ts.map