/**
 * Command Suggester Service
 *
 * Recommends next action based on workflow state.
 * Follows the ideate → plan → build → ship chain.
 */
// Workflow chain: ideate → plan → build → ship
const WORKFLOW_CHAIN = {
    ideate: 'plan',
    plan: 'build',
    build: 'ship',
    ship: 'ideate',
};
// TDD cycle: red → green → refactor → red
const TDD_CYCLE = {
    red: 'green',
    green: 'refactor',
    refactor: 'red',
};
// Failure recovery suggestions
const FAILURE_RECOVERY = {
    test: 'debug',
    build: 'review',
    lint: 'review',
    other: 'debug',
};
export class CommandSuggester {
    /**
     * Suggest the next command based on workflow context
     */
    suggestNext(context) {
        const { lastCommand, lastStatus, failureType, tddPhase, hasUncommittedChanges } = context;
        // Fresh session - start with ideate
        if (!lastCommand) {
            return {
                command: 'ideate',
                reason: 'Start your workflow by brainstorming your next feature or improvement',
                confidence: 0.9,
            };
        }
        // Handle failures first
        if (lastStatus === 'failed' && failureType) {
            const recoveryCommand = FAILURE_RECOVERY[failureType] || 'debug';
            return {
                command: recoveryCommand,
                reason: `${failureType} failure detected - ${recoveryCommand} to investigate`,
                confidence: 0.85,
            };
        }
        // TDD phase transitions
        if (tddPhase && TDD_CYCLE[tddPhase]) {
            const nextPhase = TDD_CYCLE[tddPhase];
            return {
                command: nextPhase,
                reason: `TDD cycle: ${tddPhase.toUpperCase()} → ${nextPhase.toUpperCase()}`,
                confidence: 0.95,
            };
        }
        // Context-aware: uncommitted changes should be shipped
        if (hasUncommittedChanges && lastCommand === 'build' && lastStatus === 'complete') {
            return {
                command: 'ship',
                reason: 'You have uncommitted changes - ship your work',
                confidence: 0.9,
            };
        }
        // Standard workflow chain
        if (lastStatus === 'complete' && WORKFLOW_CHAIN[lastCommand]) {
            const nextCommand = WORKFLOW_CHAIN[lastCommand];
            const reasons = {
                plan: 'Create a TDD implementation plan for your idea',
                build: 'Execute the plan with RED-GREEN-REFACTOR',
                ship: 'Quality check, commit, and create PR',
                ideate: 'Start your next feature or improvement',
            };
            return {
                command: nextCommand,
                reason: reasons[nextCommand] || `Continue workflow with ${nextCommand}`,
                confidence: 0.9,
            };
        }
        // Default: suggest continuing or ideating
        return {
            command: 'ideate',
            reason: 'Start your workflow by brainstorming your next feature or improvement',
            confidence: 0.7,
        };
    }
    /**
     * Get all possible next commands with confidence scores
     */
    getAllSuggestions(context) {
        const primary = this.suggestNext(context);
        const suggestions = [primary];
        // Add alternative suggestions based on context
        if (context.lastCommand && context.lastStatus === 'complete') {
            // Review is always a good option after completing work
            if (!suggestions.some(s => s.command === 'review')) {
                suggestions.push({
                    command: 'review',
                    reason: 'Get feedback on your recent work',
                    confidence: 0.5,
                });
            }
        }
        return suggestions.sort((a, b) => b.confidence - a.confidence);
    }
    /**
     * Format suggestion for display
     */
    formatSuggestion(suggestion) {
        const confidencePercent = Math.round(suggestion.confidence * 100);
        return `→ /oss:${suggestion.command} (${confidencePercent}% confidence)\n  ${suggestion.reason}`;
    }
}
//# sourceMappingURL=command-suggester.js.map