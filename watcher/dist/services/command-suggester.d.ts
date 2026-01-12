/**
 * Command Suggester Service
 *
 * Recommends next action based on workflow state.
 * Follows the ideate → plan → build → ship chain.
 */
interface WorkflowContext {
    lastCommand?: string;
    lastStatus?: 'complete' | 'failed' | 'in_progress';
    failureType?: 'test' | 'build' | 'lint' | 'other';
    tddPhase?: 'red' | 'green' | 'refactor';
    hasUncommittedChanges?: boolean;
}
interface Suggestion {
    command: string;
    reason: string;
    confidence: number;
}
export declare class CommandSuggester {
    /**
     * Suggest the next command based on workflow context
     */
    suggestNext(context: WorkflowContext): Suggestion;
    /**
     * Get all possible next commands with confidence scores
     */
    getAllSuggestions(context: WorkflowContext): Suggestion[];
    /**
     * Format suggestion for display
     */
    formatSuggestion(suggestion: Suggestion): string;
}
export {};
//# sourceMappingURL=command-suggester.d.ts.map