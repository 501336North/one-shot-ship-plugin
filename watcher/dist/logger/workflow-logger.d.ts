/**
 * WorkflowLogger - Structured logging for OSS workflow chain
 *
 * Logs entries in hybrid format: JSON line + human-readable summary
 */
export type WorkflowEvent = 'START' | 'PHASE_START' | 'PHASE_COMPLETE' | 'MILESTONE' | 'AGENT_SPAWN' | 'AGENT_COMPLETE' | 'COMPLETE' | 'FAILED';
export interface AgentInfo {
    type: string;
    id: string;
    parent_cmd: string;
}
export interface WorkflowLogEntry {
    cmd: string;
    phase?: string;
    event: WorkflowEvent;
    data: Record<string, unknown>;
    agent?: AgentInfo;
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
     * Format human-readable summary line
     */
    private formatHumanSummary;
    private getDescription;
}
//# sourceMappingURL=workflow-logger.d.ts.map