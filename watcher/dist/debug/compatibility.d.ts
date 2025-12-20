/**
 * Build Compatibility
 * Ensures debug output is compatible with /oss:build
 */
import type { FixTask } from './progress-update.js';
export interface BuildPhase {
    name: string;
    tasks: FixTask[];
}
export interface BuildTasks {
    phases: BuildPhase[];
}
/**
 * Format fix tasks for /oss:build compatibility
 */
export declare function formatForBuild(tasks: FixTask[]): BuildTasks;
/**
 * Get command chain suggestion
 */
export declare function getCommandChainSuggestion(): string;
//# sourceMappingURL=compatibility.d.ts.map