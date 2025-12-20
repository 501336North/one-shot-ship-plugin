/**
 * Build Compatibility
 * Ensures debug output is compatible with /oss:build
 */
/**
 * Format fix tasks for /oss:build compatibility
 */
export function formatForBuild(tasks) {
    const phases = [];
    // Group by phase
    const greenTasks = tasks.filter((t) => t.phase === 'green');
    const refactorTasks = tasks.filter((t) => t.phase === 'refactor');
    const regressionTasks = tasks.filter((t) => t.phase === 'regression');
    if (greenTasks.length > 0) {
        phases.push({ name: 'green', tasks: greenTasks });
    }
    if (refactorTasks.length > 0) {
        phases.push({ name: 'refactor', tasks: refactorTasks });
    }
    if (regressionTasks.length > 0) {
        phases.push({ name: 'regression', tasks: regressionTasks });
    }
    return { phases };
}
/**
 * Get command chain suggestion
 */
export function getCommandChainSuggestion() {
    return 'Run /oss:build when ready to execute the fix plan';
}
//# sourceMappingURL=compatibility.js.map