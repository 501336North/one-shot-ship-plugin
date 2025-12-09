/**
 * WorkflowLogger - Structured logging for OSS workflow chain
 *
 * Logs entries in hybrid format: JSON line + human-readable summary
 * Includes IRON LAW compliance checklist for every command/agent completion
 */
export type WorkflowEvent = 'START' | 'PHASE_START' | 'PHASE_COMPLETE' | 'MILESTONE' | 'AGENT_SPAWN' | 'AGENT_COMPLETE' | 'COMPLETE' | 'FAILED';
export interface AgentInfo {
    type: string;
    id: string;
    parent_cmd: string;
}
/**
 * IRON LAW compliance checklist - tracked for each command/agent
 */
export interface IronLawChecklist {
    law1_tdd: boolean;
    law2_behavior_tests: boolean;
    law3_no_loops: boolean;
    law4_feature_branch: boolean;
    law5_delegation: boolean;
    law6_docs_synced: boolean;
}
export interface WorkflowLogEntry {
    cmd: string;
    phase?: string;
    event: WorkflowEvent;
    data: Record<string, unknown>;
    agent?: AgentInfo;
    ironLaws?: IronLawChecklist;
}
export declare class WorkflowLogger {
    private readonly logPath;
    private writeQueue;
    constructor(ossDir: string);
    /**
     * Log a workflow entry
     * Writes atomically: JSON line + human summary
     */
    log(entry: WorkflowLogEntry): Promise<void>;
    private doLog;
    /**
     * Format IRON LAW compliance checklist for logging
     */
    private formatIronLawChecklist;
    /**
     * Format human-readable summary line
     */
    private formatHumanSummary;
    private getDescription;
}
//# sourceMappingURL=workflow-logger.d.ts.map