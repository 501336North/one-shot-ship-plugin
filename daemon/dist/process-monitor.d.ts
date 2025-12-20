/**
 * ProcessMonitor - Detect and track running test processes
 *
 * Finds vitest, npm test, and other test processes and tracks their age
 * to identify hung processes.
 */
export type ProcessType = 'vitest' | 'npm-test' | 'jest' | 'node' | 'unknown';
export interface ProcessInfo {
    pid: number;
    command: string;
    startTime: Date;
    cpuPercent: number;
    memoryMB: number;
}
export declare class ProcessMonitor {
    /**
     * Find processes matching a search term
     */
    findProcesses(search: string): Promise<ProcessInfo[]>;
    /**
     * Parse a ps output line into ProcessInfo
     */
    private parseProcessLine;
    /**
     * Parse process start time from ps output
     * macOS format: "10:18PM", "9:28AM", "MonDD", etc.
     */
    private parseStartTime;
    /**
     * Get process age in milliseconds
     */
    getProcessAge(process: ProcessInfo): number;
    /**
     * Check if process exceeds timeout threshold
     */
    isProcessHung(process: ProcessInfo, timeoutMs: number): boolean;
    /**
     * Determine process type from command
     */
    getProcessType(command: string): ProcessType;
}
//# sourceMappingURL=process-monitor.d.ts.map