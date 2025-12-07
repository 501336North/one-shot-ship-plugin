/**
 * LogReader - Real-time workflow log tailing and querying
 *
 * Provides chain memory by reading and querying the workflow log
 */
import { WorkflowEvent, AgentInfo } from './workflow-logger.js';
export interface ParsedLogEntry {
    ts: string;
    cmd: string;
    phase?: string;
    event: WorkflowEvent;
    data: Record<string, unknown>;
    agent?: AgentInfo;
}
export interface QueryFilter {
    cmd?: string;
    event?: WorkflowEvent;
    phase?: string;
}
type TailCallback = (entry: ParsedLogEntry) => void;
export declare class LogReader {
    private readonly logPath;
    private tailCallback;
    private tailInterval;
    private lastReadPosition;
    constructor(ossDir: string);
    /**
     * Read all entries from the log file
     */
    readAll(): Promise<ParsedLogEntry[]>;
    /**
     * Start tailing the log file for new entries
     */
    startTailing(callback: TailCallback): void;
    /**
     * Stop tailing the log file
     */
    stopTailing(): void;
    /**
     * Query for the last entry matching the filter
     */
    queryLast(filter: QueryFilter): Promise<ParsedLogEntry | null>;
    private checkForNewEntries;
    private parseContent;
}
export {};
//# sourceMappingURL=log-reader.d.ts.map