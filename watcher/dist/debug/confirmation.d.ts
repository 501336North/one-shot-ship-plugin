/**
 * Confirmation Flow
 * Presents root causes to user and captures selection
 */
import type { RootCause } from './investigation.js';
export interface QuestionParams {
    question: string;
    header: string;
    options: Array<{
        label: string;
        description: string;
    }>;
}
/**
 * Format root causes as markdown list with evidence
 */
export declare function formatRootCauses(causes: RootCause[]): string;
/**
 * Create question params for AskUserQuestion tool
 */
export declare function createConfirmationQuestion(causes: RootCause[]): QuestionParams;
/**
 * Check if auto-confirm is appropriate (single cause)
 */
export declare function shouldAutoConfirm(causes: RootCause[]): boolean;
//# sourceMappingURL=confirmation.d.ts.map