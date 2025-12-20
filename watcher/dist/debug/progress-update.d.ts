/**
 * Progress Update
 * Updates PROGRESS.md with fix tasks
 */
export interface FixTask {
    id: number;
    description: string;
    phase: 'green' | 'refactor' | 'regression';
}
/**
 * Append fix tasks to existing PROGRESS.md content
 */
export declare function appendFixTasks(existingContent: string, tasks: FixTask[]): string;
/**
 * Create new PROGRESS.md content
 */
export declare function createProgressContent(tasks: FixTask[], featureName: string): string;
//# sourceMappingURL=progress-update.d.ts.map