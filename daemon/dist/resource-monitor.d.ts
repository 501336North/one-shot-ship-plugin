/**
 * ResourceMonitor - Tracks system memory and CPU usage
 *
 * Monitors system resources and provides alerts when thresholds are exceeded.
 */
export interface MemoryUsage {
    totalMB: number;
    usedMB: number;
    freeMB: number;
    usedPercent: number;
}
export interface CpuUsage {
    percent: number;
    cores: number;
}
export interface ResourceUsage {
    memory: MemoryUsage;
    cpu: CpuUsage;
}
export interface ResourceThresholds {
    memoryPercent: number;
    cpuPercent: number;
}
export interface ResourceAlert {
    type: 'memory' | 'cpu';
    message: string;
    value: number;
    threshold: number;
}
export declare class ResourceMonitor {
    /**
     * Get current system memory usage
     */
    getMemoryUsage(): MemoryUsage;
    /**
     * Get CPU usage over a sample period
     * @param sampleMs Duration to sample CPU usage in milliseconds
     */
    getCpuUsage(sampleMs?: number): Promise<CpuUsage>;
    /**
     * Get CPU times for all cores
     */
    private getCpuTimes;
    /**
     * Check resource usage against thresholds and return alerts
     */
    checkThresholds(usage: ResourceUsage, thresholds: ResourceThresholds): ResourceAlert[];
    /**
     * Get complete resource usage snapshot
     */
    getResourceUsage(): Promise<ResourceUsage>;
}
//# sourceMappingURL=resource-monitor.d.ts.map