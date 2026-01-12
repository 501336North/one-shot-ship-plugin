/**
 * Analytics Formatter Service
 *
 * Formats metrics for human-readable terminal display.
 * Provides dashboard view, compact summaries, and colored output.
 */
interface DashboardData {
    sessionCount: number;
    totalCommands: number;
    successRate: number;
    averageSessionDuration: number;
}
interface TopCommand {
    command: string;
    count: number;
}
interface TddMetricsData {
    redPhaseTime: number;
    greenPhaseTime: number;
    refactorPhaseTime: number;
    cycleCount: number;
}
interface CompactSummaryData {
    commandCount: number;
    successRate: number;
    duration: number;
}
export declare class AnalyticsFormatter {
    /**
     * Format duration in milliseconds to human-readable string
     */
    formatDuration(ms: number): string;
    /**
     * Format success rate with color based on value
     */
    formatSuccessRate(rate: number): string;
    /**
     * Format full dashboard view
     */
    formatDashboard(data: DashboardData): string;
    /**
     * Format top commands list
     */
    formatTopCommands(commands: TopCommand[]): string;
    /**
     * Format TDD metrics
     */
    formatTddMetrics(data: TddMetricsData): string;
    /**
     * Format compact one-line summary for status line
     */
    formatCompactSummary(data: CompactSummaryData): string;
    /**
     * Format a progress bar
     */
    formatProgressBar(current: number, total: number, width?: number): string;
    /**
     * Format a metric change (up/down arrow with color)
     */
    formatChange(change: number): string;
}
export {};
//# sourceMappingURL=analytics-formatter.d.ts.map