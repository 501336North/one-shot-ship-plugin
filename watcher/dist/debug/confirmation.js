/**
 * Confirmation Flow
 * Presents root causes to user and captures selection
 */
/**
 * Format root causes as markdown list with evidence
 */
export function formatRootCauses(causes) {
    return causes
        .map((cause, index) => {
        return `${index + 1}. ${cause.cause}\n   Evidence: ${cause.evidence}`;
    })
        .join('\n');
}
/**
 * Create question params for AskUserQuestion tool
 */
export function createConfirmationQuestion(causes) {
    return {
        question: 'Which root cause should we investigate?',
        header: 'Root Causes Found',
        options: causes.map((cause) => ({
            label: cause.cause,
            description: cause.evidence,
        })),
    };
}
/**
 * Check if auto-confirm is appropriate (single cause)
 */
export function shouldAutoConfirm(causes) {
    return causes.length === 1;
}
//# sourceMappingURL=confirmation.js.map